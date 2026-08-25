import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { v7 as uuidv7 } from 'uuid';

const HUB_BASE = process.env.HUB_BASE || 'http://127.0.0.1:8789';
const HUB_WSS = HUB_BASE.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
const nativeFetch = globalThis.fetch;
let pairingPayload = null;
let recoveryPayload = null;

globalThis.fetch = async (...args) => {
  const response = await nativeFetch(...args);
  const url = String(args[0]);
  const init = args[1] || {};
  if (url.endsWith('/v1/node-pairings') && init.method === 'POST' && response.ok) {
    pairingPayload = await response.clone().json();
  }
  if (url.endsWith('/v1/node-pairings/recover') && init.method === 'POST' && response.ok) {
    recoveryPayload = await response.clone().json();
  }
  return response;
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function eventually(check, timeoutMs = 8_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await check();
    if (value) return value;
    await sleep(50);
  }
  throw new Error('condition timed out');
}

async function json(url, init = {}) {
  const headers = { 'content-type': 'application/json', ...(init.headers || {}) };
  const response = await nativeFetch(url, { ...init, headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${text}`);
  return JSON.parse(text);
}

function waitOpen(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket open timeout')), 5_000);
    ws.once('open', () => { clearTimeout(timer); resolve(); });
  });
}

function invokeRoute(path, method = 'GET') {
  const handler = routeHandlers.get(path);
  if (!handler) throw new Error(`route ${path} is not registered`);
  return new Promise((resolve, reject) => {
    let status = 200;
    let headers = {};
    const response = {
      writeHead(nextStatus, nextHeaders = {}) {
        status = nextStatus;
        headers = nextHeaders;
      },
      end(body = '') {
        resolve({ status, headers, body: String(body) });
      },
    };
    Promise.resolve(handler({ method }, response)).catch(reject);
  });
}

function waitFrame(ws, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket frame timeout')), 5_000);
    const handler = (raw) => {
      try {
        const frame = JSON.parse(raw.toString());
        if (!predicate(frame)) return;
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(frame);
      } catch {}
    };
    ws.on('message', handler);
  });
}

const handlers = new Map();
const cleanups = [];
const sessions = new Map();
const agentsById = new Map();
const routeHandlers = new Map();

function emit(name, ...args) {
  for (const handler of handlers.get(name) || []) handler(...args);
}

function append(session, type, data) {
  const event = { seq: session.events.length, time: Date.now(), type, data };
  session.events.push(event);
  emit('session/event', session, event);
  return event;
}

function makeAgent(session) {
  const agent = {
    id: session.id,
    session,
    status: 'idle',
    followup(message) {
      this.status = 'running';
      append(session, 'turn/start', { turn: 1 });
      append(session, 'user/message', message);
      append(session, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'remote ' } });
      append(session, 'assistant/message', {
        turn: 1,
        step: 1,
        message: { content: [{ type: 'text', text: 'remote complete' }] },
      });
      append(session, 'turn/end', { turn: 1, reason: { kind: 'completed' } });
      this.status = 'idle';
    },
    steer(message) {
      append(session, 'user/message', message);
    },
    cancel() {
      this.status = 'idle';
    },
  };
  agentsById.set(session.id, agent);
  return agent;
}

function createSession(id, cwd, withFirstEvent = false) {
  const session = {
    id,
    header: { id, version: 0, createdAt: Date.now(), cwd },
    events: [],
  };
  sessions.set(id, session);
  const agent = makeAgent(session);
  if (withFirstEvent) append(session, 'user/message', {
    id: uuidv7(), role: 'user', content: [{ type: 'text', text: 'native seq zero' }], source: { kind: 'user' },
  });
  return agent;
}

const firstAgent = createSession('existing-session', '/tmp/dsh-e2e', true);
const agents = {
  get: (id) => agentsById.get(id),
  roots: () => [firstAgent],
  async create(options) {
    const agent = createSession(options.sessionId, options.meta?.cwd || '/tmp/dsh-e2e');
    return { agent, dispose: async () => agentsById.delete(agent.id) };
  },
  async resume(options) {
    const session = sessions.get(options.resumeSessionId);
    if (!session) throw new Error('session not found');
    const agent = agentsById.get(session.id) || makeAgent(session);
    return { agent, dispose: async () => agentsById.delete(agent.id) };
  },
};

const sessionQuery = {
  async listSessions() {
    return [...sessions.values()].map((session) => ({ header: session.header, live: true, persisted: true }));
  },
  async readSession(id) {
    const session = sessions.get(id);
    if (!session) throw new Error('session not found');
    return { session: session.header, events: [...session.events] };
  },
  async readTitleSnapshots(ids) {
    return ids.map((id) => ({
      sessionId: id,
      status: 'fulfilled',
      value: { session: sessions.get(id)?.header, title: { title: id === 'existing-session' ? 'Existing DSH session' : 'Remote session' } },
    }));
  },
};

let selectedModel = { provider: 'deepseek', model: 'deepseek-chat' };

function rpcOk(request, value) {
  return { rpcId: request.rpcId, result: { ok: true, value } };
}

const apiProxy = {
  agentPresets: {
    async list(request) {
      return rpcOk(request, {
        presets: [
          { id: 'standard', trust: 'system', isDefault: true, name: 'Standard' },
          { id: 'ptc', trust: 'system', isDefault: false, name: 'PTC' },
          { id: 'minimal', trust: 'system', isDefault: false, name: 'Minimal' },
          { id: 'creative', trust: 'user', isDefault: false, name: 'Creative' },
          { id: 'broken', trust: 'user', isDefault: false, name: 'Broken', broken: 'preset document is invalid' },
        ],
        authorable: true,
        hasDocument: true,
      });
    },
  },
  sessions: {
    async create(request) {
      const { sessionId, cwd, agentPreset } = request.payload;
      const agent = createSession(sessionId, cwd || '/tmp/dsh-e2e');
      if (agentPreset) agent.session.header.agentPreset = agentPreset;
      return rpcOk(request, { sessionId, ...(agentPreset ? { agentPreset } : {}) });
    },
    async models(request) {
      return rpcOk(request, {
        current: selectedModel,
        routable: true,
        groups: [{
          id: 'deepseek',
          name: 'DeepSeek',
          models: [
            { id: 'deepseek-chat', name: 'DeepSeek Chat' },
            {
              id: 'deepseek-reasoner',
              name: 'DeepSeek Reasoner',
              reasoning: {
                efforts: [{ id: 'high', name: 'High' }],
                defaultEffort: 'high',
              },
            },
          ],
        }],
        failures: [{ id: 'offline-provider', name: 'Offline Provider', message: 'provider unavailable' }],
      });
    },
    async selectModel(request) {
      selectedModel = {
        provider: request.payload.provider,
        model: request.payload.model,
        ...(request.payload.reasoningEffort ? { reasoningEffort: request.payload.reasoningEffort } : {}),
      };
      return rpcOk(request, { selected: selectedModel });
    },
  },
};

const services = {
  agents,
  sessionQuery,
  agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test' }) },
  approval: {},
  apiProxy,
  webServer: {
    register({ path, handler }) {
      routeHandlers.set(path, handler);
      return () => routeHandlers.delete(path);
    },
  },
};

const ctx = {
  logger: { info() {}, warn(...args) { console.warn(...args); } },
  get: (name) => services[name],
  on(name, handler, options = {}) {
    const current = handlers.get(name) || [];
    if (options.prepend) current.unshift(handler);
    else current.push(handler);
    handlers.set(name, current);
    return () => handlers.set(name, (handlers.get(name) || []).filter((item) => item !== handler));
  },
  effect(factory) {
    const cleanup = factory();
    if (typeof cleanup === 'function') cleanups.push(cleanup);
    return cleanup;
  },
};

async function main() {
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-plugin-e2e-'));
  process.env.DSH_REMOTE_HUB_URL = HUB_BASE;
  process.env.DSH_REMOTE_NODE_NAME = 'DSH Plugin E2E';

  const { apply } = await import('../lib/index.js');
  apply(ctx);

  const pairing = await eventually(() => pairingPayload);
  const claim = await json(`${HUB_BASE}/v1/node-pairings/claim`, {
    method: 'POST',
    body: JSON.stringify({
      pairToken: pairing.pairToken,
      ownerDisplayName: 'Plugin E2E Owner',
      deviceName: 'Plugin E2E Android',
    }),
  });
  const auth = { authorization: `Bearer ${claim.accessToken}` };

  await eventually(async () => {
    const nodes = await json(`${HUB_BASE}/v1/nodes`, { headers: auth });
    return nodes.items.find((node) => node.id === claim.nodeId && node.online);
  });

  const connectedPage = await invokeRoute('/__dsh_remote_v1/pair');
  if (!connectedPage.body.includes('Reconnect mobile')) throw new Error('connected page has no mobile recovery action');
  const recoveryRedirect = await invokeRoute('/__dsh_remote_v1/recover', 'POST');
  if (recoveryRedirect.status !== 303 || recoveryRedirect.headers.location !== '/__dsh_remote_v1/pair') {
    throw new Error('mobile recovery action did not redirect to the pairing page');
  }
  const recovery = await eventually(() => recoveryPayload);
  const recoveryToken = new URL(recovery.qrPayload).searchParams.get('token');
  if (!recoveryToken) throw new Error('recovery QR did not contain a pairing token');
  const restored = await json(`${HUB_BASE}/v1/node-pairings/claim`, {
    method: 'POST',
    body: JSON.stringify({ pairToken: recoveryToken, deviceName: 'Restored E2E Android' }),
  });
  if (restored.nodeId !== claim.nodeId) throw new Error('recovery claim created or selected the wrong node');
  const restoredMe = await json(`${HUB_BASE}/v1/me`, {
    headers: { authorization: `Bearer ${restored.accessToken}` },
  });
  if (restoredMe.user.displayName !== 'Plugin E2E Owner') throw new Error('recovery claim selected the wrong owner');

  const listed = await json(`${HUB_BASE}/v1/nodes/${claim.nodeId}/sessions`, { headers: auth });
  const existing = listed.sessions.find((session) => session.sessionId === 'existing-session');
  if (!existing || existing.lastEventSeq !== 0) throw new Error('native sourceSeq zero was not indexed');

  const snapshot = await json(`${HUB_BASE}/v1/nodes/${claim.nodeId}/sessions/existing-session/snapshot`, { headers: auth });
  if (snapshot.events[0]?.event?.data?.text !== 'native seq zero') throw new Error('snapshot mapping failed');

  const presets = await json(`${HUB_BASE}/v1/nodes/${claim.nodeId}/agent-presets`, { headers: auth });
  if (presets.presets.find((preset) => preset.id === 'standard')?.isDefault !== true) {
    throw new Error('agentPreset.list did not preserve the host default');
  }
  if (presets.presets.find((preset) => preset.id === 'broken')?.broken !== 'preset document is invalid') {
    throw new Error('agentPreset.list did not preserve a broken preset reason');
  }

  const created = await json(`${HUB_BASE}/v1/nodes/${claim.nodeId}/sessions`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ requestId: uuidv7(), agentPreset: 'creative' }),
  });
  if (!sessions.has(created.sessionId)) throw new Error('session.create did not reach DSH agents');
  if (created.agentPreset !== 'creative' || sessions.get(created.sessionId)?.header.agentPreset !== 'creative') {
    throw new Error('session.create did not preserve the selected agent preset');
  }

  const models = await json(`${HUB_BASE}/v1/nodes/${claim.nodeId}/sessions/${created.sessionId}/models`, { headers: auth });
  if (models.current.model !== 'deepseek-chat' || models.groups[0]?.models[1]?.reasoning?.defaultEffort !== 'high') {
    throw new Error('session.models did not return normalized model metadata');
  }
  if (models.failures[0]?.message !== 'provider unavailable') {
    throw new Error('session.models did not preserve provider-local failures');
  }

  const modelSelection = await json(`${HUB_BASE}/v1/nodes/${claim.nodeId}/sessions/${created.sessionId}/model-selection`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      requestId: uuidv7(),
      provider: 'deepseek',
      model: 'deepseek-reasoner',
      reasoningEffort: 'high',
    }),
  });
  if (modelSelection.selected.model !== 'deepseek-reasoner' || modelSelection.selected.reasoningEffort !== 'high') {
    throw new Error('session.selectModel did not apply the exact model and reasoning effort');
  }

  const mobile = new WebSocket(`${HUB_WSS}/v1/realtime`, { headers: auth });
  await waitOpen(mobile);
  const subscribePromise = waitFrame(mobile, (frame) => frame.kind === 'subscribe.ok');
  mobile.send(JSON.stringify({
    v: 1,
    kind: 'subscribe',
    requestId: uuidv7(),
    nodeId: claim.nodeId,
    sessionId: created.sessionId,
  }));
  await subscribePromise;

  const userEventPromise = waitFrame(mobile, (frame) => frame.kind === 'session.event' && frame.event?.type === 'user.message');
  await json(`${HUB_BASE}/v1/nodes/${claim.nodeId}/sessions/${created.sessionId}/followup`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ requestId: uuidv7(), content: 'continue remotely' }),
  });
  const userEvent = await userEventPromise;
  if (userEvent.event.data.text !== 'continue remotely') throw new Error('followup did not produce canonical user event');

  const session = sessions.get(created.sessionId);
  const asked = append(session, 'approval/asked', { id: uuidv7(), toolName: 'bash', callId: 'call-e2e', reason: 'pnpm test' });
  const approvalFramePromise = waitFrame(mobile, (frame) => frame.kind === 'approval.request');
  const approvalHandler = handlers.get('approval/request')?.[0];
  const outcomePromise = approvalHandler({
    agent: agentsById.get(created.sessionId),
    toolName: 'bash',
    callId: 'call-e2e',
    reason: 'pnpm test',
    signal: new AbortController().signal,
  }, async () => 'unavailable');
  const approvalFrame = await approvalFramePromise;
  if (approvalFrame.approval.approvalId !== asked.data.id) throw new Error('approval id mapping failed');

  await json(`${HUB_BASE}/v1/approvals/${asked.data.id}/respond`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ requestId: uuidv7(), response: 'allow_once' }),
  });
  if (await outcomePromise !== 'allowed-once') throw new Error('approval response did not resume DSH');

  mobile.close();
  for (const cleanup of cleanups.reverse()) await cleanup();
  console.log('PLUGIN E2E PASSED');
}

main().catch(async (error) => {
  console.error('PLUGIN E2E FAILED', error);
  for (const cleanup of cleanups.reverse()) {
    try { await cleanup(); } catch {}
  }
  process.exitCode = 1;
});
