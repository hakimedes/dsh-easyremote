import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { inspectConnectorRuntime, probeWebSocket, runDoctor } from './doctor.js';

describe('doctor', () => {
  it('reports actionable checks without throwing on a failed probe', async () => {
    const report = await runDoctor({
      nodeVersion: '22.22.3',
      checks: {
        installState: async () => ({ ok: true, detail: 'quick' }),
        cloudflared: async () => ({ ok: false, detail: 'checksum mismatch' }),
        hub: async () => { throw new Error('connection refused'); },
      },
    });
    expect(report.ok).toBe(false);
    expect(report.checks).toEqual([
      { name: 'node', ok: true, detail: '22.22.3' },
      { name: 'installState', ok: true, detail: 'quick' },
      { name: 'cloudflared', ok: false, detail: 'checksum mismatch' },
      { name: 'hub', ok: false, detail: 'connection refused' },
    ]);
  });

  it('verifies that the public origin accepts a WebSocket upgrade', async () => {
    class FakeSocket extends EventEmitter {
      close() {}
    }
    const opened = new FakeSocket();
    const success = probeWebSocket('https://dsh.example.com', {
      timeoutMs: 100,
      createSocket: (url) => {
        expect(url).toBe('wss://dsh.example.com/v1/node/connect');
        queueMicrotask(() => opened.emit('open'));
        return opened;
      },
    });
    await expect(success).resolves.toEqual({ ok: true, detail: 'WebSocket upgrade accepted' });

    const failed = new FakeSocket();
    const failure = probeWebSocket('https://dsh.example.com', {
      timeoutMs: 100,
      createSocket: () => {
        queueMicrotask(() => failed.emit('error', new Error('upgrade blocked')));
        return failed;
      },
    });
    await expect(failure).resolves.toEqual({ ok: false, detail: 'upgrade blocked' });
  });

  it('reports a configured but unloaded Connector instead of a false green check', () => {
    const root = mkdtempSync(join(tmpdir(), 'easyremote-doctor-'));
    expect(inspectConnectorRuntime({
      pairingStatePath: join(root, 'pairing.json'),
      expectedHub: 'https://black-whale.trycloudflare.com',
    })).toEqual({
      ok: false,
      detail: 'pairing handoff missing; restart DSH Web after Connector installation',
    });
  });
});
