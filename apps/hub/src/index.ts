import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { z } from 'zod';
import { SignJWT, jwtVerify } from 'jose';
import { v7 as uuidv7 } from 'uuid';
import type { RawData, WebSocket } from 'ws';

import { getOrCreateHubId, openDatabase } from './database.js';
import { UploadSpool, UploadSpoolError, UPLOAD_CHUNK_BYTES } from './upload-spool.js';

const PORT = Number(process.env.PORT ?? '8787');
const HOST = process.env.HOST ?? '127.0.0.1';
const HUB_ENTRY = process.env.HUB_ENTRY ?? 'https://dsh.infomind.cc';
const HUB_ENTRY_FILE = process.env.HUB_ENTRY_FILE;
const HUB_VERSION = process.env.DSH_EASYREMOTE_VERSION ?? '0.3.0';
const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_MS = 60 * 24 * 60 * 60 * 1000;
const COMMAND_TTL_MS = 30_000;
const HEARTBEAT_MS = 15_000;
const OFFLINE_MS = 45_000;
const HTTP_BODY_LIMIT = 1_000_000;
const WS_PAYLOAD_LIMIT = 512 * 1024;
const SESSION_EVENT_MAX = 2000;
const SESSION_EVENT_TTL_MS = 10 * 60 * 1000;
const COMMAND_RETENTION_MS = Number(process.env.COMMAND_RETENTION_MS ?? 7 * 24 * 60 * 60 * 1000);
const DB_PATH = process.env.DATABASE_PATH || './data/hub.sqlite';
const SPOOL_DIR = process.env.SPOOL_DIR || resolve(dirname(DB_PATH), 'spool');
const jwtSecretValue = process.env.JWT_SECRET || 'replace-me-secret-change-before-prod';
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || jwtSecretValue.length < 32)) {
  throw new Error('JWT_SECRET must be explicitly set to at least 32 characters in production');
}
const JWT_SECRET = new TextEncoder().encode(jwtSecretValue);

const dbFile = resolve(DB_PATH);
mkdirSync(dirname(dbFile), { recursive: true });
const sqlite = openDatabase(dbFile);
const HUB_ID = getOrCreateHubId(sqlite);
const uploadSpool = new UploadSpool(sqlite, SPOOL_DIR);

function nowMs() {
  return Date.now();
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeModelSelection(value: unknown) {
  const selection = objectValue(value);
  if (!selection || typeof selection.provider !== 'string' || typeof selection.model !== 'string') return null;
  return {
    provider: selection.provider,
    model: selection.model,
    ...(typeof selection.reasoningEffort === 'string'
      ? { reasoningEffort: selection.reasoningEffort }
      : {}),
  };
}

function normalizeSessionModels(value: unknown) {
  const result = objectValue(value);
  const current = normalizeModelSelection(result?.current);
  if (!result || !current) throw { code: 'INTERNAL_ERROR', message: 'Node returned invalid model metadata' };
  const groups = Array.isArray(result.groups) ? result.groups.flatMap((groupValue) => {
    const group = objectValue(groupValue);
    if (!group || typeof group.id !== 'string' || typeof group.name !== 'string' || !Array.isArray(group.models)) return [];
    const models = group.models.flatMap((modelValue) => {
      const model = objectValue(modelValue);
      if (!model || typeof model.id !== 'string' || typeof model.name !== 'string') return [];
      const reasoningValue = objectValue(model.reasoning);
      const efforts = Array.isArray(reasoningValue?.efforts)
        ? reasoningValue.efforts.flatMap((effortValue) => {
            const effort = objectValue(effortValue);
            if (!effort || typeof effort.id !== 'string' || typeof effort.name !== 'string') return [];
            return [{
              id: effort.id,
              name: effort.name,
              ...(typeof effort.description === 'string' ? { description: effort.description } : {}),
            }];
          })
        : [];
      return [{
        id: model.id,
        name: model.name,
        ...(typeof model.description === 'string' ? { description: model.description } : {}),
        ...(reasoningValue ? {
          reasoning: {
            efforts,
            ...(typeof reasoningValue.defaultEffort === 'string'
              ? { defaultEffort: reasoningValue.defaultEffort }
              : {}),
          },
        } : {}),
      }];
    });
    return [{ id: group.id, name: group.name, models }];
  }) : [];
  const failures = Array.isArray(result.failures) ? result.failures.flatMap((failureValue) => {
    const failure = objectValue(failureValue);
    if (!failure || typeof failure.id !== 'string' || typeof failure.name !== 'string' || typeof failure.message !== 'string') return [];
    return [{ id: failure.id, name: failure.name, message: failure.message }];
  }) : [];
  return { current, routable: result.routable === true, groups, failures };
}

function hashText(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function randomHex(bytes: number) {
  return randomBytes(bytes).toString('hex');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isUuidv7(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseBearer(auth: string | undefined) {
  if (!auth) return null;
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice(7);
}

function parsePairToken(auth: string | undefined) {
  if (!auth) return null;
  if (!auth.startsWith('Pair ')) return null;
  return auth.slice(5);
}

function parseNodeAuth(auth: string | undefined) {
  if (!auth) return null;
  if (!auth.startsWith('Node ')) return null;
  const raw = auth.slice(5);
  const idx = raw.indexOf('.');
  if (idx <= 0) return null;
  return {
    nodeId: raw.slice(0, idx),
    nodeSecret: raw.slice(idx + 1),
  };
}

type AuthContext = {
  userId: string;
  orgId: string;
  deviceId: string;
};

function normalizePublicOrigin(value: string) {
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Hub public origin must use HTTP or HTTPS');
  }
  return url.origin;
}

function currentPublicOrigin() {
  if (HUB_ENTRY_FILE) {
    try {
      const raw = readFileSync(HUB_ENTRY_FILE, 'utf8').trim();
      if (raw) {
        const fileValue = raw.startsWith('{')
          ? (JSON.parse(raw) as { publicOrigin?: unknown }).publicOrigin
          : raw;
        if (typeof fileValue === 'string' && fileValue.trim()) {
          return normalizePublicOrigin(fileValue);
        }
      }
    } catch (error) {
      app.log.warn({ err: error, path: HUB_ENTRY_FILE }, 'Unable to read Hub entry file; using HUB_ENTRY');
    }
  }
  return normalizePublicOrigin(HUB_ENTRY);
}

function pairingQrPayload(pairToken: string) {
  const qr = new URL('dshremote://pair');
  qr.searchParams.set('server', currentPublicOrigin());
  qr.searchParams.set('token', pairToken);
  qr.searchParams.set('hubId', HUB_ID);
  return qr.toString();
}

type NodeConnection = {
  ws: WebSocket;
  nodeId: string;
  userId: string;
  capabilities: Set<string>;
  protocolMin: number;
  protocolMax: number;
  lastSeenAt: number;
};

type MobileConnection = {
  ws: WebSocket;
  userId: string;
  deviceId: string;
  subscriptions: Set<string>;
};

type SessionRingEvent = {
  v: 1;
  kind: 'session.event';
  nodeId: string;
  sessionId: string;
  sourceSeq: number;
  event: {
    type: string;
    data: Record<string, unknown>;
  };
  createdAt: number;
};

type SessionRing = {
  events: SessionRingEvent[];
  lastSourceSeq: number;
  updatedAt: number;
};

const nodeConnections = new Map<string, NodeConnection>();
const mobileConnections = new Set<MobileConnection>();
const sessionSubscribers = new Map<string, Set<WebSocket>>();
const sessionRings = new Map<string, SessionRing>();
const sessionMeta = new Map<string, { title: string; createdAt: number; updatedAt: number }>();
type CommandResultFrame = {
  v: 1;
  kind: 'command.result';
  commandId: string;
  requestId?: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code?: string;
    message?: string;
  };
};

function minimalPersistedCommandResult(action: string, frame: CommandResultFrame): CommandResultFrame | null {
  const base = {
    v: 1 as const,
    kind: 'command.result' as const,
    commandId: frame.commandId,
    ...(frame.requestId ? { requestId: frame.requestId } : {}),
    ok: frame.ok,
  };

  if (!frame.ok) {
    return {
      ...base,
      error: { code: String(frame.error?.code || 'INTERNAL_ERROR') },
    };
  }

  const result = objectValue(frame.result);
  if (action === 'session.create') {
    const session = objectValue(result?.session);
    const id = typeof session?.id === 'string'
      ? session.id
      : typeof session?.sessionId === 'string'
        ? session.sessionId
        : null;
    if (!id) return null;
    return {
      ...base,
      result: {
        session: {
          id,
          ...(typeof session?.title === 'string' ? { title: session.title } : {}),
          ...(typeof session?.agentPreset === 'string' ? { agentPreset: session.agentPreset } : {}),
          ...(typeof session?.lastSourceSeq === 'number' ? { lastSourceSeq: session.lastSourceSeq } : {}),
          ...(typeof session?.createdAt === 'number' ? { createdAt: session.createdAt } : {}),
          ...(typeof session?.updatedAt === 'number' ? { updatedAt: session.updatedAt } : {}),
        },
      },
    };
  }

  if (action === 'session.selectModel') {
    const selected = normalizeModelSelection(result?.selected);
    return selected ? { ...base, result: { selected } } : null;
  }

  if (action === 'session.rename') {
    const title = typeof result?.title === 'string' ? result.title : null;
    if (!title) return null;
    return {
      ...base,
      result: {
        title,
        ...(typeof result?.seq === 'number' ? { seq: result.seq } : {}),
      },
    };
  }

  if (action === 'session.followup') {
    return { ...base, result: { accepted: result?.accepted !== false } };
  }

  return null;
}

type PendingCommandResult = {
  resolve: (frame: CommandResultFrame) => void;
  reject: (error: { code: string; message: string }) => void;
  timeout: ReturnType<typeof setTimeout>;
  promise: Promise<CommandResultFrame>;
};

const pendingCommandTimeout = new Map<string, ReturnType<typeof setTimeout>>();
const pendingCommandResults = new Map<string, PendingCommandResult>();
const rateBuckets = new Map<string, { count: number; windowStart: number }>();
const uploadRateBuckets = new Map<string, { count: number; bytes: number; windowStart: number }>();

function keySession(nodeId: string, sessionId: string) {
  return `${nodeId}:${sessionId}`;
}

function sendJson(ws: WebSocket, payload: unknown) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(payload));
  }
}

async function issueAccessToken(userId: string, orgId: string, deviceId: string) {
  return new SignJWT({
    orgId,
    deviceId,
    type: 'access',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(JWT_SECRET);
}

async function verifyAccessToken(token: string): Promise<AuthContext | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (payload.type !== 'access' || typeof payload.sub !== 'string') return null;
    if (typeof payload.orgId !== 'string' || typeof payload.deviceId !== 'string') return null;
    return {
      userId: payload.sub,
      orgId: payload.orgId as string,
      deviceId: payload.deviceId as string,
    };
  } catch {
    return null;
  }
}

function countUsers() {
  const row = sqlite.prepare('SELECT COUNT(1) AS c FROM users').get() as { c: number };
  return row.c;
}

function getUser(userId: string) {
  return sqlite.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any | undefined;
}

function getUserByNode(nodeId: string) {
  return sqlite.prepare('SELECT owner_user_id FROM nodes WHERE id = ?').get(nodeId) as { owner_user_id: string } | undefined;
}

function createDefaultOrgAndUser(displayName: string) {
  const orgId = uuidv7();
  const userId = uuidv7();
  const now = nowMs();
  const orgName = 'Default Organization';
  sqlite.prepare('INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)').run(orgId, orgName, now);
  sqlite.prepare('INSERT INTO users (id, org_id, display_name, created_at) VALUES (?, ?, ?, ?)').run(userId, orgId, displayName, now);
  return { orgId, userId, displayName };
}

function createDevice(userId: string, kind: 'mobile' | 'node', name: string) {
  const deviceId = uuidv7();
  sqlite.prepare('INSERT INTO devices (id, user_id, kind, display_name, created_at) VALUES (?, ?, ?, ?, ?)').run(
    deviceId,
    userId,
    kind,
    name,
    nowMs(),
  );
  return deviceId;
}

function createRefreshToken(userId: string, deviceId: string) {
  const refreshId = uuidv7();
  const token = randomHex(32);
  const tokenHash = hashText(token);
  const expiresAt = nowMs() + REFRESH_TTL_MS;
  const createdAt = nowMs();
  sqlite.prepare('INSERT INTO refresh_tokens (id, user_id, device_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    refreshId,
    userId,
    deviceId,
    tokenHash,
    expiresAt,
    createdAt,
  );
  return { refreshId, token, expiresAt, createdAt };
}

function writeAudit(event: string, actorUserId: string | null, nodeId: string | null, deviceId: string | null, details: Record<string, unknown>) {
  sqlite.prepare('INSERT INTO audit_logs (id, event, actor_user_id, node_id, device_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uuidv7(), event, actorUserId, nodeId, deviceId, JSON.stringify(details), nowMs());
}

function ensureNodeMeta(nodeId: string) {
  const row = sqlite.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId) as any | undefined;
  return row;
}

function getNodeFromAuthorization(authHeader: string | undefined) {
  const auth = parseNodeAuth(authHeader);
  if (!auth) return null;
  const node = ensureNodeMeta(auth.nodeId);
  if (!node || node.revoked_at || node.credential_hash !== hashText(auth.nodeSecret)) return null;
  return node;
}

function nodeOwnerId(nodeId: string) {
  const row = sqlite.prepare('SELECT owner_user_id FROM nodes WHERE id = ?').get(nodeId) as
    | { owner_user_id: string }
    | undefined;
  return row?.owner_user_id;
}

function nodeIsOnline(nodeId: string) {
  const socket = nodeConnections.get(nodeId);
  return Boolean(socket && socket.ws.readyState === 1);
}

function publicNode(row: any) {
  const connection = nodeConnections.get(row.id);
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    arch: row.arch,
    pluginVersion: row.plugin_version,
    dshVersion: row.dsh_version,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
    online: nodeIsOnline(row.id),
    capabilities: connection ? [...connection.capabilities].sort() : [],
  };
}

function publicSession(row: any) {
  return {
    sessionId: row.session_id,
    title: row.title,
    lastEventSeq: row.last_event_seq,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

function writeRingEvent(nodeId: string, sessionId: string, event: Omit<SessionRingEvent, 'createdAt'>) {
  const k = keySession(nodeId, sessionId);
  const bucket = sessionRings.get(k) ?? { events: [], lastSourceSeq: -1, updatedAt: nowMs() };

  const next = {
    ...event,
    createdAt: nowMs(),
  };

  const expectedNext = bucket.lastSourceSeq + 1;
  if (bucket.events.length === 0 || event.sourceSeq >= expectedNext) {
    bucket.lastSourceSeq = event.sourceSeq;
  }

  bucket.events.push(next);
  bucket.events = bucket.events
    .filter((item) => nowMs() - item.createdAt <= SESSION_EVENT_TTL_MS)
    .sort((a, b) => a.sourceSeq - b.sourceSeq);

  while (bucket.events.length > SESSION_EVENT_MAX) {
    bucket.events.shift();
  }

  if (bucket.events.length > 0) {
    bucket.lastSourceSeq = Math.max(...bucket.events.map((item) => item.sourceSeq));
  }

  bucket.updatedAt = nowMs();
  sessionRings.set(k, bucket);

  sqlite.prepare('INSERT OR REPLACE INTO session_index (id, node_id, session_id, title, last_event_seq, updated_at, created_at) VALUES (?, ?, ?, COALESCE((SELECT title FROM session_index WHERE id = ?), ?), ?, ?, COALESCE((SELECT created_at FROM session_index WHERE id = ?), ?))')
    .run(
      k,
      nodeId,
      sessionId,
      k,
      `Session ${sessionId}`,
      bucket.lastSourceSeq,
      nowMs(),
      k,
      nowMs(),
    );

  if (event.event.type === 'session.title') {
    const title = typeof event.event.data?.title === 'string' ? event.event.data.title.trim() : '';
    if (title) {
      sqlite.prepare('UPDATE session_index SET title = ?, updated_at = ? WHERE id = ?')
        .run(title, nowMs(), k);
    }
  }
}

function getSessionReplay(nodeId: string, sessionId: string, afterSourceSeq: number) {
  const ring = sessionRings.get(keySession(nodeId, sessionId));
  if (!ring) {
    return null;
  }

  if (ring.events.length === 0) return [];

  const minSeq = ring.events[0].sourceSeq;
  const maxSeq = ring.events[ring.events.length - 1].sourceSeq;

  if (afterSourceSeq < minSeq - 1 || afterSourceSeq > maxSeq) {
    return null;
  }

  return ring.events.filter((evt) => evt.sourceSeq > afterSourceSeq);
}

function broadcastToSession(nodeId: string, sessionId: string, payload: unknown) {
  const key = keySession(nodeId, sessionId);
  const targets = sessionSubscribers.get(key);
  if (!targets) return;
  for (const ws of targets) {
    sendJson(ws, payload);
  }
}

function approvalRequestFrame(nodeId: string, sessionId: string, approval: any) {
  return {
    v: 1,
    kind: 'approval.request',
    nodeId,
    sessionId,
    approval: {
      approvalId: approval.approvalId,
      title: approval.title || 'Approval',
      summary: approval.summary || '',
      toolCallId: approval.toolCallId,
      nodeId,
      sessionId,
      ...(typeof approval.cwd === 'string' ? { cwd: approval.cwd } : {}),
      ...(typeof approval.risk === 'string' ? { risk: approval.risk } : {}),
      expiresAt: approval.expiresAt,
    },
  };
}

function cleanupOfflineNodes() {
  const now = nowMs();
  for (const [nodeId, state] of nodeConnections.entries()) {
    if (now - state.lastSeenAt > OFFLINE_MS) {
      state.ws.close(4001, 'NODE_OFFLINE');
      nodeConnections.delete(nodeId);
      sqlite.prepare('UPDATE nodes SET last_seen_at = ? WHERE id = ?').run(nowMs(), nodeId);
    }
  }
}

function cleanupStaleRates() {
  const now = nowMs();
  for (const [key, value] of rateBuckets.entries()) {
    if (now - value.windowStart > 60_000) {
      rateBuckets.delete(key);
    }
  }
  for (const [key, value] of uploadRateBuckets.entries()) {
    if (now - value.windowStart > 60_000) uploadRateBuckets.delete(key);
  }
}

function cleanupCommandMetadata() {
  const cutoff = nowMs() - COMMAND_RETENTION_MS;
  sqlite
    .prepare("DELETE FROM commands WHERE created_at < ? AND status NOT IN ('pending', 'sent')")
    .run(cutoff);
}

function getAuthUserFromRequest(authHeader: string | undefined): Promise<AuthContext | null> {
  const token = parseBearer(authHeader);
  if (!token) return Promise.resolve(null);
  return verifyAccessToken(token);
}

function checkUploadRate(userId: string, bytes: number) {
  const now = nowMs();
  const bucket = uploadRateBuckets.get(userId) ?? { count: 0, bytes: 0, windowStart: now };
  if (now - bucket.windowStart > 60_000) {
    bucket.count = 0;
    bucket.bytes = 0;
    bucket.windowStart = now;
  }
  bucket.count += 1;
  bucket.bytes += bytes;
  uploadRateBuckets.set(userId, bucket);
  if (bucket.count > 180 || bucket.bytes > 160 * 1024 * 1024) {
    throw new UploadSpoolError('RATE_LIMITED', 'Upload rate limit exceeded');
  }
}

function requireOwnedNode(userId: string, nodeId: string) {
  const node = ensureNodeMeta(nodeId);
  if (!node) throw { code: 'NODE_NOT_FOUND', message: 'Node not found' };
  if (node.owner_user_id !== userId) throw { code: 'FORBIDDEN', message: 'Node belongs to another user' };
  if (node.revoked_at) throw { code: 'NODE_REVOKED', message: 'Node was revoked' };
  return node;
}

function getUserByRefreshToken(refreshToken: string) {
  const tokenHash = hashText(refreshToken);
  const row = sqlite
    .prepare(
      `
    SELECT rt.id, rt.user_id, rt.device_id, rt.expires_at, rt.revoked_at, rt.token_hash, u.org_id
    FROM refresh_tokens rt
    JOIN users u ON u.id = rt.user_id
    WHERE rt.token_hash = ?
    `,
    )
    .get(tokenHash) as
    | { id: string; user_id: string; device_id: string; expires_at: number; revoked_at: number | null; org_id: string }
    | undefined;
  return row;
}

function requireBody(request: any, schema: any) {
  return schema.parse(request.body);
}

function sendError(
  reply: any,
  httpCode: number,
  errorCode: string,
  message: string,
  details?: Record<string, unknown>,
) {
  reply.code(httpCode).send({
    code: errorCode,
    message,
    details,
  });
}

const app = Fastify({
  logger: {
    level: 'info',
    redact: {
      paths: [
        'req.headers.authorization',
        'req.body.pairToken',
        'req.body.pollToken',
        'req.body.refreshToken',
        'req.body.nodeSecret',
        'req.body.nodeSecretHash',
      ],
      censor: '[REDACTED]',
    },
  },
  bodyLimit: HTTP_BODY_LIMIT,
});

await app.register(websocket, {
  options: {
    maxPayload: WS_PAYLOAD_LIMIT,
  },
});

app.addHook('onRequest', async (request, reply) => {
  if (request.method === 'PUT' && request.url.includes('/uploads/')) return;
  const key = request.ip || 'unknown';
  const now = nowMs();
  const bucket = rateBuckets.get(key) ?? { count: 0, windowStart: now };
  if (now - bucket.windowStart > 60_000) {
    bucket.count = 0;
    bucket.windowStart = now;
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (bucket.count > 120) {
    return sendError(reply, 429, 'RATE_LIMITED', 'Too many requests');
  }
});

app.addContentTypeParser(
  'application/octet-stream',
  { parseAs: 'buffer', bodyLimit: UPLOAD_CHUNK_BYTES },
  (_request, body, done) => done(null, body),
);

const httpError = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  INVALID_REQUEST: 400,
  PAIR_TOKEN_INVALID: 400,
  PAIR_TOKEN_EXPIRED: 410,
  PAIR_TOKEN_ALREADY_USED: 409,
  PAIRING_NOT_FOUND: 404,
  NODE_NOT_FOUND: 404,
  NODE_OFFLINE: 409,
  NODE_REVOKED: 403,
  SESSION_NOT_FOUND: 404,
  APPROVAL_NOT_FOUND: 404,
  APPROVAL_EXPIRED: 410,
  APPROVAL_ALREADY_RESOLVED: 409,
  CAPABILITY_UNAVAILABLE: 409,
  AGENT_PRESET_NOT_FOUND: 400,
  AGENT_PRESET_INVALID: 400,
  AGENT_PRESET_LOCKED: 409,
  MODEL_UNAVAILABLE: 409,
  COMMAND_TIMEOUT: 408,
  COMMAND_DUPLICATE: 200,
  COMMAND_EXPIRED: 408,
  PROTOCOL_UNSUPPORTED: 400,
  INTERNAL_ERROR: 500,
  RATE_LIMITED: 429,
  UPLOAD_NOT_FOUND: 404,
  ATTACHMENT_NOT_FOUND: 404,
  UPLOAD_EXPIRED: 410,
  UPLOAD_OFFSET_MISMATCH: 409,
  UPLOAD_COMPLETE: 409,
  UPLOAD_INCOMPLETE: 409,
  UPLOAD_INVALID: 409,
  UPLOAD_TOO_LARGE: 413,
  UPLOAD_LIMIT_EXCEEDED: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
};

const pairingBody = z.object({
  nodeName: z.string().min(1),
  platform: z.string().min(1),
  arch: z.string().min(1),
  pluginVersion: z.string().min(1),
  dshVersion: z.string().min(1),
  installId: z.string().min(1),
  nodeSecretHash: z.string().length(64),
});

const requestIdSchema = z.string().refine(isUuidv7, { message: 'requestId must be UUIDv7' });

const claimBody = z.object({
  pairToken: z.string().min(1),
  ownerDisplayName: z.string().min(1).optional(),
  deviceName: z.string().min(1).optional(),
});

const refreshBody = z.object({
  refreshToken: z.string().min(1),
});

const createSessionBody = z.object({
  requestId: requestIdSchema,
  agentPreset: z.string().min(1).max(256).optional(),
});

const modelSelectionBody = z.object({
  requestId: requestIdSchema,
  provider: z.string().min(1).max(256),
  model: z.string().min(1).max(512),
  reasoningEffort: z.string().min(1).max(128).optional(),
});

const renameSessionBody = z.object({
  requestId: requestIdSchema,
  title: z.string().max(200).refine((title) => title.trim().length > 0, {
    message: 'title must not be empty',
  }),
});

const workspaceReferencesQuery = z.object({
  q: z.string().max(2048).default(''),
});

const createUploadBody = z.object({
  kind: z.enum(['image', 'file']),
  displayName: z.string().min(1).max(1024),
  mediaType: z.string().min(1).max(256),
  byteSize: z.number().int().positive(),
});

const uploadIdBody = z.object({
  uploadId: z.string().uuid(),
});

const followupBody = z.object({
  requestId: requestIdSchema,
  content: z.string().max(131_072).default(''),
  references: z.array(z.object({
    path: z.string().min(1).max(4096),
    kind: z.enum(['file', 'dir']),
  })).max(50).optional(),
  uploads: z.array(uploadIdBody).max(10).optional(),
}).refine((value) => Boolean(value.content.trim() || value.references?.length || value.uploads?.length), {
  message: 'Follow-up requires text, a reference, or an upload',
});

const steerBody = z.object({
  requestId: requestIdSchema,
  instruction: z.string().min(1).max(131_072),
});

const stopBody = z.object({
  requestId: requestIdSchema,
  reason: z.string().min(1).max(4096).optional(),
});

const approvalRespondBody = z.object({
  requestId: requestIdSchema,
  response: z.enum(['allow_once', 'deny']),
});

const wsSubscribeBody = z.object({
  v: z.literal(1),
  kind: z.literal('subscribe'),
  requestId: requestIdSchema,
  nodeId: z.string().min(1),
  sessionId: z.string().min(1),
});

const wsSessionSyncBody = z.object({
  v: z.literal(1),
  kind: z.literal('session.sync'),
  requestId: requestIdSchema,
  nodeId: z.string().min(1),
  sessionId: z.string().min(1),
  afterSourceSeq: z.number().int().min(-1),
});

app.get('/healthz', async () => ({
  ok: true,
  server: 'dsh-hub',
  version: 'v1',
}));

app.get('/readyz', async () => {
  const row = sqlite.prepare('SELECT 1 as ok').get() as { ok: number };
  if (!row?.ok) {
    throw new Error('DB not ready');
  }
  return { ok: true };
});

app.get('/v1/meta', async () => ({
  hubId: HUB_ID,
  version: HUB_VERSION,
  publicOrigin: currentPublicOrigin(),
}));

app.post('/v1/node-pairings', async (request, reply) => {
  const body = requireBody(request, pairingBody);
  const id = uuidv7();
  const pairToken = randomHex(32);
  const pollToken = randomHex(32);
  const now = nowMs();
  const expiresAt = now + 5 * 60_000;

  sqlite
    .prepare("UPDATE node_pairings SET expires_at = ? WHERE install_id = ? AND status = 'pending' AND expires_at > ?")
    .run(now, body.installId, now);

  sqlite
    .prepare(
      `INSERT INTO node_pairings (
      id, pair_token_hash, poll_token_hash, install_id, node_name, platform, arch, plugin_version,
      dsh_version, node_secret_hash, status, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .run(
      id,
      hashText(pairToken),
      hashText(pollToken),
      body.installId,
      body.nodeName,
      body.platform,
      body.arch,
      body.pluginVersion,
      body.dshVersion,
      body.nodeSecretHash,
      now,
      expiresAt,
    );

  writeAudit('pairing_created', null, null, null, { pairingId: id, nodeName: body.nodeName, platform: body.platform });

  reply.code(200).send({
    pairingId: id,
    pairToken,
    pollToken,
    expiresAt,
    qrPayload: pairingQrPayload(pairToken),
  });
});

app.post('/v1/node-pairings/recover', async (request, reply) => {
  const node = getNodeFromAuthorization(request.headers.authorization);
  if (!node) {
    return sendError(reply, httpError.UNAUTHORIZED, 'UNAUTHORIZED', 'Valid Node authorization required');
  }

  const id = uuidv7();
  const pairToken = randomHex(32);
  const pollToken = randomHex(32);
  const now = nowMs();
  const expiresAt = now + 5 * 60_000;

  sqlite
    .prepare("UPDATE node_pairings SET expires_at = ? WHERE node_id = ? AND status = 'pending' AND expires_at > ?")
    .run(now, node.id, now);

  sqlite
    .prepare(
      `INSERT INTO node_pairings (
      id, pair_token_hash, poll_token_hash, install_id, node_name, platform, arch, plugin_version,
      dsh_version, node_secret_hash, status, created_at, expires_at, claimed_user_id, node_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    )
    .run(
      id,
      hashText(pairToken),
      hashText(pollToken),
      node.install_id,
      node.name,
      node.platform,
      node.arch,
      node.plugin_version,
      node.dsh_version,
      node.credential_hash,
      now,
      expiresAt,
      node.owner_user_id,
      node.id,
    );

  writeAudit('mobile_recovery_created', node.owner_user_id, node.id, null, { pairingId: id });
  reply.send({
    pairingId: id,
    pairToken,
    pollToken,
    expiresAt,
    qrPayload: pairingQrPayload(pairToken),
  });
});

app.get('/v1/node-pairings/:pairingId', async (request, reply) => {
  const pairingId = (request.params as { pairingId: string }).pairingId;
  const pollToken = parsePairToken(request.headers.authorization);
  if (!pollToken) {
    return sendError(reply, httpError.UNAUTHORIZED, 'UNAUTHORIZED', 'Missing Pair authorization');
  }

  const pollHash = hashText(pollToken);
  const row = sqlite
    .prepare('SELECT * FROM node_pairings WHERE id = ? AND poll_token_hash = ?')
    .get(pairingId, pollHash) as any;

  if (!row) {
    return sendError(reply, httpError.PAIRING_NOT_FOUND, 'PAIRING_NOT_FOUND', 'Pairing not found');
  }

  if (row.status === 'claimed') {
    const owner = sqlite
      .prepare('SELECT display_name FROM users WHERE id = ?')
      .get(row.claimed_user_id) as
      | { display_name: string }
      | undefined;

    reply.send({
      status: 'claimed',
      nodeId: row.node_id,
      ownerDisplayName: owner?.display_name ?? 'Owner',
    });
    return;
  }

  if (row.status === 'pending') {
    if (row.expires_at <= nowMs()) {
      reply.send({
        status: 'expired',
      });
      return;
    }

    reply.send({
      status: 'pending',
    });
    return;
  }

  return sendError(
    reply,
    httpError.INVALID_REQUEST,
    'INVALID_REQUEST',
    'Unsupported pairing status',
  );
});

app.post('/v1/node-pairings/claim', async (request, reply) => {
  const body = requireBody(request, claimBody);
  const authUser = await getAuthUserFromRequest(request.headers.authorization);
  const currentUserCount = countUsers();

  const row = sqlite
    .prepare('SELECT * FROM node_pairings WHERE pair_token_hash = ?')
    .get(hashText(body.pairToken)) as any;

  if (!row) {
    return sendError(reply, httpError.PAIRING_NOT_FOUND, 'PAIRING_NOT_FOUND', 'Pair token not found');
  }

  if (row.status !== 'pending') {
    return sendError(
      reply,
      httpError.PAIR_TOKEN_ALREADY_USED,
      'PAIR_TOKEN_ALREADY_USED',
      'Pair token already used'
    );
  }

  if (row.expires_at <= nowMs()) {
    return sendError(
      reply,
      httpError.PAIR_TOKEN_EXPIRED,
      'PAIR_TOKEN_EXPIRED',
      'Pair token expired'
    );
  }

  const isRecovery = Boolean(row.claimed_user_id && row.node_id);
  if (!authUser && currentUserCount > 0 && !isRecovery) {
    return sendError(reply, httpError.UNAUTHORIZED, 'UNAUTHORIZED', 'Bearer required');
  }

  let userId: string;
  let orgId: string;

  if (isRecovery) {
    const user = getUser(row.claimed_user_id);
    const node = ensureNodeMeta(row.node_id);
    if (!user || !node || node.revoked_at || node.owner_user_id !== row.claimed_user_id) {
      return sendError(reply, httpError.FORBIDDEN, 'FORBIDDEN', 'Recovery pairing is no longer valid');
    }
    userId = user.id;
    orgId = user.org_id;
  } else if (authUser) {
    const user = getUser(authUser.userId);
    if (!user) {
      return sendError(reply, httpError.UNAUTHORIZED, 'UNAUTHORIZED', 'Invalid bearer user');
    }
    userId = authUser.userId;
    orgId = user.org_id;
  } else {
    const ownerDisplayName = body.ownerDisplayName || 'Owner';
    const created = createDefaultOrgAndUser(ownerDisplayName);
    userId = created.userId;
    orgId = created.orgId;
  }

  const deviceId = createDevice(userId, 'mobile', body.deviceName || 'Mobile Device');
  const tokenInfo = createRefreshToken(userId, deviceId);
  const accessToken = await issueAccessToken(userId, orgId, deviceId);

  if (isRecovery) {
    sqlite
      .prepare('UPDATE node_pairings SET status = ?, claimed_at = ? WHERE id = ?')
      .run('claimed', nowMs(), row.id);
    writeAudit('mobile_recovery_claimed', userId, row.node_id, deviceId, { pairingId: row.id });
    reply.send({
      accessToken,
      refreshToken: tokenInfo.token,
      refreshExpiresAt: tokenInfo.expiresAt,
      expiresIn: ACCESS_TTL_SECONDS,
      nodeId: row.node_id,
      tokenType: 'Bearer',
    });
    return;
  }

  const nodeId = uuidv7();

  sqlite
    .prepare(
      `INSERT INTO nodes (
        id, org_id, owner_user_id, install_id, name, platform, arch, plugin_version,
        dsh_version, credential_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      nodeId,
      orgId,
      userId,
      row.install_id,
      row.node_name,
      row.platform,
      row.arch,
      row.plugin_version,
      row.dsh_version,
      row.node_secret_hash,
      nowMs(),
    );

  sqlite
    .prepare('UPDATE node_pairings SET status = ?, claimed_user_id = ?, claimed_at = ?, node_id = ? WHERE id = ?')
    .run('claimed', userId, nowMs(), nodeId, row.id);

  sqlite
    .prepare('INSERT INTO audit_logs (id, event, actor_user_id, node_id, device_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(
      uuidv7(),
      'pairing_claimed',
      userId,
      nodeId,
      deviceId,
      JSON.stringify({ pairingId: row.id }),
      nowMs(),
    );

  writeAudit('pairing_claimed', userId, nodeId, deviceId, { pairingId: row.id });

  reply.send({
    accessToken,
    refreshToken: tokenInfo.token,
    refreshExpiresAt: tokenInfo.expiresAt,
    expiresIn: ACCESS_TTL_SECONDS,
    nodeId,
    tokenType: 'Bearer',
  });
});

app.post('/v1/auth/refresh', async (request, reply) => {
  const body = requireBody(request, refreshBody);
  const row = getUserByRefreshToken(body.refreshToken);
  if (!row) {
    return sendError(reply, httpError.UNAUTHORIZED, 'UNAUTHORIZED', 'Invalid refresh token');
  }

  if (row.revoked_at) {
    return sendError(reply, httpError.UNAUTHORIZED, 'UNAUTHORIZED', 'Refresh token revoked');
  }

  if (row.expires_at <= nowMs()) {
    return sendError(reply, httpError.UNAUTHORIZED, 'UNAUTHORIZED', 'Refresh token expired');
  }

  sqlite
    .prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?')
    .run(nowMs(), row.id);

  const newToken = createRefreshToken(row.user_id, row.device_id);
  const accessToken = await issueAccessToken(row.user_id, row.org_id, row.device_id);

  writeAudit('token_refreshed', row.user_id, null, row.device_id, { refreshId: row.id });

  reply.send({
    accessToken,
    refreshToken: newToken.token,
    refreshExpiresAt: newToken.expiresAt,
    expiresIn: ACCESS_TTL_SECONDS,
    tokenType: 'Bearer',
  });
});

app.post('/v1/auth/logout', async (request, reply) => {
  const body = requireBody(request, refreshBody);
  const tokenHash = hashText(body.refreshToken);
  const row = sqlite.prepare('SELECT id, user_id, device_id FROM refresh_tokens WHERE token_hash = ?').get(tokenHash) as
    | { id: string; user_id: string; device_id: string }
    | undefined;
  if (!row) {
    return sendError(reply, httpError.UNAUTHORIZED, 'UNAUTHORIZED', 'Invalid refresh token');
  }

  sqlite.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?').run(nowMs(), row.id);
  writeAudit('refresh_revoked', row.user_id, null, row.device_id, { refreshId: row.id });
  reply.send({ ok: true });
});

app.get('/v1/me', async (request, reply) => {
  const authUser = await getAuthUserFromRequest(request.headers.authorization);
  if (!authUser) {
    return sendError(reply, httpError.UNAUTHORIZED, 'UNAUTHORIZED', 'Missing access token');
  }

  const user = getUser(authUser.userId);
  if (!user) {
    return sendError(reply, httpError.UNAUTHORIZED, 'UNAUTHORIZED', 'Unknown user');
  }

  reply.send({
    user: {
      id: user.id,
      displayName: user.display_name,
      orgId: user.org_id,
    },
  });
});

app.get('/v1/nodes', async (request, reply) => {
  const authUser = await getAuthUserFromRequest(request.headers.authorization);
  if (!authUser) {
    return sendError(reply, httpError.UNAUTHORIZED, 'UNAUTHORIZED', 'Missing access token');
  }

  const rows = sqlite
    .prepare('SELECT * FROM nodes WHERE owner_user_id = ? ORDER BY created_at DESC')
    .all(authUser.userId) as any[];

  const items = rows.map(publicNode);

  reply.send({ items, count: items.length });
});

app.get('/v1/nodes/:nodeId', async (request, reply) => {
  const nodeId = (request.params as { nodeId: string }).nodeId;
  const authUser = await getAuthUserFromRequest(request.headers.authorization);
  if (!authUser) {
    return sendError(reply, httpError.UNAUTHORIZED, 'UNAUTHORIZED', 'Missing access token');
  }

  const node = ensureNodeMeta(nodeId);
  if (!node) {
    return sendError(reply, httpError.NODE_NOT_FOUND, 'NODE_NOT_FOUND', 'Node not found');
  }

  if (node.owner_user_id !== authUser.userId) {
    return sendError(reply, httpError.FORBIDDEN, 'FORBIDDEN', 'Node belongs to another user');
  }

  reply.send(publicNode(node));
});

app.post('/v1/nodes/:nodeId/revoke', async (request, reply) => {
  const nodeId = (request.params as { nodeId: string }).nodeId;
  const authUser = await getAuthUserFromRequest(request.headers.authorization);
  if (!authUser) {
    return sendError(reply, httpError.UNAUTHORIZED, 'UNAUTHORIZED', 'Missing access token');
  }

  const node = ensureNodeMeta(nodeId);
  if (!node) {
    return sendError(reply, httpError.NODE_NOT_FOUND, 'NODE_NOT_FOUND', 'Node not found');
  }

  if (node.owner_user_id !== authUser.userId) {
    return sendError(reply, httpError.FORBIDDEN, 'FORBIDDEN', 'Node belongs to another user');
  }

  sqlite.prepare('UPDATE nodes SET revoked_at = ? WHERE id = ?').run(nowMs(), nodeId);
  const conn = nodeConnections.get(nodeId);
  if (conn) {
    conn.ws.close(4403, 'revoked');
    nodeConnections.delete(nodeId);
  }

  writeAudit('node_revoked', authUser.userId, nodeId, authUser.deviceId, {});
  reply.send({ ok: true, nodeId });
});

app.get('/v1/nodes/:nodeId/sessions', async (request, reply) => {
  const nodeId = (request.params as { nodeId: string }).nodeId;
  const authUser = await getAuthUserFromRequest(request.headers.authorization);
  if (!authUser) {
    return sendError(reply, httpError.UNAUTHORIZED, 'UNAUTHORIZED', 'Missing access token');
  }

  if (nodeOwnerId(nodeId) !== authUser.userId) {
    return sendError(reply, httpError.FORBIDDEN, 'FORBIDDEN', 'Node belongs to another user');
  }

  try {
    const dispatched = await dispatchCommand(
      authUser,
      nodeId,
      null,
      'session.list',
      uuidv7(),
      {},
      true,
    );

    const resultFrame = await dispatched.resultPromise;
    if (!resultFrame || !resultFrame.ok) {
      throw {
        code: resultFrame?.error?.code || 'INTERNAL_ERROR',
        message: resultFrame?.error?.message || 'Session list command failed',
      };
    }

    const result = resultFrame.result as { sessions?: unknown } | undefined;
    const remoteSessions = Array.isArray(result?.sessions) ? result.sessions : [];
    const upsert = sqlite.prepare(`
        INSERT INTO session_index (
          id, node_id, session_id, title, last_event_seq, updated_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(node_id, session_id) DO UPDATE SET
          title = excluded.title,
          last_event_seq = CASE
            WHEN excluded.last_event_seq > session_index.last_event_seq THEN excluded.last_event_seq
            ELSE session_index.last_event_seq
          END,
          updated_at = excluded.updated_at
      `);

    const indexedAt = nowMs();
    const sessions: Array<ReturnType<typeof publicSession> & { status: string; workspaceLabel?: string }> = [];
    for (const item of remoteSessions) {
      if (!item || typeof item !== 'object') continue;
      const session = item as Record<string, unknown>;
      const sessionId = typeof session.id === 'string'
        ? session.id
        : typeof session.sessionId === 'string'
          ? session.sessionId
          : null;
      if (!sessionId) continue;

      const title = typeof session.title === 'string' && session.title.trim()
        ? session.title
        : `Session ${sessionId}`;
      const lastEventSeq = typeof session.lastSourceSeq === 'number'
        ? session.lastSourceSeq
        : typeof session.lastEventSeq === 'number'
          ? session.lastEventSeq
          : -1;
      const updatedAt = typeof session.updatedAt === 'number' ? session.updatedAt : indexedAt;
      const createdAt = typeof session.createdAt === 'number' ? session.createdAt : indexedAt;
      const status = session.status === 'running' || session.status === 'idle' ? session.status : 'unknown';
      const workspaceLabel = typeof session.cwdLabel === 'string'
        ? session.cwdLabel
        : typeof session.workspaceLabel === 'string'
          ? session.workspaceLabel
          : undefined;
      const agentPreset = typeof session.agentPreset === 'string' && session.agentPreset
        ? session.agentPreset
        : undefined;

      upsert.run(
        keySession(nodeId, sessionId),
        nodeId,
        sessionId,
        title,
        lastEventSeq,
        updatedAt,
        createdAt,
      );
      sessions.push({
        sessionId,
        title,
        status,
        lastEventSeq,
        updatedAt,
        createdAt,
        ...(workspaceLabel ? { workspaceLabel } : {}),
        ...(agentPreset ? { agentPreset } : {}),
      });
    }

    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    reply.send({ sessions, count: sessions.length });
  } catch (err: any) {
    const statusCode = httpError[err?.code as keyof typeof httpError] ?? 500;
    return sendError(reply, statusCode, err?.code || 'INTERNAL_ERROR', err?.message || 'Failed to list sessions');
  }
});

async function dispatchCommand(
  authUser: AuthContext,
  nodeId: string,
  sessionId: string | null,
  action: string,
  requestId: string,
  payload: Record<string, unknown>,
  expectResult = false,
) {
  const existing = sqlite
    .prepare('SELECT * FROM commands WHERE request_id = ? AND user_id = ?')
    .get(requestId, authUser.userId) as any | undefined;

  if (existing) {
    const persistedResult = typeof existing.result_json === 'string'
      ? JSON.parse(existing.result_json) as CommandResultFrame
      : undefined;
    const inFlightResult = pendingCommandResults.get(existing.id)?.promise;
    return {
      commandId: existing.id,
      status: existing.status,
      requestId,
      duplicates: true,
      resultPromise: expectResult
        ? persistedResult
          ? Promise.resolve(persistedResult)
          : inFlightResult
        : undefined,
    };
  }

  const node = ensureNodeMeta(nodeId);
  if (!node) {
    throw { code: 'NODE_NOT_FOUND' };
  }

  if (node.owner_user_id !== authUser.userId) {
    throw { code: 'FORBIDDEN' };
  }

  if (node.revoked_at) {
    throw { code: 'NODE_REVOKED' };
  }

  const conn = nodeConnections.get(nodeId);
  if (!conn) {
    throw { code: 'NODE_OFFLINE' };
  }

  if (!conn.capabilities.has(action)) {
    throw { code: 'CAPABILITY_UNAVAILABLE' };
  }

  const commandId = uuidv7();
  const now = nowMs();
  const expiresAt = now + COMMAND_TTL_MS;

  sqlite
    .prepare(
      `INSERT INTO commands (id, request_id, user_id, device_id, node_id, session_id, action, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .run(commandId, requestId, authUser.userId, authUser.deviceId, nodeId, sessionId, action, now, expiresAt);

  const commandFrame = {
    v: 1,
    kind: 'command',
    commandId,
    requestId,
    nodeId,
    sessionId,
    action,
    payload,
    issuedAt: now,
    expiresAt,
  };

  let resultPromise: Promise<CommandResultFrame> | undefined;
  if (expectResult) {
    let resolveResult!: (frame: CommandResultFrame) => void;
    let rejectResult!: (error: { code: string; message: string }) => void;
    resultPromise = new Promise<CommandResultFrame>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const timeout = setTimeout(() => {
      pendingCommandResults.delete(commandId);
      sqlite
        .prepare('UPDATE commands SET status = ?, error_code = ? WHERE id = ?')
        .run('failed', 'COMMAND_TIMEOUT', commandId);
      rejectResult({ code: 'COMMAND_TIMEOUT', message: 'Command result timed out' });
    }, COMMAND_TTL_MS);

    pendingCommandResults.set(commandId, {
      resolve: resolveResult,
      reject: rejectResult,
      timeout,
      promise: resultPromise,
    });
  }

  sendJson(conn.ws, commandFrame);
  sqlite
    .prepare('UPDATE commands SET status = ? WHERE id = ?')
    .run('sent', commandId);

  const t = setTimeout(() => {
    const c = sqlite.prepare('SELECT status FROM commands WHERE id = ?').get(commandId) as { status: string } | undefined;
    if (c && c.status !== 'acked') {
      sqlite
        .prepare('UPDATE commands SET status = ?, error_code = ? WHERE id = ?')
        .run('failed', 'COMMAND_TIMEOUT', commandId);
    }
    pendingCommandTimeout.delete(commandId);
  }, COMMAND_TTL_MS);

  pendingCommandTimeout.set(commandId, t);

  return {
    commandId,
    status: 'sent',
    requestId,
    duplicates: false,
    resultPromise,
  };
}

app.get('/v1/nodes/:nodeId/agent-presets', async (request, reply) => {
  const nodeId = (request.params as { nodeId: string }).nodeId;
  const authUser = await getAuthUserFromRequest(request.headers.authorization);
  if (!authUser) {
    return sendError(reply, httpError.UNAUTHORIZED, 'UNAUTHORIZED', 'Missing access token');
  }
  if (nodeOwnerId(nodeId) !== authUser.userId) {
    return sendError(reply, httpError.FORBIDDEN, 'FORBIDDEN', 'Node belongs to another user');
  }

  try {
    const dispatched = await dispatchCommand(
      authUser,
      nodeId,
      null,
      'agentPreset.list',
      uuidv7(),
      {},
      true,
    );
    const resultFrame = await dispatched.resultPromise;
    if (!resultFrame?.ok) {
      throw {
        code: resultFrame?.error?.code || 'INTERNAL_ERROR',
        message: resultFrame?.error?.message || 'Agent preset command failed',
      };
    }
    const result = resultFrame.result as { presets?: unknown } | undefined;
    const presets = Array.isArray(result?.presets)
      ? result.presets.flatMap((value) => {
          if (!value || typeof value !== 'object') return [];
          const preset = value as Record<string, unknown>;
          if (typeof preset.id !== 'string' || !preset.id) return [];
          const trust = preset.trust === 'user' ? 'user' : 'system';
          return [{
            id: preset.id,
            trust,
            isDefault: preset.isDefault === true,
            ...(typeof preset.name === 'string' ? { name: preset.name } : {}),
            ...(typeof preset.description === 'string' ? { description: preset.description } : {}),
            ...(typeof preset.broken === 'string' ? { broken: preset.broken } : {}),
          }];
        })
      : [];
    reply.send({ presets });
  } catch (err: any) {
    const statusCode = httpError[err.code as keyof typeof httpError] ?? 500;
    return sendError(reply, statusCode, err.code || 'INTERNAL_ERROR', err.message || 'Command failed');
  }
});

app.post('/v1/nodes/:nodeId/sessions', async (request, reply) => {
  const nodeId = (request.params as { nodeId: string }).nodeId;
  const authUser = await getAuthUserFromRequest(request.headers.authorization);
  if (!authUser) {
    return sendError(reply, httpError.UNAUTHORIZED, 'UNAUTHORIZED', 'Missing access token');
  }

  const body = requireBody(request, createSessionBody);
  const requestId = body.requestId;

  try {
    const dispatched = await dispatchCommand(authUser, nodeId, null, 'session.create', requestId, {
      createdBy: 'mobile',
      ...(body.agentPreset ? { agentPreset: body.agentPreset } : {}),
    }, true);
    const resultFrame = await dispatched.resultPromise;
    if (!resultFrame?.ok) {
      throw {
        code: resultFrame?.error?.code || 'INTERNAL_ERROR',
        message: resultFrame?.error?.message || 'Session create command failed',
      };
    }
    const remoteSession = (resultFrame.result as { session?: Record<string, unknown> } | undefined)?.session;
    const sessionId = typeof remoteSession?.id === 'string'
      ? remoteSession.id
      : typeof remoteSession?.sessionId === 'string'
        ? remoteSession.sessionId
        : null;
    if (!sessionId) {
      throw { code: 'INTERNAL_ERROR', message: 'Node did not return a session id' };
    }
    const title = typeof remoteSession?.title === 'string' && remoteSession.title.trim()
      ? remoteSession.title
      : 'New Session';
    const lastEventSeq = typeof remoteSession?.lastSourceSeq === 'number'
      ? remoteSession.lastSourceSeq
      : typeof remoteSession?.lastEventSeq === 'number'
        ? remoteSession.lastEventSeq
        : -1;
    const updatedAt = typeof remoteSession?.updatedAt === 'number' ? remoteSession.updatedAt : nowMs();
    const createdAt = typeof remoteSession?.createdAt === 'number' ? remoteSession.createdAt : updatedAt;
    const agentPreset = typeof remoteSession?.agentPreset === 'string' && remoteSession.agentPreset
      ? remoteSession.agentPreset
      : body.agentPreset;
    sqlite.prepare(
      'INSERT OR IGNORE INTO session_index (id, node_id, session_id, title, last_event_seq, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      `${nodeId}:${sessionId}`,
      nodeId,
      sessionId,
      title,
      lastEventSeq,
      updatedAt,
      createdAt,
    );
    sqlite
      .prepare('UPDATE nodes SET last_seen_at = ? WHERE id = ?')
      .run(nowMs(), nodeId);

    reply.code(202).send({
      commandId: dispatched.commandId,
      sessionId,
      requestId: dispatched.requestId,
      ...(agentPreset ? { agentPreset } : {}),
    });
  } catch (err: any) {
    const statusCode = httpError[err.code as keyof typeof httpError] ?? 500;
    return sendError(reply, statusCode, err.code || 'INTERNAL_ERROR', err.message || 'Command failed');
  }
});

app.get('/v1/nodes/:nodeId/sessions/:sessionId/snapshot', async (request, reply) => {
  const params = request.params as { nodeId: string; sessionId: string };
  const authUser = await getAuthUserFromRequest(request.headers.authorization);
  if (!authUser) {
    return sendError(reply, httpError.UNAUTHORIZED, 'UNAUTHORIZED', 'Missing access token');
  }

  const node = ensureNodeMeta(params.nodeId);
  if (!node || node.owner_user_id !== authUser.userId) {
    return sendError(reply, httpError.FORBIDDEN, 'FORBIDDEN', 'Node belongs to another user');
  }

  const conn = nodeConnections.get(params.nodeId);
  if (conn && conn.capabilities.has('session.snapshot')) {
    try {
      const dispatched = await dispatchCommand(
        authUser,
        params.nodeId,
        params.sessionId,
        'session.snapshot',
        uuidv7(),
        {},
        true,
      );

      const resultFrame = await dispatched.resultPromise;
      if (resultFrame && resultFrame.ok) {
        const result = resultFrame.result as { session?: unknown; events?: unknown } | undefined;
        return reply.send({
          source: 'node',
          session: result?.session ?? {
            nodeId: params.nodeId,
            sessionId: params.sessionId,
          },
          events: result?.events ?? [],
        });
      }
    } catch {
      // Fall through to ring-buffer fallback.
    }
  }

  const row = sqlite
    .prepare('SELECT * FROM session_index WHERE node_id = ? AND session_id = ?')
    .get(params.nodeId, params.sessionId) as any | undefined;

  if (!row) {
    return sendError(reply, httpError.SESSION_NOT_FOUND, 'SESSION_NOT_FOUND', 'Session not found');
  }

  const replay = getSessionReplay(params.nodeId, params.sessionId, -1) || [];
  reply.send({
    source: 'ring-buffer',
    session: {
      nodeId: params.nodeId,
      sessionId: params.sessionId,
      title: row.title,
      lastEventSeq: row.last_event_seq,
    },
    events: replay,
  });
});

app.get('/v1/nodes/:nodeId/sessions/:sessionId/models', async (request, reply) => {
  const params = request.params as { nodeId: string; sessionId: string };
  const authUser = await getAuthUserFromRequest(request.headers.authorization);
  if (!authUser) {
    return sendError(reply, httpError.UNAUTHORIZED, 'UNAUTHORIZED', 'Missing access token');
  }
  if (nodeOwnerId(params.nodeId) !== authUser.userId) {
    return sendError(reply, httpError.FORBIDDEN, 'FORBIDDEN', 'Node belongs to another user');
  }

  try {
    const dispatched = await dispatchCommand(
      authUser,
      params.nodeId,
      params.sessionId,
      'session.models',
      uuidv7(),
      {},
      true,
    );
    const resultFrame = await dispatched.resultPromise;
    if (!resultFrame?.ok) {
      throw {
        code: resultFrame?.error?.code || 'INTERNAL_ERROR',
        message: resultFrame?.error?.message || 'Session model command failed',
      };
    }
    reply.send(normalizeSessionModels(resultFrame.result));
  } catch (err: any) {
    const statusCode = httpError[err.code as keyof typeof httpError] ?? 500;
    return sendError(reply, statusCode, err.code || 'INTERNAL_ERROR', err.message || 'Command failed');
  }
});

app.post('/v1/nodes/:nodeId/sessions/:sessionId/model-selection', async (request, reply) => {
  const params = request.params as { nodeId: string; sessionId: string };
  const body = requireBody(request, modelSelectionBody);
  const authUser = await getAuthUserFromRequest(request.headers.authorization);
  if (!authUser) {
    return sendError(reply, httpError.UNAUTHORIZED, 'UNAUTHORIZED', 'Missing access token');
  }

  try {
    const dispatched = await dispatchCommand(
      authUser,
      params.nodeId,
      params.sessionId,
      'session.selectModel',
      body.requestId,
      {
        provider: body.provider,
        model: body.model,
        ...(body.reasoningEffort ? { reasoningEffort: body.reasoningEffort } : {}),
      },
      true,
    );
    const resultFrame = await dispatched.resultPromise;
    if (!resultFrame?.ok) {
      throw {
        code: resultFrame?.error?.code || 'INTERNAL_ERROR',
        message: resultFrame?.error?.message || 'Model selection command failed',
      };
    }
    const result = objectValue(resultFrame.result);
    const selected = normalizeModelSelection(result?.selected);
    if (!selected) throw { code: 'INTERNAL_ERROR', message: 'Node returned an invalid model selection' };
    reply.send({ selected });
  } catch (err: any) {
    const statusCode = httpError[err.code as keyof typeof httpError] ?? 500;
    return sendError(reply, statusCode, err.code || 'INTERNAL_ERROR', err.message || 'Command failed');
  }
});

app.patch('/v1/nodes/:nodeId/sessions/:sessionId', async (request, reply) => {
  const params = request.params as { nodeId: string; sessionId: string };
  const body = requireBody(request, renameSessionBody);
  const authUser = await getAuthUserFromRequest(request.headers.authorization);
  if (!authUser) {
    return sendError(reply, httpError.UNAUTHORIZED, 'UNAUTHORIZED', 'Missing access token');
  }

  try {
    const dispatched = await dispatchCommand(
      authUser,
      params.nodeId,
      params.sessionId,
      'session.rename',
      body.requestId,
      { title: body.title },
      true,
    );
    const resultFrame = await dispatched.resultPromise;
    if (!resultFrame?.ok) {
      throw {
        code: resultFrame?.error?.code || 'INTERNAL_ERROR',
        message: resultFrame?.error?.message || 'Session rename command failed',
      };
    }
    const result = objectValue(resultFrame.result);
    const title = typeof result?.title === 'string' ? result.title.trim() : '';
    const seq = typeof result?.seq === 'number' ? result.seq : undefined;
    if (!title) throw { code: 'INTERNAL_ERROR', message: 'Node returned an invalid session title' };
    sqlite.prepare('UPDATE session_index SET title = ?, updated_at = ? WHERE node_id = ? AND session_id = ?')
      .run(title, nowMs(), params.nodeId, params.sessionId);
    reply.send({ title, ...(seq === undefined ? {} : { seq }) });
  } catch (err: any) {
    const statusCode = httpError[err.code as keyof typeof httpError] ?? 500;
    return sendError(reply, statusCode, err.code || 'INTERNAL_ERROR', err.message || 'Command failed');
  }
});

app.get('/v1/nodes/:nodeId/sessions/:sessionId/workspace-references', async (request, reply) => {
  const params = request.params as { nodeId: string; sessionId: string };
  const query = workspaceReferencesQuery.parse(request.query);
  const authUser = await getAuthUserFromRequest(request.headers.authorization);
  if (!authUser) return sendError(reply, 401, 'UNAUTHORIZED', 'Missing access token');

  try {
    const dispatched = await dispatchCommand(
      authUser,
      params.nodeId,
      params.sessionId,
      'workspace.references',
      uuidv7(),
      { query: query.q },
      true,
    );
    const frame = await dispatched.resultPromise;
    if (!frame?.ok) throw frame?.error || { code: 'INTERNAL_ERROR', message: 'Workspace search failed' };
    const result = objectValue(frame.result);
    const references = Array.isArray(result?.references) ? result.references.flatMap((value) => {
      const item = objectValue(value);
      if (!item || typeof item.path !== 'string') return [];
      return [{
        path: item.path,
        kind: item.kind === 'dir' ? 'dir' : 'file',
        ...(typeof item.name === 'string' ? { name: item.name } : {}),
      }];
    }).slice(0, 100) : [];
    reply.send({ references });
  } catch (err: any) {
    const statusCode = httpError[err?.code as keyof typeof httpError] ?? 500;
    return sendError(reply, statusCode, err?.code || 'INTERNAL_ERROR', err?.message || 'Workspace search failed');
  }
});

app.post('/v1/nodes/:nodeId/sessions/:sessionId/uploads', async (request, reply) => {
  const params = request.params as { nodeId: string; sessionId: string };
  const body = requireBody(request, createUploadBody);
  const authUser = await getAuthUserFromRequest(request.headers.authorization);
  if (!authUser) return sendError(reply, 401, 'UNAUTHORIZED', 'Missing access token');

  try {
    requireOwnedNode(authUser.userId, params.nodeId);
    const connection = nodeConnections.get(params.nodeId);
    const capability = body.kind === 'image' ? 'session.prompt.parts' : 'workspace.upload';
    if (!connection?.capabilities.has(capability)) {
      throw { code: 'CAPABILITY_UNAVAILABLE', message: `Connector does not support ${capability}` };
    }
    checkUploadRate(authUser.userId, 0);
    const upload = uploadSpool.create({ userId: authUser.userId, ...params }, body);
    reply.code(201).send({ upload });
  } catch (err: any) {
    const statusCode = httpError[err?.code as keyof typeof httpError] ?? 500;
    return sendError(reply, statusCode, err?.code || 'INTERNAL_ERROR', err?.message || 'Could not create upload');
  }
});

app.put('/v1/nodes/:nodeId/sessions/:sessionId/uploads/:uploadId', {
  bodyLimit: UPLOAD_CHUNK_BYTES,
}, async (request, reply) => {
  const params = request.params as { nodeId: string; sessionId: string; uploadId: string };
  const authUser = await getAuthUserFromRequest(request.headers.authorization);
  if (!authUser) return sendError(reply, 401, 'UNAUTHORIZED', 'Missing access token');

  try {
    requireOwnedNode(authUser.userId, params.nodeId);
    const offsetValue = (request.query as { offset?: unknown }).offset;
    const offset = typeof offsetValue === 'string' && /^\d+$/.test(offsetValue) ? Number(offsetValue) : Number.NaN;
    const bytes = Buffer.isBuffer(request.body) ? request.body : null;
    if (!bytes) throw new UploadSpoolError('INVALID_REQUEST', 'Upload chunk must use application/octet-stream');
    checkUploadRate(authUser.userId, bytes.length);
    const upload = uploadSpool.append(params.uploadId, { userId: authUser.userId, ...params }, offset, bytes);
    reply.send({ upload });
  } catch (err: any) {
    const statusCode = httpError[err?.code as keyof typeof httpError] ?? 500;
    return sendError(reply, statusCode, err?.code || 'INTERNAL_ERROR', err?.message || 'Could not append upload');
  }
});

app.get('/v1/nodes/:nodeId/sessions/:sessionId/uploads/:uploadId', async (request, reply) => {
  const params = request.params as { nodeId: string; sessionId: string; uploadId: string };
  const authUser = await getAuthUserFromRequest(request.headers.authorization);
  if (!authUser) return sendError(reply, 401, 'UNAUTHORIZED', 'Missing access token');
  try {
    requireOwnedNode(authUser.userId, params.nodeId);
    const upload = uploadSpool.getOwned(params.uploadId, { userId: authUser.userId, ...params });
    reply.send({ upload });
  } catch (err: any) {
    const statusCode = httpError[err?.code as keyof typeof httpError] ?? 500;
    return sendError(reply, statusCode, err?.code || 'INTERNAL_ERROR', err?.message || 'Could not read upload');
  }
});

app.delete('/v1/nodes/:nodeId/sessions/:sessionId/uploads/:uploadId', async (request, reply) => {
  const params = request.params as { nodeId: string; sessionId: string; uploadId: string };
  const authUser = await getAuthUserFromRequest(request.headers.authorization);
  if (!authUser) return sendError(reply, 401, 'UNAUTHORIZED', 'Missing access token');
  try {
    requireOwnedNode(authUser.userId, params.nodeId);
    uploadSpool.getOwned(params.uploadId, { userId: authUser.userId, ...params });
    uploadSpool.remove(params.uploadId);
    reply.code(204).send();
  } catch (err: any) {
    const statusCode = httpError[err?.code as keyof typeof httpError] ?? 500;
    return sendError(reply, statusCode, err?.code || 'INTERNAL_ERROR', err?.message || 'Could not delete upload');
  }
});

app.get('/v1/nodes/:nodeId/sessions/:sessionId/attachments/:attachmentId', async (request, reply) => {
  const params = request.params as { nodeId: string; sessionId: string; attachmentId: string };
  const authUser = await getAuthUserFromRequest(request.headers.authorization);
  if (!authUser) return sendError(reply, 401, 'UNAUTHORIZED', 'Missing access token');
  try {
    requireOwnedNode(authUser.userId, params.nodeId);
    const dispatched = await dispatchCommand(
      authUser,
      params.nodeId,
      params.sessionId,
      'session.attachment.export',
      uuidv7(),
      { attachmentId: params.attachmentId },
      true,
    );
    const frame = await dispatched.resultPromise;
    if (!frame?.ok) throw frame?.error || { code: 'INTERNAL_ERROR', message: 'Attachment export failed' };
    const result = objectValue(frame.result);
    const attachment = objectValue(result?.attachment);
    if (!result || typeof result.exportToken !== 'string' || !attachment || typeof attachment.mediaType !== 'string') {
      throw { code: 'INTERNAL_ERROR', message: 'Node returned invalid attachment metadata' };
    }
    const exported = uploadSpool.validatedAttachment(result.exportToken);
    if (typeof attachment.bytes === 'number' && attachment.bytes !== exported.bytes) {
      uploadSpool.removeAttachment(result.exportToken);
      throw { code: 'INTERNAL_ERROR', message: 'Attachment byte count mismatch' };
    }
    const stream = createReadStream(exported.path);
    stream.once('close', () => uploadSpool.removeAttachment(result.exportToken as string));
    reply.header('cache-control', 'private, max-age=31536000, immutable');
    reply.header('content-length', String(exported.bytes));
    reply.type(attachment.mediaType);
    return reply.send(stream);
  } catch (err: any) {
    const statusCode = httpError[err?.code as keyof typeof httpError] ?? 500;
    return sendError(reply, statusCode, err?.code || 'INTERNAL_ERROR', err?.message || 'Could not export attachment');
  }
});

app.post('/v1/nodes/:nodeId/sessions/:sessionId/followup', async (request, reply) => {
  const params = request.params as { nodeId: string; sessionId: string };
  const body = requireBody(request, followupBody);
  const authUser = await getAuthUserFromRequest(request.headers.authorization);
  if (!authUser) {
    return sendError(reply, httpError.UNAUTHORIZED, 'UNAUTHORIZED', 'Missing access token');
  }

  try {
    const existing = sqlite
      .prepare('SELECT * FROM commands WHERE request_id = ? AND user_id = ?')
      .get(body.requestId, authUser.userId) as any | undefined;
    if (existing) {
      if (
        existing.action !== 'session.followup'
        || existing.node_id !== params.nodeId
        || existing.session_id !== params.sessionId
      ) {
        throw { code: 'INVALID_REQUEST', message: 'requestId was already used for another write' };
      }
      const persisted = typeof existing.result_json === 'string'
        ? JSON.parse(existing.result_json) as CommandResultFrame
        : undefined;
      if (persisted && !persisted.ok) {
        throw persisted.error || { code: 'INTERNAL_ERROR', message: 'Follow-up failed' };
      }
      return reply.code(202).send({
        commandId: existing.id,
        requestId: body.requestId,
        accepted: true,
        duplicates: true,
      });
    }

    const uploadIds = (body.uploads || []).map((upload: { uploadId: string }) => upload.uploadId);
    const descriptors = uploadSpool.readyDescriptors(uploadIds, {
      userId: authUser.userId,
      nodeId: params.nodeId,
      sessionId: params.sessionId,
    });
    const dispatched = await dispatchCommand(authUser, params.nodeId, params.sessionId, 'session.followup', body.requestId, {
      content: body.content,
      ...(body.references?.length ? { references: body.references } : {}),
      ...(descriptors.length ? { uploads: descriptors } : {}),
    }, true);
    const frame = await dispatched.resultPromise;
    if (!frame?.ok) throw frame?.error || { code: 'INTERNAL_ERROR', message: 'Follow-up failed' };
    if (uploadIds.length) uploadSpool.markConsumed(uploadIds);
    reply.code(202).send({
      commandId: dispatched.commandId,
      requestId: body.requestId,
      accepted: true,
      duplicates: dispatched.duplicates,
    });
  } catch (err: any) {
    const statusCode = httpError[err.code as keyof typeof httpError] ?? 500;
    return sendError(reply, statusCode, err.code || 'INTERNAL_ERROR', err.message || 'Command failed');
  }
});

app.post('/v1/nodes/:nodeId/sessions/:sessionId/steer', async (request, reply) => {
  const params = request.params as { nodeId: string; sessionId: string };
  const body = requireBody(request, steerBody);
  const authUser = await getAuthUserFromRequest(request.headers.authorization);
  if (!authUser) {
    return sendError(reply, httpError.UNAUTHORIZED, 'UNAUTHORIZED', 'Missing access token');
  }

  try {
    const result = await dispatchCommand(authUser, params.nodeId, params.sessionId, 'session.steer', body.requestId, {
      instruction: body.instruction,
    });
    reply.code(202).send(result);
  } catch (err: any) {
    const statusCode = httpError[err.code as keyof typeof httpError] ?? 500;
    return sendError(reply, statusCode, err.code || 'INTERNAL_ERROR', err.message || 'Command failed');
  }
});

app.post('/v1/nodes/:nodeId/sessions/:sessionId/stop', async (request, reply) => {
  const params = request.params as { nodeId: string; sessionId: string };
  const body = requireBody(request, stopBody);
  const authUser = await getAuthUserFromRequest(request.headers.authorization);
  if (!authUser) {
    return sendError(reply, httpError.UNAUTHORIZED, 'UNAUTHORIZED', 'Missing access token');
  }

  try {
    const result = await dispatchCommand(authUser, params.nodeId, params.sessionId, 'session.stop', body.requestId, {
      reason: body.reason || 'user_stop',
    });
    reply.code(202).send(result);
  } catch (err: any) {
    const statusCode = httpError[err.code as keyof typeof httpError] ?? 500;
    return sendError(reply, statusCode, err.code || 'INTERNAL_ERROR', err.message || 'Command failed');
  }
});

app.post('/v1/approvals/:approvalId/respond', async (request, reply) => {
  const approvalId = (request.params as { approvalId: string }).approvalId;
  const body = requireBody(request, approvalRespondBody);
  const authUser = await getAuthUserFromRequest(request.headers.authorization);
  if (!authUser) {
    return sendError(reply, httpError.UNAUTHORIZED, 'UNAUTHORIZED', 'Missing access token');
  }

  const row = sqlite.prepare('SELECT * FROM approvals WHERE id = ?').get(approvalId) as any | undefined;
  if (!row) {
    return sendError(reply, httpError.APPROVAL_NOT_FOUND, 'APPROVAL_NOT_FOUND', 'Approval not found');
  }

  if (row.user_id !== authUser.userId) {
    return sendError(reply, httpError.FORBIDDEN, 'FORBIDDEN', 'Approval belongs to another user');
  }

  const existingCommand = sqlite
    .prepare('SELECT * FROM commands WHERE request_id = ? AND user_id = ?')
    .get(body.requestId, authUser.userId) as any | undefined;
  if (existingCommand) {
    if (
      existingCommand.action !== 'approval.respond'
      || existingCommand.node_id !== row.node_id
      || existingCommand.session_id !== row.session_id
      || row.response !== body.response
    ) {
      return sendError(reply, httpError.INVALID_REQUEST, 'INVALID_REQUEST', 'requestId was already used for another write');
    }
    return reply.send({
      ok: true,
      approvalId,
      status: row.status,
      commandId: existingCommand.id,
      requestId: body.requestId,
      duplicate: true,
    });
  }

  if (row.status !== 'pending') {
    return sendError(reply, httpError.APPROVAL_ALREADY_RESOLVED, 'APPROVAL_ALREADY_RESOLVED', 'Approval already resolved');
  }

  if (row.expires_at <= nowMs()) {
    return sendError(reply, httpError.APPROVAL_EXPIRED, 'APPROVAL_EXPIRED', 'Approval expired');
  }

  let dispatched;
  try {
    dispatched = await dispatchCommand(
      authUser,
      row.node_id,
      row.session_id,
      'approval.respond',
      body.requestId,
      { approvalId, response: body.response },
    );
  } catch (err: any) {
    const statusCode = httpError[err.code as keyof typeof httpError] ?? 500;
    return sendError(reply, statusCode, err.code || 'INTERNAL_ERROR', err.message || 'Command failed');
  }

  const status = body.response === 'allow_once' ? 'approved' : 'denied';
  sqlite
    .prepare('UPDATE approvals SET status = ?, resolved_at = ?, response = ? WHERE id = ?')
    .run(status, nowMs(), body.response, approvalId);

  broadcastToSession(row.node_id, row.session_id, {
    v: 1,
    kind: 'approval.resolved',
    approvalId,
    status,
  });

  reply.send({
    ok: true,
    approvalId,
    status,
    commandId: dispatched.commandId,
    requestId: body.requestId,
    duplicate: false,
  });
});

app.get('/v1/node/connect', { websocket: true }, (connection, request) => {
  const socket = connection;

  const auth = parseNodeAuth(request.headers.authorization);
  if (!auth) {
    socket.close(1008, 'UNAUTHORIZED');
    return;
  }

  const nodeRow = ensureNodeMeta(auth.nodeId);
  if (!nodeRow) {
    socket.close(1008, 'NODE_NOT_FOUND');
    return;
  }

  const credentialHash = hashText(auth.nodeSecret);
  if (nodeRow.credential_hash !== credentialHash) {
    socket.close(1008, 'UNAUTHORIZED');
    return;
  }

  if (nodeRow.revoked_at) {
    socket.close(4403, 'NODE_REVOKED');
    return;
  }

  let acceptedNode = false;
  const now = nowMs();

  const state: NodeConnection = {
    ws: socket,
    nodeId: auth.nodeId,
    userId: nodeRow.owner_user_id,
    capabilities: new Set<string>(),
    protocolMin: 1,
    protocolMax: 1,
    lastSeenAt: now,
  };

  const closeExisting = nodeConnections.get(auth.nodeId);
  if (closeExisting) {
    closeExisting.ws.close(4009, 'NODE_REPLACED');
  }
  nodeConnections.set(auth.nodeId, state);

  socket.on('close', () => {
    const current = nodeConnections.get(auth.nodeId);
    if (current === state) {
      nodeConnections.delete(auth.nodeId);
      sqlite.prepare('UPDATE nodes SET last_seen_at = ? WHERE id = ?').run(nowMs(), auth.nodeId);
    }
  });

  socket.on('message', (raw: RawData) => {
    const text = raw.toString();
    if (!text) return;
    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      socket.close(1007, 'INVALID_JSON');
      return;
    }

    state.lastSeenAt = nowMs();

    if (payload?.v !== 1) {
      sendJson(socket, { v: 1, kind: 'error', code: 'PROTOCOL_UNSUPPORTED', message: 'unsupported protocol version' });
      return;
    }

    if (!acceptedNode) {
      if (
        payload?.v !== 1 ||
        payload?.kind !== 'node.hello' ||
        payload?.protocolMin > 1 ||
        payload?.protocolMax < 1 ||
        !payload?.node ||
        payload.node.id !== auth.nodeId
      ) {
        socket.close(4400, 'PROTOCOL_UNSUPPORTED');
        return;
      }

      state.protocolMin = payload.protocolMin;
      state.protocolMax = payload.protocolMax;
      state.capabilities = new Set(Array.isArray(payload.capabilities) ? payload.capabilities : []);
      const persistedNode = ensureNodeMeta(auth.nodeId);
      const runtimeNode = payload.node as Record<string, unknown>;
      const runtimeValue = (key: string, fallback: string) => typeof runtimeNode[key] === 'string' && runtimeNode[key]
        ? runtimeNode[key] as string
        : fallback;
      sqlite
        .prepare('UPDATE nodes SET name = ?, platform = ?, arch = ?, plugin_version = ?, dsh_version = ?, last_seen_at = ? WHERE id = ?')
        .run(
          runtimeValue('name', String(persistedNode?.name || 'DSH Node')),
          runtimeValue('platform', String(persistedNode?.platform || 'unknown')),
          runtimeValue('arch', String(persistedNode?.arch || 'unknown')),
          runtimeValue('pluginVersion', String(persistedNode?.plugin_version || 'unknown')),
          runtimeValue('dshVersion', String(persistedNode?.dsh_version || 'unknown')),
          nowMs(),
          auth.nodeId,
        );
      acceptedNode = true;
      sendJson(socket, {
        v: 1,
        kind: 'node.hello.ack',
        nodeId: auth.nodeId,
      });
      return;
    }

    if (payload.kind === 'node.heartbeat') {
      sqlite.prepare('UPDATE nodes SET last_seen_at = ? WHERE id = ?').run(nowMs(), auth.nodeId);
      sendJson(socket, { v: 1, kind: 'node.heartbeat.ack' });
      return;
    }

    if (payload.kind === 'session.event') {
      if (typeof payload.sourceSeq !== 'number' || !payload.sessionId || typeof payload.nodeId !== 'string') {
        sendJson(socket, { v: 1, kind: 'error', code: 'INVALID_REQUEST', message: 'invalid session event' });
        return;
      }
      if (payload.nodeId !== auth.nodeId) {
        sendJson(socket, { v: 1, kind: 'error', code: 'UNAUTHORIZED', message: 'nodeId mismatch' });
        return;
      }
      const evt = payload as SessionRingEvent;
      writeRingEvent(evt.nodeId, evt.sessionId, {
        v: 1,
        kind: 'session.event',
        nodeId: evt.nodeId,
        sessionId: evt.sessionId,
        sourceSeq: evt.sourceSeq,
        event: evt.event,
      });

      broadcastToSession(evt.nodeId, evt.sessionId, {
        v: 1,
        kind: 'session.event',
        nodeId: evt.nodeId,
        sessionId: evt.sessionId,
        sourceSeq: evt.sourceSeq,
        event: evt.event,
        createdAt: nowMs(),
      });
      return;
    }

    if (payload.kind === 'command.ack') {
      const commandId = payload.commandId as string;
      const status = payload.status || 'acked';
      if (commandId) {
        const command = sqlite
          .prepare('SELECT node_id FROM commands WHERE id = ?')
          .get(commandId) as { node_id: string } | undefined;
        if (!command || command.node_id !== auth.nodeId) {
          sendJson(socket, { v: 1, kind: 'error', code: 'UNAUTHORIZED', message: 'commandId does not belong to node' });
          return;
        }

        const errorCode = payload.errorCode ? String(payload.errorCode) : null;
        sqlite
          .prepare('UPDATE commands SET status = ?, acked_at = ?, error_code = ? WHERE id = ?')
          .run(status, nowMs(), errorCode, commandId);
        const timeout = pendingCommandTimeout.get(commandId);
        if (timeout) {
          clearTimeout(timeout);
          pendingCommandTimeout.delete(commandId);
        }
      }
      return;
    }

    if (payload.kind === 'command.result') {
      const frame = payload as CommandResultFrame;
      if (!frame.commandId || typeof frame.ok !== 'boolean') {
        sendJson(socket, { v: 1, kind: 'error', code: 'INVALID_REQUEST', message: 'invalid command result' });
        return;
      }

      const command = sqlite
        .prepare('SELECT node_id, action FROM commands WHERE id = ?')
        .get(frame.commandId) as { node_id: string; action: string } | undefined;
      if (!command || command.node_id !== auth.nodeId) {
        sendJson(socket, { v: 1, kind: 'error', code: 'UNAUTHORIZED', message: 'commandId does not belong to node' });
        return;
      }

      const errorCode = frame.ok ? null : String(frame.error?.code || 'INTERNAL_ERROR');
      const persistedResult = minimalPersistedCommandResult(command.action, frame);
      sqlite
        .prepare('UPDATE commands SET status = ?, acked_at = COALESCE(acked_at, ?), error_code = ?, result_json = ? WHERE id = ?')
        .run(
          frame.ok ? 'completed' : 'failed',
          nowMs(),
          errorCode,
          persistedResult ? JSON.stringify(persistedResult) : null,
          frame.commandId,
        );

      const ackTimeout = pendingCommandTimeout.get(frame.commandId);
      if (ackTimeout) {
        clearTimeout(ackTimeout);
        pendingCommandTimeout.delete(frame.commandId);
      }

      const pending = pendingCommandResults.get(frame.commandId);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingCommandResults.delete(frame.commandId);
        pending.resolve(frame);
      }
      return;
    }

    if (payload.kind === 'approval.request') {
      const approval = payload.approval;
      if (
        !approval?.approvalId ||
        !approval?.sessionId ||
        !approval?.toolCallId ||
        typeof approval.expiresAt !== 'number'
      ) {
        sendJson(socket, { v: 1, kind: 'error', code: 'INVALID_REQUEST', message: 'invalid approval request' });
        return;
      }
      if (approval.nodeId && approval.nodeId !== auth.nodeId) {
        return;
      }

      const status = sqlite
        .prepare('SELECT * FROM approvals WHERE id = ?')
        .get(approval.approvalId) as any | undefined;
      if (!status) {
        sqlite
          .prepare(
            `INSERT INTO approvals (
            id, user_id, node_id, session_id, tool_call_id, status, expires_at, created_at, request_payload
          ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
          )
          .run(
            approval.approvalId,
            nodeRow.owner_user_id,
            auth.nodeId,
            approval.sessionId,
            approval.toolCallId,
            approval.expiresAt,
            nowMs(),
            JSON.stringify(approval),
          );
      }
      if (!status || (status.status === 'pending' && status.expires_at > nowMs())) {
        broadcastToSession(
          auth.nodeId,
          approval.sessionId,
          approvalRequestFrame(auth.nodeId, approval.sessionId, approval),
        );
      }
      return;
    }

    sendJson(socket, {
      v: 1,
      kind: 'error',
      code: 'INVALID_REQUEST',
      message: 'unknown frame',
    });
  });
});

app.get('/v1/realtime', { websocket: true }, async (connection, request) => {
  const socket = connection;
  const auth = await getAuthUserFromRequest(request.headers.authorization);
  if (!auth) {
    socket.close(1008, 'UNAUTHORIZED');
    return;
  }

  const state: MobileConnection = {
    ws: socket,
    userId: auth.userId,
    deviceId: auth.deviceId,
    subscriptions: new Set(),
  };

  mobileConnections.add(state);

  socket.on('close', () => {
    mobileConnections.delete(state);
    for (const sub of state.subscriptions) {
      const targets = sessionSubscribers.get(sub);
      if (!targets) continue;
      targets.delete(socket);
      if (targets.size === 0) {
        sessionSubscribers.delete(sub);
      }
    }
  });

  const handleMobileMessage = (raw: RawData) => {
    const text = raw.toString();
    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      sendJson(socket, { v: 1, kind: 'error', code: 'INVALID_REQUEST', message: 'Invalid JSON' });
      return;
    }

    if (payload?.v !== 1) {
      sendJson(socket, { v: 1, kind: 'error', code: 'PROTOCOL_UNSUPPORTED', message: 'unsupported protocol version' });
      return;
    }

    if (payload.kind === 'subscribe') {
      const body = wsSubscribeBody.safeParse(payload);
      if (!body.success) {
        sendJson(socket, { v: 1, kind: 'error', code: 'INVALID_REQUEST', message: 'Invalid subscribe payload' });
        return;
      }
      const { nodeId, sessionId } = body.data;
      const node = ensureNodeMeta(nodeId);
      if (!node) {
        sendJson(socket, { v: 1, kind: 'error', code: 'NODE_NOT_FOUND', message: 'Node not found' });
        return;
      }
      if (node.owner_user_id !== auth.userId) {
        sendJson(socket, { v: 1, kind: 'error', code: 'FORBIDDEN', message: 'Node belongs to another user' });
        return;
      }

      const subKey = keySession(nodeId, sessionId);
      state.subscriptions.add(subKey);
      const targets = sessionSubscribers.get(subKey) ?? new Set();
      targets.add(socket);
      sessionSubscribers.set(subKey, targets);

      const replay = getSessionReplay(nodeId, sessionId, -1);
      sendJson(socket, {
        v: 1,
        kind: 'subscribe.ok',
        requestId: body.data.requestId,
        nodeId,
        sessionId,
      });

      const pendingApprovals = sqlite
        .prepare(
          `SELECT request_payload FROM approvals
           WHERE user_id = ? AND node_id = ? AND session_id = ? AND status = 'pending' AND expires_at > ?
           ORDER BY created_at ASC`,
        )
        .all(auth.userId, nodeId, sessionId, nowMs()) as Array<{ request_payload: string }>;
      for (const row of pendingApprovals) {
        try {
          const approval = JSON.parse(row.request_payload);
          sendJson(socket, approvalRequestFrame(nodeId, sessionId, approval));
        } catch {
          // A malformed legacy row is ignored instead of breaking subscription.
        }
      }

      if (replay && replay.length > 0) {
        sendJson(socket, {
          v: 1,
          kind: 'session.sync',
          nodeId,
          sessionId,
          afterSourceSeq: replay[0].sourceSeq - 1,
          events: replay,
        });
      }
      return;
    }

    if (payload.kind === 'session.sync') {
      const body = wsSessionSyncBody.safeParse(payload);
      if (!body.success) {
        sendJson(socket, { v: 1, kind: 'error', code: 'INVALID_REQUEST', message: 'Invalid sync payload' });
        return;
      }

      const { nodeId, sessionId, afterSourceSeq } = body.data;
      const key = keySession(nodeId, sessionId);
      if (!state.subscriptions.has(key)) {
        sendJson(socket, { v: 1, kind: 'error', code: 'FORBIDDEN', message: 'Not subscribed' });
        return;
      }

      const replay = getSessionReplay(nodeId, sessionId, afterSourceSeq);
      if (replay === null) {
        sendJson(socket, {
          v: 1,
          kind: 'snapshot.required',
          nodeId,
          sessionId,
          message: 'Replay window missing',
        });
      } else {
        sendJson(socket, {
          v: 1,
          kind: 'session.sync',
          nodeId,
          sessionId,
          afterSourceSeq,
          events: replay,
        });
      }
      return;
    }

    sendJson(socket, { v: 1, kind: 'error', code: 'INVALID_REQUEST', message: 'Unsupported realtime frame' });
  };

  socket.on('message', handleMobileMessage);
});

app.setErrorHandler((error, request, reply) => {
  if (error instanceof z.ZodError) {
    return sendError(reply, 400, 'INVALID_REQUEST', 'Validation failed', { issues: error.issues });
  }
  app.log.error(error);
  reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Unexpected error' });
});

setInterval(cleanupOfflineNodes, 5_000);
setInterval(cleanupStaleRates, 60_000);
setInterval(cleanupCommandMetadata, 60 * 60_000);
setInterval(() => uploadSpool.cleanupExpired(), 60_000);

app.listen({ port: PORT, host: HOST }).then(() => {
  app.log.info(`dsh-hub listening on ${HOST}:${PORT}`);
});
