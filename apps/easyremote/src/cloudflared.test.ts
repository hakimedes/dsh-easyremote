import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  CLOUDFLARED_VERSION,
  artifactFor,
  parseQuickTunnelOrigin,
  verifySha256,
} from './cloudflared.js';

describe('cloudflared runtime', () => {
  it('selects a pinned official artifact for every supported platform', () => {
    expect(CLOUDFLARED_VERSION).toBe('2026.7.2');
    expect(artifactFor('darwin', 'arm64')).toMatchObject({ archive: 'tgz' });
    expect(artifactFor('darwin', 'x64').name).toContain('darwin-amd64');
    expect(artifactFor('linux', 'arm64').name).toContain('linux-arm64');
    expect(artifactFor('linux', 'x64').name).toContain('linux-amd64');
    expect(artifactFor('win32', 'x64').name).toContain('windows-amd64.exe');
  });

  it('rejects a download whose checksum differs from the pinned digest', () => {
    const bytes = Buffer.from('cloudflared');
    const digest = createHash('sha256').update(bytes).digest('hex');
    expect(verifySha256(bytes, digest)).toBe(true);
    expect(verifySha256(bytes, '0'.repeat(64))).toBe(false);
  });

  it('extracts only a valid trycloudflare HTTPS origin from mixed logs', () => {
    expect(parseQuickTunnelOrigin('INF Visit https://Calm-Whale.trycloudflare.com/path to test')).toBe(
      'https://calm-whale.trycloudflare.com',
    );
    expect(parseQuickTunnelOrigin('https://evil.example')).toBeNull();
  });
});
