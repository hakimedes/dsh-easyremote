import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadInstallState, saveInstallState, type InstallState } from './install-state.js';

const state: InstallState = {
  schemaVersion: 1,
  installId: '0198dd42-c274-7000-8000-000000000001',
  activeMode: 'quick',
  hub: { hubId: 'f5f85f64-0320-4e8a-a207-d16af17dc5ce', host: '127.0.0.1', port: 8787 },
  tunnel: { publicOrigin: 'https://example.trycloudflare.com' },
  autostart: 'user-login',
};

describe('install state', () => {
  it('round-trips valid state and restricts the file to the current user', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'easyremote-state-')), 'install.json');
    saveInstallState(path, state);
    expect(loadInstallState(path)).toEqual(state);
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('returns null when no installation exists', () => {
    expect(loadInstallState(join(tmpdir(), `missing-${Date.now()}.json`))).toBeNull();
  });

  it('rejects an empty Hub identity', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'easyremote-state-')), 'install.json');
    expect(() => saveInstallState(path, {
      ...state,
      hub: { ...state.hub, hubId: '' },
    })).toThrow(/Hub state/i);
  });
});
