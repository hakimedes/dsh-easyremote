import { randomBytes } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

import { loadInstallState, saveInstallState, type InstallState } from './install-state.js';
import {
  buildHubLaunch,
  buildNamedTunnelLaunch,
  buildQuickTunnelLaunch,
  writeConnectorConfig,
  writeNamedTunnelConfig,
  writePublicEntry,
  writeQuickTunnelConfig,
  type ProcessLaunch,
  type RuntimePaths,
} from './runtime.js';
import type { HubMeta } from './supervisor.js';

type ControllerDependencies = {
  ensureCloudflared: () => Promise<void>;
  findPort: (preferred?: number) => Promise<number>;
  spawnProcess: (launch: ProcessLaunch, role: 'hub' | 'tunnel') => ChildProcess;
  waitForHub: (origin: string) => Promise<HubMeta>;
  waitForQuick: (child: ChildProcess) => Promise<string>;
  waitForNamed?: (publicOrigin: string, child: ChildProcess) => Promise<void>;
  provisionNamed?: (options: {
    executable: string;
    originCertificate: string;
    credentialsFile: string;
    tunnelName: string;
    hostname: string;
  }) => Promise<{ tunnelId: string; credentialsFile: string }>;
  stopProcess?: (child: ChildProcess) => Promise<void>;
  hubScript: string;
  createInstallId: () => string;
  nodeName?: () => string;
};

export type StartResult = {
  state: InstallState;
  recoveryRequired: boolean;
  alreadyRunning: boolean;
};

export class EasyRemoteController {
  private hubProcess: ChildProcess | null = null;
  private tunnelProcess: ChildProcess | null = null;

  constructor(
    private readonly paths: RuntimePaths,
    private readonly dependencies: ControllerDependencies,
  ) {}

  async startQuick(): Promise<StartResult> {
    const previous = loadInstallState(this.paths.installState);
    if (this.hubProcess || this.tunnelProcess) {
      const hubRunning = this.hubProcess?.exitCode == null && this.hubProcess?.signalCode == null;
      const tunnelRunning = this.tunnelProcess?.exitCode == null && this.tunnelProcess?.signalCode == null;
      if (hubRunning && tunnelRunning && previous?.activeMode === 'quick') {
        return { state: previous, recoveryRequired: false, alreadyRunning: true };
      }
      throw new Error('EasyRemote is already running in this process');
    }
    const port = await this.dependencies.findPort(previous?.hub.port);
    await this.dependencies.ensureCloudflared();
    const jwtSecret = this.loadOrCreateJwtSecret();
    writePublicEntry(this.paths, `http://127.0.0.1:${port}`);
    writeQuickTunnelConfig(this.paths);

    try {
      this.hubProcess = this.dependencies.spawnProcess(
        buildHubLaunch(this.paths, port, jwtSecret, this.dependencies.hubScript),
        'hub',
      );
      this.writePid(this.paths.hubPid, this.hubProcess.pid);
      const localMeta = await this.dependencies.waitForHub(`http://127.0.0.1:${port}`);
      this.assertHubIdentity(previous, localMeta);

      this.tunnelProcess = this.dependencies.spawnProcess(
        buildQuickTunnelLaunch(this.paths, port, this.paths.cloudflaredExecutable),
        'tunnel',
      );
      this.writePid(this.paths.tunnelPid, this.tunnelProcess.pid);
      const publicOrigin = await this.dependencies.waitForQuick(this.tunnelProcess);
      writePublicEntry(this.paths, publicOrigin);
      writeConnectorConfig(this.paths, publicOrigin, this.dependencies.nodeName?.() ?? hostname());

      const state: InstallState = {
        schemaVersion: 1,
        installId: previous?.installId ?? this.dependencies.createInstallId(),
        activeMode: 'quick',
        hub: {
          hubId: previous?.hub.hubId || localMeta.hubId,
          host: '127.0.0.1',
          port,
        },
        tunnel: { publicOrigin },
        autostart: 'user-login',
      };
      saveInstallState(this.paths.installState, state);
      return {
        state,
        recoveryRequired: Boolean(previous?.tunnel.publicOrigin && previous.tunnel.publicOrigin !== publicOrigin),
        alreadyRunning: false,
      };
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async startNamed(): Promise<StartResult> {
    if (this.hubProcess || this.tunnelProcess) throw new Error('EasyRemote is already running in this process');
    const previous = loadInstallState(this.paths.installState);
    if (previous?.activeMode !== 'named' || !previous.tunnel.tunnelId
      || !previous.tunnel.hostname || !previous.tunnel.publicOrigin) {
      throw new Error('Named Tunnel is not configured; run setup first');
    }
    const port = await this.dependencies.findPort(previous.hub.port);
    await this.dependencies.ensureCloudflared();
    const jwtSecret = this.loadOrCreateJwtSecret();
    writePublicEntry(this.paths, previous.tunnel.publicOrigin);
    writeConnectorConfig(this.paths, previous.tunnel.publicOrigin, this.dependencies.nodeName?.() ?? hostname());
    try {
      this.hubProcess = this.dependencies.spawnProcess(
        buildHubLaunch(this.paths, port, jwtSecret, this.dependencies.hubScript),
        'hub',
      );
      this.writePid(this.paths.hubPid, this.hubProcess.pid);
      const localMeta = await this.dependencies.waitForHub(`http://127.0.0.1:${port}`);
      this.assertHubIdentity(previous, localMeta);
      this.tunnelProcess = this.dependencies.spawnProcess(
        buildNamedTunnelLaunch(this.paths, previous.tunnel.tunnelId, this.paths.cloudflaredExecutable),
        'tunnel',
      );
      this.writePid(this.paths.tunnelPid, this.tunnelProcess.pid);
      await this.dependencies.waitForNamed?.(previous.tunnel.publicOrigin, this.tunnelProcess);
      const state: InstallState = {
        ...previous,
        hub: { ...previous.hub, hubId: previous.hub.hubId || localMeta.hubId, port },
      };
      saveInstallState(this.paths.installState, state);
      return { state, recoveryRequired: false, alreadyRunning: false };
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async configureNamed(options: {
    hostname: string;
    tunnelName: string;
    originCertificate: string;
  }): Promise<StartResult> {
    if (!this.dependencies.provisionNamed) throw new Error('Named Tunnel provisioning is unavailable');
    if (this.running) await this.stop();
    const previous = loadInstallState(this.paths.installState);
    const port = await this.dependencies.findPort(previous?.hub.port);
    await this.dependencies.ensureCloudflared();
    const jwtSecret = this.loadOrCreateJwtSecret();
    const publicOrigin = `https://${options.hostname}`;
    writePublicEntry(this.paths, publicOrigin);
    try {
      this.hubProcess = this.dependencies.spawnProcess(
        buildHubLaunch(this.paths, port, jwtSecret, this.dependencies.hubScript),
        'hub',
      );
      this.writePid(this.paths.hubPid, this.hubProcess.pid);
      const localMeta = await this.dependencies.waitForHub(`http://127.0.0.1:${port}`);
      this.assertHubIdentity(previous, localMeta);
      const credentials = await this.dependencies.provisionNamed({
        executable: this.paths.cloudflaredExecutable,
        originCertificate: options.originCertificate,
        credentialsFile: join(this.paths.cloudflaredDir, `${options.tunnelName}.json`),
        tunnelName: options.tunnelName,
        hostname: options.hostname,
      });
      writeNamedTunnelConfig(this.paths, {
        tunnelId: credentials.tunnelId,
        credentialsFile: credentials.credentialsFile,
        hostname: options.hostname,
        hubPort: port,
      });
      writeConnectorConfig(this.paths, publicOrigin, this.dependencies.nodeName?.() ?? hostname());
      this.tunnelProcess = this.dependencies.spawnProcess(
        buildNamedTunnelLaunch(this.paths, credentials.tunnelId, this.paths.cloudflaredExecutable),
        'tunnel',
      );
      this.writePid(this.paths.tunnelPid, this.tunnelProcess.pid);
      await this.dependencies.waitForNamed?.(publicOrigin, this.tunnelProcess);
      const state: InstallState = {
        schemaVersion: 1,
        installId: previous?.installId ?? this.dependencies.createInstallId(),
        activeMode: 'named',
        hub: {
          hubId: previous?.hub.hubId || localMeta.hubId,
          host: '127.0.0.1',
          port,
        },
        tunnel: {
          publicOrigin,
          hostname: options.hostname,
          tunnelId: credentials.tunnelId,
        },
        autostart: 'user-login',
      };
      saveInstallState(this.paths.installState, state);
      return {
        state,
        recoveryRequired: Boolean(previous?.tunnel.publicOrigin && previous.tunnel.publicOrigin !== publicOrigin),
        alreadyRunning: false,
      };
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    const processes = [this.tunnelProcess, this.hubProcess].filter((child): child is ChildProcess => Boolean(child));
    this.tunnelProcess = null;
    this.hubProcess = null;
    for (const child of processes) {
      if (this.dependencies.stopProcess) await this.dependencies.stopProcess(child);
      else if (child.exitCode == null && child.signalCode == null) child.kill('SIGTERM');
    }
  }

  get running() {
    return Boolean(this.hubProcess || this.tunnelProcess);
  }

  waitForExit(): Promise<{ role: 'hub' | 'tunnel'; code: number | null }> {
    const processes = [
      ['hub', this.hubProcess],
      ['tunnel', this.tunnelProcess],
    ] as const;
    if (!processes.some(([, child]) => child)) throw new Error('EasyRemote is not running');
    return new Promise((resolve) => {
      for (const [role, child] of processes) {
        if (!child) continue;
        if (child.exitCode != null || child.signalCode != null) {
          resolve({ role, code: child.exitCode });
          return;
        }
        child.once('close', (code) => resolve({ role, code }));
      }
    });
  }

  private loadOrCreateJwtSecret() {
    if (existsSync(this.paths.jwtSecret)) return readFileSync(this.paths.jwtSecret, 'utf8').trim();
    mkdirSync(this.paths.secretsDir, { recursive: true, mode: 0o700 });
    const value = randomBytes(48).toString('hex');
    writeFileSync(this.paths.jwtSecret, `${value}\n`, { mode: 0o600 });
    if (process.platform !== 'win32') chmodSync(this.paths.jwtSecret, 0o600);
    return value;
  }

  private writePid(path: string, pid: number | undefined) {
    if (!pid) return;
    mkdirSync(this.paths.runDir, { recursive: true, mode: 0o700 });
    writeFileSync(path, `${pid}\n`, { mode: 0o600 });
  }

  private assertHubIdentity(previous: InstallState | null, localMeta: HubMeta) {
    if (previous?.hub.hubId && previous.hub.hubId !== localMeta.hubId) {
      throw new Error('Hub identity mismatch: the local database does not belong to this installation; restore the correct backup before continuing');
    }
  }
}
