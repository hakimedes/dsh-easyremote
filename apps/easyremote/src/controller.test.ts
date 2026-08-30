import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { EasyRemoteController } from './controller.js';
import { loadInstallState } from './install-state.js';
import { createRuntimePaths, writePublicEntry } from './runtime.js';
import { saveInstallState } from './install-state.js';

function child() {
  const value = new EventEmitter() as any;
  value.exitCode = null;
  value.signalCode = null;
  value.stdout = null;
  value.stderr = null;
  value.kill = vi.fn();
  value.pid = 123;
  return value;
}

describe('EasyRemote controller', () => {
  it('starts Quick mode locally and persists the dynamic origin', async () => {
    const paths = createRuntimePaths(mkdtempSync(join(tmpdir(), 'easyremote-controller-')));
    const hub = child();
    const tunnel = child();
    const spawnProcess = vi.fn()
      .mockReturnValueOnce(hub)
      .mockReturnValueOnce(tunnel);
    const controller = new EasyRemoteController(paths, {
      ensureCloudflared: async () => {},
      findPort: async () => 8787,
      spawnProcess,
      waitForHub: async () => ({ hubId: 'stable-hub-id', publicOrigin: 'http://127.0.0.1:8787' }),
      waitForQuick: async () => 'https://black-whale.trycloudflare.com',
      hubScript: '/runtime/hub/index.js',
      createInstallId: () => 'stable-install-id',
      nodeName: () => 'Studio Mac',
    });

    const result = await controller.startQuick();
    expect(result.state).toMatchObject({
      installId: 'stable-install-id',
      activeMode: 'quick',
      hub: { hubId: 'stable-hub-id', host: '127.0.0.1', port: 8787 },
      tunnel: { publicOrigin: 'https://black-whale.trycloudflare.com' },
    });
    expect(loadInstallState(paths.installState)).toEqual(result.state);
    expect(JSON.parse(readFileSync(paths.connectorConfig, 'utf8')).hubUrl).toBe('http://127.0.0.1:8787');
    expect(JSON.parse(readFileSync(paths.publicEntry, 'utf8')).publicOrigin).toBe('https://black-whale.trycloudflare.com');
    expect(spawnProcess).toHaveBeenCalledTimes(2);
  });

  it('does not publish Quick mode before the public Hub is reachable', async () => {
    const paths = createRuntimePaths(mkdtempSync(join(tmpdir(), 'easyremote-controller-')));
    let releasePublicHub!: (value: { hubId: string; publicOrigin: string }) => void;
    const publicHubReady = new Promise<{ hubId: string; publicOrigin: string }>((resolve) => {
      releasePublicHub = resolve;
    });
    const controller = new EasyRemoteController(paths, {
      ensureCloudflared: async () => {},
      findPort: async () => 8787,
      spawnProcess: () => child(),
      waitForHub: async (origin) => {
        if (origin === 'http://127.0.0.1:8787') {
          return { hubId: 'stable-hub-id', publicOrigin: origin };
        }
        return publicHubReady;
      },
      waitForQuick: async () => 'https://black-whale.trycloudflare.com',
      hubScript: '/runtime/hub/index.js',
      createInstallId: () => 'stable-install-id',
    });

    const starting = controller.startQuick();
    const stateAfterUrl = await Promise.race([
      starting.then(() => 'published'),
      new Promise<'waiting'>((resolve) => setImmediate(() => resolve('waiting'))),
    ]);

    expect(stateAfterUrl).toBe('waiting');
    expect(existsSync(paths.connectorConfig)).toBe(false);
    releasePublicHub({
      hubId: 'stable-hub-id',
      publicOrigin: 'https://black-whale.trycloudflare.com',
    });
    await expect(starting).resolves.toMatchObject({
      state: { tunnel: { publicOrigin: 'https://black-whale.trycloudflare.com' } },
    });
    expect(existsSync(paths.connectorConfig)).toBe(true);
  });

  it('keeps identity and data when Quick mode receives a new public address', async () => {
    const paths = createRuntimePaths(mkdtempSync(join(tmpdir(), 'easyremote-controller-')));
    let nextOrigin = 'https://one.trycloudflare.com';
    const controller = new EasyRemoteController(paths, {
      ensureCloudflared: async () => {},
      findPort: async () => 8787,
      spawnProcess: () => child(),
      waitForHub: async () => ({ hubId: 'stable-hub-id', publicOrigin: 'http://127.0.0.1:8787' }),
      waitForQuick: async () => nextOrigin,
      hubScript: '/runtime/hub/index.js',
      createInstallId: () => 'stable-install-id',
      nodeName: () => 'Studio Mac',
    });
    const first = await controller.startQuick();
    await controller.stop();
    nextOrigin = 'https://two.trycloudflare.com';
    const second = await controller.startQuick();
    expect(second.state.installId).toBe(first.state.installId);
    expect(second.state.hub.hubId).toBe(first.state.hub.hubId);
    expect(second.state.tunnel.publicOrigin).toBe('https://two.trycloudflare.com');
    expect(second.recoveryRequired).toBe(true);
  });

  it('returns the live Quick connection when Quick Start is clicked again', async () => {
    const paths = createRuntimePaths(mkdtempSync(join(tmpdir(), 'easyremote-controller-')));
    const spawnProcess = vi.fn()
      .mockReturnValueOnce(child())
      .mockReturnValueOnce(child());
    const controller = new EasyRemoteController(paths, {
      ensureCloudflared: async () => {},
      findPort: async () => 8787,
      spawnProcess,
      waitForHub: async () => ({ hubId: 'stable-hub-id', publicOrigin: 'http://127.0.0.1:8787' }),
      waitForQuick: async () => 'https://black-whale.trycloudflare.com',
      hubScript: '/runtime/hub/index.js',
      createInstallId: () => 'stable-install-id',
      nodeName: () => 'Windows PC',
    });

    const first = await controller.startQuick();
    const second = await controller.startQuick();

    expect(second).toEqual({
      state: first.state,
      recoveryRequired: false,
      alreadyRunning: true,
    });
    expect(spawnProcess).toHaveBeenCalledTimes(2);
  });

  it('restarts a configured Named Tunnel against the same local Hub', async () => {
    const paths = createRuntimePaths(mkdtempSync(join(tmpdir(), 'easyremote-controller-')));
    saveInstallState(paths.installState, {
      schemaVersion: 1,
      installId: 'stable-install-id',
      activeMode: 'named',
      hub: { hubId: 'stable-hub-id', host: '127.0.0.1', port: 8787 },
      tunnel: {
        publicOrigin: 'https://dsh.example.com',
        hostname: 'dsh.example.com',
        tunnelId: 'stable-tunnel-id',
      },
      autostart: 'user-login',
    });
    writePublicEntry(paths, 'https://dsh.example.com');
    const spawnProcess = vi.fn().mockReturnValue(child());
    const controller = new EasyRemoteController(paths, {
      ensureCloudflared: async () => {},
      findPort: async () => 8787,
      spawnProcess,
      waitForHub: async () => ({ hubId: 'stable-hub-id', publicOrigin: 'https://dsh.example.com' }),
      waitForQuick: async () => { throw new Error('quick should not run'); },
      waitForNamed: async () => {},
      hubScript: '/runtime/hub/index.js',
      createInstallId: () => 'different-id',
    });
    const result = await controller.startNamed();
    expect(result.state.activeMode).toBe('named');
    expect(result.state.installId).toBe('stable-install-id');
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(spawnProcess.mock.calls[1][0].args).toContain('stable-tunnel-id');
    expect(JSON.parse(readFileSync(paths.connectorConfig, 'utf8')).hubUrl).toBe('http://127.0.0.1:8787');
    expect(JSON.parse(readFileSync(paths.publicEntry, 'utf8')).publicOrigin).toBe('https://dsh.example.com');
  });

  it('upgrades Quick state to a Named Tunnel without replacing Hub or install identity', async () => {
    const paths = createRuntimePaths(mkdtempSync(join(tmpdir(), 'easyremote-controller-')));
    saveInstallState(paths.installState, {
      schemaVersion: 1,
      installId: 'stable-install-id',
      activeMode: 'quick',
      hub: { hubId: 'stable-hub-id', host: '127.0.0.1', port: 8787 },
      tunnel: { publicOrigin: 'https://old.trycloudflare.com' },
      autostart: 'user-login',
    });
    const controller = new EasyRemoteController(paths, {
      ensureCloudflared: async () => {},
      findPort: async () => 8787,
      spawnProcess: () => child(),
      waitForHub: async () => ({ hubId: 'stable-hub-id', publicOrigin: 'https://dsh.example.com' }),
      waitForQuick: async () => { throw new Error('quick should not run'); },
      waitForNamed: async () => {},
      provisionNamed: async () => ({ tunnelId: 'named-tunnel-id', credentialsFile: join(paths.cloudflaredDir, 'named.json') }),
      hubScript: '/runtime/hub/index.js',
      createInstallId: () => 'different-id',
    });
    const result = await controller.configureNamed({
      hostname: 'dsh.example.com',
      tunnelName: 'dsh-easyremote-stable-install-id',
      originCertificate: '/home/.cloudflared/cert.pem',
    });
    expect(result.state).toMatchObject({
      installId: 'stable-install-id',
      activeMode: 'named',
      hub: { hubId: 'stable-hub-id' },
      tunnel: {
        publicOrigin: 'https://dsh.example.com',
        hostname: 'dsh.example.com',
        tunnelId: 'named-tunnel-id',
      },
    });
    expect(result.recoveryRequired).toBe(true);
    expect(readFileSync(paths.namedConfig, 'utf8')).toContain('named-tunnel-id');
    expect(JSON.parse(readFileSync(paths.connectorConfig, 'utf8')).hubUrl).toBe('http://127.0.0.1:8787');
    expect(JSON.parse(readFileSync(paths.publicEntry, 'utf8')).publicOrigin).toBe('https://dsh.example.com');
  });

  it('notifies the foreground CLI if either managed process exits', async () => {
    const paths = createRuntimePaths(mkdtempSync(join(tmpdir(), 'easyremote-controller-')));
    const hub = child();
    const tunnel = child();
    const controller = new EasyRemoteController(paths, {
      ensureCloudflared: async () => {},
      findPort: async () => 8787,
      spawnProcess: vi.fn().mockReturnValueOnce(hub).mockReturnValueOnce(tunnel),
      waitForHub: async () => ({ hubId: 'hub', publicOrigin: 'http://127.0.0.1:8787' }),
      waitForQuick: async () => 'https://one.trycloudflare.com',
      hubScript: '/runtime/hub/index.js',
      createInstallId: () => 'install',
    });
    await controller.startQuick();
    const exited = controller.waitForExit();
    tunnel.exitCode = 2;
    tunnel.emit('close', 2);
    await expect(exited).resolves.toEqual({ role: 'tunnel', code: 2 });
  });

  it('refuses to silently replace a configured Hub when its database identity changes', async () => {
    const paths = createRuntimePaths(mkdtempSync(join(tmpdir(), 'easyremote-controller-')));
    saveInstallState(paths.installState, {
      schemaVersion: 1,
      installId: 'stable-install-id',
      activeMode: 'quick',
      hub: { hubId: 'expected-hub', host: '127.0.0.1', port: 8787 },
      tunnel: { publicOrigin: 'https://old.trycloudflare.com' },
      autostart: 'user-login',
    });
    const controller = new EasyRemoteController(paths, {
      ensureCloudflared: async () => {},
      findPort: async () => 8787,
      spawnProcess: () => child(),
      waitForHub: async () => ({ hubId: 'replacement-hub', publicOrigin: 'http://127.0.0.1:8787' }),
      waitForQuick: async () => 'https://new.trycloudflare.com',
      hubScript: '/runtime/hub/index.js',
      createInstallId: () => 'different-id',
    });
    await expect(controller.startQuick()).rejects.toThrow(/Hub identity mismatch/i);
  });
});
