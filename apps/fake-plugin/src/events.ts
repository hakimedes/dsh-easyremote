export type CanonicalEvent = {
  type: string;
  data: Record<string, unknown>;
};

export function buildFollowupEvents(content: string): CanonicalEvent[] {
  return [
    { type: 'user.message', data: { text: content } },
    { type: 'turn.start', data: {} },
    { type: 'assistant.delta', data: { text: `received followup: ${content}` } },
    { type: 'assistant.message', data: { text: `done: ${content}` } },
    { type: 'turn.end', data: {} },
  ];
}
