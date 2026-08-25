import WebSocket from 'ws';
import { v7 as uuidv7 } from 'uuid';

const HUB_BASE = process.env.HUB_BASE || 'http://127.0.0.1:8788';
const HUB_WSS = process.env.HUB_WSS || 'ws://127.0.0.1:8788';

function randomHex(bytes = 32) {
  const buf = Buffer.allocUnsafe(bytes);
  for (let i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256);
  return buf.toString('hex');
}

import { createHash } from 'node:crypto';
function realSha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(text);
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(text);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitWs(ws, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`wait ${event} timeout`)), 5000);
    ws.once(event, (...args) => {
      clearTimeout(timer);
      resolve(args);
    });
  });
}

function waitFrame(ws, kind) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`wait frame ${kind} timeout`)), 5000);
    const handler = (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.kind === kind) {
          ws.off('message', handler);
          clearTimeout(timer);
          resolve(msg);
        }
      } catch {}
    };
    ws.on('message', handler);
  });
}

async function main() {
  const installId = 'install-' + randomHex(8);
  const nodeSecret = randomHex(32);
  const nodeName = 'Smoke Test Node';

  console.log('1. healthz');
  console.log(await getJson(`${HUB_BASE}/healthz`));

  console.log('2. create pairing');
  const pairing = await postJson(`${HUB_BASE}/v1/node-pairings`, {
    nodeName,
    platform: 'darwin',
    arch: 'arm64',
    pluginVersion: '0.1.0',
    dshVersion: 'test',
    installId,
    nodeSecretHash: realSha256(nodeSecret),
  });
  console.log({ pairingId: pairing.pairingId, qrPayload: pairing.qrPayload });

  console.log('3. claim (first owner)');
  const claim = await postJson(`${HUB_BASE}/v1/node-pairings/claim`, {
    pairToken: pairing.pairToken,
    ownerDisplayName: 'Smoke Owner',
    deviceName: 'Smoke iPhone',
  });
  console.log({ nodeId: claim.nodeId, hasAccessToken: !!claim.accessToken, hasRefreshToken: !!claim.refreshToken });

  console.log('4. /v1/me');
  const me = await getJson(`${HUB_BASE}/v1/me`, { authorization: `Bearer ${claim.accessToken}` });
  console.log(me);

  console.log('5. /v1/nodes');
  const nodes = await getJson(`${HUB_BASE}/v1/nodes`, { authorization: `Bearer ${claim.accessToken}` });
  console.log(nodes);

  console.log('6. node connect ws');
  const nodeWs = new WebSocket(`${HUB_WSS}/v1/node/connect`, {
    headers: { authorization: `Node ${claim.nodeId}.${nodeSecret}` },
  });
  await waitWs(nodeWs, 'open');
  nodeWs.send(JSON.stringify({
    v: 1,
    kind: 'node.hello',
    protocolMin: 1,
    protocolMax: 1,
    node: {
      id: claim.nodeId,
      name: nodeName,
      platform: 'darwin',
      arch: 'arm64',
      pluginVersion: '0.1.0',
      dshVersion: 'test',
    },
    capabilities: ['session.list', 'session.snapshot', 'session.create', 'session.followup', 'session.steer', 'session.stop', 'session.events', 'approval.respond'],
  }));
  const helloAck = await waitFrame(nodeWs, 'node.hello.ack');
  console.log(helloAck);

  // Handle commands from hub
  nodeWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.kind === 'command') {
        nodeWs.send(JSON.stringify({ v: 1, kind: 'command.ack', commandId: msg.commandId, requestId: msg.requestId, status: 'acked' }));
        if (msg.action === 'session.list') {
          nodeWs.send(JSON.stringify({
            v: 1, kind: 'command.result', commandId: msg.commandId, requestId: msg.requestId,
            ok: true, result: { sessions: [] }
          }));
        } else if (msg.action === 'session.create') {
          const now = Date.now();
          nodeWs.send(JSON.stringify({
            v: 1, kind: 'command.result', commandId: msg.commandId, requestId: msg.requestId,
            ok: true,
            result: {
              session: {
                id: `smoke-session-${uuidv7()}`,
                title: 'Smoke Session',
                status: 'idle',
                lastSourceSeq: 0,
                createdAt: now,
                updatedAt: now,
              },
            },
          }));
        } else if (msg.action === 'session.followup') {
          const approvalId = uuidv7();
          const toolCallId = `tool-${uuidv7()}`;
          nodeWs.send(JSON.stringify({
            v: 1, kind: 'command.result', commandId: msg.commandId, requestId: msg.requestId,
            ok: true, result: {}
          }));
          nodeWs.send(JSON.stringify({
            v: 1, kind: 'approval.request',
            approval: {
              approvalId,
              nodeId: claim.nodeId,
              sessionId: msg.sessionId,
              toolCallId,
              title: 'Run command',
              summary: String(msg.payload.content || ''),
              cwd: 'project',
              risk: 'medium',
              expiresAt: Date.now() + 10 * 60_000,
            },
          }));
        } else {
          nodeWs.send(JSON.stringify({
            v: 1, kind: 'command.result', commandId: msg.commandId, requestId: msg.requestId,
            ok: true, result: {}
          }));
        }
      }
    } catch {}
  });

  const auth = { authorization: `Bearer ${claim.accessToken}` };

  console.log('7. list sessions');
  const sessions = await getJson(`${HUB_BASE}/v1/nodes/${claim.nodeId}/sessions`, auth);
  console.log(sessions);

  console.log('8. create session');
  const createSession = await postJson(`${HUB_BASE}/v1/nodes/${claim.nodeId}/sessions`, { requestId: uuidv7() }, auth);
  console.log(createSession);

  console.log('9. mobile realtime ws');
  const mobileWs = new WebSocket(`${HUB_WSS}/v1/realtime`, {
    headers: auth,
  });
  await waitWs(mobileWs, 'open');

  const sessionId = createSession.sessionId;
  mobileWs.send(JSON.stringify({
    v: 1,
    kind: 'subscribe',
    requestId: uuidv7(),
    nodeId: claim.nodeId,
    sessionId,
  }));
  const subOk = await waitFrame(mobileWs, 'subscribe.ok');
  console.log(subOk);

  console.log('10. node emit session event');
  const eventPromise = waitFrame(mobileWs, 'session.event');
  nodeWs.send(JSON.stringify({
    v: 1,
    kind: 'session.event',
    nodeId: claim.nodeId,
    sessionId,
    sourceSeq: 1,
    event: { type: 'assistant.delta', data: { text: 'hello mobile' } },
  }));
  const evt = await eventPromise;
  console.log(evt);

  console.log('11. followup');
  const approvalPromise = waitFrame(mobileWs, 'approval.request');
  const followup = await postJson(`${HUB_BASE}/v1/nodes/${claim.nodeId}/sessions/${sessionId}/followup`, {
    requestId: uuidv7(),
    content: 'please approve',
  }, auth);
  console.log(followup);

  const approvalReq = await approvalPromise;
  console.log('approval.request:', approvalReq);

  console.log('12. respond approval');
  const approvalResp = await postJson(`${HUB_BASE}/v1/approvals/${approvalReq.approval.approvalId}/respond`, {
    requestId: uuidv7(),
    response: 'allow_once',
  }, auth);
  console.log(approvalResp);

  console.log('13. token refresh');
  const refresh = await postJson(`${HUB_BASE}/v1/auth/refresh`, { refreshToken: claim.refreshToken });
  console.log({ hasNewAccessToken: !!refresh.accessToken, hasNewRefreshToken: !!refresh.refreshToken });

  console.log('14. logout');
  const logout = await postJson(`${HUB_BASE}/v1/auth/logout`, { refreshToken: refresh.refreshToken });
  console.log(logout);

  nodeWs.close();
  mobileWs.close();
  console.log('SMOKE PASSED');
}

main().catch((err) => {
  console.error('SMOKE FAILED', err);
  process.exit(1);
});
