import { APP_VERSION, HUB_HTTP_URL, apiUrl } from '../config';
import { uuidv7 } from '../domain/ids';
import type {
  AgentPreset,
  ApiErrorPayload,
  ClaimResponse,
  ModelSelection,
  Node,
  PairingPayload,
  SessionModels,
  SessionSummary,
  SnapshotResponse,
  User,
} from '../domain/types';
import { ApiError } from '../domain/types';
import { clearHubBinding, writeHubBinding } from '../storage/secure';
import type { HubBinding } from '../storage/secure';

type TokenState = {
  accessToken: string | null;
  refreshToken: string | null;
  server: string;
  hubId: string | null;
};

type ClaimProfile = {
  ownerDisplayName?: string;
  deviceName?: string;
  platform?: 'ios' | 'android';
};

type RequestOptions = RequestInit & { retryOnUnauthorized?: boolean };

export class ApiClient {
  private state: TokenState = { accessToken: null, refreshToken: null, server: HUB_HTTP_URL, hubId: null };
  private refreshPromise: Promise<string | null> | null = null;

  get accessToken() {
    return this.state.accessToken;
  }

  get server() {
    return this.state.server;
  }

  get hubId() {
    return this.state.hubId;
  }

  setServer(server: string) {
    this.state.server = server;
  }

  hydrate(binding: HubBinding) {
    this.state.refreshToken = binding.refreshToken;
    this.state.server = binding.server;
    this.state.hubId = binding.hubId ?? null;
  }

  setTokens(tokens: { accessToken: string; refreshToken: string; server?: string; hubId?: string }) {
    this.state.accessToken = tokens.accessToken;
    this.state.refreshToken = tokens.refreshToken;
    if (tokens.server) this.state.server = tokens.server;
    if (tokens.hubId) this.state.hubId = tokens.hubId;
  }

  clearTokens() {
    this.state = { accessToken: null, refreshToken: null, server: HUB_HTTP_URL, hubId: null };
  }

  private binding(refreshToken = this.state.refreshToken): HubBinding | null {
    if (!refreshToken) return null;
    return {
      schemaVersion: 1,
      server: this.state.server,
      refreshToken,
      ...(this.state.hubId ? { hubId: this.state.hubId } : {}),
    };
  }

  async claimPairing(pairing: PairingPayload, profile: ClaimProfile): Promise<ClaimResponse> {
    if (this.state.refreshToken) {
      const sameHub = Boolean(this.state.hubId && pairing.hubId && this.state.hubId === pairing.hubId);
      const sameServer = this.state.server === pairing.server;
      const identityMismatch = Boolean(this.state.hubId && pairing.hubId && this.state.hubId !== pairing.hubId);
      if (identityMismatch || (!sameHub && !sameServer)) {
        throw new Error('This QR belongs to a different DSH EasyRemote Hub. Sign out before switching Hubs.');
      }
    }
    this.setServer(pairing.server);
    const response = await this.request<ClaimResponse>('/v1/node-pairings/claim', {
      method: 'POST',
      body: JSON.stringify({
        pairToken: pairing.pairToken,
        ownerDisplayName: profile.ownerDisplayName,
        deviceName: profile.deviceName,
        device: {
          name: profile.deviceName,
          platform: profile.platform,
          appVersion: APP_VERSION,
        },
      }),
    }, false);
    this.setTokens({ ...response, server: pairing.server, ...(pairing.hubId ? { hubId: pairing.hubId } : {}) });
    const binding = this.binding(response.refreshToken);
    if (binding) await writeHubBinding(binding);
    return response;
  }

  async refresh(): Promise<string | null> {
    if (!this.state.refreshToken) return null;
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      try {
        const currentToken = this.state.refreshToken;
        const response = await this.rawRequest<{ accessToken: string; refreshToken: string }>('/v1/auth/refresh', {
          method: 'POST',
          body: JSON.stringify({ refreshToken: currentToken }),
        }, false);
        this.setTokens({ ...response });
        const binding = this.binding(response.refreshToken);
        if (binding) await writeHubBinding(binding);
        return response.accessToken;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          this.clearTokens();
          await clearHubBinding();
          return null;
        }
        throw error;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  async logout() {
    const refreshToken = this.state.refreshToken;
    if (refreshToken) {
      try {
        await this.rawRequest('/v1/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }, false);
      } catch {
        // Local logout must still complete when the cloud is unreachable.
      }
    }
    this.clearTokens();
    await clearHubBinding();
  }

  getMe() {
    return this.request<{ user: User }>('/v1/me');
  }

  async listNodes() {
    const response = await this.request<{ items: Node[] }>('/v1/nodes');
    return response.items;
  }

  async listSessions(nodeId: string) {
    const response = await this.request<{ sessions: Array<Omit<SessionSummary, 'nodeId' | 'status'> & { status?: SessionSummary['status'] }> }>(`/v1/nodes/${encodeURIComponent(nodeId)}/sessions`);
    return response.sessions.map((session) => ({ ...session, nodeId, status: session.status || 'unknown' }));
  }

  getSnapshot(nodeId: string, sessionId: string) {
    return this.request<SnapshotResponse>(`/v1/nodes/${encodeURIComponent(nodeId)}/sessions/${encodeURIComponent(sessionId)}/snapshot`);
  }

  getAgentPresets(nodeId: string) {
    return this.request<{ presets: AgentPreset[] }>(`/v1/nodes/${encodeURIComponent(nodeId)}/agent-presets`)
      .then((response) => response.presets);
  }

  createSession(nodeId: string, agentPreset?: string) {
    return this.request<{ commandId: string; sessionId: string; requestId: string; agentPreset?: string }>(`/v1/nodes/${encodeURIComponent(nodeId)}/sessions`, {
      method: 'POST',
      body: JSON.stringify({ requestId: uuidv7(), ...(agentPreset ? { agentPreset } : {}) }),
    });
  }

  getSessionModels(nodeId: string, sessionId: string) {
    return this.request<SessionModels>(`/v1/nodes/${encodeURIComponent(nodeId)}/sessions/${encodeURIComponent(sessionId)}/models`);
  }

  selectSessionModel(nodeId: string, sessionId: string, selection: ModelSelection, requestId = uuidv7()) {
    return this.request<{ selected: ModelSelection }>(`/v1/nodes/${encodeURIComponent(nodeId)}/sessions/${encodeURIComponent(sessionId)}/model-selection`, {
      method: 'POST',
      body: JSON.stringify({ requestId, ...selection }),
    });
  }

  renameSession(nodeId: string, sessionId: string, title: string, requestId = uuidv7()) {
    return this.request<{ title: string; seq: number }>(`/v1/nodes/${encodeURIComponent(nodeId)}/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ requestId, title }),
    });
  }

  followup(nodeId: string, sessionId: string, content: string, requestId = uuidv7()) {
    return this.request(`/v1/nodes/${encodeURIComponent(nodeId)}/sessions/${encodeURIComponent(sessionId)}/followup`, {
      method: 'POST',
      body: JSON.stringify({ requestId, content }),
    });
  }

  steer(nodeId: string, sessionId: string, instruction: string, requestId = uuidv7()) {
    return this.request(`/v1/nodes/${encodeURIComponent(nodeId)}/sessions/${encodeURIComponent(sessionId)}/steer`, {
      method: 'POST',
      body: JSON.stringify({ requestId, instruction }),
    });
  }

  stop(nodeId: string, sessionId: string, requestId = uuidv7()) {
    return this.request(`/v1/nodes/${encodeURIComponent(nodeId)}/sessions/${encodeURIComponent(sessionId)}/stop`, {
      method: 'POST',
      body: JSON.stringify({ requestId, reason: 'user_stop' }),
    });
  }

  respondApproval(approvalId: string, response: 'allow_once' | 'deny', requestId = uuidv7()) {
    return this.request(`/v1/approvals/${encodeURIComponent(approvalId)}/respond`, {
      method: 'POST',
      body: JSON.stringify({ requestId, response }),
    });
  }

  revokeNode(nodeId: string) {
    return this.request(`/v1/nodes/${encodeURIComponent(nodeId)}/revoke`, { method: 'POST' });
  }

  private async rawRequest<T>(path: string, init: RequestOptions, authorized = true): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    if (authorized && this.state.accessToken) headers.set('authorization', `Bearer ${this.state.accessToken}`);
    const response = await fetch(apiUrl(path, this.state.server), { ...init, headers });
    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const payload = typeof body === 'object' && body ? body as ApiErrorPayload : { message: String(body) };
      throw new ApiError(response.status, payload);
    }
    return body as T;
  }

  private async request<T>(path: string, init: RequestOptions = {}, authorized = true): Promise<T> {
    try {
      return await this.rawRequest<T>(path, init, authorized);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401 || !authorized || init.retryOnUnauthorized === false) throw error;
      const nextAccessToken = await this.refresh();
      if (!nextAccessToken) throw error;
      return this.rawRequest<T>(path, init, authorized);
    }
  }
}

export const apiClient = new ApiClient();
