import { basename } from 'node:path';

type RpcIdFactory = () => string;

type CreateSessionInput = {
  sessionId: string;
  cwd: string;
  agentPreset?: string;
};

type SelectModelInput = {
  sessionId: string;
  provider: string;
  model: string;
  reasoningEffort?: string;
};

export function toRemoteSessionSummary(
  session: any,
  title?: string,
  status?: string,
  now = Date.now(),
): Record<string, unknown> {
  const header = session?.header || session?.session || {};
  const events = Array.isArray(session?.events) ? session.events : [];
  const last = events.at(-1);
  const cwd = typeof header.cwd === 'string' ? header.cwd : '';
  return {
    id: header.id,
    title: title || basename(cwd) || `Session ${String(header.id || '').slice(0, 8)}`,
    status: status === 'running' ? 'running' : 'idle',
    lastSourceSeq: typeof last?.seq === 'number' ? last.seq : -1,
    createdAt: typeof header.createdAt === 'number' ? header.createdAt : now,
    updatedAt: typeof last?.time === 'number' ? last.time : header.createdAt || now,
    ...(cwd ? { cwdLabel: basename(cwd) } : {}),
    ...(typeof header.agentPreset === 'string' && header.agentPreset
      ? { agentPreset: header.agentPreset }
      : {}),
  };
}

function remoteCode(value: unknown) {
  return String(value || 'internal').replaceAll('-', '_').toUpperCase();
}

export class DshApiBridgeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DshApiBridgeError';
    this.code = code;
  }
}

export class DshApiBridge {
  constructor(
    private readonly apiProxy: any,
    private readonly createRpcId: RpcIdFactory,
  ) {}

  private request(payload: Record<string, unknown>) {
    return { rpcId: this.createRpcId(), payload };
  }

  private value<T>(response: any): T {
    if (response?.result?.ok) return response.result.value as T;
    const error = response?.result?.error;
    throw new DshApiBridgeError(remoteCode(error?.code), error?.message || 'DSH request failed');
  }

  async listAgentPresets() {
    const response = await this.apiProxy.agentPresets.list(this.request({}));
    const value = this.value<{ presets?: unknown[] }>(response);
    return { presets: Array.isArray(value.presets) ? value.presets : [] };
  }

  async createSession(input: CreateSessionInput) {
    const payload = {
      sessionId: input.sessionId,
      cwd: input.cwd,
      ...(input.agentPreset ? { agentPreset: input.agentPreset } : {}),
    };
    return this.value<{ sessionId: string; agentPreset?: string }>(
      await this.apiProxy.sessions.create(this.request(payload)),
    );
  }

  async sessionModels(sessionId: string) {
    return this.value<any>(
      await this.apiProxy.sessions.models(this.request({ sessionId })),
    );
  }

  async selectModel(input: SelectModelInput) {
    const payload = {
      sessionId: input.sessionId,
      provider: input.provider,
      model: input.model,
      ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
    };
    return this.value<any>(
      await this.apiProxy.sessions.selectModel(this.request(payload)),
    );
  }

  async renameSession(sessionId: string, title: string) {
    return this.value<{ title: string; seq: number }>(
      await this.apiProxy.sessions.rename(this.request({ sessionId, title })),
    );
  }
}
