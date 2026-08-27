import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { captureProcessLaunch } from './local-runtime.js';

describe('bundled pnpm runtime', () => {
  it('resolves the pinned pnpm runtime shipped with EasyRemote', async () => {
    const runtime = await import('./bundled-pnpm.js').catch(() => null);
    expect(runtime, 'bundled pnpm runtime module should exist').not.toBeNull();
    if (!runtime) return;

    await expect(captureProcessLaunch({
      command: process.execPath,
      args: [runtime.resolveBundledPnpmScript(), '--version'],
    })).resolves.toBe('9.12.0\n');
  });

  it('materializes a POSIX pnpm launcher that forwards arguments to the bundled runtime', async () => {
    const runtime = await import('./bundled-pnpm.js').catch(() => null);
    expect(runtime, 'bundled pnpm runtime module should exist').not.toBeNull();
    if (!runtime) return;

    const root = mkdtempSync(join(tmpdir(), 'easyremote-pnpm-'));
    const pnpmScript = join(root, 'fake pnpm.cjs');
    writeFileSync(pnpmScript, "process.stdout.write(JSON.stringify(process.argv.slice(2)))\n");
    const binDirectory = runtime.materializeBundledPnpmBin({
      directory: join(root, 'managed bin'),
      platform: 'linux',
      nodeExecutable: process.execPath,
      pnpmScript,
    });

    await expect(captureProcessLaunch({
      command: join(binDirectory, 'pnpm'),
      args: ['install', 'package with spaces'],
    })).resolves.toBe('["install","package with spaces"]');
  });

  it('creates a Windows command launcher without relying on a global pnpm installation', async () => {
    const runtime = await import('./bundled-pnpm.js').catch(() => null);
    expect(runtime, 'bundled pnpm runtime module should exist').not.toBeNull();
    if (!runtime) return;

    const root = mkdtempSync(join(tmpdir(), 'easyremote-pnpm-win-'));
    const binDirectory = runtime.materializeBundledPnpmBin({
      directory: join(root, 'managed bin'),
      platform: 'win32',
      nodeExecutable: 'C:\\Portable Node\\node.exe',
      pnpmScript: 'C:\\npm cache\\pnpm.cjs',
    });
    const launcher = join(binDirectory, 'pnpm.cmd');

    expect(existsSync(launcher)).toBe(true);
    expect(readFileSync(launcher, 'utf8')).toBe(
      '@echo off\r\n"C:\\Portable Node\\node.exe" "C:\\npm cache\\pnpm.cjs" %*\r\n',
    );
  });

  it('prepends the managed bin directory using the target platform PATH semantics', async () => {
    const runtime = await import('./bundled-pnpm.js').catch(() => null);
    expect(runtime, 'bundled pnpm runtime module should exist').not.toBeNull();
    if (!runtime) return;

    const windowsSource = { Path: 'C:\\Windows', USERNAME: 'Example' };
    const windows = runtime.prependExecutableDirectory(windowsSource, 'C:\\EasyRemote\\bin', 'win32');
    const posix = runtime.prependExecutableDirectory({ PATH: '/usr/bin' }, '/state/bin', 'darwin');

    expect(windows).toEqual({ Path: 'C:\\EasyRemote\\bin;C:\\Windows', USERNAME: 'Example' });
    expect(windowsSource.Path).toBe('C:\\Windows');
    expect(posix.PATH).toBe('/state/bin:/usr/bin');
  });
});
