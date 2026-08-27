import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { artifactFor, CLOUDFLARED_VERSION, type CloudflaredArtifact } from './cloudflared.js';
import { installCloudflaredArtifact } from './download.js';
import type { ProcessLaunch, RuntimePaths } from './runtime.js';

const crossSpawn = createRequire(import.meta.url)('cross-spawn') as typeof spawn;

export async function findAvailablePort(
  preferred = 8787,
  probe: (port: number) => Promise<boolean> = isLoopbackPortFree,
) {
  for (let offset = 0; offset < 100; offset += 1) {
    const port = preferred + offset;
    if (port > 65_535) break;
    if (await probe(port)) return port;
  }
  throw new Error(`No free loopback port found from ${preferred}`);
}

export async function ensureCloudflaredRuntime(paths: RuntimePaths, options: {
  platform?: NodeJS.Platform;
  arch?: string;
  installer?: (input: {
    artifact: CloudflaredArtifact;
    destination: string;
  }) => Promise<void>;
} = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const artifact = artifactFor(platform, arch);
  const expected = {
    version: CLOUDFLARED_VERSION,
    platform,
    arch,
    artifact: artifact.name,
    sha256: artifact.sha256,
  };
  if (inspectCloudflaredRuntime(paths, { platform, arch }).ok) return;
  mkdirSync(paths.cloudflaredDir, { recursive: true, mode: 0o700 });
  await (options.installer ?? installCloudflaredArtifact)({ artifact, destination: paths.cloudflaredExecutable });
  writeFileSync(paths.cloudflaredManifest, `${JSON.stringify({
    ...expected,
    executableSha256: fileSha256(paths.cloudflaredExecutable),
  }, null, 2)}\n`, { mode: 0o600 });
}

export function inspectCloudflaredRuntime(
  paths: RuntimePaths,
  options: { platform?: NodeJS.Platform; arch?: string } = {},
) {
  if (!existsSync(paths.cloudflaredExecutable) || !existsSync(paths.cloudflaredManifest)) {
    return { ok: false, detail: 'cloudflared is not installed' };
  }
  try {
    const platform = options.platform ?? process.platform;
    const arch = options.arch ?? process.arch;
    const artifact = artifactFor(platform, arch);
    const manifest = JSON.parse(readFileSync(paths.cloudflaredManifest, 'utf8')) as Record<string, unknown>;
    const metadataMatches = manifest.version === CLOUDFLARED_VERSION
      && manifest.platform === platform
      && manifest.arch === arch
      && manifest.artifact === artifact.name
      && manifest.sha256 === artifact.sha256;
    const executableHash = fileSha256(paths.cloudflaredExecutable);
    const hashMatches = typeof manifest.executableSha256 === 'string'
      && manifest.executableSha256 === executableHash;
    return {
      ok: metadataMatches && hashMatches,
      detail: metadataMatches && hashMatches
        ? `verified cloudflared ${CLOUDFLARED_VERSION}`
        : 'cloudflared metadata or executable checksum mismatch',
    };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

function fileSha256(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function spawnLoggedProcess(
  paths: RuntimePaths,
  launch: ProcessLaunch,
  role: 'hub' | 'tunnel',
  mirrorOutput = true,
): ChildProcess {
  mkdirSync(paths.logsDir, { recursive: true, mode: 0o700 });
  const log = createWriteStream(join(paths.logsDir, `${role}.log`), { flags: 'a', mode: 0o600 });
  const child = crossSpawn(launch.command, launch.args, {
    env: launch.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  if (mirrorOutput) {
    child.stdout?.pipe(process.stdout, { end: false });
    child.stderr?.pipe(process.stderr, { end: false });
  }
  child.once('close', () => log.end());
  return child;
}

export function runProcessLaunch(launch: ProcessLaunch, interactive = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = crossSpawn(launch.command, launch.args, {
      env: launch.env ?? process.env,
      stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const errors: Buffer[] = [];
    if (!interactive) child.stderr?.on('data', (chunk: Buffer) => errors.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed (${code ?? 'signal'}): ${Buffer.concat(errors).toString('utf8').trim()}`));
    });
  });
}

export function captureProcessLaunch(launch: ProcessLaunch, maxOutputBytes = 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = crossSpawn(launch.command, launch.args, {
      env: launch.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let outputBytes = 0;
    const capture = (target: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        child.kill();
        reject(new Error('Command output exceeded the safe capture limit'));
        return;
      }
      target.push(chunk);
    };
    child.stdout?.on('data', (chunk: Buffer) => capture(output, chunk));
    child.stderr?.on('data', (chunk: Buffer) => capture(errors, chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(Buffer.concat(output).toString('utf8'));
      else reject(new Error(`Command failed (${code ?? 'signal'}): ${Buffer.concat(errors).toString('utf8').trim()}`));
    });
  });
}

function isLoopbackPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}
