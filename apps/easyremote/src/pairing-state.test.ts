import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadPairingState } from './pairing-state.js';

describe('Connector pairing handoff', () => {
  it('loads a live one-time pairing payload from the installer-owned state directory', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'easyremote-pairing-')), 'pairing.json');
    const pairingExpiresAt = Date.now() + 60_000;
    writeFileSync(path, JSON.stringify({
      schemaVersion: 1,
      status: 'pairing',
      hub: 'https://dsh.example.com',
      nodeName: 'Studio Mac',
      nodeId: null,
      qrPayload: `dshremote://pair?server=${encodeURIComponent('https://dsh.example.com')}&token=${'a'.repeat(64)}`,
      pairingExpiresAt,
      updatedAt: Date.now(),
    }));

    expect(loadPairingState(path)).toMatchObject({ status: 'pairing', pairingExpiresAt });
  });

  it('drops expired QR payloads and rejects malformed handoff files', () => {
    const root = mkdtempSync(join(tmpdir(), 'easyremote-pairing-'));
    const path = join(root, 'pairing.json');
    writeFileSync(path, JSON.stringify({
      schemaVersion: 1,
      status: 'pairing',
      hub: 'https://dsh.example.com',
      nodeName: 'Studio Mac',
      nodeId: null,
      qrPayload: `dshremote://pair?token=${'b'.repeat(64)}`,
      pairingExpiresAt: Date.now() - 1,
      updatedAt: Date.now(),
    }));
    const expired = loadPairingState(path);
    expect(expired).toMatchObject({ pairingExpiresAt: null });
    expect(expired).not.toHaveProperty('qrPayload');

    writeFileSync(path, '{broken');
    expect(loadPairingState(path)).toBeNull();
  });
});
