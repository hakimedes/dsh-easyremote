import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type RuntimePaths = {
  root: string;
  installState: string;
  setupProgress: string;
  connectorConfig: string;
  pairingState: string;
  publicEntry: string;
  dataDir: string;
  database: string;
  secretsDir: string;
  jwtSecret: string;
  cloudflaredDir: string;
  cloudflaredExecutable: string;
  cloudflaredManifest: string;
  quickConfig: string;
  namedConfig: string;
  logsDir: string;
  runDir: string;
  hubPid: string;
  tunnelPid: string;
  backupsDir: string;
  packagesDir: string;
  serviceDir: string;
};

export type ProcessLaunch = {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
};

export function createRuntimePaths(root: string): RuntimePaths {
  const cloudflaredDir = join(root, 'cloudflared');
  const dataDir = join(root, 'data');
  const secretsDir = join(root, 'secrets');
  const runDir = join(root, 'run');
  return {
    root,
    installState: join(root, 'install.json'),
    setupProgress: join(root, 'setup.json'),
    connectorConfig: join(root, 'connector.json'),
    pairingState: join(root, 'pairing.json'),
    publicEntry: join(root, 'public-origin.json'),
    dataDir,
    database: join(dataDir, 'hub.sqlite'),
    secretsDir,
    jwtSecret: join(secretsDir, 'jwt-secret'),
    cloudflaredDir,
    cloudflaredExecutable: join(cloudflaredDir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'),
    cloudflaredManifest: join(cloudflaredDir, 'install.json'),
    quickConfig: join(cloudflaredDir, 'quick.yml'),
    namedConfig: join(cloudflaredDir, 'named.yml'),
    logsDir: join(root, 'logs'),
    runDir,
    hubPid: join(runDir, 'hub.pid'),
    tunnelPid: join(runDir, 'tunnel.pid'),
    backupsDir: join(root, 'backups'),
    packagesDir: join(root, 'packages'),
    serviceDir: join(root, 'service'),
  };
}

export function buildHubLaunch(
  paths: RuntimePaths,
  port: number,
  jwtSecret: string,
  hubScript: string,
): ProcessLaunch {
  return {
    command: process.execPath,
    args: [hubScript],
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_PATH: paths.database,
      HUB_ENTRY_FILE: paths.publicEntry,
      HUB_ENTRY: `http://127.0.0.1:${port}`,
      JWT_SECRET: jwtSecret,
      NODE_ENV: 'production',
      DSH_EASYREMOTE_VERSION: '0.2.0',
    },
  };
}

export function buildQuickTunnelLaunch(paths: RuntimePaths, hubPort: number, executable: string): ProcessLaunch {
  return {
    command: executable,
    args: [
      'tunnel', '--config', paths.quickConfig, '--no-autoupdate',
      '--url', `http://127.0.0.1:${hubPort}`, '--loglevel', 'info',
    ],
  };
}

export function buildNamedTunnelLaunch(paths: RuntimePaths, tunnelId: string, executable: string): ProcessLaunch {
  return {
    command: executable,
    args: ['tunnel', '--config', paths.namedConfig, '--no-autoupdate', 'run', tunnelId],
  };
}

export function writeConnectorConfig(paths: RuntimePaths, hubUrl: string, nodeName?: string, defaultCwd?: string) {
  const parsed = new URL(hubUrl);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Connector Hub URL must use HTTP or HTTPS');
  writeSecureJson(paths.connectorConfig, {
    schemaVersion: 1,
    hubUrl: parsed.origin,
    ...(nodeName?.trim() ? { nodeName: nodeName.trim() } : {}),
    ...(defaultCwd?.trim() ? { defaultCwd: defaultCwd.trim() } : {}),
  });
}

export function writePublicEntry(paths: RuntimePaths, publicOrigin: string) {
  const parsed = new URL(publicOrigin);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Public origin must use HTTP or HTTPS');
  writeSecureJson(paths.publicEntry, { publicOrigin: parsed.origin });
}

export function writeNamedTunnelConfig(paths: RuntimePaths, options: {
  tunnelId: string;
  credentialsFile: string;
  hostname: string;
  hubPort: number;
}) {
  const yaml = [
    `tunnel: ${JSON.stringify(options.tunnelId)}`,
    `credentials-file: ${JSON.stringify(options.credentialsFile)}`,
    'ingress:',
    `  - hostname: ${JSON.stringify(options.hostname)}`,
    `    service: http://127.0.0.1:${options.hubPort}`,
    '  - service: http_status:404',
    '',
  ].join('\n');
  writeSecureFile(paths.namedConfig, yaml);
}

export function writeQuickTunnelConfig(paths: RuntimePaths) {
  writeSecureFile(paths.quickConfig, '{}\n');
}

function writeSecureJson(path: string, value: unknown) {
  writeSecureFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeSecureFile(path: string, value: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, value, { mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, path);
  if (process.platform !== 'win32') chmodSync(path, 0o600);
}
