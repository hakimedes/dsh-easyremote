import type { SessionEvent, SessionMessage, SessionSummary, SessionView } from '../domain/types';

function textFrom(data: Record<string, unknown>) {
  for (const key of ['text', 'content', 'message', 'summary']) {
    if (typeof data[key] === 'string') return data[key] as string;
  }
  return '';
}

function messageId(event: SessionEvent) {
  return `${event.nodeId}:${event.sessionId}:${event.sourceSeq}`;
}

export function eventToMessage(event: SessionEvent): SessionMessage | null {
  const text = textFrom(event.event.data);
  const timestamp = event.createdAt || Date.now();
  if (event.event.type === 'user.message') return { id: messageId(event), role: 'user', text, timestamp, sourceSeq: event.sourceSeq };
  if (event.event.type === 'assistant.delta' || event.event.type === 'assistant.message') {
    return {
      id: messageId(event),
      role: 'assistant',
      text,
      timestamp,
      sourceSeq: event.sourceSeq,
      streaming: event.event.type === 'assistant.delta',
    };
  }
  if (event.event.type === 'tool.call' || event.event.type === 'tool.result') {
    const name = typeof event.event.data.name === 'string' ? event.event.data.name : 'DSH tool';
    const input = typeof event.event.data.input === 'string' ? event.event.data.input : undefined;
    const output = typeof event.event.data.output === 'string' ? event.event.data.output : text || undefined;
    const status = event.event.type === 'tool.call' ? 'running' : event.event.data.error ? 'failed' : 'complete';
    return { id: messageId(event), role: 'tool', text: '', timestamp, sourceSeq: event.sourceSeq, tool: { name, input, output, status } };
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
