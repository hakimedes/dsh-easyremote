import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RealtimeClient } from './realtime';

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  readonly send = vi.fn();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  fail() {
    this.onerror?.();
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

describe('RealtimeClient connection recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances.length = 0;
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reconnects after a transport error without surfacing a stale global error', async () => {
    const onError = vi.fn();
    const onStatus = vi.fn();
    const client = new RealtimeClient({
      server: 'https://hub.example',
      accessToken: () => 'access-token',
      handlers: { onError, onStatus },
    });

    await client.connect();
    const first = FakeWebSocket.instances[0];
    first.open();
    first.fail();

    expect(onError).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenLastCalledWith('reconnecting');

    await vi.advanceTimersByTimeAsync(500);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('replaces a stale open socket when the app returns to the foreground', async () => {
    const client = new RealtimeClient({
      server: 'https://hub.example',
      accessToken: () => 'access-token',
    });

    await client.connect();
    const stale = FakeWebSocket.instances[0];
    stale.open();

    client.reconnectNow();

    expect(stale.readyState).toBe(FakeWebSocket.CLOSED);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});
