import { chmodSync, existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';

import { artifactUrl, verifySha256, type CloudflaredArtifact } from './cloudflared.js';

type InstallOptions = {
  artifact: CloudflaredArtifact;
  destination: string;
  fetcher?: typeof fetch;
  extractArchive?: (archivePath: string, destination: string) => Promise<void>;
};

export async function installCloudflaredArtifact(options: InstallOptions): Promise<void> {
  const response = await (options.fetcher ?? fetch)(artifactUrl(options.artifact));
  if (!response.ok) throw new Error(`cloudflared download failed with HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!verifySha256(bytes, options.artifact.sha256)) throw new Error('cloudflared checksum verification failed');

  mkdirSync(dirname(options.destination), { recursive: true, mode: 0o700 });
  const temporaryPath = `${options.destination}.download-${process.pid}`;
  try {
    if (options.artifact.archive === 'binary') {
      writeFileSync(temporaryPath, bytes, { mode: 0o700 });
    } else {
      const archivePath = `${temporaryPath}.tgz`;
      writeFileSync(archivePath, bytes, { mode: 0o600 });
      try {
        await (options.extractArchive ?? extractCloudflaredTgz)(archivePath, temporaryPath);
      } finally {
        if (existsSync(archivePath)) unlinkSync(archivePath);
      }
    }
    if (!existsSync(temporaryPath)) throw new Error('cloudflared archive did not contain an executable');
    if (process.platform !== 'win32') chmodSync(temporaryPath, 0o755);
    renameSync(temporaryPath, options.destination);
    if (process.platform !== 'win32') chmodSync(options.destination, 0o755);
  } catch (error) {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    throw error;
  }
}

function extractCloudflaredTgz(archivePath: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xOzf', archivePath, 'cloudflared'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) return reject(new Error(`Unable to extract cloudflared: ${Buffer.concat(errors).toString('utf8')}`));
      writeFileSync(destination, Buffer.concat(chunks), { mode: 0o700 });
      resolve();
    });
  });
}
