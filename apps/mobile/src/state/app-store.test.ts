import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionSummary, SessionView } from '../domain/types';

vi.mock('react-native', () => ({
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  Platform: { OS: 'android' },
}));

vi.mock('../config', () => ({ APP_VERSION: 'test', HUB_HTTP_URL: 'https://dsh.example.com' }));

vi.mock('../api/client', () => ({
  apiClient: {
    accessToken: null,
    hydrate: vi.fn(),
    refresh: vi.fn(),
    getMe: vi.fn(),
    listNodes: vi.fn(),
    listSessions: vi.fn(async () => []),
    getAgentPresets: vi.fn(),
    createSession: vi.fn(),
    getSessionModels: vi.fn(),
    selectSessionModel: vi.fn(),
    renameSession: vi.fn(),
    followup: vi.fn(async () => ({ ok: true })),
    getSnapshot: vi.fn(),
  },
}));

vi.mock('../api/realtime', () => ({
  RealtimeClient: class {
    setHandlers() {}
    updateServer() {}
    connect() {}
    disconnect() {}
    subscribe() {}
    sync() {}
  },
}));

vi.mock('../storage/secure', () => ({ readHubBinding: vi.fn(async () => null) }));

vi.mock('../storage/database', () => ({
  cacheNodes: vi.fn(),
  cacheSessionView: vi.fn(),
  cacheSessions: vi.fn(),
  cacheUser: vi.fn(),
  readCachedNodes: vi.fn(() => []),
  readCachedSessionView: vi.fn(() => null),
  readCachedSessions: vi.fn(() => []),
  readCachedUser: vi.fn(() => null),
}));

import { useAppStore } from './app-store';
import { apiClient } from '../api/client';
import { readHubBinding } from '../storage/secure';

const summary: SessionSummary = {
  nodeId: 'node-1',
  sessionId: 'session-1',
  title: 'Canonical sequence test',
  status: 'idle',
  lastEventSeq: 4,
  createdAt: 1,
  updatedAt: 1,
};

const view: SessionView = {
  session: summary,
  messages: [],
  lastSourceSeq: 4,
  isRunning: false,
  isOfflineSnapshot: false,
  pendingSteer: false,
};

describe('bootstrap', () => {
  beforeEach(() => {
    useAppStore.setState({
      bootstrapped: false,
      isAuthenticated: false,
      user: null,
      nodes: [],
      cloudAvailable: true,
    });
    vi.mocked(readHubBinding).mockResolvedValue({
      schemaVersion: 1,
      server: 'https://restored.example',
      hubId: '9afef32a-0c8b-4a7b-91ab-40d866e2cb45',
      refreshToken: 'stored-refresh-token',
    });
    vi.mocked(apiClient.refresh).mockRejectedValue(new TypeError('Network request failed'));
  });

  it('keeps the paired phone in offline mode when refresh is blocked by a transient network error', async () => {
    await useAppStore.getState().bootstrap();

    expect(apiClient.hydrate).toHaveBeenCalledWith({
      schemaVersion: 1,
      server: 'https://restored.example',
      hubId: '9afef32a-0c8b-4a7b-91ab-40d866e2cb45',
      refreshToken: 'stored-refresh-token',
    });
    expect(useAppStore.getState()).toMatchObject({
      bootstrapped: true,
      isAuthenticated: true,
      cloudAvailable: false,
    });
  });
});

describe('cloud availability', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAppStore.setState({ cloudAvailable: true, errorMessage: null, nodes: [], realtimeStatus: 'offline' });
    vi.mocked(apiClient.listNodes).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not report the network unavailable after one transient request failure', async () => {
    vi.mocked(apiClient.listNodes).mockRejectedValueOnce(new TypeError('Network request failed'));

    await expect(useAppStore.getState().refreshNodes()).rejects.toThrow('Network request failed');
    expect(useAppStore.getState().cloudAvailable).toBe(true);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(useAppStore.getState().cloudAvailable).toBe(false);
  });

  it('cancels a pending offline transition when the next request succeeds', async () => {
    vi.mocked(apiClient.listNodes)
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce([]);

    await expect(useAppStore.getState().refreshNodes()).rejects.toThrow('Network request failed');
    await useAppStore.getState().refreshNodes();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(useAppStore.getState().cloudAvailable).toBe(true);
  });

  it('keeps the Hub available while the realtime channel is connected', async () => {
    useAppStore.setState({ realtimeStatus: 'connected' });
    vi.mocked(apiClient.listNodes).mockRejectedValueOnce(new TypeError('Network request failed'));

    await expect(useAppStore.getState().refreshNodes()).rejects.toThrow('Network request failed');
    await vi.advanceTimersByTimeAsync(5_000);

    expect(useAppStore.getState().cloudAvailable).toBe(true);
  });
});

describe('sendFollowup', () => {
  beforeEach(() => {
    useAppStore.setState({ sessionViews: { 'node-1:session-1': view } });
  });

  it('does not advance the canonical DSH source sequence optimistically', async () => {
    await useAppStore.getState().sendFollowup('node-1', 'session-1', 'continue');

    const current = useAppStore.getState().sessionViews['node-1:session-1'];
    expect(current?.lastSourceSeq).toBe(4);
    expect(current?.messages).toEqual([]);
  });
});

describe('session title events', () => {
  it('updates the open conversation and matching history row', () => {
    useAppStore.setState({
      sessionsByNode: { 'node-1': [summary] },
      sessionViews: { 'node-1:session-1': view },
    });

    useAppStore.getState().receiveEvents([{
      v: 1,
      kind: 'session.event',
      nodeId: 'node-1',
      sessionId: 'session-1',
      sourceSeq: 5,
      event: { type: 'session.title', data: { title: '深海探索计划' } },
    }]);

    expect(useAppStore.getState().sessionViews['node-1:session-1']?.session.title).toBe('深海探索计划');
    expect(useAppStore.getState().sessionsByNode['node-1']?.[0]?.title).toBe('深海探索计划');
  });
});

describe('openSession', () => {
  it('hydrates transcript events even when snapshot metadata contains the latest source sequence', async () => {
    vi.mocked(apiClient.getSnapshot).mockResolvedValue({
      source: 'node',
      session: {
        id: 'session-1',
        title: 'Existing session',
        status: 'idle',
        lastSourceSeq: 3,
        createdAt: 1,
        updatedAt: 2,
        agentPreset: 'minimal',
      },
      events: [
        { sourceSeq: 1, event: { type: 'user.message', data: { text: 'hello' } } },
        { sourceSeq: 2, event: { type: 'assistant.message', data: { text: 'world' } } },
        { sourceSeq: 3, event: { type: 'turn.end', data: {} } },
      ],
    });
    useAppStore.setState({ sessionsByNode: { 'node-1': [summary] }, sessionViews: {} });

    await useAppStore.getState().openSession('node-1', 'session-1');

    const current = useAppStore.getState().sessionViews['node-1:session-1'];
    expect(current?.messages.map((message) => message.text)).toEqual(['hello', 'world']);
    expect(current?.lastSourceSeq).toBe(3);
    expect(current?.session.agentPreset).toBe('minimal');
  });
});

describe('session configuration', () => {
  beforeEach(() => {
    useAppStore.setState({
      sessionsByNode: {},
      agentPresetsByNode: {},
      sessionModels: {},
      errorMessage: null,
    });
  });

  it('loads the node roster and forwards the selected preset when creating a session', async () => {
    vi.mocked(apiClient.getAgentPresets).mockResolvedValue([
      { id: 'standard', trust: 'system', isDefault: true },
      { id: 'code', trust: 'system', isDefault: false },
    ]);
    vi.mocked(apiClient.createSession).mockResolvedValue({
      commandId: 'command-1',
      sessionId: 'session-code',
      requestId: 'request-1',
      agentPreset: 'code',
    });

    await useAppStore.getState().loadAgentPresets('node-1');
    const sessionId = await useAppStore.getState().createSession('node-1', 'code');

    expect(useAppStore.getState().agentPresetsByNode['node-1']?.map((preset) => preset.id)).toEqual(['standard', 'code']);
    expect(apiClient.createSession).toHaveBeenCalledWith('node-1', 'code');
    expect(sessionId).toBe('session-code');
  });

  it('updates model state only after the Hub confirms the selection', async () => {
    vi.mocked(apiClient.getSessionModels).mockResolvedValue({
      current: { provider: 'deepseek', model: 'deepseek-chat' },
      routable: true,
      groups: [],
      failures: [],
    });
    vi.mocked(apiClient.selectSessionModel).mockResolvedValue({
      selected: { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' },
    });

    await useAppStore.getState().loadSessionModels('node-1', 'session-1');
    await useAppStore.getState().selectSessionModel('node-1', 'session-1', {
      provider: 'deepseek',
      model: 'deepseek-reasoner',
      reasoningEffort: 'high',
    });

    expect(useAppStore.getState().sessionModels['node-1:session-1']?.current).toEqual({
      provider: 'deepseek',
      model: 'deepseek-reasoner',
      reasoningEffort: 'high',
    });
  });
});
