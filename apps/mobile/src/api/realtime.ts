import { realtimeUrl } from '../config';
import { uuidv7 } from '../domain/ids';
import type { MobileRealtimeFrame, RealtimeStatus, SessionEvent } from '../domain/types';

type Subscription = {
  nodeId: string;
  sessionId: string;
  lastSourceSeq: number;
};

type RealtimeHandlers = {
  onStatus?: (status: RealtimeStatus) => void;
  onEvents?: (events: SessionEvent[]) => void;
  onSnapshotRequired?: (nodeId: string, sessionId: string) => void;
  onApproval?: (frame: Extract<MobileRealtimeFrame, { kind: 'approval.request' }>) => void;
  onError?: (message: string) => void;
};

export class RealtimeClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private manuallyClosed = false;
  private status: RealtimeStatus = 'offline';
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly lastSourceSeq = new Map<string, number>();
  private readonly eventBuffer: SessionEvent[] = [];
  private handlers: RealtimeHandlers;
  private accessToken: () => string | null;
  private server: string;

  constructor(options: { server: string; accessToken: () => string | null; handlers?: RealtimeHandlers }) {
    this.server = options.server;
    this.accessToken = options.accessToken;
    this.handlers = options.handlers || {};
  }

  updateServer(server: string) {
    this.server = server;
  }

  setHandlers(handlers: RealtimeHandlers) {
    this.handlers = handlers;
  }

  async connect() {
    this.manuallyClosed = false;
    this.clearReconnectTimer();
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) return;

    const accessToken = this.accessToken();
    if (!accessToken) {
      this.setStatus('offline');
      return;
    }

    this.setStatus(this.reconnectAttempt > 0 ? 'reconnecting' : 'auth_refreshing');
    const WebSocketWithHeaders = WebSocket as unknown as new (
      url: string,
      protocols?: string | string[],
      options?: { headers?: Record<string, string> },
    ) => WebSocket;
    const socket = new WebSocketWithHeaders(realtimeUrl(this.server), undefined, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempt = 0;
      this.setStatus('connected');
      for (const subscription of this.subscriptions.values()) {
        this.sendSubscribe(subscription);
      }
    };

    socket.onmessage = (message) => {
      try {
        this.handleFrame(JSON.parse(String(message.data)) as MobileRealtimeFrame);
      } catch {
        this.handlers.onError?.('Realtime returned an invalid message.');
      }
    };

    socket.onerror = () => {
      this.handlers.onError?.("Can't reach DSH Remote");
    };

    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      if (!this.manuallyClosed) this.scheduleReconnect();
    };
  }

  disconnect() {
    this.manuallyClosed = true;
    this.clearReconnectTimer();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.setStatus('offline');
  }

  subscribe(nodeId: string, sessionId: string, lastSeq = -1) {
    const key = this.key(nodeId, sessionId);
    this.lastSourceSeq.set(key, Math.max(lastSeq, this.lastSourceSeq.get(key) ?? -1));
    const subscription = { nodeId, sessionId, lastSourceSeq: this.lastSourceSeq.get(key) ?? -1 };
    this.subscriptions.set(key, subscription);
    if (this.socket?.readyState === WebSocket.OPEN) this.sendSubscribe(subscription);
  }

  sync(nodeId: string, sessionId: string) {
    const subscription = this.subscriptions.get(this.key(nodeId, sessionId));
    if (!subscription) return;
    this.send({
      v: 1,
      kind: 'session.sync',
      requestId: uuidv7(),
      nodeId,
      sessionId,
      afterSourceSeq: subscription.lastSourceSeq,
    });
  }

  private sendSubscribe(subscription: Subscription) {
    this.send({
      v: 1,
      kind: 'subscribe',
      requestId: uuidv7(),
      nodeId: subscription.nodeId,
      sessionId: subscription.sessionId,
    });
    this.sync(subscription.nodeId, subscription.sessionId);
  }

  private send(payload: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload));
  }

  private handleFrame(frame: MobileRealtimeFrame) {
    if (frame.v !== 1) return;
    if (frame.kind === 'session.event') {
      this.acceptEvent(frame);
      return;
    }
    if (frame.kind === 'session.sync') {
      for (const event of frame.events || []) this.acceptEvent(event);
      return;
    }
    if (frame.kind === 'snapshot.required') {
      this.handlers.onSnapshotRequired?.(frame.nodeId, frame.sessionId);
      return;
    }
    if (frame.kind === 'approval.request') {
      this.handlers.onApproval?.(frame);
      return;
    }
    if (frame.kind === 'error') this.handlers.onError?.(frame.message);
  }

  private acceptEvent(event: SessionEvent) {
    const key = this.key(event.nodeId, event.sessionId);
    const previous = this.lastSourceSeq.get(key) ?? -1;
    if (event.sourceSeq <= previous) return;
    this.lastSourceSeq.set(key, event.sourceSeq);
    const subscription = this.subscriptions.get(key);
    if (subscription) subscription.lastSourceSeq = event.sourceSeq;
    this.eventBuffer.push(event);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        const events = this.eventBuffer.splice(0, this.eventBuffer.length);
        if (events.length) this.handlers.onEvents?.(events);
      }, 40);
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.manuallyClosed) return;
    this.setStatus('reconnecting');
    const delay = Math.min(15_000, 500 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private setStatus(status: RealtimeStatus) {
    this.status = status;
    this.handlers.onStatus?.(status);
  }

  private key(nodeId: string, sessionId: string) {
    return `${nodeId}:${sessionId}`;
  }
}
