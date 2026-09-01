import type { MessageBlock, SessionEvent, SessionMessage, SessionSummary, SessionView } from '../domain/types';

function textFrom(data: Record<string, unknown>) {
  for (const key of ['text', 'content', 'message', 'summary']) {
    if (typeof data[key] === 'string') return data[key] as string;
  }
  return '';
}

function messageId(event: SessionEvent) {
  return `${event.nodeId}:${event.sessionId}:${event.sourceSeq}`;
}

function suppressedPathsFrom(data: Record<string, unknown>) {
  if (!Array.isArray(data.suppressedWorkspaceMediaPaths)) return undefined;
  const paths = data.suppressedWorkspaceMediaPaths.filter((value): value is string => typeof value === 'string' && Boolean(value));
  return paths.length ? paths : undefined;
}

function blocksFrom(data: Record<string, unknown>): MessageBlock[] | undefined {
  if (!Array.isArray(data.blocks)) return undefined;
  const blocks = data.blocks.flatMap((value): MessageBlock[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const block = value as Record<string, unknown>;
    if (block.type === 'text' && typeof block.text === 'string') return [{ type: 'text', text: block.text }];
    if (
      block.type === 'image'
      && typeof block.attachmentId === 'string'
      && typeof block.mediaType === 'string'
      && typeof block.bytes === 'number'
      && typeof block.width === 'number'
      && typeof block.height === 'number'
    ) return [{
      type: 'image', attachmentId: block.attachmentId, mediaType: block.mediaType,
      bytes: block.bytes, width: block.width, height: block.height,
      ...(typeof block.name === 'string' ? { name: block.name } : {}),
    }];
    if (block.type === 'workspace-reference' && typeof block.path === 'string') {
      return [{ type: 'workspace-reference', path: block.path, kind: block.kind === 'dir' ? 'dir' : 'file' }];
    }
    const workspaceMediaTypes = new Set(['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']);
    if (
      block.type === 'workspace-media'
      && typeof block.artifactId === 'string'
      && typeof block.mediaType === 'string'
      && workspaceMediaTypes.has(block.mediaType)
      && typeof block.bytes === 'number'
      && typeof block.name === 'string'
      && typeof block.path === 'string'
      && (block.source === 'tool' || block.source === 'markdown')
    ) return [{
      type: 'workspace-media',
      artifactId: block.artifactId,
      mediaType: block.mediaType as Extract<MessageBlock, { type: 'workspace-media' }>['mediaType'],
      bytes: block.bytes,
      name: block.name,
      path: block.path,
      source: block.source,
    }];
    return [];
  });
  return blocks.length ? blocks : undefined;
}

export function eventToMessage(event: SessionEvent): SessionMessage | null {
  const text = textFrom(event.event.data);
  const timestamp = event.createdAt || Date.now();
  if (event.event.type === 'user.message') return { id: messageId(event), role: 'user', text, timestamp, sourceSeq: event.sourceSeq, ...(blocksFrom(event.event.data) ? { blocks: blocksFrom(event.event.data) } : {}), ...(suppressedPathsFrom(event.event.data) ? { suppressedWorkspaceMediaPaths: suppressedPathsFrom(event.event.data) } : {}) };
  if (event.event.type === 'assistant.delta' || event.event.type === 'assistant.message') {
    return {
      id: messageId(event),
      role: 'assistant',
      text,
      timestamp,
      sourceSeq: event.sourceSeq,
      streaming: event.event.type === 'assistant.delta',
      ...(blocksFrom(event.event.data) ? { blocks: blocksFrom(event.event.data) } : {}),
      ...(suppressedPathsFrom(event.event.data) ? { suppressedWorkspaceMediaPaths: suppressedPathsFrom(event.event.data) } : {}),
    };
  }
  if (event.event.type === 'tool.call' || event.event.type === 'tool.result') {
    const name = typeof event.event.data.name === 'string' ? event.event.data.name : 'DSH tool';
    const input = typeof event.event.data.input === 'string' ? event.event.data.input : undefined;
    const output = typeof event.event.data.output === 'string' ? event.event.data.output : text || undefined;
    const status = event.event.type === 'tool.call' ? 'running' : event.event.data.error ? 'failed' : 'complete';
    const blocks = blocksFrom(event.event.data);
    return { id: messageId(event), role: 'tool', text: '', timestamp, sourceSeq: event.sourceSeq, tool: { name, input, output, status }, ...(blocks ? { blocks } : {}) };
  }
  return null;
}

export function reduceSessionEvents(view: SessionView, events: SessionEvent[]): SessionView {
  const messages = [...view.messages];
  let isRunning = view.isRunning;
  let lastSourceSeq = view.lastSourceSeq;
  let session = view.session;

  for (const event of events.sort((a, b) => a.sourceSeq - b.sourceSeq)) {
    if (event.sourceSeq <= lastSourceSeq) continue;
    lastSourceSeq = event.sourceSeq;
    if (event.event.type === 'turn.start' || event.event.type === 'step.start') isRunning = true;
    if (event.event.type === 'turn.end') isRunning = false;
    if (event.event.type === 'session.title') {
      const title = typeof event.event.data.title === 'string' ? event.event.data.title.trim() : '';
      if (title) session = { ...session, title };
      continue;
    }
    const message = eventToMessage(event);
    if (!message) continue;

    if (event.event.type === 'assistant.delta') {
      const previous = messages[messages.length - 1];
      if (previous?.role === 'assistant' && previous.streaming && previous.sourceSeq < event.sourceSeq) {
        messages[messages.length - 1] = { ...previous, text: `${previous.text}${message.text}`, sourceSeq: event.sourceSeq, streaming: true };
        continue;
      }
    }
    if (event.event.type === 'assistant.message') {
      const previous = messages[messages.length - 1];
      if (previous?.role === 'assistant' && previous.streaming) {
        messages[messages.length - 1] = {
          ...previous,
          text: message.text,
          timestamp: message.timestamp,
          sourceSeq: message.sourceSeq,
          streaming: false,
          ...(message.blocks ? { blocks: message.blocks } : {}),
          ...(message.suppressedWorkspaceMediaPaths ? { suppressedWorkspaceMediaPaths: message.suppressedWorkspaceMediaPaths } : {}),
        };
        continue;
      }
    }
    messages.push(message);
  }

  return { ...view, messages, lastSourceSeq, isRunning, session: { ...session, lastEventSeq: lastSourceSeq, updatedAt: Date.now() } };
}

export function emptySessionView(session: SessionSummary, offline = false): SessionView {
  return {
    session,
    messages: [],
    lastSourceSeq: session.lastEventSeq,
    isRunning: session.status === 'running',
    isOfflineSnapshot: offline,
    pendingSteer: false,
  };
}

export function messagesFromSnapshot(events: Array<SessionEvent | { sourceSeq: number; event: SessionEvent['event'] }>, nodeId: string, sessionId: string) {
  const normalized: SessionEvent[] = events.map((event) => ({
    v: 1,
    kind: 'session.event',
    nodeId,
    sessionId,
    sourceSeq: event.sourceSeq,
    event: event.event,
  }));
  return reduceSessionEvents(emptySessionView({
    nodeId,
    sessionId,
    title: `Session ${sessionId.slice(0, 8)}`,
    status: 'unknown',
    lastEventSeq: -1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }), normalized);
}
