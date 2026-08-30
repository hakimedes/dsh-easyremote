import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { stopManagedChild, waitForHubMeta, waitForQuickOrigin } from './supervisor.js';

describe('local process supervision', () => {
  it('retries Hub metadata until the local process is ready', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('refused'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ hubId: 'hub-id', publicOrigin: 'http://127.0.0.1:8787' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    await expect(waitForHubMeta('http://127.0.0.1:8787', { fetcher, timeoutMs: 100, retryMs: 1 }))
      .resolves.toMatchObject({ hubId: 'hub-id' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('waits through a delayed QUIC to HTTP/2 fallback before timing out', async () => {
    let elapsedMs = 0;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => elapsedMs);
    const fetcher = vi.fn(async () => {
      elapsedMs += 4_000;
      if (elapsedMs < 20_000) throw new Error('fetch failed');
      return new Response(JSON.stringify({
        hubId: 'hub-id',
        publicOrigin: 'https://black-whale.trycloudflare.com',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    try {
      await expect(waitForHubMeta('https://black-whale.trycloudflare.com', { fetcher, retryMs: 0 }))
        .resolves.toMatchObject({ hubId: 'hub-id' });
    } finally {
      dateNow.mockRestore();
    }
  });

  it('resolves a Quick Tunnel origin from either cloudflared output stream', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const promise = waitForQuickOrigin({ stdout, stderr } as any, 100);
    stderr.write('INF Route propagating https://Black-Whale.trycloudflare.com');
    await expect(promise).resolves.toBe('https://black-whale.trycloudflare.com');
  });

  it('sends SIGTERM and waits for a managed child to close', async () => {
    const child = new EventEmitter() as any;
    child.exitCode = null;
    child.kill = vi.fn(() => { child.exitCode = 0; queueMicrotask(() => child.emit('close', 0)); return true; });
    await stopManagedChild(child, 100);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
