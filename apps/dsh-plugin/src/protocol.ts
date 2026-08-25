export type DshEvent = {
  seq: number;
  time: number;
  type: string;
  data: Record<string, unknown>;
};

export type CanonicalSessionEvent = {
  sourceSeq: number;
  createdAt: number;
  event: {
    type: string;
    data: Record<string, unknown>;
  };
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textFromBlocks(value: unknown): string {
  if (!Array.isArray(value)) return '';
  const text: string[] = [];
  for (const item of value) {
    const block = record(item);
    if (!block) continue;
    if ((block.type === 'text' || block.type === 'reasoning') && typeof block.text === 'string') {
      text.push(block.text);
      continue;
    }
    if (block.type === 'tool-result') {
      const nested = textFromBlocks(block.content);
      if (nested) text.push(nested);
    }
  }
  return text.join('\n').trim();
}

export function normalizeDshEvent(
  source: DshEvent,
  toolNames: Map<string, string> = new Map(),
): CanonicalSessionEvent | null {
  const envelope = (type: string, data: Record<string, unknown>): CanonicalSessionEvent => ({
    sourceSeq: source.seq,
    createdAt: source.time,
    event: { type, data },
  });

  switch (source.type) {
    case 'turn/start':
      return envelope('turn.start', {});
    case 'turn/end':
      return envelope('turn.end', {});
    case 'step/start':
      return envelope('step.start', {});
    case 'step/end':
      return envelope('step.end', {});
    case 'user/message': {
      const text = textFromBlocks(source.data.content);
      return text ? envelope('user.message', { text }) : null;
    }
    case 'assistant/chunk': {
      const chunk = record(source.data.chunk);
      return chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text
        ? envelope('assistant.delta', { text: chunk.text })
        : null;
    }
    case 'assistant/message': {
      const message = record(source.data.message);
      const text = textFromBlocks(message?.content);
      return text ? envelope('assistant.message', { text }) : null;
    }
    case 'session/title': {
      const title = typeof source.data.title === 'string' ? source.data.title.trim() : '';
      return title ? envelope('session.title', { title }) : null;
    }
    case 'tool/call': {
      const toolCallId = typeof source.data.callId === 'string' ? source.data.callId : '';
      const name = typeof source.data.name === 'string' && source.data.name ? source.data.name : 'DSH tool';
      if (toolCallId) toolNames.set(toolCallId, name);
      return envelope('tool.call', {
        toolCallId,
        name,
        input: typeof source.data.arguments === 'string' ? source.data.arguments : '',
      });
    }
    case 'tool/result': {
      const message = record(source.data.message);
      const block = Array.isArray(message?.content)
        ? message.content.map(record).find((item) => item?.type === 'tool-result')
        : undefined;
      const toolCallId = typeof block?.toolCallId === 'string'
        ? block.toolCallId
        : typeof source.data.callId === 'string'
          ? source.data.callId
          : '';
      const output = textFromBlocks(block?.content ?? message?.content);
      const name = toolNames.get(toolCallId) ?? 'DSH tool';
      if (toolCallId) toolNames.delete(toolCallId);
      return envelope('tool.result', {
        toolCallId,
        name,
        output,
        ...(source.data.error || block?.isError ? { error: true } : {}),
      });
    }
    default:
      return null;
  }
}
