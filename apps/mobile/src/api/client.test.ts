import { beforeEach, describe, expect, it, vi } from 'vitest';

const secure = vi.hoisted(() => ({
  clearHubBinding: vi.fn(async () => undefined),
  writeHubBinding: vi.fn(async () => undefined),
}));

vi.mock('../config', () => ({
  APP_VERSION: 'test',
  HUB_HTTP_URL: 'https://dsh.example.com',
  apiUrl: (path: string, server = 'https://dsh.example.com') => `${server}${path}`,
}));

vi.mock('../storage/secure', () => secure);

import { ApiClient } from './client';

describe('ApiClient refresh credentials', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    secure.clearHubBinding.mockClear();
    secure.writeHubBinding.mockClear();
  });

  it('preserves the refresh credential when the network is temporarily unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Network request failed');
    }));
    const client = new ApiClient();
    client.hydrate({ schemaVersion: 1, server: 'https://dsh.example.com', refreshToken: 'stored-refresh-token' });

    await expect(client.refresh()).rejects.toThrow('Network request failed');

    expect(secure.clearHubBinding).not.toHaveBeenCalled();
  });

  it('clears the refresh credential when the Hub explicitly rejects it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 'UNAUTHORIZED',
      message: 'Refresh token revoked',
    }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })));
    const client = new ApiClient();
    client.hydrate({ schemaVersion: 1, server: 'https://dsh.example.com', refreshToken: 'revoked-refresh-token' });

    await expect(client.refresh()).resolves.toBeNull();

    expect(secure.clearHubBinding).toHaveBeenCalledOnce();
  });

  it('persists the complete Hub binding after pairing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      refreshExpiresAt: 123,
      expiresIn: 900,
      nodeId: 'node-1',
      tokenType: 'Bearer',
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const client = new ApiClient();
    const hubId = '9afef32a-0c8b-4a7b-91ab-40d866e2cb45';

    await client.claimPairing({
      server: 'https://my-hub.example',
      pairToken: 'a'.repeat(64),
      hubId,
    }, { platform: 'android' });

    expect(secure.writeHubBinding).toHaveBeenCalledWith({
      schemaVersion: 1,
      server: 'https://my-hub.example',
      hubId,
      refreshToken: 'refresh-token',
    });
  });

  it('rejects a pairing QR from a different Hub until the user logs out', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient();
    client.hydrate({
      schemaVersion: 1,
      server: 'https://old.example',
      hubId: '9afef32a-0c8b-4a7b-91ab-40d866e2cb45',
      refreshToken: 'stored-refresh-token',
    });

    await expect(client.claimPairing({
      server: 'https://new.example',
      hubId: 'eaed822d-d901-44fd-82dc-750b74391b0e',
      pairToken: 'b'.repeat(64),
    }, { platform: 'android' })).rejects.toThrow('different DSH EasyRemote Hub');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ApiClient session configuration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('retries one transient failure for a safe read request', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient();
    client.setTokens({ accessToken: 'access', refreshToken: 'refresh' });

    await expect(client.listNodes()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends the selected agent preset when creating a session', async () => {
    let requestBody: unknown;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        commandId: 'command-1',
        sessionId: 'session-1',
        requestId: 'request-1',
        agentPreset: 'code',
      }), { status: 202, headers: { 'content-type': 'application/json' } });
    }));
    const client = new ApiClient();
    client.setTokens({ accessToken: 'access', refreshToken: 'refresh' });

    await expect(client.createSession('node-1', 'code')).resolves.toMatchObject({
      sessionId: 'session-1',
      agentPreset: 'code',
    });
    expect(requestBody).toMatchObject({ agentPreset: 'code' });
  });

  it('loads agent presets and switches the complete session model selection', async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({
        url,
        method: init?.method || 'GET',
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      });
      if (url.endsWith('/agent-presets')) {
        return new Response(JSON.stringify({
          presets: [{ id: 'standard', trust: 'system', isDefault: true }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/models')) {
        return new Response(JSON.stringify({
          current: { provider: 'deepseek', model: 'deepseek-chat' },
          routable: true,
          groups: [],
          failures: [],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        selected: { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const client = new ApiClient();
    client.setTokens({ accessToken: 'access', refreshToken: 'refresh' });

    await client.getAgentPresets('node-1');
    await client.getSessionModels('node-1', 'session-1');
    await client.selectSessionModel('node-1', 'session-1', {
      provider: 'deepseek',
      model: 'deepseek-reasoner',
      reasoningEffort: 'high',
    });

    expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'GET https://dsh.example.com/v1/nodes/node-1/agent-presets',
      'GET https://dsh.example.com/v1/nodes/node-1/sessions/session-1/models',
      'POST https://dsh.example.com/v1/nodes/node-1/sessions/session-1/model-selection',
    ]);
    expect(requests[2]?.body).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-reasoner',
      reasoningEffort: 'high',
    });
  });

  it('renames a session through the idempotent Hub route', async () => {
    let request: { url: string; method?: string; body?: unknown } | undefined;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      request = {
        url: String(input),
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      return new Response(JSON.stringify({ title: '深海探索计划', seq: 12 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));
    const client = new ApiClient();
    client.setTokens({ accessToken: 'access', refreshToken: 'refresh' });

    await expect(client.renameSession('node-1', 'session-1', '深海探索计划')).resolves.toMatchObject({
      title: '深海探索计划',
    });
    expect(request).toMatchObject({
      url: 'https://dsh.example.com/v1/nodes/node-1/sessions/session-1',
      method: 'PATCH',
      body: { title: '深海探索计划' },
    });
    expect((request?.body as { requestId?: string }).requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
