import { AppState, AppStateStatus, Platform } from 'react-native';
import { create } from 'zustand';
import { APP_VERSION, HUB_HTTP_URL } from '../config';
import { apiClient } from '../api/client';
import { RealtimeClient } from '../api/realtime';
import type { AgentPreset, ApprovalRequest, LocalUpload, ModelSelection, Node, PairingPayload, RealtimeStatus, SessionEvent, SessionModels, SessionSummary, SessionView, User, WorkspaceReference } from '../domain/types';
import { ApiError } from '../domain/types';
import { readHubBinding } from '../storage/secure';
import { cacheNodes, cacheSessionView, cacheSessions, cacheUser, readCachedNodes, readCachedSessionView, readCachedSessions, readCachedUser } from '../storage/database';
import { emptySessionView, reduceSessionEvents } from './session-reducer';
import { uploadLocalFiles } from '../api/uploads';
import { clearAttachmentCache } from '../storage/attachment-cache';

export type SendFollowupOptions = {
  references?: WorkspaceReference[];
  uploads?: LocalUpload[];
  signal?: AbortSignal;
  onProgress?: (progress: number, file: LocalUpload) => void;
};

type AppStateShape = {
  bootstrapped: boolean;
  initialSyncComplete: boolean;
  isAuthenticated: boolean;
  user: User | null;
  nodes: Node[];
  sessionsByNode: Record<string, SessionSummary[]>;
  sessionViews: Record<string, SessionView>;
  agentPresetsByNode: Record<string, AgentPreset[]>;
  sessionModels: Record<string, SessionModels>;
  activePairing: { nodeId: string; nodeName: string; server: string } | null;
  approvals: ApprovalRequest[];
  realtimeStatus: RealtimeStatus;
  cloudAvailable: boolean;
  errorMessage: string | null;
  bootstrap: () => Promise<void>;
  claimPairing: (pairing: PairingPayload) => Promise<void>;
  refreshNodes: () => Promise<void>;
  loadSessions: (nodeId: string) => Promise<void>;
  openSession: (nodeId: string, sessionId: string) => Promise<void>;
  loadAgentPresets: (nodeId: string) => Promise<AgentPreset[]>;
  createSession: (nodeId: string, agentPreset?: string) => Promise<string>;
  loadSessionModels: (nodeId: string, sessionId: string) => Promise<SessionModels>;
  selectSessionModel: (nodeId: string, sessionId: string, selection: ModelSelection) => Promise<ModelSelection>;
  renameSession: (nodeId: string, sessionId: string, title: string) => Promise<string>;
  searchWorkspaceReferences: (nodeId: string, sessionId: string, query: string) => Promise<WorkspaceReference[]>;
  sendFollowup: (nodeId: string, sessionId: string, content: string, options?: SendFollowupOptions) => Promise<void>;
  sendSteer: (nodeId: string, sessionId: string, instruction: string) => Promise<void>;
  stopSession: (nodeId: string, sessionId: string) => Promise<void>;
  respondApproval: (approvalId: string, response: 'allow_once' | 'deny') => Promise<void>;
  revokeNode: (nodeId: string) => Promise<void>;
  clearError: () => void;
  logout: () => Promise<void>;
  handleAppState: (status: AppStateStatus) => void;
  setRealtimeStatus: (status: RealtimeStatus) => void;
  setError: (message: string) => void;
  receiveEvents: (events: SessionEvent[]) => void;
  receiveApproval: (approval: ApprovalRequest) => void;
};

const realtime = new RealtimeClient({
  server: HUB_HTTP_URL,
  accessToken: () => apiClient.accessToken,
});

let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
let cloudUnavailableTimer: ReturnType<typeof setTimeout> | null = null;
const CLOUD_UNAVAILABLE_GRACE_MS = 5_000;

function cancelCloudUnavailable() {
  if (cloudUnavailableTimer) clearTimeout(cloudUnavailableTimer);
  cloudUnavailableTimer = null;
}

function markCloudAvailable() {
  cancelCloudUnavailable();
  useAppStore.setState({ cloudAvailable: true });
}

function markCloudUnavailableAfterGrace(error: unknown) {
  if ((error instanceof ApiError && error.status < 500 && error.status !== 408) || cloudUnavailableTimer) return;
  cloudUnavailableTimer = setTimeout(() => {
    cloudUnavailableTimer = null;
    if (useAppStore.getState().realtimeStatus === 'connected') return;
    useAppStore.setState({ cloudAvailable: false });
  }, CLOUD_UNAVAILABLE_GRACE_MS);
}

function sessionKey(nodeId: string, sessionId: string) {
  return `${nodeId}:${sessionId}`;
}

function sessionFromSnapshot(nodeId: string, sessionId: string, response: Awaited<ReturnType<typeof apiClient.getSnapshot>>, fallback?: SessionSummary): SessionView {
  const session = response.session;
  const summary: SessionSummary = {
    nodeId,
    sessionId,
    title: session.title || fallback?.title || `Session ${sessionId.slice(0, 8)}`,
    status: session.status || fallback?.status || 'unknown',
    lastEventSeq: session.lastSourceSeq ?? session.lastEventSeq ?? fallback?.lastEventSeq ?? -1,
    createdAt: session.createdAt || fallback?.createdAt || Date.now(),
    updatedAt: session.updatedAt || fallback?.updatedAt || Date.now(),
    ...(session.agentPreset || fallback?.agentPreset
      ? { agentPreset: session.agentPreset || fallback?.agentPreset }
      : {}),
    ...(fallback?.workspaceLabel ? { workspaceLabel: fallback.workspaceLabel } : {}),
  };
  const view = {
    ...emptySessionView(summary, response.source !== 'node'),
    // Snapshot events must be folded from the beginning. The metadata sequence is
    // the sync cursor, not evidence that this fresh in-memory view rendered them.
    lastSourceSeq: -1,
  };
  const hydrated = reduceSessionEvents(view, response.events.map((event) => ({
    v: 1,
    kind: 'session.event',
    nodeId,
    sessionId,
    sourceSeq: event.sourceSeq,
    event: event.event,
  })));
  const lastSourceSeq = Math.max(summary.lastEventSeq, hydrated.lastSourceSeq);
  return {
    ...hydrated,
    lastSourceSeq,
    session: { ...hydrated.session, lastEventSeq: lastSourceSeq },
  };
}

export const useAppStore = create<AppStateShape>((set, get) => ({
  bootstrapped: false,
  initialSyncComplete: false,
  isAuthenticated: false,
  user: null,
  nodes: [],
  sessionsByNode: {},
  sessionViews: {},
  agentPresetsByNode: {},
  sessionModels: {},
  activePairing: null,
  approvals: [],
  realtimeStatus: 'offline',
  cloudAvailable: true,
  errorMessage: null,

  bootstrap: async () => {
    const cachedUser = readCachedUser();
    const cachedNodes = readCachedNodes();
    if (cachedUser) set({ user: cachedUser });
    if (cachedNodes.length) set({ nodes: cachedNodes });

    const binding = await readHubBinding();
    if (!binding) {
      set({ bootstrapped: true, initialSyncComplete: true });
      return;
    }

    apiClient.hydrate(binding);
    let accessToken: string | null;
    try {
      accessToken = await apiClient.refresh();
    } catch {
      cancelCloudUnavailable();
      set({ bootstrapped: true, initialSyncComplete: true, isAuthenticated: true, cloudAvailable: false });
      return;
    }
    if (!accessToken) {
      set({ bootstrapped: true, initialSyncComplete: true, isAuthenticated: false, user: null });
      return;
    }

    set({ isAuthenticated: true, bootstrapped: true });
    try {
      const me = await apiClient.getMe();
      cacheUser(me.user);
      set({ user: me.user });
      markCloudAvailable();
      await get().refreshNodes();
      realtime.updateServer(apiClient.server);
      void realtime.connect();
    } catch {
      cancelCloudUnavailable();
      set({ cloudAvailable: false });
    } finally {
      set({ initialSyncComplete: true });
    }
  },

  claimPairing: async (pairing) => {
    set({ errorMessage: null });
    try {
      const claim = await apiClient.claimPairing(pairing, {
        ownerDisplayName: 'DSH Owner',
        deviceName: Platform.OS === 'ios' ? "Martin's iPhone" : 'Android phone',
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
      });
      const me = claim.user ? { user: claim.user } : await apiClient.getMe();
      cacheUser(me.user);
      set({
        user: me.user,
        isAuthenticated: true,
        activePairing: { nodeId: claim.nodeId, nodeName: claim.node?.name || 'Your DSH', server: pairing.server },
      });
      await get().refreshNodes();
      realtime.updateServer(pairing.server);
      void realtime.connect();
    } catch (error) {
      set({ errorMessage: error instanceof Error ? error.message : 'Pairing failed' });
      throw error;
    }
  },

  refreshNodes: async () => {
    try {
      const nodes = await apiClient.listNodes();
      cacheNodes(nodes);
      set({ nodes, errorMessage: null });
      markCloudAvailable();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'UNAUTHORIZED') await get().logout();
      markCloudUnavailableAfterGrace(error);
      throw error;
    }
  },

  loadSessions: async (nodeId) => {
    try {
      const sessions = await apiClient.listSessions(nodeId);
      cacheSessions(nodeId, sessions);
      set((state) => ({ sessionsByNode: { ...state.sessionsByNode, [nodeId]: sessions } }));
      markCloudAvailable();
    } catch (error) {
      const cached = readCachedSessions(nodeId);
      if (cached.length) set((state) => ({ sessionsByNode: { ...state.sessionsByNode, [nodeId]: cached } }));
      markCloudUnavailableAfterGrace(error);
    }
  },

  openSession: async (nodeId, sessionId) => {
    const key = sessionKey(nodeId, sessionId);
    const summary = get().sessionsByNode[nodeId]?.find((item) => item.sessionId === sessionId) || {
      nodeId,
      sessionId,
      title: `Session ${sessionId.slice(0, 8)}`,
      status: 'unknown' as const,
      lastEventSeq: -1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const cached = readCachedSessionView(nodeId, sessionId);
    if (cached) set((state) => ({ sessionViews: { ...state.sessionViews, [key]: cached } }));

    try {
      const snapshot = await apiClient.getSnapshot(nodeId, sessionId);
      const view = sessionFromSnapshot(nodeId, sessionId, snapshot, summary);
      set((state) => ({ sessionViews: { ...state.sessionViews, [key]: view } }));
      markCloudAvailable();
      cacheSessionView(view);
      realtime.subscribe(nodeId, sessionId, view.lastSourceSeq);
      void realtime.connect();
    } catch (error) {
      if (!cached) set((state) => ({ sessionViews: { ...state.sessionViews, [key]: emptySessionView(summary, true) } }));
      markCloudUnavailableAfterGrace(error);
    }
  },

  loadAgentPresets: async (nodeId) => {
    try {
      const presets = await apiClient.getAgentPresets(nodeId);
      set((state) => ({
        agentPresetsByNode: { ...state.agentPresetsByNode, [nodeId]: presets },
      }));
      markCloudAvailable();
      return presets;
    } catch (error) {
      set({ errorMessage: error instanceof Error ? error.message : 'Could not load agent modes' });
      throw error;
    }
  },

  createSession: async (nodeId, agentPreset) => {
    const response = await apiClient.createSession(nodeId, agentPreset);
    await get().loadSessions(nodeId);
    return response.sessionId;
  },

  loadSessionModels: async (nodeId, sessionId) => {
    const models = await apiClient.getSessionModels(nodeId, sessionId);
    const key = sessionKey(nodeId, sessionId);
    set((state) => ({ sessionModels: { ...state.sessionModels, [key]: models } }));
    return models;
  },

  selectSessionModel: async (nodeId, sessionId, selection) => {
    const response = await apiClient.selectSessionModel(nodeId, sessionId, selection);
    const key = sessionKey(nodeId, sessionId);
    set((state) => {
      const current = state.sessionModels[key];
      return {
        sessionModels: {
          ...state.sessionModels,
          [key]: current
            ? { ...current, current: response.selected, routable: true }
            : { current: response.selected, routable: true, groups: [], failures: [] },
        },
      };
    });
    return response.selected;
  },

  renameSession: async (nodeId, sessionId, title) => {
    const response = await apiClient.renameSession(nodeId, sessionId, title);
    const key = sessionKey(nodeId, sessionId);
    set((state) => {
      const sessions = (state.sessionsByNode[nodeId] || []).map((session) => session.sessionId === sessionId
        ? { ...session, title: response.title, updatedAt: Date.now() }
        : session);
      const current = state.sessionViews[key];
      const sessionViews = current
        ? { ...state.sessionViews, [key]: { ...current, session: { ...current.session, title: response.title, updatedAt: Date.now() } } }
        : state.sessionViews;
      cacheSessions(nodeId, sessions);
      if (current) cacheSessionView(sessionViews[key]);
      return { sessionsByNode: { ...state.sessionsByNode, [nodeId]: sessions }, sessionViews };
    });
    return response.title;
  },

  searchWorkspaceReferences: (nodeId, sessionId, query) => apiClient.workspaceReferences(nodeId, sessionId, query),

  sendFollowup: async (nodeId, sessionId, content, options = {}) => {
    const remoteIds = options.uploads?.length ? await uploadLocalFiles({
      api: apiClient,
      nodeId,
      sessionId,
      files: options.uploads,
      signal: options.signal,
      onProgress: options.onProgress,
    }) : [];
    try {
      await apiClient.followup(nodeId, sessionId, content, {
        references: options.references,
        uploadIds: remoteIds,
      });
    } catch (error) {
      await Promise.allSettled(remoteIds.map((uploadId) => apiClient.deleteUpload(nodeId, sessionId, uploadId)));
      throw error;
    }
  },

  sendSteer: async (nodeId, sessionId, instruction) => {
    const key = sessionKey(nodeId, sessionId);
    set((state) => ({ sessionViews: { ...state.sessionViews, [key]: state.sessionViews[key] ? { ...state.sessionViews[key], pendingSteer: true } : state.sessionViews[key] } }));
    try {
      await apiClient.steer(nodeId, sessionId, instruction);
    } finally {
      set((state) => ({ sessionViews: { ...state.sessionViews, [key]: state.sessionViews[key] ? { ...state.sessionViews[key], pendingSteer: false } : state.sessionViews[key] } }));
    }
  },

  stopSession: async (nodeId, sessionId) => {
    await apiClient.stop(nodeId, sessionId);
  },

  respondApproval: async (approvalId, response) => {
    await apiClient.respondApproval(approvalId, response);
    set((state) => ({ approvals: state.approvals.filter((approval) => approval.approvalId !== approvalId) }));
  },

  revokeNode: async (nodeId) => {
    await apiClient.revokeNode(nodeId);
    set((state) => ({ nodes: state.nodes.map((node) => node.id === nodeId ? { ...node, online: false, revokedAt: Date.now() } : node) }));
  },

  clearError: () => set({ errorMessage: null }),
  setRealtimeStatus: (status: RealtimeStatus) => {
    if (status === 'connected') markCloudAvailable();
    set((state) => ({
      realtimeStatus: status,
      ...(status === 'connected' && state.errorMessage === "Can't reach DSH Remote" ? { errorMessage: null } : {}),
    }));
  },
  setError: (errorMessage: string) => set({ errorMessage }),
  receiveEvents: (events: SessionEvent[]) => set((state) => {
    const next = { ...state.sessionViews };
    const nextSessions = { ...state.sessionsByNode };
    const changedNodes = new Set<string>();
    for (const event of events) {
      const key = sessionKey(event.nodeId, event.sessionId);
      const current = next[key];
      if (current) next[key] = reduceSessionEvents(current, [event]);
      if (event.event.type === 'session.title' && typeof event.event.data.title === 'string') {
        const title = event.event.data.title.trim();
        if (title) {
          nextSessions[event.nodeId] = (nextSessions[event.nodeId] || []).map((session) => session.sessionId === event.sessionId
            ? { ...session, title, updatedAt: Date.now(), lastEventSeq: Math.max(session.lastEventSeq, event.sourceSeq) }
            : session);
          changedNodes.add(event.nodeId);
        }
      }
    }
    for (const view of Object.values(next)) cacheSessionView(view);
    for (const nodeId of changedNodes) cacheSessions(nodeId, nextSessions[nodeId] || []);
    return { sessionViews: next, sessionsByNode: nextSessions };
  }),
  receiveApproval: (approval: ApprovalRequest) => set((state) => ({ approvals: state.approvals.some((item) => item.approvalId === approval.approvalId) ? state.approvals : [...state.approvals, approval] })),
  handleAppState: (status) => {
    if (status === 'active' && get().isAuthenticated) {
      void get().refreshNodes();
      realtime.reconnectNow();
      for (const view of Object.values(get().sessionViews)) realtime.sync(view.session.nodeId, view.session.sessionId);
    }
  },
  logout: async () => {
    cancelCloudUnavailable();
    realtime.disconnect();
    await apiClient.logout();
    await clearAttachmentCache();
    set({ isAuthenticated: false, user: null, nodes: [], sessionsByNode: {}, sessionViews: {}, agentPresetsByNode: {}, sessionModels: {}, activePairing: null, approvals: [], realtimeStatus: 'offline' });
  },
}));

realtime.setHandlers({
  onStatus: (status) => useAppStore.getState().setRealtimeStatus(status),
  onEvents: (events) => useAppStore.getState().receiveEvents(events),
  onSnapshotRequired: (nodeId, sessionId) => { void useAppStore.getState().openSession(nodeId, sessionId); },
  onApproval: (frame) => useAppStore.getState().receiveApproval(frame.approval),
  onError: (message) => useAppStore.getState().setError(message),
});

export function useAppBootstrap() {
  const bootstrap = useAppStore((state) => state.bootstrap);
  if (!appStateSubscription) {
    appStateSubscription = AppState.addEventListener('change', (status) => useAppStore.getState().handleAppState(status));
  }
  return bootstrap;
}
