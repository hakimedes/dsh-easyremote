/// <reference types="vitest/globals" />

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { v7 as uuidv7 } from 'uuid';
import { createHash, randomBytes } from 'node:crypto';

function randomHex(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHub(baseUrl: string, timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error('Hub failed to start');
}

async function postJson(url: string, body: unknown, headers?: Record<string, string>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(text);
}

async function getJson(url: string, headers?: Record<string, string>) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(text);
}

function waitWs(ws: WebSocket, event: string) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`wait ${event} timeout`)), 5_000);
    ws.once(event, (...args: any[]) => {
      clearTimeout(timer);
      resolve(args);
    });
  });
}

function waitFrame(ws: WebSocket, kind: string) {
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`wait frame ${kind} timeout`)), 5_000);
    const handler = (raw: any) => {
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

let portCounter = 18787;

describe('DSH Hub P0 integration', () => {
  let hubProcess: ReturnType<typeof spawn>;
  let baseUrl: string;
  let wssUrl: string;
  let ownerToken: string;
  let dbPath: string;
  let entryFile: string;
  const port = portCounter++;

  beforeEach(async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dsh-hub-test-'));
    dbPath = join(tmpDir, 'hub.sqlite');
    entryFile = join(tmpDir, 'public-origin.json');
    writeFileSync(entryFile, JSON.stringify({ publicOrigin: 'https://dsh.example.com' }));
    baseUrl = `http://127.0.0.1:${port}`;
    wssUrl = `ws://127.0.0.1:${port}`;

    hubProcess = spawn(
      process.execPath,
      ['--import', 'tsx', 'src/index.ts'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PORT: String(port),
          DATABASE_PATH: dbPath,
          JWT_SECRET: 'test-test-test-test-test-test-test-test',
          HUB_ENTRY: 'https://fallback.example.com',
          HUB_ENTRY_FILE: entryFile,
          NODE_ENV: 'test',
        },
      },
    );

    hubProcess.stderr?.on('data', (data) => {
      console.error('[hub stderr]', data.toString());
    });

    await waitForHub(baseUrl);

    const initialPairing = await postJson(`${baseUrl}/v1/node-pairings`, {
      nodeName: 'Bootstrap Node',
      platform: 'darwin',
      arch: 'arm64',
      pluginVersion: '0.1.0',
      dshVersion: 'test',
      installId: uuidv7(),
      nodeSecretHash: sha256(randomHex(32)),
    });

    const initialClaim = await postJson(`${baseUrl}/v1/node-pairings/claim`, {
      pairToken: initialPairing.pairToken,
      ownerDisplayName: 'Test Owner',
      deviceName: 'Test Phone',
    });

    ownerToken = initialClaim.accessToken;
  });

  afterEach(() => {
    if (hubProcess && !hubProcess.killed) {
      hubProcess.kill('SIGTERM');
    }
  });

  async function createNode() {
    const nodeSecret = randomHex(32);
    const pairing = await postJson(`${baseUrl}/v1/node-pairings`, {
      nodeName: 'Test Node',
      platform: 'darwin',
      arch: 'arm64',
      pluginVersion: '0.1.0',
      dshVersion: 'test',
      installId: uuidv7(),
      nodeSecretHash: sha256(nodeSecret),
    });

    const claim = await postJson(`${baseUrl}/v1/node-pairings/claim`, {
      pairToken: pairing.pairToken,
      deviceName: 'Test Phone',
    }, { authorization: `Bearer ${ownerToken}` });

    return { nodeId: claim.nodeId, nodeSecret, accessToken: claim.accessToken };
  }

  it('healthz and readyz return ok', async () => {
    const health = await getJson(`${baseUrl}/healthz`);
    expect(health.ok).toBe(true);
    const ready = await getJson(`${baseUrl}/readyz`);
    expect(ready.ok).toBe(true);
  });

  it('exposes stable Hub metadata and resolves the QR origin from the live entry file', async () => {
    const firstMeta = await getJson(`${baseUrl}/v1/meta`);
    expect(firstMeta).toMatchObject({
      version: expect.any(String),
      publicOrigin: 'https://dsh.example.com',
    });
    expect(firstMeta.hubId).toMatch(/^[0-9a-f-]{36}$/i);

    const pairing = await postJson(`${baseUrl}/v1/node-pairings`, {
      nodeName: 'Dynamic Origin Node',
      platform: 'darwin',
      arch: 'arm64',
      pluginVersion: '0.2.0',
      dshVersion: 'test',
      installId: uuidv7(),
      nodeSecretHash: sha256(randomHex(32)),
    });
    const pairingUrl = new URL(pairing.qrPayload);
    expect(pairingUrl.searchParams.get('server')).toBe('https://dsh.example.com');
    expect(pairingUrl.searchParams.get('hubId')).toBe(firstMeta.hubId);

    writeFileSync(entryFile, 'https://next.trycloudflare.com\n');
    const updatedMeta = await getJson(`${baseUrl}/v1/meta`);
    expect(updatedMeta).toEqual({
      ...firstMeta,
      publicOrigin: 'https://next.trycloudflare.com',
    });

    const updatedPairing = await postJson(`${baseUrl}/v1/node-pairings`, {
      nodeName: 'Updated Origin Node',
      platform: 'darwin',
      arch: 'arm64',
      pluginVersion: '0.2.0',
      dshVersion: 'test',
      installId: uuidv7(),
      nodeSecretHash: sha256(randomHex(32)),
    });
    const updatedPairingUrl = new URL(updatedPairing.qrPayload);
    expect(updatedPairingUrl.searchParams.get('server')).toBe('https://next.trycloudflare.com');
    expect(updatedPairingUrl.searchParams.get('hubId')).toBe(firstMeta.hubId);
  });

  it('first-owner pairing claim creates user and node', async () => {
    const { nodeId, accessToken } = await createNode();

    const me = await getJson(`${baseUrl}/v1/me`, { authorization: `Bearer ${accessToken}` });
    expect(me.user.displayName).toBe('Test Owner');

    const nodes = await getJson(`${baseUrl}/v1/nodes`, { authorization: `Bearer ${accessToken}` });
    expect(nodes.items.some((n: any) => n.id === nodeId)).toBe(true);
  });

  it('lets an authenticated node issue a one-time QR that restores mobile access', async () => {
    const { nodeId, nodeSecret, accessToken } = await createNode();
    const before = await getJson(`${baseUrl}/v1/nodes`, {
      authorization: `Bearer ${accessToken}`,
    });

    const staleRecovery = await postJson(`${baseUrl}/v1/node-pairings/recover`, {}, {
      authorization: `Node ${nodeId}.${nodeSecret}`,
    });
    const recovery = await postJson(`${baseUrl}/v1/node-pairings/recover`, {}, {
      authorization: `Node ${nodeId}.${nodeSecret}`,
    });
    const staleClaim = await fetch(`${baseUrl}/v1/node-pairings/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pairToken: staleRecovery.pairToken, deviceName: 'Stale Android phone' }),
    });
    expect(staleClaim.status).toBe(410);
    await expect(staleClaim.json()).resolves.toMatchObject({ code: 'PAIR_TOKEN_EXPIRED' });

    const restored = await postJson(`${baseUrl}/v1/node-pairings/claim`, {
      pairToken: recovery.pairToken,
      deviceName: 'Restored Android phone',
    });

    expect(restored.nodeId).toBe(nodeId);
    const me = await getJson(`${baseUrl}/v1/me`, {
      authorization: `Bearer ${restored.accessToken}`,
    });
    expect(me.user.displayName).toBe('Test Owner');
    const after = await getJson(`${baseUrl}/v1/nodes`, {
      authorization: `Bearer ${restored.accessToken}`,
    });
    expect(after.items).toHaveLength(before.items.length);
    expect(after.items.some((node: any) => node.id === nodeId)).toBe(true);
  });

  it('node can connect, receive hello ack, and refresh its runtime metadata', async () => {
    const { nodeId, nodeSecret, accessToken } = await createNode();

    const ws = new WebSocket(`${wssUrl}/v1/node/connect`, {
      headers: { authorization: `Node ${nodeId}.${nodeSecret}` },
    });
    await waitWs(ws, 'open');
    ws.send(JSON.stringify({
      v: 1,
      kind: 'node.hello',
      protocolMin: 1,
      protocolMax: 1,
      node: {
        id: nodeId,
        name: 'Node WSS',
        platform: 'darwin',
        arch: 'arm64',
        pluginVersion: '0.1.2',
        dshVersion: '0.1.0-rc.6',
      },
      capabilities: ['session.list', 'session.snapshot', 'session.create', 'session.followup', 'session.steer', 'session.stop', 'session.events', 'approval.respond'],
    }));
    const ack = await waitFrame(ws, 'node.hello.ack');
    expect(ack.nodeId).toBe(nodeId);
    const roster = await getJson(`${baseUrl}/v1/nodes`, { authorization: `Bearer ${accessToken}` });
    expect(roster.items.find((node: any) => node.id === nodeId)).toMatchObject({
      pluginVersion: '0.1.2',
      dshVersion: '0.1.0-rc.6',
      online: true,
    });
    ws.close();
  });

  it('mobile can subscribe and receive session events', async () => {
    const { nodeId, nodeSecret, accessToken } = await createNode();

    const nodeWs = new WebSocket(`${wssUrl}/v1/node/connect`, {
      headers: { authorization: `Node ${nodeId}.${nodeSecret}` },
    });
    await waitWs(nodeWs, 'open');
    nodeWs.send(JSON.stringify({
      v: 1,
      kind: 'node.hello',
      protocolMin: 1,
      protocolMax: 1,
      node: { id: nodeId, name: 'Event Node', platform: 'darwin', arch: 'arm64', pluginVersion: '0.1.0', dshVersion: 'test' },
      capabilities: ['session.list', 'session.snapshot', 'session.create', 'session.followup', 'session.steer', 'session.stop', 'session.events', 'approval.respond'],
    }));
    await waitFrame(nodeWs, 'node.hello.ack');

    const mobileWs = new WebSocket(`${wssUrl}/v1/realtime`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    await waitWs(mobileWs, 'open');

    const sessionId = uuidv7();
    mobileWs.send(JSON.stringify({
      v: 1,
      kind: 'subscribe',
      requestId: uuidv7(),
      nodeId,
      sessionId,
    }));
    const subOk = await waitFrame(mobileWs, 'subscribe.ok');
    expect(subOk.sessionId).toBe(sessionId);

    nodeWs.send(JSON.stringify({
      v: 1,
      kind: 'session.event',
      nodeId,
      sessionId,
      sourceSeq: 0,
      event: { type: 'assistant.delta', data: { text: 'hi' } },
    }));
    const evt = await waitFrame(mobileWs, 'session.event');
    expect(evt.event.type).toBe('assistant.delta');

    const syncPromise = waitFrame(mobileWs, 'session.sync');
    mobileWs.send(JSON.stringify({
      v: 1,
      kind: 'session.sync',
      requestId: uuidv7(),
      nodeId,
      sessionId,
      afterSourceSeq: -1,
    }));
    const sync = await syncPromise;
    expect(sync.events).toEqual([
      expect.objectContaining({ sourceSeq: 0, event: { type: 'assistant.delta', data: { text: 'hi' } } }),
    ]);

    nodeWs.close();
    mobileWs.close();
  });

  it('rejects invalid requestId format', async () => {
    const { nodeId, accessToken } = await createNode();

    const res = await fetch(`${baseUrl}/v1/nodes/${nodeId}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ requestId: 'not-a-uuid' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_REQUEST');
  });

  it('returns the session id created by the node', async () => {
    const { nodeId, nodeSecret, accessToken } = await createNode();
    const nodeWs = new WebSocket(`${wssUrl}/v1/node/connect`, {
      headers: { authorization: `Node ${nodeId}.${nodeSecret}` },
    });
    await waitWs(nodeWs, 'open');
    nodeWs.send(JSON.stringify({
      v: 1,
      kind: 'node.hello',
      protocolMin: 1,
      protocolMax: 1,
      node: { id: nodeId, name: 'Create Node', platform: 'darwin', arch: 'arm64', pluginVersion: '0.1.0', dshVersion: 'test' },
      capabilities: ['session.create'],
    }));
    await waitFrame(nodeWs, 'node.hello.ack');

    nodeWs.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.kind !== 'command' || message.action !== 'session.create') return;
      nodeWs.send(JSON.stringify({
        v: 1, kind: 'command.ack', commandId: message.commandId, requestId: message.requestId, status: 'acked',
      }));
      nodeWs.send(JSON.stringify({
        v: 1,
        kind: 'command.result',
        commandId: message.commandId,
        requestId: message.requestId,
        ok: true,
        result: {
          session: {
            id: 'dsh-session-created-by-node',
            title: 'Node-created session',
            status: 'idle',
            lastSourceSeq: 0,
            createdAt: 1787300000000,
            updatedAt: 1787300000000,
          },
        },
      }));
    });

    const created = await postJson(`${baseUrl}/v1/nodes/${nodeId}/sessions`, {
      requestId: uuidv7(),
    }, { authorization: `Bearer ${accessToken}` });

    expect(created.sessionId).toBe('dsh-session-created-by-node');
    nodeWs.close();
  });

  it('returns the original create result when a requestId is retried', async () => {
    const { nodeId, nodeSecret, accessToken } = await createNode();
    const nodeWs = new WebSocket(`${wssUrl}/v1/node/connect`, {
      headers: { authorization: `Node ${nodeId}.${nodeSecret}` },
    });
    await waitWs(nodeWs, 'open');
    nodeWs.send(JSON.stringify({
      v: 1,
      kind: 'node.hello',
      protocolMin: 1,
      protocolMax: 1,
      node: { id: nodeId, name: 'Idempotent Node', platform: 'darwin', arch: 'arm64', pluginVersion: '0.1.0', dshVersion: 'test' },
      capabilities: ['session.create'],
    }));
    await waitFrame(nodeWs, 'node.hello.ack');

    let commandCount = 0;
    nodeWs.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.kind !== 'command' || message.action !== 'session.create') return;
      commandCount += 1;
      nodeWs.send(JSON.stringify({
        v: 1, kind: 'command.ack', commandId: message.commandId, requestId: message.requestId, status: 'acked',
      }));
      nodeWs.send(JSON.stringify({
        v: 1,
        kind: 'command.result',
        commandId: message.commandId,
        requestId: message.requestId,
        ok: true,
        result: { session: { id: 'stable-session-id', title: 'Stable', status: 'idle' } },
      }));
    });

    const requestId = uuidv7();
    const first = await postJson(`${baseUrl}/v1/nodes/${nodeId}/sessions`, { requestId }, {
      authorization: `Bearer ${accessToken}`,
    });
    const retry = await postJson(`${baseUrl}/v1/nodes/${nodeId}/sessions`, { requestId }, {
      authorization: `Bearer ${accessToken}`,
    });

    expect(first.sessionId).toBe('stable-session-id');
    expect(retry).toMatchObject({
      commandId: first.commandId,
      sessionId: 'stable-session-id',
      requestId,
    });
    expect(commandCount).toBe(1);
    nodeWs.close();
  });

  it('returns agent presets and forwards the selected preset when creating a session', async () => {
    const { nodeId, nodeSecret, accessToken } = await createNode();
    const nodeWs = new WebSocket(`${wssUrl}/v1/node/connect`, {
      headers: { authorization: `Node ${nodeId}.${nodeSecret}` },
    });
    await waitWs(nodeWs, 'open');
    nodeWs.send(JSON.stringify({
      v: 1,
      kind: 'node.hello',
      protocolMin: 1,
      protocolMax: 1,
      node: { id: nodeId, name: 'Preset Node', platform: 'darwin', arch: 'arm64', pluginVersion: '0.2.0', dshVersion: 'test' },
      capabilities: ['agentPreset.list', 'session.create'],
    }));
    await waitFrame(nodeWs, 'node.hello.ack');

    let createPayload: Record<string, unknown> | undefined;
    nodeWs.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.kind !== 'command') return;
      nodeWs.send(JSON.stringify({
        v: 1, kind: 'command.ack', commandId: message.commandId, requestId: message.requestId, status: 'acked',
      }));
      if (message.action === 'agentPreset.list') {
        nodeWs.send(JSON.stringify({
          v: 1,
          kind: 'command.result',
          commandId: message.commandId,
          requestId: message.requestId,
          ok: true,
          result: {
            presets: [
              { id: 'standard', trust: 'system', isDefault: true, name: 'Standard mode' },
              { id: 'code', trust: 'system', isDefault: false, name: 'PTC mode' },
            ],
          },
        }));
      }
      if (message.action === 'session.create') {
        createPayload = message.payload;
        nodeWs.send(JSON.stringify({
          v: 1,
          kind: 'command.result',
          commandId: message.commandId,
          requestId: message.requestId,
          ok: true,
          result: {
            session: {
              id: 'preset-session',
              title: 'New Session',
              status: 'idle',
              agentPreset: 'code',
              createdAt: 100,
              updatedAt: 100,
            },
          },
        }));
      }
    });

    const roster = await getJson(`${baseUrl}/v1/nodes/${nodeId}/agent-presets`, {
      authorization: `Bearer ${accessToken}`,
    });
    expect(roster.presets).toEqual([
      { id: 'standard', trust: 'system', isDefault: true, name: 'Standard mode' },
      { id: 'code', trust: 'system', isDefault: false, name: 'PTC mode' },
    ]);

    const created = await postJson(`${baseUrl}/v1/nodes/${nodeId}/sessions`, {
      requestId: uuidv7(),
      agentPreset: 'code',
    }, { authorization: `Bearer ${accessToken}` });
    expect(created).toMatchObject({ sessionId: 'preset-session', agentPreset: 'code' });
    expect(createPayload).toEqual({ createdBy: 'mobile', agentPreset: 'code' });
    nodeWs.close();
  });

  it('returns the session model catalog and forwards an exact model selection', async () => {
    const { nodeId, nodeSecret, accessToken } = await createNode();
    const nodeWs = new WebSocket(`${wssUrl}/v1/node/connect`, {
      headers: { authorization: `Node ${nodeId}.${nodeSecret}` },
    });
    await waitWs(nodeWs, 'open');
    nodeWs.send(JSON.stringify({
      v: 1,
      kind: 'node.hello',
      protocolMin: 1,
      protocolMax: 1,
      node: { id: nodeId, name: 'Model Node', platform: 'darwin', arch: 'arm64', pluginVersion: '0.2.0', dshVersion: 'test' },
      capabilities: ['session.models', 'session.selectModel'],
    }));
    await waitFrame(nodeWs, 'node.hello.ack');

    const sessionId = 'session-models';
    let selectPayload: Record<string, unknown> | undefined;
    nodeWs.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.kind !== 'command') return;
      nodeWs.send(JSON.stringify({
        v: 1, kind: 'command.ack', commandId: message.commandId, requestId: message.requestId, status: 'acked',
      }));
      if (message.action === 'session.models') {
        nodeWs.send(JSON.stringify({
          v: 1,
          kind: 'command.result',
          commandId: message.commandId,
          requestId: message.requestId,
          ok: true,
          result: {
            current: { provider: 'deepseek', model: 'deepseek-chat' },
            routable: true,
            groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] }],
            failures: [],
          },
        }));
      }
      if (message.action === 'session.selectModel') {
        selectPayload = message.payload;
        nodeWs.send(JSON.stringify({
          v: 1,
          kind: 'command.result',
          commandId: message.commandId,
          requestId: message.requestId,
          ok: true,
          result: { selected: message.payload },
        }));
      }
    });

    const catalog = await getJson(`${baseUrl}/v1/nodes/${nodeId}/sessions/${sessionId}/models`, {
      authorization: `Bearer ${accessToken}`,
    });
    expect(catalog).toMatchObject({
      current: { provider: 'deepseek', model: 'deepseek-chat' },
      routable: true,
    });

    const requestId = uuidv7();
    const selected = await postJson(`${baseUrl}/v1/nodes/${nodeId}/sessions/${sessionId}/model-selection`, {
      requestId,
      provider: 'deepseek',
      model: 'deepseek-reasoner',
      reasoningEffort: 'high',
    }, { authorization: `Bearer ${accessToken}` });
    expect(selected.selected).toEqual({
      provider: 'deepseek',
      model: 'deepseek-reasoner',
      reasoningEffort: 'high',
    });
    expect(selectPayload).toEqual({
      provider: 'deepseek',
      model: 'deepseek-reasoner',
      reasoningEffort: 'high',
    });
    nodeWs.close();
  });

  it('forwards a user session rename and returns the native normalized title', async () => {
    const { nodeId, nodeSecret, accessToken } = await createNode();
    const nodeWs = new WebSocket(`${wssUrl}/v1/node/connect`, {
      headers: { authorization: `Node ${nodeId}.${nodeSecret}` },
    });
    await waitWs(nodeWs, 'open');
    nodeWs.send(JSON.stringify({
      v: 1,
      kind: 'node.hello',
      protocolMin: 1,
      protocolMax: 1,
      node: { id: nodeId, name: 'Rename Node', platform: 'darwin', arch: 'arm64', pluginVersion: '0.1.2', dshVersion: 'test' },
      capabilities: ['session.rename'],
    }));
    await waitFrame(nodeWs, 'node.hello.ack');

    let renamePayload: Record<string, unknown> | undefined;
    nodeWs.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.kind !== 'command' || message.action !== 'session.rename') return;
      renamePayload = message.payload;
      nodeWs.send(JSON.stringify({
        v: 1, kind: 'command.ack', commandId: message.commandId, requestId: message.requestId, status: 'acked',
      }));
      nodeWs.send(JSON.stringify({
        v: 1,
        kind: 'command.result',
        commandId: message.commandId,
        requestId: message.requestId,
        ok: true,
        result: { title: '深海探索计划', seq: 12 },
      }));
    });

    const renamed = await fetch(`${baseUrl}/v1/nodes/${nodeId}/sessions/session-rename`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ requestId: uuidv7(), title: '  深海探索计划  ' }),
    });
    expect(renamed.status).toBe(200);
    await expect(renamed.json()).resolves.toEqual({ title: '深海探索计划', seq: 12 });
    expect(renamePayload).toEqual({ title: '  深海探索计划  ' });
    nodeWs.close();
  });

  it('preserves node session status and workspace label in session lists', async () => {
    const { nodeId, nodeSecret, accessToken } = await createNode();
    const nodeWs = new WebSocket(`${wssUrl}/v1/node/connect`, {
      headers: { authorization: `Node ${nodeId}.${nodeSecret}` },
    });
    await waitWs(nodeWs, 'open');
    nodeWs.send(JSON.stringify({
      v: 1,
      kind: 'node.hello',
      protocolMin: 1,
      protocolMax: 1,
      node: { id: nodeId, name: 'List Node', platform: 'darwin', arch: 'arm64', pluginVersion: '0.1.0', dshVersion: 'test' },
      capabilities: ['session.list'],
    }));
    await waitFrame(nodeWs, 'node.hello.ack');

    nodeWs.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.kind !== 'command' || message.action !== 'session.list') return;
      nodeWs.send(JSON.stringify({
        v: 1, kind: 'command.ack', commandId: message.commandId, requestId: message.requestId, status: 'acked',
      }));
      nodeWs.send(JSON.stringify({
        v: 1,
        kind: 'command.result',
        commandId: message.commandId,
        requestId: message.requestId,
        ok: true,
        result: {
          sessions: [{
            id: 'dsh-running-session',
            title: 'Running in DSH',
            status: 'running',
            cwdLabel: 'workspace-alpha',
            lastSourceSeq: 7,
            createdAt: 1787300000000,
            updatedAt: 1787300001000,
          }],
        },
      }));
    });

    const listed = await getJson(`${baseUrl}/v1/nodes/${nodeId}/sessions`, {
      authorization: `Bearer ${accessToken}`,
    });

    expect(listed.sessions[0]).toMatchObject({
      sessionId: 'dsh-running-session',
      status: 'running',
      workspaceLabel: 'workspace-alpha',
    });
    nodeWs.close();
  });

  it('node snapshot is dispatched when node is online', async () => {
    const { nodeId, nodeSecret, accessToken } = await createNode();

    const nodeWs = new WebSocket(`${wssUrl}/v1/node/connect`, {
      headers: { authorization: `Node ${nodeId}.${nodeSecret}` },
    });
    await waitWs(nodeWs, 'open');
    nodeWs.send(JSON.stringify({
      v: 1,
      kind: 'node.hello',
      protocolMin: 1,
      protocolMax: 1,
      node: { id: nodeId, name: 'Snapshot Node', platform: 'darwin', arch: 'arm64', pluginVersion: '0.1.0', dshVersion: 'test' },
      capabilities: ['session.list', 'session.snapshot', 'session.create', 'session.followup', 'session.steer', 'session.stop', 'session.events', 'approval.respond'],
    }));
    await waitFrame(nodeWs, 'node.hello.ack');

    const sessionId = uuidv7();
    nodeWs.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.kind === 'command' && msg.action === 'session.snapshot') {
          nodeWs.send(JSON.stringify({
            v: 1, kind: 'command.ack', commandId: msg.commandId, requestId: msg.requestId, status: 'acked',
          }));
          nodeWs.send(JSON.stringify({
            v: 1, kind: 'command.result', commandId: msg.commandId, requestId: msg.requestId,
            ok: true, result: {
              session: { id: sessionId, title: 'Snapshot Session', lastSourceSeq: 0, createdAt: Date.now(), updatedAt: Date.now() },
              events: [{ sourceSeq: 1, event: { type: 'assistant.message', data: { text: 'from node' } } }],
            },
          }));
        }
      } catch {}
    });

    const snapshot = await getJson(`${baseUrl}/v1/nodes/${nodeId}/sessions/${sessionId}/snapshot`, { authorization: `Bearer ${accessToken}` });
    expect(snapshot.source).toBe('node');
    expect(snapshot.session.title).toBe('Snapshot Session');

    const reader = new DatabaseSync(dbPath, { readOnly: true });
    const persisted = reader
      .prepare("SELECT result_json FROM commands WHERE action = 'session.snapshot' ORDER BY created_at DESC LIMIT 1")
      .get() as { result_json: string | null } | undefined;
    reader.close();
    expect(persisted?.result_json).toBeNull();

    nodeWs.close();
  });

  it('requires requestId for approval responses and treats a retry as success', async () => {
    const { nodeId, nodeSecret, accessToken } = await createNode();
    const nodeWs = new WebSocket(`${wssUrl}/v1/node/connect`, {
      headers: { authorization: `Node ${nodeId}.${nodeSecret}` },
    });
    await waitWs(nodeWs, 'open');
    nodeWs.send(JSON.stringify({
      v: 1,
      kind: 'node.hello',
      protocolMin: 1,
      protocolMax: 1,
      node: { id: nodeId, name: 'Approval Node', platform: 'darwin', arch: 'arm64', pluginVersion: '0.1.0', dshVersion: 'test' },
      capabilities: ['approval.respond'],
    }));
    await waitFrame(nodeWs, 'node.hello.ack');

    const approvalId = uuidv7();
    const sessionId = uuidv7();
    nodeWs.send(JSON.stringify({
      v: 1,
      kind: 'approval.request',
      approval: {
        approvalId,
        nodeId,
        sessionId,
        toolCallId: `tool-${uuidv7()}`,
        title: 'Run tests',
        summary: 'pnpm test',
        risk: 'medium',
        expiresAt: Date.now() + 60_000,
      },
    }));
    await sleep(50);

    const missingRequestId = await fetch(`${baseUrl}/v1/approvals/${approvalId}/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ response: 'allow_once' }),
    });
    expect(missingRequestId.status).toBe(400);

    let responseCommandCount = 0;
    nodeWs.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.kind !== 'command' || message.action !== 'approval.respond') return;
      responseCommandCount += 1;
      nodeWs.send(JSON.stringify({
        v: 1, kind: 'command.ack', commandId: message.commandId, requestId: message.requestId, status: 'acked',
      }));
      nodeWs.send(JSON.stringify({
        v: 1, kind: 'command.result', commandId: message.commandId, requestId: message.requestId, ok: true, result: { accepted: true },
      }));
    });

    const requestId = uuidv7();
    const first = await postJson(`${baseUrl}/v1/approvals/${approvalId}/respond`, {
      requestId,
      response: 'allow_once',
    }, { authorization: `Bearer ${accessToken}` });
    const retry = await postJson(`${baseUrl}/v1/approvals/${approvalId}/respond`, {
      requestId,
      response: 'allow_once',
    }, { authorization: `Bearer ${accessToken}` });

    expect(first).toMatchObject({ ok: true, approvalId, status: 'approved', requestId });
    expect(retry).toMatchObject({ ok: true, approvalId, status: 'approved', requestId, duplicate: true });
    expect(responseCommandCount).toBe(1);
    nodeWs.close();
  });

  it('replays pending approvals when mobile subscribes after the request', async () => {
    const { nodeId, nodeSecret, accessToken } = await createNode();
    const nodeWs = new WebSocket(`${wssUrl}/v1/node/connect`, {
      headers: { authorization: `Node ${nodeId}.${nodeSecret}` },
    });
    await waitWs(nodeWs, 'open');
    nodeWs.send(JSON.stringify({
      v: 1,
      kind: 'node.hello',
      protocolMin: 1,
      protocolMax: 1,
      node: { id: nodeId, name: 'Approval Replay Node', platform: 'darwin', arch: 'arm64', pluginVersion: '0.1.0', dshVersion: 'test' },
      capabilities: ['approval.respond'],
    }));
    await waitFrame(nodeWs, 'node.hello.ack');

    const approvalId = uuidv7();
    const sessionId = uuidv7();
    nodeWs.send(JSON.stringify({
      v: 1,
      kind: 'approval.request',
      approval: {
        approvalId,
        nodeId,
        sessionId,
        toolCallId: `tool-${uuidv7()}`,
        title: 'Late approval',
        summary: 'run after reconnect',
        risk: 'medium',
        expiresAt: Date.now() + 60_000,
      },
    }));
    await sleep(50);

    const mobileWs = new WebSocket(`${wssUrl}/v1/realtime`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    await waitWs(mobileWs, 'open');
    const approvalPromise = waitFrame(mobileWs, 'approval.request');
    mobileWs.send(JSON.stringify({
      v: 1,
      kind: 'subscribe',
      requestId: uuidv7(),
      nodeId,
      sessionId,
    }));

    const replayed = await approvalPromise;
    expect(replayed.approval).toMatchObject({ approvalId, title: 'Late approval' });
    nodeWs.close();
    mobileWs.close();
  });
});
