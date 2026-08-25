import type { ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';

import { parseQuickTunnelOrigin } from './cloudflared.js';

export type HubMeta = { hubId: string; version?: string; publicOrigin: string };

export async function waitForHubMeta(origin: string, options: {
  fetcher?: typeof fetch;
  timeoutMs?: number;
  retryMs?: number;
} = {}): Promise<HubMeta> {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const retryMs = options.retryMs ?? 150;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() <= deadline) {
    try {
      const response = await fetcher(`${origin}/v1/meta`);
      if (!response.ok) throw new Error(`Hub returned HTTP ${response.status}`);
      const value = await response.json() as Partial<HubMeta>;
      if (!value || typeof value.hubId !== 'string' || typeof value.publicOrigin !== 'string') {
        throw new Error('Hub returned invalid metadata');
      }
      return value as HubMeta;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }
  throw new Error(`Local Hub did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export function waitForQuickOrigin(
  child: { stdout: Readable | null; stderr: Readable | null; once?: ChildProcess['once'] },
  timeoutMs = 30_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const streams = [child.stdout, child.stderr].filter((stream): stream is Readable => Boolean(stream));
    const cleanup = () => {
      clearTimeout(timer);
      for (const stream of streams) stream.off('data', onData);
    };
    const finish = (error: Error | null, value?: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value!);
    };
    const onData = (chunk: Buffer | string) => {
      const origin = parseQuickTunnelOrigin(String(chunk));
      if (origin) finish(null, origin);
    };
    const timer = setTimeout(() => finish(new Error('Timed out waiting for Quick Tunnel URL')), timeoutMs);
    for (const stream of streams) stream.on('data', onData);
    child.once?.('error', (error: Error) => finish(error));
    child.once?.('close', (code: number | null) => {
      if (!settled) finish(new Error(`cloudflared exited before publishing a URL (${code ?? 'signal'})`));
    });
  });
}

export function stopManagedChild(child: ChildProcess, timeoutMs = 5_000): Promise<void> {
  if (child.exitCode != null || child.signalCode != null) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    child.once('close', finish);
    child.kill('SIGTERM');
    const timer = setTimeout(() => {
      if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL');
      finish();
    }, timeoutMs);
  });
}
