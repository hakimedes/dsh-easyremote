import { describe, expect, it } from 'vitest';

import { DshApiBridge, DshApiBridgeError, toRemoteSessionSummary } from './dsh-api.js';

function ok<T>(value: T) {
  return { rpcId: 'rpc-test', result: { ok: true as const, value } };
}

describe('DshApiBridge', () => {
  it('returns the host agent preset roster without exposing the RPC envelope', async () => {
    const bridge = new DshApiBridge({
      agentPresets: {
        list: async () => ok({
          presets: [{ id: 'standard', trust: 'system', isDefault: true, name: 'Standard mode' }],
          authorable: false,
          hasDocument: true,
        }),
      },
    }, () => 'rpc-presets');

    await expect(bridge.listAgentPresets()).resolves.toEqual({
      presets: [{ id: 'standard', trust: 'system', isDefault: true, name: 'Standard mode' }],
    });
  });

  it('creates a session with the requested agent preset', async () => {
    let payload: Record<string, unknown> | undefined;
    const bridge = new DshApiBridge({
      sessions: {
        create: async (request: { payload: Record<string, unknown> }) => {
          payload = request.payload;
          return ok({ sessionId: 'session-1', agentPreset: 'code' });
        },
      },
    }, () => 'rpc-create');

    await expect(bridge.createSession({
      sessionId: 'session-1',
      cwd: '/workspace',
      agentPreset: 'code',
    })).resolves.toEqual({ sessionId: 'session-1', agentPreset: 'code' });
    expect(payload).toEqual({ sessionId: 'session-1', cwd: '/workspace', agentPreset: 'code' });
  });

  it('returns session model metadata and applies an exact model selection', async () => {
    let selectedPayload: Record<string, unknown> | undefined;
    const models = {
      current: { provider: 'deepseek', model: 'deepseek-chat' },
      routable: true,
      groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] }],
      failures: [],
    };
    const bridge = new DshApiBridge({
      sessions: {
        models: async () => ok(models),
        selectModel: async (request: { payload: Record<string, unknown> }) => {
          selectedPayload = request.payload;
          return ok({ selected: { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' } });
        },
      },
    }, () => 'rpc-model');

    await expect(bridge.sessionModels('session-1')).resolves.toEqual(models);
    await expect(bridge.selectModel({
      sessionId: 'session-1',
      provider: 'deepseek',
      model: 'deepseek-reasoner',
      reasoningEffort: 'high',
    })).resolves.toEqual({
      selected: { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' },
    });
    expect(selectedPayload).toEqual({
      sessionId: 'session-1',
      provider: 'deepseek',
      model: 'deepseek-reasoner',
      reasoningEffort: 'high',
    });
  });

  it('renames the native DSH session and returns the normalized title', async () => {
    let renamePayload: Record<string, unknown> | undefined;
    const bridge = new DshApiBridge({
      sessions: {
        rename: async (request: { payload: Record<string, unknown> }) => {
          renamePayload = request.payload;
          return ok({ title: '探索未至之境', seq: 9 });
        },
      },
    }, () => 'rpc-rename');

    await expect(bridge.renameSession('session-1', '  探索未至之境  ')).resolves.toEqual({
      title: '探索未至之境',
      seq: 9,
    });
    expect(renamePayload).toEqual({ sessionId: 'session-1', title: '  探索未至之境  ' });
  });

  it('preserves host error identity for the Remote protocol', async () => {
    const bridge = new DshApiBridge({
      sessions: {
        selectModel: async () => ({
          rpcId: 'rpc-error',
          result: {
            ok: false as const,
            error: { code: 'model-unavailable', message: 'Model is not routable', details: {} },
          },
        }),
      },
    }, () => 'rpc-error');

    await expect(bridge.selectModel({
      sessionId: 'session-1',
      provider: 'missing',
      model: 'missing',
    })).rejects.toMatchObject<DshApiBridgeError>({
      code: 'MODEL_UNAVAILABLE',
      message: 'Model is not routable',
    });
  });
});

describe('toRemoteSessionSummary', () => {
  it('publishes the session agent preset with the remote summary', () => {
    expect(toRemoteSessionSummary({
      header: {
        id: 'session-1',
        cwd: '/workspace/project-alpha',
        createdAt: 100,
        agentPreset: 'minimal',
      },
      events: [{ seq: 7, time: 250 }],
    }, 'Build mobile', 'running', 999)).toEqual({
      id: 'session-1',
      title: 'Build mobile',
      status: 'running',
      lastSourceSeq: 7,
      createdAt: 100,
      updatedAt: 250,
      cwdLabel: 'project-alpha',
      agentPreset: 'minimal',
    });
  });
});
