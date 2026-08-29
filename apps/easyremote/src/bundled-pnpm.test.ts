import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('bundled pnpm runtime', () => {
  it('resolves every pnpm major shipped for DSH profile compatibility', async () => {
    const runtime = await import('./bundled-pnpm.js').catch(() => null);
    expect(runtime, 'bundled pnpm runtime module should exist').not.toBeNull();
    if (!runtime) return;

    const cwd = mkdtempSync(join(tmpdir(), 'easyremote-pnpm-version-'));
    const versions = ['pnpm', 'pnpm-v10', 'pnpm-v11'].map((packageName) => {
      const launched = spawnSync(
        process.execPath,
        [runtime.resolveBundledPnpmScript(packageName), '--version'],
        { cwd, encoding: 'utf8' },
      );
      expect(launched.status, launched.stderr).toBe(0);
      return launched.stdout;
    });

    expect(versions).toEqual(['9.12.0\n', '10.34.5\n', '11.24.0\n']);
  }, 15_000);

  it('selects a compatible pnpm runtime from the profile store metadata', async () => {
    const runtime = await import('./bundled-pnpm.js').catch(() => null);
    expect(runtime, 'bundled pnpm runtime module should exist').not.toBeNull();
    if (!runtime) return;

    const root = mkdtempSync(join(tmpdir(), 'easyremote-pnpm-'));
    const pnpmScripts = {
      v9: createFakePnpm(root, 'v9'),
      v10: createFakePnpm(root, 'v10'),
      v11: createFakePnpm(root, 'v11'),
    };
    const binDirectory = runtime.materializeBundledPnpmBin({
      directory: join(root, 'managed bin'),
      platform: 'linux',
      nodeExecutable: process.execPath,
      pnpmScripts,
    });

    const profiles = [
      { name: 'pnpm-9', storeDir: '/Users/example/.pnpm-store/v3', expected: 'v9' },
      { name: 'pnpm-10', storeDir: 'C:\\\\Users\\\\example\\\\.pnpm-store\\\\v10', expected: 'v10' },
      { name: 'pnpm-11', storeDir: '/Users/example/.pnpm-store/v11', expected: 'v11' },
      { name: 'new-profile', expected: 'v11' },
    ];

    for (const profile of profiles) {
      const profileDirectory = join(root, profile.name);
      mkdirSync(profileDirectory, { recursive: true });
      if (profile.storeDir) {
        mkdirSync(join(profileDirectory, 'node_modules'), { recursive: true });
        writeFileSync(
          join(profileDirectory, 'node_modules', '.modules.yaml'),
          `storeDir: ${profile.storeDir}\n`,
        );
      }
      const launched = spawnSync(join(binDirectory, 'pnpm'), ['install', 'package with spaces'], {
        cwd: profileDirectory,
        encoding: 'utf8',
      });
      expect(launched.status, launched.stderr).toBe(0);
      expect(launched.stdout).toBe(`${profile.expected}:["install","package with spaces"]`);
    }
  });

  it('refuses an unknown future pnpm store instead of modifying the profile', async () => {
    const runtime = await import('./bundled-pnpm.js').catch(() => null);
    expect(runtime, 'bundled pnpm runtime module should exist').not.toBeNull();
    if (!runtime) return;

    const root = mkdtempSync(join(tmpdir(), 'easyremote-pnpm-future-'));
    const profileDirectory = join(root, 'profile');
    mkdirSync(join(profileDirectory, 'node_modules'), { recursive: true });
    writeFileSync(join(profileDirectory, 'node_modules', '.modules.yaml'), 'storeDir: /tmp/.pnpm-store/v12\n');
    const binDirectory = runtime.materializeBundledPnpmBin({
      directory: join(root, 'managed bin'),
      platform: 'darwin',
      nodeExecutable: process.execPath,
      pnpmScripts: {
        v9: createFakePnpm(root, 'v9'),
        v10: createFakePnpm(root, 'v10'),
        v11: createFakePnpm(root, 'v11'),
      },
    });

    const launched = spawnSync(join(binDirectory, 'pnpm'), ['install'], {
      cwd: profileDirectory,
      encoding: 'utf8',
    });
    expect(launched.status).not.toBe(0);
    expect(launched.stderr).toContain('unsupported pnpm store v12');
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
      pnpmScripts: {
        v9: 'C:\\npm cache\\pnpm-9.cjs',
        v10: 'C:\\npm cache\\pnpm-10.cjs',
        v11: 'C:\\npm cache\\pnpm-11.cjs',
      },
    });
    const launcher = join(binDirectory, 'pnpm.cmd');

    expect(existsSync(launcher)).toBe(true);
    expect(existsSync(join(binDirectory, 'pnpm-runtime.cjs'))).toBe(true);
    expect(readFileSync(launcher, 'utf8')).toContain('"C:\\Portable Node\\node.exe"');
    expect(readFileSync(launcher, 'utf8')).toContain('pnpm-runtime.cjs" %*');
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

function createFakePnpm(root: string, label: string) {
  const script = join(root, `fake-pnpm-${label}.cjs`);
  writeFileSync(script, `process.stdout.write(${JSON.stringify(`${label}:`)} + JSON.stringify(process.argv.slice(2)))\n`);
  return script;
}
