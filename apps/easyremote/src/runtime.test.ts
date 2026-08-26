import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildHubLaunch,
  buildNamedTunnelLaunch,
  buildQuickTunnelLaunch,
  createRuntimePaths,
  writeConnectorConfig,
  writeNamedTunnelConfig,
  writePublicEntry,
} from './runtime.js';

describe('local runtime configuration', () => {
  it('keeps every mutable file under the dedicated app home', () => {
    const root = join(tmpdir(), 'easyremote-home');
    const paths = createRuntimePaths(root);
    expect(Object.values(paths).every((value) => value.startsWith(root))).toBe(true);
    expect(paths.installState).toBe(join(root, 'install.json'));
    expect(paths.pairingState).toBe(join(root, 'pairing.json'));
  });

  it('always launches Hub on loopback with persistent data and a dynamic entry file', () => {
    const paths = createRuntimePaths('/state');
    const launch = buildHubLaunch(paths, 9191, 'secret-secret-secret-secret-secret-secret', '/package/runtime/hub/index.js');
    expect(launch.command).toBe(process.execPath);
    expect(launch.args).toEqual(['/package/runtime/hub/index.js']);
    expect(launch.env).toMatchObject({
      HOST: '127.0.0.1',
      PORT: '9191',
      DATABASE_PATH: '/state/data/hub.sqlite',
      HUB_ENTRY_FILE: '/state/public-origin.json',
      NODE_ENV: 'production',
    });
  });

  it('uses an explicit installer-owned config for quick and named tunnels', () => {
    const paths = createRuntimePaths('/state');
    expect(buildQuickTunnelLaunch(paths, 8787, '/bin/cloudflared').args).toEqual([
      'tunnel', '--config', '/state/cloudflared/quick.yml', '--no-autoupdate',
      '--url', 'http://127.0.0.1:8787', '--loglevel', 'info',
    ]);
    expect(buildNamedTunnelLaunch(paths, 'tunnel-id', '/bin/cloudflared').args).toEqual([
      'tunnel', '--config', '/state/cloudflared/named.yml', '--no-autoupdate', 'run', 'tunnel-id',
    ]);
  });

  it('writes Connector, origin, and named ingress files without exposing Hub publicly', () => {
    const root = mkdtempSync(join(tmpdir(), 'easyremote-runtime-'));
    const paths = createRuntimePaths(root);
    writeConnectorConfig(paths, 'https://dsh.example.com', 'Studio Mac');
    writePublicEntry(paths, 'https://dsh.example.com');
    writeNamedTunnelConfig(paths, {
      tunnelId: '46a2bf0d-c954-4b75-a174-ac55284715c6',
      credentialsFile: join(root, 'cloudflared', 'tunnel.json'),
      hostname: 'dsh.example.com',
      hubPort: 8787,
    });

    expect(JSON.parse(readFileSync(paths.connectorConfig, 'utf8'))).toEqual({
      schemaVersion: 1,
      hubUrl: 'https://dsh.example.com',
      nodeName: 'Studio Mac',
    });
    expect(JSON.parse(readFileSync(paths.publicEntry, 'utf8'))).toEqual({ publicOrigin: 'https://dsh.example.com' });
    const yaml = readFileSync(paths.namedConfig, 'utf8');
    expect(yaml).toContain('service: http://127.0.0.1:8787');
    expect(yaml).toContain('service: http_status:404');
    if (process.platform !== 'win32') expect(statSync(paths.connectorConfig).mode & 0o777).toBe(0o600);
  });
});
