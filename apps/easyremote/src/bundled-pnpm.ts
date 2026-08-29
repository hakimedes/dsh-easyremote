import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const packageRequire = createRequire(import.meta.url);

export function resolveBundledPnpmScript(packageName = 'pnpm') {
  const manifestPath = packageRequire.resolve(packageName);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    bin?: string | Record<string, string>;
  };
  const relativeScript = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.pnpm;
  if (!relativeScript) throw new Error('Bundled pnpm package does not expose a pnpm executable');
  return resolve(dirname(manifestPath), relativeScript);
}

export function materializeBundledPnpmBin(options: {
  directory: string;
  platform: NodeJS.Platform;
  nodeExecutable: string;
  pnpmScripts: {
    v9: string;
    v10: string;
    v11: string;
  };
}) {
  mkdirSync(options.directory, { recursive: true, mode: 0o700 });
  const runtime = join(options.directory, 'pnpm-runtime.cjs');
  writeFileSync(runtime, createRuntimeSource(options.pnpmScripts), { mode: 0o600 });
  if (options.platform === 'win32') {
    const launcher = join(options.directory, 'pnpm.cmd');
    writeFileSync(
      launcher,
      `@echo off\r\n${quoteWindowsArgument(options.nodeExecutable)} ${quoteWindowsArgument(runtime)} %*\r\n`,
      { mode: 0o700 },
    );
    return options.directory;
  }

  const launcher = join(options.directory, 'pnpm');
  writeFileSync(
    launcher,
    `#!/bin/sh\nexec ${quotePosixArgument(options.nodeExecutable)} ${quotePosixArgument(runtime)} "$@"\n`,
    { mode: 0o700 },
  );
  chmodSync(launcher, 0o700);
  return options.directory;
}

export function prependExecutableDirectory(
  environment: NodeJS.ProcessEnv,
  directory: string,
  platform: NodeJS.Platform = process.platform,
) {
  const key = platform === 'win32'
    ? Object.keys(environment).find((name) => name.toUpperCase() === 'PATH') ?? 'Path'
    : 'PATH';
  const separator = platform === 'win32' ? ';' : ':';
  const current = environment[key];
  return {
    ...environment,
    [key]: current ? `${directory}${separator}${current}` : directory,
  };
}

function createRuntimeSource(pnpmScripts: { v9: string; v10: string; v11: string }) {
  return `'use strict';
const { existsSync, readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const pnpmScripts = ${JSON.stringify(pnpmScripts)};
const modulesManifest = join(process.cwd(), 'node_modules', '.modules.yaml');
let selected = pnpmScripts.v11;

if (existsSync(modulesManifest)) {
  const contents = readFileSync(modulesManifest, 'utf8');
  const storeLine = contents.match(/(?:^|[\\r\\n])\\s*storeDir:\\s*(?:"([^"]+)"|'([^']+)'|([^\\r\\n#]+))/);
  const storeDir = (storeLine?.[1] ?? storeLine?.[2] ?? storeLine?.[3] ?? '').trim();
  const storeVersion = storeDir.match(/[\\\\/]v(\\d+)(?:[\\\\/]|$)/)?.[1];
  if (storeVersion === '3') selected = pnpmScripts.v9;
  else if (storeVersion === '10') selected = pnpmScripts.v10;
  else if (storeVersion === '11') selected = pnpmScripts.v11;
  else if (storeVersion) {
    process.stderr.write('EasyRemote: unsupported pnpm store v' + storeVersion + ' in ' + modulesManifest + '\\n');
    process.exit(1);
  }
}

const child = spawnSync(process.execPath, [selected, ...process.argv.slice(2)], { stdio: 'inherit' });
if (child.error) {
  process.stderr.write('EasyRemote: unable to start bundled pnpm: ' + child.error.message + '\\n');
  process.exit(1);
}
process.exit(child.status ?? 1);
`;
}

function quotePosixArgument(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function quoteWindowsArgument(value: string) {
  if (/[\r\n"]/.test(value)) throw new Error('Executable path cannot be represented in a Windows command launcher');
  return `"${value.replaceAll('%', '%%')}"`;
}
