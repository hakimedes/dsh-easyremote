import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type SetupPhase =
  | 'choose-mode'
  | 'quick-starting'
  | 'cloudflare-site'
  | 'nameservers-pending'
  | 'cloudflare-authorizing'
  | 'cloudflare-authorized'
  | 'named-provisioning'
  | 'complete'
  | 'error';

export type SetupProgress = {
  schemaVersion: 1;
  mode?: 'quick' | 'named';
  phase: SetupPhase;
  rootDomain?: string;
  hostname?: string;
  nameservers?: [string, string];
  lastError?: string;
  updatedAt: number;
};

export function loadSetupProgress(path: string): SetupProgress | null {
  if (!existsSync(path)) return null;
  const value = JSON.parse(readFileSync(path, 'utf8')) as SetupProgress;
  if (value.schemaVersion !== 1 || typeof value.phase !== 'string' || typeof value.updatedAt !== 'number') {
    throw new Error('Invalid setup progress');
  }
  return value;
}

export function saveSetupProgress(path: string, progress: SetupProgress): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(progress, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, path);
  if (process.platform !== 'win32') chmodSync(path, 0o600);
}
