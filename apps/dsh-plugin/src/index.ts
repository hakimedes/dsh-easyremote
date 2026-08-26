import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { hostname, homedir, platform, arch } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import QRCode from 'qrcode';
import { v7 as uuidv7 } from 'uuid';
import WebSocket from 'ws';

import { CommandReplayCache } from './command-cache.js';
import { connectorConfigPath, loadConnectorConfig, watchConnectorConfig } from './connector-config.js';
import { DshApiBridge, toRemoteSessionSummary } from './dsh-api.js';
import { normalizeDshEvent, type DshEvent } from './protocol.js';

export const name = 'dsh-easyremote-connector';
export const inject = ['webServer', 'agents', 'sessionQuery', 'agentDefaultModel', 'approval', 'apiProxy'];

const PROTOCOL_VERSION = 1;
const PLUGIN_VERSION = '0.2.0';
const HEARTBEAT_MS = 15_000;
const APPROVAL_TTL_MS = 10 * 60_000;
const PAIR_POLL_MS = 800;
/** Longest the pair page / pair-data waits for a fresh QR before answering "preparing". */
const PAIR_SNAPSHOT_WAIT_MS = 2_500;

type PairSnapshot = {
  ok: true;
  status: string;
  hub: string;
  nodeName: string;
  nodeId: string | null;
  recovering: boolean;
  qrSvg: string;
  pairingExpiresAt: number | null;
  error: string | null;
};

type JsonRecord = Record<string, unknown>;

type Identity = {
  installId: string;
  nodeSecret: string;
  nodeId?: string;
};

type PairingState = {
  pairingId: string;
  pollToken: string;
  qrPayload: string;
  expiresAt: number;
};

type PairingHandoff = {
  schemaVersion: 1;
  status: string;
  hub: string;
  nodeName: string;
  nodeId: string | null;
  qrPayload?: string;
  pairingExpiresAt: number | null;
  error: string | null;
  updatedAt: number;
};

type CommandFrame = {
  v: number;
  kind: 'command';
  commandId: string;
  requestId: string;
  nodeId: string;
  sessionId: string | null;
  action: string;
  payload: JsonRecord;
  issuedAt: number;
  expiresAt: number;
};

type CommandResultFrame = {
  v: 1;
  kind: 'command.result';
  commandId: string;
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
};

type PendingApproval = {
  approvalId: string;
  sessionId: string;
  toolCallId: string;
  title: string;
  summary: string;
  cwd?: string;
  risk: 'low' | 'medium' | 'high';
  expiresAt: number;
  settle: (outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable') => void;
};

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function wsUrl(hubUrl: string) {
  const url = new URL(hubUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/v1/node/connect';
  url.search = '';
  return url.toString();
}

export function shouldRotateRecoveryAfterReconnect(endpointChanged: boolean, nodeId?: string) {
  return endpointChanged && Boolean(nodeId);
}

function html(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Client-side enhancement for the standalone pair page: polls pair-data so a
 * fresh QR appears without a manual reload, a claimed pairing flips the page
 * to its connected state, and an unreachable Hub shows the last error instead
 * of a spinner. The server-rendered markup stays complete on its own.
 */
const PAIR_PAGE_SCRIPT = `<script>
(function () {
  'use strict';
  var data = null;
  function el(id) { return document.getElementById(id); }
  function setText(id, text) { var node = el(id); if (node && node.textContent !== text) node.textContent = text; }
  function countdown(now) {
    if (!data || !data.pairingExpiresAt || !data.qrSvg) { setText('c', ''); return; }
    var remaining = Math.max(0, data.pairingExpiresAt - now);
    var m = Math.floor(remaining / 60000);
    var s = Math.floor((remaining % 60000) / 1000);
    setText('c', m + ':' + String(s).padStart(2, '0'));
  }
  function render(now) {
    if (!data) return;
    var qr = el('q');
    var form = el('rc');
    var button = el('rb');
    var pill = el('s');
    if (pill) pill.textContent = String(data.status || '');
    if (pill) pill.className = 'pill ' + String(data.status || '');
    var title = data.recovering && data.qrSvg ? 'Reconnect DSH Mobile'
      : data.nodeId ? 'DSH Remote connected'
      : data.qrSvg ? 'Scan with DSH Mobile'
      : (data.error ? 'Hub unreachable' : 'Preparing pairing QR…');
    setText('t', title);
    document.title = title;
    if (qr) {
      if (data.qrSvg) {
        var qrKey = String(data.pairingExpiresAt || 'live');
        if (qr.dataset.key !== qrKey) { qr.innerHTML = data.qrSvg; qr.dataset.key = qrKey; }
      } else { qr.innerHTML = ''; qr.dataset.key = ''; }
    }
    var hint = data.recovering && data.qrSvg ? 'Scan this one-time QR to restore access on a phone that was previously paired.'
      : data.nodeId ? 'Remote access is active. Use Nodes in the mobile app to revoke it.'
      : data.qrSvg ? 'The QR is one-time and expires after five minutes. This page refreshes itself.'
      : (data.error ? 'Will keep retrying in the background. Last error: ' + data.error : 'Waiting for the Hub…');
    setText('hint', hint);
    if (form) form.hidden = !data.nodeId;
    if (button) button.textContent = data.qrSvg ? 'Refresh connection QR' : 'Generate connection QR';
    countdown(now);
  }
  async function tick() {
    try {
      var res = await fetch('/__dsh_remote_v1/pair-data', { cache: 'no-store' });
      var next = await res.json();
      if (next && next.ok) { data = next; render(Date.now()); }
    } catch (error) { /* keep last state; next tick retries */ }
  }
  tick();
  setInterval(tick, 4000);
  setInterval(function () { render(Date.now()); }, 1000);
})();
</script>`;

function errorCode(error: unknown) {
  if (isRecord(error) && typeof error.code === 'string' && error.code) return error.code;
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('not found') || message.includes('missing')) return 'SESSION_NOT_FOUND';
  if (message.includes('expired')) return 'COMMAND_EXPIRED';
  return 'INTERNAL_ERROR';
}

function requestBody(req: IncomingMessage, maxBytes = 64 * 1024): Promise<JsonRecord> {
  return new Promise((resolveBody, rejectBody) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      text += chunk;
      if (text.length > maxBytes) rejectBody(new Error('request body too large'));
    });
    req.on('end', () => {
      if (!text) return resolveBody({});
      try {
        const parsed = JSON.parse(text);
        resolveBody(isRecord(parsed) ? parsed : {});
      } catch (error) {
        rejectBody(error);
      }
    });
    req.on('error', rejectBody);
  });
}

class HubConnector {
  private hubUrl: string;
  private hubWsUrl: string;
  private nodeName: string;
  private defaultCwd?: string;
  private readonly dshVersion: string;
  private readonly configPath: string;
  private readonly pairingStatePath: string;
  private configWatchDisposer: (() => void) | null = null;
  private readonly identityPath: string;
  private identity: Identity;
  private pairing: PairingState | null = null;
  private socket: WebSocket | null = null;
  private connectionStatus: 'starting' | 'pairing' | 'connecting' | 'online' | 'offline' | 'revoked' = 'starting';
  private lastPairingError: string | null = null;
  private disposed = false;
  private pairingTask: Promise<void> | null = null;
  private recoveryCreateTask: Promise<void> | null = null;
  private rotateRecoveryOnAck = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private readonly routeDisposers: Array<() => void> = [];
  private readonly ownedAgentHandles = new Map<string, { agent: any; dispose: () => Promise<void> }>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly commandCache = new CommandReplayCache<CommandResultFrame>(500);
  private readonly toolNamesBySession = new Map<string, Map<string, string>>();
  private readonly agents: any;
  private readonly sessionQuery: any;
  private readonly agentDefaultModel: any;
  private readonly dshApi: DshApiBridge;
  private readonly webServer: any;
  private readonly logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };

  constructor(private readonly ctx: any) {
    this.configPath = connectorConfigPath();
    this.pairingStatePath = join(dirname(this.configPath), 'pairing.json');
    const config = loadConnectorConfig({ path: this.configPath, fallbackNodeName: hostname() });
    this.hubUrl = config.hubUrl;
    this.hubWsUrl = wsUrl(this.hubUrl);
    this.nodeName = config.nodeName;
    this.defaultCwd = config.defaultCwd;
    this.dshVersion = process.env.DSH_VERSION || '0.1.0-rc.6';
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
    this.identityPath = join(dshHome, 'remote-hub', 'node-identity.json');
    this.identity = this.loadIdentity();
    this.agents = ctx.get('agents');
    this.sessionQuery = ctx.get('sessionQuery');
    this.agentDefaultModel = ctx.get('agentDefaultModel');
    this.dshApi = new DshApiBridge(ctx.get('apiProxy'), () => uuidv7());
    this.webServer = ctx.get('webServer');
    this.logger = ctx.logger || console;
  }

  start() {
    if (!this.agents || !this.sessionQuery) {
      throw new Error('DSH Remote requires agents and sessionQuery services');
    }
    this.registerRoutes();
    this.configWatchDisposer = watchConnectorConfig(
      this.configPath,
      () => this.reloadConnectorConfig(),
      (error) => this.logger.warn(`[dsh-easyremote] config watch failed: ${String(error)}`),
    );
    this.ctx.on('session/event', (session: any, event: DshEvent) => {
      this.forwardSessionEvent(session, event);
    });
    if (this.ctx.get('approval')) {
      this.ctx.on('approval/request', (req: any, next: () => Promise<any>) => {
        return this.requestRemoteApproval(req, next);
      }, { prepend: true });
    }
    if (this.identity.nodeId) this.connect();
    else void this.ensurePairing();
    this.publishPairingState();
    this.logger.info(`[dsh-easyremote] Hub connector active; scan /__dsh_remote_v1/pair in DSH Web`);
  }

  async dispose() {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.configWatchDisposer?.();
    this.configWatchDisposer = null;
    this.socket?.close(1000, 'plugin disposed');
    this.socket = null;
    this.connectionStatus = 'offline';
    this.publishPairingState();
    for (const approval of [...this.pendingApprovals.values()]) approval.settle('cancelled');
    for (const dispose of this.routeDisposers) {
      try { dispose(); } catch {}
    }
    await Promise.allSettled([...this.ownedAgentHandles.values()].map((handle) => handle.dispose()));
    this.ownedAgentHandles.clear();
  }

  private reloadConnectorConfig() {
    let next;
    try {
      next = loadConnectorConfig({ path: this.configPath, fallbackNodeName: hostname() });
    } catch (error) {
      this.logger.warn(`[dsh-easyremote] ignoring invalid connector config: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    const endpointChanged = next.hubUrl !== this.hubUrl;
    const nodeNameChanged = next.nodeName !== this.nodeName;
    this.hubUrl = next.hubUrl;
    this.hubWsUrl = wsUrl(next.hubUrl);
    this.nodeName = next.nodeName;
    this.defaultCwd = next.defaultCwd;
    if (!endpointChanged && !nodeNameChanged) return;
    if (shouldRotateRecoveryAfterReconnect(endpointChanged, this.identity.nodeId)) {
      this.rotateRecoveryOnAck = true;
    }

    this.lastPairingError = null;
    this.pairing = null;
    this.reconnectAttempt = 0;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    const staleSocket = this.socket;
    this.socket = null;
    staleSocket?.close(1000, 'connector config changed');
    this.logger.info(`[dsh-easyremote] connector config updated; reconnecting to ${this.hubUrl}`);
    if (this.identity.nodeId) this.connect();
    else void this.ensurePairing();
  }

  private loadIdentity(): Identity {
    try {
      if (existsSync(this.identityPath)) {
        const parsed = JSON.parse(readFileSync(this.identityPath, 'utf8')) as Identity;
        if (parsed.installId && /^[a-f0-9]{64}$/i.test(parsed.nodeSecret)) return parsed;
      }
    } catch {}
    const identity = { installId: uuidv7(), nodeSecret: randomBytes(32).toString('hex') };
    this.saveIdentity(identity);
    return identity;
  }

  private saveIdentity(identity = this.identity) {
    mkdirSync(dirname(this.identityPath), { recursive: true, mode: 0o700 });
    const tempPath = `${this.identityPath}.${process.pid}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
    renameSync(tempPath, this.identityPath);
    chmodSync(this.identityPath, 0o600);
  }

  private publishPairingState() {
    try {
      const fresh = this.pairing && this.pairing.expiresAt > Date.now() ? this.pairing : null;
      const handoff: PairingHandoff = {
        schemaVersion: 1,
        status: this.connectionStatus,
        hub: this.hubUrl,
        nodeName: this.nodeName,
        nodeId: this.identity.nodeId ?? null,
        ...(fresh ? { qrPayload: fresh.qrPayload } : {}),
        pairingExpiresAt: fresh?.expiresAt ?? null,
        error: this.lastPairingError,
        updatedAt: Date.now(),
      };
      mkdirSync(dirname(this.pairingStatePath), { recursive: true, mode: 0o700 });
      const temporaryPath = `${this.pairingStatePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
      writeFileSync(temporaryPath, `${JSON.stringify(handoff, null, 2)}\n`, { mode: 0o600 });
      if (process.platform !== 'win32') chmodSync(temporaryPath, 0o600);
      renameSync(temporaryPath, this.pairingStatePath);
      if (process.platform !== 'win32') chmodSync(this.pairingStatePath, 0o600);
    } catch (error) {
      this.logger.warn(`[dsh-easyremote] pairing handoff unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private registerRoutes() {
    if (!this.webServer) return;
    const safeRegister = (path: string, handler: (req: IncomingMessage, res: ServerResponse) => unknown) => {
      try {
        const dispose = this.webServer.register({ kind: 'exact', path, handler });
        if (typeof dispose === 'function') this.routeDisposers.push(dispose);
      } catch (error) {
        this.logger.warn(`[dsh-remote] route ${path} unavailable: ${String(error)}`);
      }
    };

    safeRegister('/__dsh_remote_v1/status', (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({
        ok: true,
        status: this.connectionStatus,
        hub: this.hubUrl,
        nodeName: this.nodeName,
        nodeId: this.identity.nodeId ?? null,
        pairingExpiresAt: this.pairing?.expiresAt ?? null,
        error: this.lastPairingError,
        pairPage: '/__dsh_remote_v1/pair',
      }));
    });

    safeRegister('/__dsh_remote_v1/pair-data', async (_req, res) => {
      const snapshot = await this.pairSnapshot();
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(snapshot));
    });

    safeRegister('/__dsh_remote_v1/pair', async (_req, res) => {
      const data = await this.pairSnapshot();
      const qr = data.qrSvg;
      const recovering = Boolean(data.nodeId && qr);
      const title = recovering
        ? 'Reconnect DSH Mobile'
        : data.nodeId
          ? 'DSH Remote connected'
          : qr
            ? 'Scan with DSH Mobile'
            : data.error
              ? 'Hub unreachable'
              : 'Preparing pairing QR…';
      const hint = recovering
        ? 'Scan this one-time QR to restore access on a phone that was previously paired.'
        : data.nodeId
          ? 'Remote access is active. Use Nodes in the mobile app to revoke it.'
          : data.error
            ? `Will keep retrying in the background. Last error: ${data.error}`
            : 'The QR is one-time and expires after five minutes. This page refreshes itself.';
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(title)}</title><style>body{font-family:system-ui;background:#0d1117;color:#f4f5f7;margin:0;min-height:100vh;display:grid;place-items:center}.card{max-width:420px;text-align:center;padding:28px;border:1px solid #30363d;border-radius:18px;background:#161b22}.qr{background:white;padding:14px;border-radius:14px;line-height:0;margin:20px auto;max-width:300px;min-height:120px;display:flex;align-items:center;justify-content:center}.pill{display:inline-block;border-radius:999px;padding:3px 12px;font-size:12px;font-weight:700;background:#21262d;color:#9da7b3}.pill.online{background:#0f3517;color:#4ade80}.pill.pairing,.pill.connecting{background:#33270f;color:#fbbf24}p{color:#9da7b3;line-height:1.5}code{font-size:12px}button{border:0;border-radius:12px;background:#4d6bfe;color:white;font:600 16px system-ui;padding:12px 18px;cursor:pointer}.count{font-size:13px;color:#6e7681}</style><main class="card"><h1 id="t">${html(title)}</h1><span class="pill" id="s">${html(data.status)}</span>${qr ? `<div class="qr" id="q">${qr}</div>` : '<div class="qr" id="q"></div>'}<p id="n">${html(this.nodeName)}</p><p><code id="h">${html(this.hubUrl)}</code></p><p id="hint">${html(hint)}</p><p class="count" id="c"></p><form id="rc" method="post" action="/__dsh_remote_v1/recover"${data.nodeId ? '' : ' hidden'}><button id="rb" type="submit">${qr ? 'Refresh connection QR' : 'Generate connection QR'}</button></form></main>${PAIR_PAGE_SCRIPT}`);
    });

    safeRegister('/__dsh_remote_v1/recover', async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST', 'content-type': 'text/plain; charset=utf-8' });
        res.end('Method not allowed');
        return;
      }
      if (!this.identity.nodeId) {
        res.writeHead(409, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Node is not connected');
        return;
      }
      try {
        await this.refreshRecoveryPairing();
        res.writeHead(303, { location: '/__dsh_remote_v1/pair', 'cache-control': 'no-store' });
        res.end();
      } catch (error) {
        this.logger.warn(`[dsh-remote] mobile recovery unavailable: ${error instanceof Error ? error.message : String(error)}`);
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Could not create a mobile recovery QR');
      }
    });
  }

  private async fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    const response = await fetch(`${this.hubUrl}${path}`, { ...init, headers });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    return response.json() as Promise<T>;
  }

  private ensurePairing() {
    if (this.pairingTask) return this.pairingTask;
    this.pairingTask = this.runPairing().finally(() => {
      this.pairingTask = null;
    });
    return this.pairingTask;
  }

  /**
   * Current pairing state for UI consumers (pair page, pair-data JSON, the
   * web Settings section). Never awaits a full pairing loop: an unreachable
   * Hub answers quickly with status + last error instead of hanging the
   * request. Expired QRs are dropped so callers never render a dead code.
   */
  private async pairSnapshot(): Promise<PairSnapshot> {
    if (!this.identity.nodeId) {
      if (this.pairing && this.pairing.expiresAt <= Date.now()) this.pairing = null;
      if (!this.pairing) {
        const task = this.ensurePairing();
        await Promise.race([
          task,
          new Promise<void>((resolveWait) => setTimeout(resolveWait, PAIR_SNAPSHOT_WAIT_MS)),
        ]);
      }
    }
    const fresh = this.pairing && this.pairing.expiresAt > Date.now() ? this.pairing : null;
    const qrSvg = fresh ? await QRCode.toString(fresh.qrPayload, { type: 'svg', margin: 1, width: 280 }) : '';
    return {
      ok: true,
      status: this.connectionStatus,
      hub: this.hubUrl,
      nodeName: this.nodeName,
      nodeId: this.identity.nodeId ?? null,
      recovering: Boolean(this.identity.nodeId && fresh),
      qrSvg,
      pairingExpiresAt: fresh?.expiresAt ?? null,
      error: this.lastPairingError,
    };
  }

  private ensureRecoveryPairing() {
    if (this.pairing && this.pairing.expiresAt > Date.now()) return Promise.resolve();
    if (this.recoveryCreateTask) return this.recoveryCreateTask;
    this.recoveryCreateTask = this.createRecoveryPairing().finally(() => {
      this.recoveryCreateTask = null;
    });
    return this.recoveryCreateTask;
  }

  private async refreshRecoveryPairing() {
    if (this.recoveryCreateTask) await this.recoveryCreateTask;
    this.pairing = null;
    this.publishPairingState();
    await this.ensureRecoveryPairing();
  }

  private async createRecoveryPairing() {
    const nodeId = this.identity.nodeId;
    if (!nodeId) throw new Error('Node is not connected');
    const created = await this.fetchJson<PairingState & { pairToken: string }>('/v1/node-pairings/recover', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { authorization: `Node ${nodeId}.${this.identity.nodeSecret}` },
    });
    this.pairing = created;
    this.publishPairingState();
    void this.pollRecoveryPairing(created);
  }

  private async pollRecoveryPairing(created: PairingState) {
    try {
      while (!this.disposed && Date.now() < created.expiresAt) {
        const polled = await this.fetchJson<{ status: string }>(
          `/v1/node-pairings/${encodeURIComponent(created.pairingId)}`,
          { headers: { authorization: `Pair ${created.pollToken}` } },
        );
        if (polled.status === 'claimed' || polled.status === 'expired') return;
        await new Promise((resolveWait) => setTimeout(resolveWait, PAIR_POLL_MS));
      }
    } catch (error) {
      this.logger.warn(`[dsh-remote] mobile recovery polling unavailable: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (this.pairing?.pairingId === created.pairingId) this.pairing = null;
      this.publishPairingState();
    }
  }

  private async runPairing() {
    while (!this.disposed && !this.identity.nodeId) {
      try {
        this.connectionStatus = 'pairing';
        this.publishPairingState();
        const created = await this.fetchJson<{
          pairingId: string;
          pollToken: string;
          qrPayload: string;
          expiresAt: number;
        }>('/v1/node-pairings', {
          method: 'POST',
          body: JSON.stringify({
            nodeName: this.nodeName,
            platform: platform(),
            arch: arch(),
            pluginVersion: PLUGIN_VERSION,
            dshVersion: this.dshVersion,
            installId: this.identity.installId,
            nodeSecretHash: sha256(this.identity.nodeSecret),
          }),
        });
        this.pairing = created;
        this.lastPairingError = null;
        this.publishPairingState();
        while (!this.disposed && !this.identity.nodeId && Date.now() < created.expiresAt) {
          const polled = await this.fetchJson<{ status: string; nodeId?: string }>(
            `/v1/node-pairings/${encodeURIComponent(created.pairingId)}`,
            { headers: { authorization: `Pair ${created.pollToken}` } },
          );
          if (polled.status === 'claimed' && polled.nodeId) {
            this.identity = { ...this.identity, nodeId: polled.nodeId };
            this.saveIdentity();
            this.pairing = null;
            this.publishPairingState();
            this.connect();
            return;
          }
          if (polled.status === 'expired') break;
          await new Promise((resolveWait) => setTimeout(resolveWait, PAIR_POLL_MS));
        }
      } catch (error) {
        this.connectionStatus = 'offline';
        this.lastPairingError = error instanceof Error ? error.message : String(error);
        this.publishPairingState();
        this.logger.warn(`[dsh-remote] pairing unavailable: ${this.lastPairingError}`);
        await new Promise((resolveWait) => setTimeout(resolveWait, 3_000));
      } finally {
        if (!this.identity.nodeId) this.pairing = null;
        this.publishPairingState();
      }
    }
  }

  private connect() {
    if (this.disposed || !this.identity.nodeId) return;
    if (
      this.socket
      && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) return;
    this.connectionStatus = 'connecting';
    this.publishPairingState();
    const socket = new WebSocket(this.hubWsUrl, {
      headers: { authorization: `Node ${this.identity.nodeId}.${this.identity.nodeSecret}` },
      maxPayload: 512 * 1024,
    });
    this.socket = socket;

    socket.on('open', () => {
      this.reconnectAttempt = 0;
      this.send({
        v: 1,
        kind: 'node.hello',
        protocolMin: PROTOCOL_VERSION,
        protocolMax: PROTOCOL_VERSION,
        node: {
          id: this.identity.nodeId,
          name: this.nodeName,
          platform: platform(),
          arch: arch(),
          pluginVersion: PLUGIN_VERSION,
          dshVersion: this.dshVersion,
        },
        capabilities: [
          'session.list',
          'session.snapshot',
          'session.create',
          'agentPreset.list',
          'session.models',
          'session.selectModel',
          'session.rename',
          'session.followup',
          'session.steer',
          'session.stop',
          'session.events',
          'approval.respond',
        ],
      });
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = setInterval(() => {
        this.send({ v: 1, kind: 'node.heartbeat', nodeId: this.identity.nodeId });
      }, HEARTBEAT_MS);
    });

    socket.on('message', (raw) => {
      let payload: unknown;
      try { payload = JSON.parse(raw.toString()); } catch { return; }
      if (!isRecord(payload)) return;
      if (payload.kind === 'node.hello.ack') {
        this.connectionStatus = 'online';
        this.lastPairingError = null;
        this.publishPairingState();
        this.replayPendingApprovals();
        if (this.rotateRecoveryOnAck) {
          this.rotateRecoveryOnAck = false;
          void this.ensureRecoveryPairing().catch((error) => {
            this.logger.warn(`[dsh-easyremote] automatic mobile recovery rotation failed: ${error instanceof Error ? error.message : String(error)}`);
          });
        }
        return;
      }
      if (payload.kind === 'command') void this.handleCommand(payload as unknown as CommandFrame);
    });

    socket.on('close', (code, reasonBuffer) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      if (this.disposed) return;
      const reason = reasonBuffer.toString();
      if (code === 4403 || reason.includes('NODE_NOT_FOUND') || reason.includes('NODE_REVOKED')) {
        this.connectionStatus = 'revoked';
        this.identity = { installId: this.identity.installId, nodeSecret: this.identity.nodeSecret };
        this.saveIdentity();
        this.publishPairingState();
        void this.ensurePairing();
        return;
      }
      this.connectionStatus = 'offline';
      this.publishPairingState();
      this.scheduleReconnect();
    });
    socket.on('error', () => {
      // close schedules the bounded reconnect.
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.disposed) return;
    const delay = Math.min(30_000, 1_000 * 2 ** this.reconnectAttempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private send(payload: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload));
  }

  private forwardSessionEvent(session: any, source: DshEvent) {
    if (!session?.id || !this.identity.nodeId) return;
    const toolNames = this.toolNamesBySession.get(session.id) ?? new Map<string, string>();
    this.toolNamesBySession.set(session.id, toolNames);
    const normalized = normalizeDshEvent(source, toolNames);
    if (!normalized) return;
    this.send({
      v: 1,
      kind: 'session.event',
      nodeId: this.identity.nodeId,
      sessionId: session.id,
      ...normalized,
    });
  }

  private async handleCommand(frame: CommandFrame) {
    if (frame.v !== 1 || !frame.commandId || !frame.requestId) return;
    this.send({
      v: 1,
      kind: 'command.ack',
      commandId: frame.commandId,
      requestId: frame.requestId,
      status: frame.expiresAt <= Date.now() ? 'failed' : 'acked',
      ...(frame.expiresAt <= Date.now() ? { errorCode: 'COMMAND_EXPIRED' } : {}),
    });
    const result = await this.commandCache.execute(frame.commandId, async () => {
      if (frame.expiresAt <= Date.now()) {
        return this.commandError(frame, 'COMMAND_EXPIRED', 'Command expired before execution');
      }
      try {
        return {
          v: 1,
          kind: 'command.result',
          commandId: frame.commandId,
          requestId: frame.requestId,
          ok: true,
          result: await this.executeCommand(frame),
        } satisfies CommandResultFrame;
      } catch (error) {
        return this.commandError(
          frame,
          errorCode(error),
          error instanceof Error ? error.message : String(error),
        );
      }
    });
    this.send(result);
  }

  private commandError(frame: CommandFrame, code: string, message: string): CommandResultFrame {
    return {
      v: 1,
      kind: 'command.result',
      commandId: frame.commandId,
      requestId: frame.requestId,
      ok: false,
      error: { code, message },
    };
  }

  private async executeCommand(frame: CommandFrame) {
    switch (frame.action) {
      case 'session.list':
        return { sessions: await this.listSessions() };
      case 'session.snapshot':
        return this.snapshot(String(frame.sessionId || ''));
      case 'session.create':
        return { session: await this.createSession(
          typeof frame.payload.agentPreset === 'string' ? frame.payload.agentPreset : undefined,
        ) };
      case 'agentPreset.list':
        return this.dshApi.listAgentPresets();
      case 'session.models':
        return this.dshApi.sessionModels(String(frame.sessionId || ''));
      case 'session.selectModel':
        return this.dshApi.selectModel({
          sessionId: String(frame.sessionId || ''),
          provider: String(frame.payload.provider || ''),
          model: String(frame.payload.model || ''),
          ...(typeof frame.payload.reasoningEffort === 'string'
            ? { reasoningEffort: frame.payload.reasoningEffort }
            : {}),
        });
      case 'session.rename':
        return this.dshApi.renameSession(
          String(frame.sessionId || ''),
          String(frame.payload.title || ''),
        );
      case 'session.followup': {
        const agent = await this.ensureAgent(String(frame.sessionId || ''));
        agent.followup(this.userMessage(String(frame.payload.content || '')));
        return { accepted: true };
      }
      case 'session.steer': {
        const agent = await this.ensureAgent(String(frame.sessionId || ''));
        agent.steer(this.userMessage(String(frame.payload.instruction || '')));
        return { accepted: true };
      }
      case 'session.stop': {
        const agent = this.agents.get(String(frame.sessionId || ''));
        if (!agent) throw new Error('session not found or not live');
        agent.cancel({ kind: 'user' });
        return { stopped: true };
      }
      case 'approval.respond':
        return this.resolveApproval(frame.payload);
      default:
        throw new Error(`unsupported capability: ${frame.action}`);
    }
  }

  private defaultAgentOptions() {
    try {
      const selection = this.agentDefaultModel?.currentSelection?.();
      return selection?.provider && selection?.model
        ? { provider: selection.provider, model: selection.model }
        : undefined;
    } catch {
      return undefined;
    }
  }

  private userMessage(text: string) {
    if (!text.trim()) throw new Error('message content is empty');
    return {
      id: `remote-${uuidv7()}`,
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: '@hakimedes/dsh-easyremote-connector' },
    };
  }

  private async ensureAgent(sessionId: string) {
    if (!sessionId) throw new Error('session id is missing');
    const live = this.agents.get(sessionId);
    if (live) return live;
    const handle = await this.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: this.defaultAgentOptions(),
    });
    this.ownedAgentHandles.set(sessionId, handle);
    return handle.agent;
  }

  private async createSession(agentPreset?: string) {
    const sessionId = uuidv7();
    const root = this.agents.roots?.()[0];
    const cwd = this.defaultCwd
      || root?.session?.header?.cwd
      || resolve(process.cwd());
    const created = await this.dshApi.createSession({
      sessionId,
      cwd,
      ...(agentPreset ? { agentPreset } : {}),
    });
    const agent = this.agents.get(created.sessionId);
    if (!agent) throw new Error('created session agent is unavailable');
    return this.sessionSummary(agent.session, 'New Session', agent.status);
  }

  private async listSessions() {
    const records = await this.sessionQuery.listSessions();
    const ids = records.map((item: any) => item.header.id);
    const titles = new Map<string, string>();
    try {
      const observations = await this.sessionQuery.readTitleSnapshots(ids);
      for (const item of observations) {
        const title = item?.status === 'fulfilled' ? item.value?.title?.title : undefined;
        if (typeof title === 'string' && title) titles.set(item.sessionId, title);
      }
    } catch {}

    return Promise.all(records.map(async (item: any) => {
      let snapshot: any = null;
      try { snapshot = await this.sessionQuery.readSession(item.header.id); } catch {}
      const agent = this.agents.get(item.header.id);
      return this.sessionSummary(
        { header: item.header, events: snapshot?.events || [] },
        titles.get(item.header.id),
        agent?.status,
      );
    }));
  }

  private sessionSummary(session: any, title?: string, status?: string) {
    return toRemoteSessionSummary(session, title, status);
  }

  private async snapshot(sessionId: string) {
    if (!sessionId) throw new Error('session id is missing');
    const snapshot = await this.sessionQuery.readSession(sessionId);
    if (!snapshot) throw new Error('session not found');
    const title = await this.readTitle(sessionId);
    const toolNames = new Map<string, string>();
    const events = (snapshot.events as DshEvent[])
      .map((event) => normalizeDshEvent(event, toolNames))
      .filter((event): event is NonNullable<typeof event> => event !== null);
    return {
      session: this.sessionSummary(
        { header: snapshot.session, events: snapshot.events },
        title,
        this.agents.get(sessionId)?.status,
      ),
      events: this.fitSnapshotEvents(events),
    };
  }

  private async readTitle(sessionId: string) {
    try {
      const [item] = await this.sessionQuery.readTitleSnapshots([sessionId]);
      return item?.status === 'fulfilled' ? item.value?.title?.title : undefined;
    } catch {
      return undefined;
    }
  }

  private fitSnapshotEvents(events: Array<NonNullable<ReturnType<typeof normalizeDshEvent>>>) {
    const selected: typeof events = [];
    let bytes = 0;
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (!event) continue;
      const size = Buffer.byteLength(JSON.stringify(event));
      if (bytes + size > 350 * 1024 && selected.length > 0) break;
      selected.push(event);
      bytes += size;
    }
    return selected.reverse();
  }

  private requestRemoteApproval(req: any, next: () => Promise<any>) {
    if (this.connectionStatus !== 'online' || !this.identity.nodeId) return next();
    const approvalId = this.findApprovalId(req.agent?.session?.events || [], req.callId);
    if (!approvalId) return next();
    const sessionId = String(req.agent.session.id);
    const toolCallId = String(req.callId || approvalId);
    const summary = typeof req.reason === 'string' && req.reason ? req.reason : String(req.toolName || 'DSH action');
    const pendingPromise = new Promise<string>((resolveOutcome) => {
      const expiresAt = Date.now() + APPROVAL_TTL_MS;
      let timer: ReturnType<typeof setTimeout>;
      const onAbort = () => settle('cancelled');
      const settle = (outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable') => {
        const current = this.pendingApprovals.get(approvalId);
        if (!current) return;
        this.pendingApprovals.delete(approvalId);
        clearTimeout(timer);
        req.signal?.removeEventListener('abort', onAbort);
        resolveOutcome(outcome);
      };
      timer = setTimeout(() => settle('unavailable'), APPROVAL_TTL_MS);
      const cwd = req.agent?.session?.header?.cwd;
      const pending: PendingApproval = {
        approvalId,
        sessionId,
        toolCallId,
        title: `DSH wants to run ${String(req.toolName || 'an action')}`,
        summary,
        ...(typeof cwd === 'string' ? { cwd } : {}),
        risk: String(req.toolName || '').includes('bash') ? 'high' : 'medium',
        expiresAt,
        settle,
      };
      this.pendingApprovals.set(approvalId, pending);
      req.signal?.addEventListener('abort', onAbort, { once: true });
      this.sendApproval(pending);
    });
    return pendingPromise;
  }

  private findApprovalId(events: DshEvent[], callId?: string) {
    const decided = new Set<string>();
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event?.type === 'approval/decided' && typeof event.data.id === 'string') {
        decided.add(event.data.id);
      }
      if (event?.type !== 'approval/asked' || typeof event.data.id !== 'string') continue;
      if (decided.has(event.data.id) || this.pendingApprovals.has(event.data.id)) continue;
      if ((event.data.callId ?? null) !== (callId ?? null)) continue;
      return event.data.id;
    }
    return null;
  }

  private sendApproval(pending: PendingApproval) {
    this.send({
      v: 1,
      kind: 'approval.request',
      approval: {
        approvalId: pending.approvalId,
        nodeId: this.identity.nodeId,
        sessionId: pending.sessionId,
        toolCallId: pending.toolCallId,
        title: pending.title,
        summary: pending.summary,
        cwd: pending.cwd,
        risk: pending.risk,
        expiresAt: pending.expiresAt,
      },
    });
  }

  private replayPendingApprovals() {
    for (const pending of this.pendingApprovals.values()) this.sendApproval(pending);
  }

  private resolveApproval(payload: JsonRecord) {
    const approvalId = String(payload.approvalId || '');
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) throw new Error('approval not found or no longer pending');
    pending.settle(payload.response === 'allow_once' ? 'allowed-once' : 'rejected');
    return { accepted: true, approvalId };
  }
}

export function apply(ctx: any) {
  const connector = new HubConnector(ctx);
  connector.start();
  ctx.effect(() => () => connector.dispose());
}
