import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  ensureCloudflaredRuntime,
  findAvailablePort,
  spawnLoggedProcess,
} from './local-runtime.js';
import { createRuntimePaths } from './runtime.js';

describe('default local runtime adapters', () => {
  it('chooses the first free loopback port from the preferred range', async () => {
    const probe = vi.fn(async (port: number) => port === 8789);
    await expect(findAvailablePort(8787, probe)).resolves.toBe(8789);
    expect(probe.mock.calls.map(([port]) => port)).toEqual([8787, 8788, 8789]);
  });

  it('downloads cloudflared once and reuses only matching pinned metadata', async () => {
    const paths = createRuntimePaths(mkdtempSync(join(tmpdir(), 'easyremote-local-runtime-')));
    const installer = vi.fn(async ({ destination }: { destination: string }) => writeFileSync(destination, 'binary'));
    await ensureCloudflaredRuntime(paths, { installer });
    await ensureCloudflaredRuntime(paths, { installer });
    expect(installer).toHaveBeenCalledOnce();
    expect(JSON.parse(readFileSync(paths.cloudflaredManifest, 'utf8'))).toMatchObject({ version: '2026.7.2' });
  });

  it('reinstalls cloudflared when the installed executable no longer matches its manifest', async () => {
    const paths = createRuntimePaths(mkdtempSync(join(tmpdir(), 'easyremote-local-runtime-')));
    const installer = vi.fn(async ({ destination }: { destination: string }) => writeFileSync(destination, `binary-${installer.mock.calls.length}`));
    await ensureCloudflaredRuntime(paths, { installer });
    writeFileSync(paths.cloudflaredExecutable, 'tampered');
    await ensureCloudflaredRuntime(paths, { installer });
    expect(installer).toHaveBeenCalledTimes(2);
  });

  it('captures child output in an app-owned log file', async () => {
    const paths = createRuntimePaths(mkdtempSync(join(tmpdir(), 'easyremote-local-runtime-')));
    const child = spawnLoggedProcess(paths, {
      command: process.execPath,
      args: ['-e', "console.log('deep ocean ready')"],
    }, 'hub', false);
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', () => resolve());
    });
    expect(readFileSync(join(paths.logsDir, 'hub.log'), 'utf8')).toContain('deep ocean ready');
  });
});
