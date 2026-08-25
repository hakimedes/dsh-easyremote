import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildCreateTunnelLaunch,
  buildDnsRouteLaunch,
  buildLoginLaunch,
  provisionNamedTunnel,
  readTunnelCredentials,
} from './named-tunnel.js';

describe('locally managed Named Tunnel', () => {
  it('uses browser login and explicit certificate/credential paths', () => {
    expect(buildLoginLaunch('/bin/cloudflared')).toEqual({ command: '/bin/cloudflared', args: ['tunnel', 'login'] });
    expect(buildCreateTunnelLaunch('/bin/cloudflared', '/home/.cloudflared/cert.pem', '/state/tunnel.json', 'dsh-easyremote-id')).toEqual({
      command: '/bin/cloudflared',
      args: ['tunnel', '--origincert', '/home/.cloudflared/cert.pem', '--credentials-file', '/state/tunnel.json', 'create', 'dsh-easyremote-id'],
    });
    expect(buildDnsRouteLaunch('/bin/cloudflared', '/home/.cloudflared/cert.pem', 'tunnel-id', 'dsh.example.com')).toEqual({
      command: '/bin/cloudflared',
      args: ['tunnel', '--origincert', '/home/.cloudflared/cert.pem', 'route', 'dns', 'tunnel-id', 'dsh.example.com'],
    });
  });

  it('reads the tunnel ID from cloudflared credentials without returning the secret', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'named-tunnel-')), 'tunnel.json');
    writeFileSync(path, JSON.stringify({ AccountTag: 'secret-account', TunnelSecret: 'secret', TunnelID: 'tunnel-id' }));
    expect(readTunnelCredentials(path)).toEqual({ tunnelId: 'tunnel-id', credentialsFile: path });
  });

  it('authorizes once, creates the tunnel, then creates its DNS route', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'named-provision-'));
    const certificate = join(dir, 'cert.pem');
    const credentials = join(dir, 'credentials.json');
    const calls: string[][] = [];
    const result = await provisionNamedTunnel({
      executable: '/bin/cloudflared',
      originCertificate: certificate,
      credentialsFile: credentials,
      tunnelName: 'dsh-easyremote-install',
      hostname: 'dsh.example.com',
      exists: () => false,
      run: async (launch) => {
        calls.push(launch.args);
        if (launch.args.includes('login')) writeFileSync(certificate, 'certificate');
        if (launch.args.includes('create')) writeFileSync(credentials, JSON.stringify({ TunnelID: 'new-tunnel-id' }));
      },
    });
    expect(result.tunnelId).toBe('new-tunnel-id');
    expect(calls.map((args) => args.at(-3))).toHaveLength(3);
    expect(calls[0]).toEqual(['tunnel', 'login']);
    expect(calls[2]).toEqual([
      'tunnel', '--origincert', certificate, 'route', 'dns', 'new-tunnel-id', 'dsh.example.com',
    ]);
  });
});
