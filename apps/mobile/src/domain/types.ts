export type NodeStatus = 'online' | 'offline';
export type RealtimeStatus = 'connected' | 'reconnecting' | 'offline' | 'auth_refreshing';
export type SessionStatus = 'idle' | 'running' | 'unknown';
export type ApprovalResponse = 'allow_once' | 'deny';

export type User = {
  id: string;
  displayName: string;
  orgId: string;
};

export type Node = {
  id: string;
  name: string;
  platform: string;
  arch: string;
  pluginVersion: string;
  dshVersion: string;
  createdAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
  online: boolean;
  capabilities?: string[];
};

export type WorkspaceReference = {
  path: string;
  kind: 'file' | 'dir';
  name?: string;
};

export type LocalUpload = {
  localId: string;
  uri: string;
  kind: 'image' | 'file';
  displayName: string;
  mediaType: string;
  byteSize: number;
  width?: number;
  height?: number;
};

export type RemoteUpload = {
  id: string;
  kind: 'image' | 'file';
  displayName: string;
  mediaType: string;
  byteSize: number;
  receivedBytes: number;
  status: 'pending' | 'ready' | 'consumed';
  sha256?: string;
};

export type MessageBlock =
  | { type: 'text'; text: string }
  | {
    type: 'image';
    attachmentId: string;
    mediaType: string;
    bytes: number;
    width: number;
    height: number;
    name?: string;
  }
  | {
    type: 'workspace-media';
    artifactId: string;
    mediaType: 'image/svg+xml' | 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
    bytes: number;
    name: string;
    path: string;
    source: 'tool' | 'markdown';
  }
  | { type: 'workspace-reference'; path: string; kind: 'file' | 'dir' };

export type AgentPreset = {
  id: string;
  trust: 'system' | 'user';
  isDefault: boolean;
  name?: string;
  description?: string;
  broken?: string;
};

export type ModelSelection = {
  provider: string;
  model: string;
  reasoningEffort?: string;
};

export type ModelReasoningEffort = {
  id: string;
  name: string;
  description?: string;
};

export type ModelCatalogModel = {
  id: string;
  name: string;
  description?: string;
  reasoning?: {
    efforts: ModelReasoningEffort[];
    defaultEffort?: string;
  };
};

export type ModelProviderGroup = {
  id: string;
  name: string;
  models: ModelCatalogModel[];
};

export type SessionModels = {
  current: ModelSelection;
  routable: boolean;
  groups: ModelProviderGroup[];
  failures: Array<{ id: string; name: string; message: string }>;
};

export type SessionSummary = {
  sessionId: string;
  nodeId: string;
  title: string;
  status: SessionStatus;
  lastEventSeq: number;
  updatedAt: number;
  createdAt: number;
  workspaceLabel?: string;
  agentPreset?: string;
};

export type CanonicalEventType =
  | 'turn.start'
  | 'turn.end'
  | 'step.start'
  | 'step.end'
  | 'user.message'
  | 'assistant.delta'
  | 'assistant.message'
  | 'session.title'
  | 'tool.call'
  | 'tool.result';

export type SessionEvent = {
  v: 1;
  kind: 'session.event';
  nodeId: string;
  sessionId: string;
  sourceSeq: number;
  event: {
    type: CanonicalEventType | string;
    data: Record<string, unknown>;
  };
  createdAt?: number;
};

export type SessionMessage = {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  timestamp: number;
  sourceSeq: number;
  streaming?: boolean;
  blocks?: MessageBlock[];
  suppressedWorkspaceMediaPaths?: string[];
  tool?: {
    name: string;
    status: 'running' | 'complete' | 'failed';
    input?: string;
    output?: string;
  };
};

export type SessionView = {
  session: SessionSummary;
  messages: SessionMessage[];
  lastSourceSeq: number;
  isRunning: boolean;
  isOfflineSnapshot: boolean;
  pendingSteer: boolean;
};

export type ApprovalRequest = {
  approvalId: string;
  nodeId: string;
  sessionId: string;
  toolCallId: string;
  title: string;
  summary: string;
  cwd?: string;
  risk?: 'low' | 'medium' | 'high' | string;
  expiresAt: number;
};

export type PairingPayload = {
  server: string;
  pairToken: string;
  hubId?: string;
};

export type ClaimResponse = {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: number;
  expiresIn: number;
  nodeId: string;
  tokenType: 'Bearer';
  user?: User;
  node?: Node;
};

export type ApiErrorPayload = {
  code?: string;
  message?: string;
  details?: unknown;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, payload: ApiErrorPayload = {}) {
    super(payload.message || 'DSH Remote request failed');
    this.name = 'ApiError';
    this.status = status;
    this.code = payload.code || 'INTERNAL_ERROR';
    this.details = payload.details;
  }
}

export type SnapshotResponse = {
  source: 'node' | 'ring-buffer' | 'cache';
  session: {
    id?: string;
    sessionId?: string;
    nodeId?: string;
    title?: string;
    status?: SessionStatus;
    lastSourceSeq?: number;
    lastEventSeq?: number;
    createdAt?: number;
    updatedAt?: number;
    agentPreset?: string;
  };
  events: Array<SessionEvent | { sourceSeq: number; event: SessionEvent['event'] }>;
};

export type MobileRealtimeFrame =
  | { v: 1; kind: 'session.event'; nodeId: string; sessionId: string; sourceSeq: number; event: SessionEvent['event']; createdAt?: number }
  | { v: 1; kind: 'session.sync'; nodeId: string; sessionId: string; afterSourceSeq: number; events: SessionEvent[] }
  | { v: 1; kind: 'snapshot.required'; nodeId: string; sessionId: string; message?: string }
  | { v: 1; kind: 'approval.request'; nodeId: string; sessionId: string; approval: ApprovalRequest }
  | { v: 1; kind: 'approval.resolved'; approvalId: string; status: string }
  | { v: 1; kind: 'subscribe.ok'; requestId: string; nodeId: string; sessionId: string }
  | { v: 1; kind: 'error'; code: string; message: string };
