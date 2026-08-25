export type InstallMode = 'quick' | 'named';

export interface InstallState {
  schemaVersion: 1;
  installId: string;
  activeMode: InstallMode;
  hub: {
    hubId: string;
    host: '127.0.0.1';
    port: number;
  };
  tunnel: {
    publicOrigin?: string;
    hostname?: string;
    tunnelId?: string;
  };
  autostart: 'user-login';
}

export function loadInstallState(_path: string): InstallState | null {
  if (!existsSync(_path)) return null;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(_path, 'utf8'));
  } catch (error) {
    throw new Error(`Install state is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  assertInstallState(value);
  return value;
}

export function saveInstallState(_path: string, _state: InstallState): void {
  assertInstallState(_state);
  mkdirSync(dirname(_path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${_path}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(_state, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, _path);
  if (process.platform !== 'win32') chmodSync(_path, 0o600);
}

function assertInstallState(value: unknown): asserts value is InstallState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Install state must be an object');
  const state = value as Partial<InstallState>;
  if (state.schemaVersion !== 1) throw new Error('Unsupported install state schema');
  if (typeof state.installId !== 'string' || !state.installId) throw new Error('Install state requires installId');
  if (state.activeMode !== 'quick' && state.activeMode !== 'named') throw new Error('Invalid install mode');
  if (!state.hub || state.hub.host !== '127.0.0.1' || !Number.isInteger(state.hub.port)
    || state.hub.port < 1 || state.hub.port > 65_535 || typeof state.hub.hubId !== 'string'
    || !state.hub.hubId.trim()) {
    throw new Error('Invalid local Hub state');
  }
  if (!state.tunnel || typeof state.tunnel !== 'object') throw new Error('Invalid tunnel state');
  if (state.autostart !== 'user-login') throw new Error('Invalid autostart mode');
}
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
