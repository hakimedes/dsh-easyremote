#!/usr/bin/env node

import { spawn } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { arch, homedir, hostname, platform } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { v7 as uuidv7 } from 'uuid';

import { installUserAutostart, removeUserAutostart } from './autostart.js';
import {
  materializeBundledPnpmBin,
  prependExecutableDirectory,
  resolveBundledPnpmScript,
} from './bundled-pnpm.js';
import { formatHelp, formatStatus } from './cli-views.js';
import { routeCommand, type CommandHandlers } from './command-router.js';
import {
  buildConnectorInstallLaunch,
  buildDshProfileProbeLaunch,
  cleanupLegacyConnectorPatches,
  connectorUpgradeRequired,
  inferDshHomeFromLauncher,
  inferDshHomeFromProfileOutput,
  readInstalledConnectorVersion,
} from './connector-install.js';
import { EasyRemoteController } from './controller.js';
import { inspectConnectorRuntime, probeWebSocket, runDoctor } from './doctor.js';
import { normalizeHostname, normalizeNameserver, verifyNameservers } from './domain.js';
import { loadInstallState } from './install-state.js';
import { captureProcessLaunch, ensureCloudflaredRuntime, findAvailablePort, inspectCloudflaredRuntime, runProcessLaunch, spawnLoggedProcess } from './local-runtime.js';
import { buildLoginLaunch, provisionNamedTunnel } from './named-tunnel.js';
import { loadPairingState } from './pairing-state.js';
import { createRuntimePaths } from './runtime.js';
import { loadSetupProgress, saveSetupProgress, type SetupProgress } from './setup-progress.js';
import { stopManagedChild, waitForHubMeta, waitForQuickOrigin } from './supervisor.js';
import { startWizardServer, type WizardAction } from './wizard.js';

const VERSION = '0.3.2';
const PACKAGE_NAME = '@hakimedes/dsh-easyremote';
const CONNECTOR_VERSION = '0.3.2';
const CLI_SCRIPT = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = resolve(dirname(CLI_SCRIPT), '..');
const APP_HOME = process.env.DSH_EASYREMOTE_HOME || join(homedir(), '.dsh-easyremote');
const paths = createRuntimePaths(APP_HOME);
const hubScript = join(PACKAGE_ROOT, 'runtime', 'hub', 'index.js');
const connectorRuntime = join(PACKAGE_ROOT, 'runtime', 'connector');
const originCertificate = join(homedir(), '.cloudflared', 'cert.pem');

const controller = new EasyRemoteController(paths, {
  ensureCloudflared: () => ensureCloudflaredRuntime(paths),
  findPort: (preferred) => findAvailablePort(preferred),
  spawnProcess: (launch, role) => spawnLoggedProcess(paths, launch, role),
  waitForHub: (origin) => waitForHubMeta(origin),
  waitForQuick: (child) => waitForQuickOrigin(child),
  waitForNamed: async (origin) => {
    const meta = await waitForHubMeta(origin, { timeoutMs: 60_000, retryMs: 1_000 });
    const state = loadInstallState(paths.installState);
    if (state?.hub.hubId && meta.hubId !== state.hub.hubId) throw new Error('Fixed hostname points to a different DSH EasyRemote Hub');
  },
  provisionNamed: (options) => provisionNamedTunnel({
    ...options,
    run: runProcessLaunch,
  }),
  stopProcess: (child) => stopManagedChild(child),
  hubScript,
  createInstallId: uuidv7,
  nodeName: hostname,
});

async function main() {
  assertNodeVersion();
  const handlers: CommandHandlers = {
    setup: setupCommand,
    quick: quickCommand,
    start: startCommand,
    stop: stopCommand,
    status: statusCommand,
    doctor: doctorCommand,
    backup: backupCommand,
    restore: restoreCommand,
    upgrade: upgradeCommand,
    uninstall: uninstallCommand,
    help: async () => console.log(formatHelp()),
    serviceRun: serviceRunCommand,
  };
  await routeCommand(process.argv.slice(2), {
    loadState: () => loadInstallState(paths.installState),
    handlers,
  });
}

function createSetupActions(): Record<string, WizardAction> {
  return {
    quick: async () => {
      persistProgress({ schemaVersion: 1, mode: 'quick', phase: 'quick-starting', updatedAt: Date.now() });
      const result = await controller.startQuick();
      const connector = await installConnectorSafely('web');
      persistProgress({ schemaVersion: 1, mode: 'quick', phase: 'complete', updatedAt: Date.now() });
      if (!result.alreadyRunning) monitorController();
      return {
        ok: true,
        message: [
          `${result.alreadyRunning ? '临时连接已在运行' : '临时连接已建立'}：${result.state.tunnel.publicOrigin}`,
          result.recoveryRequired ? '公网地址已变化，请在 DSH Web 配对页扫描一次恢复二维码。' : '请打开 DSH Web 的 /__dsh_remote_v1/pair 扫码。',
          connector,
        ].join('\n'),
      };
    },
    'named/domain': async (body) => {
      const domain = parseNamedBody(body, false);
      const progress: SetupProgress = {
        schemaVersion: 1,
        mode: 'named',
        phase: 'cloudflare-site',
        rootDomain: domain.rootDomain,
        hostname: domain.hostname,
        ...(domain.nameservers ? { nameservers: domain.nameservers } : {}),
        updatedAt: Date.now(),
      };
      persistProgress(progress);
      return { ok: true, progress, message: '域名已保存。请在 Cloudflare 添加站点，并填写其分配的两条 Nameserver。' };
    },
    'named/check-ns': async (body) => {
      const domain = parseNamedBody(body, true);
      const result = await verifyNameservers(domain.rootDomain, domain.nameservers!);
      const progress: SetupProgress = {
        schemaVersion: 1,
        mode: 'named',
        phase: result.active ? 'cloudflare-site' : 'nameservers-pending',
        rootDomain: domain.rootDomain,
        hostname: domain.hostname,
        nameservers: domain.nameservers!,
        updatedAt: Date.now(),
      };
      persistProgress(progress);
      return {
        ok: result.active,
        progress,
        message: result.active ? 'Nameserver 已生效，可以进行 Cloudflare 授权。' : `仍在等待：${result.missing.join(', ')}`,
      };
    },
    'named/authorize': async (body) => {
      const domain = parseNamedBody(body, true);
      const ns = await verifyNameservers(domain.rootDomain, domain.nameservers!);
      if (!ns.active) throw new Error(`Nameserver 尚未生效：${ns.missing.join(', ')}`);
      await ensureCloudflaredRuntime(paths);
      persistProgress(namedProgress(domain, 'cloudflare-authorizing'));
      if (!existsSync(originCertificate)) await runProcessLaunch(buildLoginLaunch(paths.cloudflaredExecutable), true);
      if (!existsSync(originCertificate)) throw new Error('Cloudflare 授权未生成 cert.pem');
      persistProgress(namedProgress(domain, 'cloudflare-authorized'));
      return { ok: true, message: 'Cloudflare 授权完成。程序未读取账号密码。' };
    },
    'named/provision': async (body) => {
      const domain = parseNamedBody(body, true);
      const ns = await verifyNameservers(domain.rootDomain, domain.nameservers!);
      if (!ns.active) throw new Error(`Nameserver 尚未生效：${ns.missing.join(', ')}`);
      persistProgress(namedProgress(domain, 'named-provisioning'));
      const previous = loadInstallState(paths.installState);
      const installId = previous?.installId ?? uuidv7();
      const result = await controller.configureNamed({
        hostname: domain.hostname,
        tunnelName: `dsh-easyremote-${installId}`,
        originCertificate,
      });
      const connector = await installConnectorSafely('web');
      await controller.stop();
      const serviceCommand = await materializeServiceCommand();
      await installUserAutostart({
        home: homedir(),
        command: serviceCommand,
        run: (command, args) => runProcessLaunch({ command, args }),
      });
      persistProgress(namedProgress(domain, 'complete'));
      return {
        ok: true,
        message: [
          `固定连接已建立：${result.state.tunnel.publicOrigin}`,
          result.recoveryRequired ? '请扫描一次恢复二维码，让手机切换到固定域名。' : '请在 DSH Web 配对页扫码。',
          connector,
          '已安装当前用户登录后自启服务。',
        ].join('\n'),
      };
    },
  };
}

async function setupCommand() {
  const connector = await installConnectorSafely('web');
  const wizard = await startWizardServer({
    version: VERSION,
    getState: async () => ({
      state: loadInstallState(paths.installState),
      progress: loadSetupProgress(paths.setupProgress),
      message: ['本机控制面已就绪。请选择连接路径。', connector].join('\n'),
    }),
    getPairing: () => loadPairingState(paths.pairingState),
    actions: createSetupActions(),
  });
  console.log(`DSH EasyRemote setup: ${wizard.launchUrl}`);
  openBrowser(wizard.launchUrl);
  await waitForSignal();
  await controller.stop();
  await wizard.close();
}

async function quickCommand() {
  const connector = await installConnectorSafely('web');
  const result = await controller.startQuick();
  console.log(`Quick Tunnel: ${result.state.tunnel.publicOrigin}`);
  console.log(result.recoveryRequired
    ? 'Address changed. Open DSH Web /__dsh_remote_v1/pair and scan the recovery QR.'
    : 'Open DSH Web /__dsh_remote_v1/pair to pair the Community APK.');
  console.log(connector);
  await runForeground([formatStatus(result.state, true), connector].join('\n'));
}

async function startCommand() {
  const state = loadInstallState(paths.installState);
  if (!state) return setupCommand();
  const connector = await installConnectorSafely('web');
  if (await localHubOnline(state.hub.port)) {
    const status = [formatStatus(state, true), connector].join('\n');
    console.log(status);
    await holdControlConsole(status);
    return;
  }
  const result = state.activeMode === 'named' ? await controller.startNamed() : await controller.startQuick();
  const status = [formatStatus(result.state, true), connector].join('\n');
  console.log(status);
  await runForeground(status);
}

async function serviceRunCommand() {
  const state = loadInstallState(paths.installState);
  if (state?.activeMode !== 'named') throw new Error('service-run requires a configured Named Tunnel');
  await controller.startNamed();
  await runForeground(undefined, false);
}

async function stopCommand() {
  await stopUserService();
  for (const path of [paths.tunnelPid, paths.hubPid]) {
    if (!existsSync(path)) continue;
    const pid = Number(readFileSync(path, 'utf8').trim());
    if (Number.isInteger(pid) && pid > 1) {
      try { process.kill(pid, 'SIGTERM'); } catch (error: any) { if (error?.code !== 'ESRCH') throw error; }
    }
    unlinkSync(path);
  }
  console.log('DSH EasyRemote stopped. Local data was preserved.');
}

async function statusCommand() {
  const state = loadInstallState(paths.installState);
  console.log(formatStatus(state, state ? await localHubOnline(state.hub.port) : false));
}

async function doctorCommand(args: string[]) {
  const state = loadInstallState(paths.installState);
  const progress = loadSetupProgress(paths.setupProgress);
  const report = await runDoctor({
    checks: {
      installState: async () => ({ ok: Boolean(state), detail: state?.activeMode ?? 'not configured' }),
      cloudflared: async () => inspectCloudflaredRuntime(paths),
      localHub: async () => ({ ok: Boolean(state && await localHubOnline(state.hub.port)), detail: state ? `${state.hub.host}:${state.hub.port}` : 'not configured' }),
      publicOrigin: async () => {
        if (!state?.tunnel.publicOrigin) return { ok: false, detail: 'not configured' };
        const response = await fetch(`${state.tunnel.publicOrigin}/v1/meta`);
        const meta = response.ok ? await response.json() as { hubId?: string } : {};
        return { ok: response.ok && meta.hubId === state.hub.hubId, detail: `${response.status} ${state.tunnel.publicOrigin}` };
      },
      websocket: async () => state?.tunnel.publicOrigin
        ? probeWebSocket(state.tunnel.publicOrigin)
        : ({ ok: false, detail: 'not configured' }),
      connectorConfig: async () => ({ ok: existsSync(paths.connectorConfig), detail: paths.connectorConfig }),
      connectorRuntime: async () => inspectConnectorRuntime({
        pairingStatePath: paths.pairingState,
        expectedHub: state ? `http://${state.hub.host}:${state.hub.port}` : undefined,
      }),
      nameservers: async () => {
        if (state?.activeMode !== 'named') return { ok: true, detail: 'not required in quick mode' };
        if (!progress?.rootDomain || !progress.nameservers) return { ok: false, detail: 'setup checkpoint is missing NS values' };
        const result = await verifyNameservers(progress.rootDomain, progress.nameservers);
        return { ok: result.active, detail: result.active ? 'active' : `missing ${result.missing.join(', ')}` };
      },
    },
  });
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else for (const check of report.checks) console.log(`${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`);
  if (!report.ok) process.exitCode = 1;
}

async function backupCommand(args: string[]) {
  const { createBackup } = await import('./maintenance.js');
  const destination = await createBackup(paths, args[0] ? resolve(args[0]) : undefined);
  console.log(`Backup created: ${destination}`);
}

async function restoreCommand(args: string[]) {
  if (!args[0]) throw new Error('restore requires a backup directory');
  const { restoreBackup } = await import('./maintenance.js');
  await restoreBackup(paths, resolve(args[0]), { isRunning: () => pidAlive(paths.hubPid) });
  console.log('Backup restored. Run `dsh-easyremote start`.');
}

async function upgradeCommand() {
  const { createBackup } = await import('./maintenance.js');
  const backupPath = await createBackup(paths);
  const serviceCommand = await installPackageRuntime('latest');
  const state = loadInstallState(paths.installState);
  if (state?.activeMode === 'named') {
    await installUserAutostart({
      home: homedir(),
      command: serviceCommand,
      run: (command, args) => runProcessLaunch({ command, args }),
    });
  }
  const connector = await installConnectorSafely('web');
  console.log(`Upgrade staged after backup: ${backupPath}`);
  console.log(connector);
}

async function uninstallCommand(args: string[]) {
  await stopCommand();
  const command = await currentServiceCommand();
  try {
    await removeUserAutostart({
      home: homedir(),
      command,
      run: (program, programArgs) => runProcessLaunch({ command: program, args: programArgs }),
    });
  } catch (error) {
    console.warn(`Autostart cleanup warning: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (args.includes('--purge')) {
    throw new Error('For safety, --purge is not non-interactive. Remove ~/.dsh-easyremote manually after verifying backups.');
  }
  console.log(`Uninstalled launch integration. Data and Cloudflare resources remain in ${paths.root}.`);
}

async function runForeground(message?: string, showControl = true) {
  const control = showControl ? await openControlConsole(message) : null;
  const signal = waitForSignal();
  const exit = controller.waitForExit();
  try {
    const outcome = await Promise.race([
      signal.then(() => ({ signal: true as const })),
      exit.then((value) => ({ signal: false as const, value })),
    ]);
    if (!outcome.signal) throw new Error(`${outcome.value.role} exited unexpectedly (${outcome.value.code ?? 'signal'})`);
  } finally {
    await controller.stop();
    await control?.close();
  }
}

async function openControlConsole(message?: string) {
  const control = await startWizardServer({
    version: VERSION,
    controlMode: true,
    getState: async () => ({
      state: loadInstallState(paths.installState),
      progress: loadSetupProgress(paths.setupProgress),
      message: message ?? formatStatus(loadInstallState(paths.installState), true),
    }),
    getPairing: () => loadPairingState(paths.pairingState),
    actions: createSetupActions(),
  });
  console.log(`DSH EasyRemote console: ${control.launchUrl}`);
  openBrowser(control.launchUrl);
  return control;
}

async function holdControlConsole(message: string) {
  const control = await openControlConsole(message);
  try {
    await waitForSignal();
  } finally {
    await control.close();
  }
}

function monitorController() {
  controller.waitForExit().then(({ role, code }) => {
    console.error(`${role} exited (${code ?? 'signal'}); reopen the wizard or run start to retry.`);
  }).catch(() => {});
}

function persistProgress(progress: SetupProgress) {
  saveSetupProgress(paths.setupProgress, progress);
}

function parseNamedBody(body: Record<string, unknown>, requireNameservers: boolean) {
  const rootDomain = normalizeHostname(String(body.rootDomain || ''));
  const hostnameValue = String(body.hostname || `dsh.${rootDomain}`);
  const publicHostname = normalizeHostname(hostnameValue);
  if (publicHostname !== rootDomain && !publicHostname.endsWith(`.${rootDomain}`)) {
    throw new Error('Public hostname must belong to the root domain');
  }
  const rawNameservers = Array.isArray(body.nameservers) ? body.nameservers : [];
  const provided = rawNameservers.filter((value) => String(value).trim());
  if (requireNameservers && provided.length !== 2) throw new Error('Enter both Cloudflare Nameservers');
  const nameservers = provided.length === 2
    ? provided.map((value) => normalizeNameserver(String(value))) as [string, string]
    : undefined;
  if (nameservers && nameservers[0] === nameservers[1]) throw new Error('Nameservers must be distinct');
  return { rootDomain, hostname: publicHostname, nameservers };
}

function namedProgress(
  domain: { rootDomain: string; hostname: string; nameservers?: [string, string] },
  phase: SetupProgress['phase'],
): SetupProgress {
  return {
    schemaVersion: 1,
    mode: 'named',
    phase,
    rootDomain: domain.rootDomain,
    hostname: domain.hostname,
    ...(domain.nameservers ? { nameservers: domain.nameservers } : {}),
    updatedAt: Date.now(),
  };
}

async function installConnectorSafely(profile: string) {
  try {
    const result = await installPackagedConnector(profile);
    return result.changed
      ? `Connector 已从 ${result.previousVersion || '未安装'} 升级到 ${CONNECTOR_VERSION}（DSH profile: ${profile}）。请重启一次 DSH Web 以启用图片和文件上传。`
      : `Connector ${CONNECTOR_VERSION} 已是最新版本（DSH profile: ${profile}）。若手机仍提示升级，请重启一次 DSH Web。`;
  } catch (error) {
    return `Connector 自动安装未完成：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function installPackagedConnector(profile: string) {
  if (!existsSync(join(connectorRuntime, 'package.json'))) throw new Error('npm package does not contain the Connector runtime');
  const dshExecutable = findExecutable(process.platform === 'win32' ? 'dsh.cmd' : 'dsh');
  if (!dshExecutable) throw new Error('dsh executable was not found in PATH');
  const managedBin = materializeBundledPnpmBin({
    directory: join(paths.root, 'bin'),
    platform: process.platform,
    nodeExecutable: process.execPath,
    pnpmScripts: {
      v9: resolveBundledPnpmScript('pnpm'),
      v10: resolveBundledPnpmScript('pnpm-v10'),
      v11: resolveBundledPnpmScript('pnpm-v11'),
    },
  });
  const dshEnvironment = prependExecutableDirectory(process.env, managedBin);
  let dshHome = await detectDshHome(dshExecutable, profile, dshEnvironment);
  const previousVersion = dshHome ? readInstalledConnectorVersion(dshHome, profile) : null;
  if (!connectorUpgradeRequired(previousVersion, CONNECTOR_VERSION)) {
    repairLegacyConnectorOverlay(dshHome!, profile);
    return { changed: false, previousVersion };
  }

  mkdirSync(paths.packagesDir, { recursive: true, mode: 0o700 });
  await runProcessLaunch({
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['pack', connectorRuntime, '--pack-destination', paths.packagesDir, '--ignore-scripts'],
  });
  const packagePath = readdirSync(paths.packagesDir)
    .filter((name) => name.endsWith('.tgz') && name.includes('dsh-easyremote-connector'))
    .map((name) => join(paths.packagesDir, name))
    .sort()
    .at(-1);
  if (!packagePath) throw new Error('Unable to build the Connector package');
  await runProcessLaunch(buildConnectorInstallLaunch(dshExecutable, profile, packagePath, dshEnvironment), true);
  dshHome = dshHome || await detectDshHome(dshExecutable, profile, dshEnvironment);
  if (!dshHome) throw new Error('Connector installed, but DSH_HOME could not be detected; set DSH_HOME and rerun setup');
  const installedVersion = readInstalledConnectorVersion(dshHome, profile);
  if (connectorUpgradeRequired(installedVersion, CONNECTOR_VERSION)) {
    throw new Error(`DSH reported success, but Connector ${CONNECTOR_VERSION} is not active in profile ${profile}`);
  }
  repairLegacyConnectorOverlay(dshHome, profile);
  return { changed: true, previousVersion };
}

function repairLegacyConnectorOverlay(dshHome: string, profile: string) {
  const patchPath = join(dshHome, 'profiles', profile, 'cordis.patch.yml');
  if (!existsSync(dirname(patchPath))) throw new Error(`DSH profile not found: ${profile}`);
  const existing = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '';
  const cleaned = cleanupLegacyConnectorPatches(existing);
  if (cleaned !== existing) {
    writeFileSync(patchPath, cleaned, { mode: 0o600 });
    if (process.platform !== 'win32') chmodSync(patchPath, 0o600);
  }
}

async function detectDshHome(dshExecutable: string, profile: string, environment = process.env) {
  if (environment.DSH_HOME && existsSync(environment.DSH_HOME)) return environment.DSH_HOME;
  try {
    const inferred = inferDshHomeFromLauncher(readFileSync(dshExecutable, 'utf8'), environment);
    if (inferred && existsSync(inferred)) return inferred;
  } catch {}
  try {
    const output = await captureProcessLaunch(buildDshProfileProbeLaunch(dshExecutable, profile, environment));
    const inferred = inferDshHomeFromProfileOutput(output, profile);
    if (inferred && existsSync(inferred)) return inferred;
  } catch {}
  const fallback = join(homedir(), '.dsh');
  return existsSync(fallback) ? fallback : null;
}

function findExecutable(name: string) {
  for (const directory of (process.env.PATH || '').split(delimiter)) {
    const candidate = join(directory, name);
    try { accessSync(candidate, constants.X_OK); return candidate; } catch {}
  }
  return null;
}

async function materializeServiceCommand() {
  try { return await installPackageRuntime(VERSION); } catch { return currentServiceCommand(); }
}

async function installPackageRuntime(version: string) {
  const prefix = join(paths.serviceDir, 'runtime');
  mkdirSync(prefix, { recursive: true, mode: 0o700 });
  await runProcessLaunch({
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', `${PACKAGE_NAME}@${version}`],
  }, true);
  const installedCli = join(prefix, 'node_modules', '@hakimedes', 'dsh-easyremote', 'dist', 'cli.js');
  if (!existsSync(installedCli)) throw new Error('Installed package does not contain dist/cli.js');
  return { executable: process.execPath, args: [installedCli, 'service-run'] };
}

async function currentServiceCommand() {
  return { executable: process.execPath, args: [CLI_SCRIPT, 'service-run'] };
}

async function stopUserService() {
  try {
    if (process.platform === 'darwin') {
      await runProcessLaunch({ command: 'launchctl', args: ['stop', 'io.github.hakimedes.dsheasyremote'] });
    } else if (process.platform === 'linux') {
      await runProcessLaunch({ command: 'systemctl', args: ['--user', 'stop', 'dsh-easyremote.service'] });
    } else if (process.platform === 'win32') {
      await runProcessLaunch({ command: 'schtasks', args: ['/End', '/TN', 'DSH EasyRemote'] });
    }
  } catch {}
}

function pidAlive(path: string) {
  if (!existsSync(path)) return false;
  const pid = Number(readFileSync(path, 'utf8').trim());
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try { process.kill(pid, 0); return true; } catch (error: any) { return error?.code === 'EPERM'; }
}

async function localHubOnline(port: number) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch { return false; }
}

function waitForSignal() {
  return new Promise<NodeJS.Signals>((resolveSignal) => {
    const finish = (signal: NodeJS.Signals) => {
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
      resolveSignal(signal);
    };
    const onInt = () => finish('SIGINT');
    const onTerm = () => finish('SIGTERM');
    process.once('SIGINT', onInt);
    process.once('SIGTERM', onTerm);
  });
}

function openBrowser(url: string) {
  const launch = process.platform === 'darwin'
    ? { command: 'open', args: [url] }
    : process.platform === 'win32'
      ? { command: 'cmd.exe', args: ['/d', '/s', '/c', 'start', '', url] }
      : { command: 'xdg-open', args: [url] };
  try {
    const child = spawn(launch.command, launch.args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
  } catch {}
}

function assertNodeVersion() {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 19)) throw new Error('DSH EasyRemote requires Node.js 22.19 or newer');
}

main().catch((error) => {
  console.error(`DSH EasyRemote: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
