import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const packageRequire = createRequire(import.meta.url);

export function resolveBundledPnpmScript() {
  const manifestPath = packageRequire.resolve('pnpm');
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
  pnpmScript: string;
}) {
  mkdirSync(options.directory, { recursive: true, mode: 0o700 });
  if (options.platform === 'win32') {
    const launcher = join(options.directory, 'pnpm.cmd');
    writeFileSync(
      launcher,
      `@echo off\r\n${quoteWindowsArgument(options.nodeExecutable)} ${quoteWindowsArgument(options.pnpmScript)} %*\r\n`,
      { mode: 0o700 },
    );
    return options.directory;
  }

  const launcher = join(options.directory, 'pnpm');
  writeFileSync(
    launcher,
    `#!/bin/sh\nexec ${quotePosixArgument(options.nodeExecutable)} ${quotePosixArgument(options.pnpmScript)} "$@"\n`,
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

function quotePosixArgument(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function quoteWindowsArgument(value: string) {
  if (/[\r\n"]/.test(value)) throw new Error('Executable path cannot be represented in a Windows command launcher');
  return `"${value.replaceAll('%', '%%')}"`;
}
