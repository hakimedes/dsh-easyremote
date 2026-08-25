import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { installCloudflaredArtifact } from './download.js';

describe('cloudflared download', () => {
  it('installs a verified binary with executable permissions', async () => {
    const bytes = Buffer.from('verified cloudflared');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const destination = join(mkdtempSync(join(tmpdir(), 'cloudflared-download-')), 'cloudflared');
    const fetcher = vi.fn(async () => new Response(bytes));

    await installCloudflaredArtifact({
      artifact: { name: 'cloudflared-linux-amd64', sha256, archive: 'binary' },
      destination,
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(readFileSync(destination)).toEqual(bytes);
    if (process.platform !== 'win32') expect(statSync(destination).mode & 0o777).toBe(0o755);
  });

  it('does not leave an executable behind after a checksum failure', async () => {
    const destination = join(mkdtempSync(join(tmpdir(), 'cloudflared-download-')), 'cloudflared');
    await expect(installCloudflaredArtifact({
      artifact: { name: 'cloudflared-linux-amd64', sha256: '0'.repeat(64), archive: 'binary' },
      destination,
      fetcher: async () => new Response('tampered'),
    })).rejects.toThrow(/checksum/i);
    expect(existsSync(destination)).toBe(false);
  });

  it('verifies a macOS archive before extracting its executable', async () => {
    const archive = Buffer.from('verified tgz');
    const sha256 = createHash('sha256').update(archive).digest('hex');
    const destination = join(mkdtempSync(join(tmpdir(), 'cloudflared-download-')), 'cloudflared');
    const extractArchive = vi.fn(async (_archivePath: string, target: string) => writeFileSync(target, 'binary'));
    await installCloudflaredArtifact({
      artifact: { name: 'cloudflared-darwin-arm64.tgz', sha256, archive: 'tgz' },
      destination,
      fetcher: async () => new Response(archive),
      extractArchive,
    });
    expect(extractArchive).toHaveBeenCalledOnce();
    expect(readFileSync(destination, 'utf8')).toBe('binary');
  });
});
