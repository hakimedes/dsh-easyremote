import { randomBytes, createHash } from 'node:crypto';
import { setInterval, setTimeout } from 'node:timers';
import { v7 as uuidv7 } from 'uuid';
import WebSocket from 'ws';

import { buildFollowupEvents } from './events.js';

const HUB_BASE = process.env.HUB_BASE || 'http://127.0.0.1:8787';
const HUB_WSS = process.env.HUB_WSS || 'ws://127.0.0.1:8787';
const NODE_NAME = process.env.NODE_NAME || "Developer MacBook";
const PLATFORM = process.env.PLATFORM || 'darwin';
const ARCH = process.env.ARCH || 'arm64';
const PLUGIN_VERSION = process.env.PLUGIN_VERSION || '0.1.0';
const DSH_VERSION = process.env.DSH_VERSION || 'local';

function randomHex(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

type PairingResponse = {
  pairingId: string;
  pairToken: string;
  pollToken: string;
  expiresAt: number;
  qrPayload: string;
};

type PollResponse = {
  status: 'pending' | 'claimed' | 'expired';
  nodeId?: string;
  ownerDisplayName?: string;
};

type CommandFrame = {
  v: number;
  kind: 'command';
  commandId: string;
  requestId: string;
  nodeId: string;
  sessionId: string | null;
  action: string;
  payload: Record<string, unknown>;
  issuedAt: number;
  expiresAt: number;
};

type SessionEvent = {
  sourceSeq: number;
  type: string;
  data: Record<string, unknown>;
};

type FakeSession = {
  seq: number;
  title: string;
  status: 'idle' | 'running';
  createdAt: number;
  updatedAt: number;
  events: SessionEvent[];
};

async function postJson<T>(url: string, body: any): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }

  return response.json() as Promise<T>;
}

async function getJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return response.json() as Promise<T>;
}

async function main() {
  const installId = uuidv7();
  const nodeSecret = randomHex(32);

  console.log(`[fake-plugin] installId=${installId}`);

  const createResp = await postJson<PairingResponse>(`${HUB_BASE}/v1/node-pairings`, {
    nodeName: NODE_NAME,
    platform: PLATFORM,
    arch: ARCH,
    pluginVersion: PLUGIN_VERSION,
    dshVersion: DSH_VERSION,
    installId,
    nodeSecretHash: sha256(nodeSecret),
  });

  console.log(`[fake-plugin] Pairing QR Payload: ${createResp.qrPayload}`);
  console.log(`[fake-plugin] Poll with: ${createResp.pollToken}`);

  const claimHeaders = { authorization: `Pair ${createResp.pollToken}` };
  let nodeId = '';

  while (!nodeId) {
    const polling = await getJson<PollResponse>(`${HUB_BASE}/v1/node-pairings/${createResp.pairingId}`, claimHeaders);
    if (polling.status === 'claimed' && polling.nodeId) {
      nodeId = polling.nodeId;
      break;
    }
    if (polling.status === 'expired') {
      throw new Error('Pairing expired before claim completion');
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }

  console.log(`[fake-plugin] claimed as nodeId=${nodeId}`);

  const ws = new WebSocket(`${HUB_WSS}/v1/node/connect`, {
    headers: {
      authorization: `Node ${nodeId}.${nodeSecret}`,
    },
  });

  const activeSessions = new Map<string, FakeSession>();
  const fakeSessionNow = Date.now();
  activeSessions.set('fake-session-001', {
    seq: -1,
    title: 'Fix authentication middleware',
    status: 'idle',
    createdAt: fakeSessionNow - 60_000,
    updatedAt: fakeSessionNow,
    events: [],
  });

  ws.on('open', () => {
    ws.send(
      JSON.stringify({
        v: 1,
        kind: 'node.hello',
        protocolMin: 1,
        protocolMax: 1,
        node: {
          id: nodeId,
          name: NODE_NAME,
          platform: PLATFORM,
          arch: ARCH,
          pluginVersion: PLUGIN_VERSION,
          dshVersion: DSH_VERSION,
        },
        capabilities: [
          'session.list',
          'session.snapshot',
          'session.create',
          'session.followup',
          'session.steer',
          'session.stop',
          'session.events',
          'approval.respond',
        ],
      }),
    );

    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ v: 1, kind: 'node.heartbeat', nodeId }));
      }
    }, 15_000);
  });

  ws.on('message', (raw) => {
    const msg = raw.toString();
    const payload = JSON.parse(msg);

    if (payload.kind === 'node.hello.ack') {
      console.log(`[fake-plugin] hello acknowledged by hub`);
      return;
    }

    if (payload.kind === 'node.heartbeat.ack') {
      return;
    }

    if (payload.kind === 'command') {
      const frame = payload as CommandFrame;
      handleCommand(frame, nodeId, activeSessions);
      return;
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[fake-plugin] socket closed ${code} ${reason}`);
    process.exit(0);
  });

  ws.on('error', (error) => {
    console.error('[fake-plugin] websocket error', error);
  });

  function emitSessionEvent(sessionId: string, type: string, data: Record<string, unknown>) {
    const now = Date.now();
    const session: FakeSession = activeSessions.get(sessionId) ?? {
      seq: -1,
      title: `Session ${sessionId}`,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
      events: [],
    };
    session.seq += 1;
    session.updatedAt = now;
    session.events.push({ sourceSeq: session.seq, type, data });
    if (session.events.length > 2_000) {
      session.events.splice(0, session.events.length - 2_000);
    }
    activeSessions.set(sessionId, session);
    if (ws.readyState !== WebSocket.OPEN) return;

    ws.send(
      JSON.stringify({
        v: 1,
        kind: 'session.event',
        nodeId,
        sessionId,
        sourceSeq: session.seq,
        event: {
          type,
          data,
        },
      }),
    );
  }

  function handleCommand(frame: CommandFrame, nodeId: string, sessions: Map<string, FakeSession>) {
    if (frame.expiresAt && frame.expiresAt < Date.now()) {
      return;
    }

    const ack = {
      v: 1,
      kind: 'command.ack',
      commandId: frame.commandId,
      requestId: frame.requestId,
      status: 'acked',
    };

    const sendResult = (ok: boolean, result?: unknown, error?: { code: string; message?: string }) => {
      ws.send(JSON.stringify({
        v: 1,
        kind: 'command.result',
        commandId: frame.commandId,
        requestId: frame.requestId,
        ok,
        result,
        error,
      }));
    };

    if (frame.action === 'session.list') {
      ws.send(JSON.stringify(ack));
      sendResult(true, {
        sessions: Array.from(sessions.entries()).map(([id, session]) => ({
          id,
          title: session.title,
          status: session.status,
          lastSourceSeq: session.seq,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        })),
      });
      return;
    }

    if (frame.action === 'session.create') {
      const sessionId = uuidv7();
      const now = Date.now();
      sessions.set(sessionId, {
        seq: -1,
        title: 'New Session',
        status: 'idle',
        createdAt: now,
        updatedAt: now,
        events: [],
      });
      ws.send(JSON.stringify(ack));
      sendResult(true, {
        session: {
          id: sessionId,
          title: 'New Session',
          status: 'idle',
          lastSourceSeq: -1,
          createdAt: now,
          updatedAt: now,
        },
      });
      emitSessionEvent(sessionId, 'assistant.message', { text: `Session created: ${sessionId}` });
      return;
    }

    if (frame.action === 'session.snapshot') {
      const sessionId = frame.sessionId as string;
      const session = sessions.get(sessionId);
      ws.send(JSON.stringify(ack));
      sendResult(true, {
        session: {
          id: sessionId,
          title: session?.title || `Session ${sessionId}`,
          status: session?.status || 'idle',
          lastSourceSeq: session?.seq ?? -1,
          createdAt: session?.createdAt || Date.now(),
          updatedAt: session?.updatedAt || Date.now(),
        },
        events: session?.events ?? [],
      });
      return;
    }

    if (frame.action === 'session.followup') {
      const sessionId = frame.sessionId as string;
      const content = String(frame.payload.content || '');
      ws.send(JSON.stringify(ack));
      const session = sessions.get(sessionId);
      if (session) session.status = 'running';
      for (const event of buildFollowupEvents(content)) {
        emitSessionEvent(sessionId, event.type, event.data);
      }
      if (session) session.status = 'idle';

      if (content.toLowerCase().includes('approve') || content.toLowerCase().includes('permission')) {
        const approvalId = uuidv7();
        const toolCallId = `tool-${uuidv7()}`;
        ws.send(
          JSON.stringify({
            v: 1,
            kind: 'approval.request',
            approval: {
              approvalId,
              nodeId,
              sessionId,
              toolCallId,
              title: 'Run command',
              summary: content,
              cwd: 'project',
              risk: 'medium',
              expiresAt: Date.now() + 10 * 60_000,
            },
          }),
        );
      }

      sendResult(true, { accepted: true });
      return;
    }

    if (frame.action === 'session.steer') {
      const sessionId = frame.sessionId as string;
      ws.send(JSON.stringify(ack));
      emitSessionEvent(sessionId, 'assistant.message', {
        text: `steered: ${String(frame.payload.instruction || '')}`,
      });
      sendResult(true, { accepted: true });
      return;
    }

    if (frame.action === 'session.stop') {
      const sessionId = frame.sessionId as string;
      ws.send(JSON.stringify(ack));
      emitSessionEvent(sessionId, 'assistant.message', {
        text: `session stop: ${String(frame.payload.reason || 'user stop')}`,
      });
      const session = sessions.get(sessionId);
      if (session) session.status = 'idle';
      sendResult(true, { stopped: true });
      return;
    }

    if (frame.action === 'approval.respond') {
      ws.send(JSON.stringify(ack));
      sendResult(true, { accepted: true });
      return;
    }

    ws.send(JSON.stringify({
      v: 1,
      kind: 'command.ack',
      commandId: frame.commandId,
      requestId: frame.requestId,
      status: 'failed',
      errorCode: 'CAPABILITY_UNAVAILABLE',
    }));
    sendResult(false, undefined, {
      code: 'CAPABILITY_UNAVAILABLE',
      message: `Unsupported action: ${frame.action}`,
    });
  }
}

main().catch((err) => {
  console.error('[fake-plugin]', err?.message || err);
  process.exit(1);
});
