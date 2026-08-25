import { describe, expect, it } from 'vitest';

import { normalizeDshEvent } from './protocol.js';

describe('normalizeDshEvent', () => {
  it('preserves native DSH source sequence zero and maps user content', () => {
    expect(normalizeDshEvent({
      seq: 0,
      time: 123,
      type: 'user/message',
      data: { content: [{ type: 'text', text: 'hello' }] },
    })).toEqual({
      sourceSeq: 0,
      createdAt: 123,
      event: { type: 'user.message', data: { text: 'hello' } },
    });
  });

  it('maps streaming text and tool cards without exposing raw DSH envelopes', () => {
    expect(normalizeDshEvent({
      seq: 4,
      time: 456,
      type: 'assistant/chunk',
      data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'working' } },
    })?.event).toEqual({ type: 'assistant.delta', data: { text: 'working' } });

    expect(normalizeDshEvent({
      seq: 5,
      time: 457,
      type: 'tool/call',
      data: { callId: 'call-1', name: 'shell', arguments: '{"cmd":"pwd"}' },
    })?.event).toEqual({
      type: 'tool.call',
      data: { toolCallId: 'call-1', name: 'shell', input: '{"cmd":"pwd"}' },
    });
  });

  it('maps the native durable session title projection', () => {
    expect(normalizeDshEvent({
      seq: 6,
      time: 458,
      type: 'session/title',
      data: { title: '探索深海模型', source: 'generated' },
    })?.event).toEqual({ type: 'session.title', data: { title: '探索深海模型' } });
  });

  it('ignores internal events outside the public canonical contract', () => {
    expect(normalizeDshEvent({ seq: 8, time: 500, type: 'request/header', data: {} })).toBeNull();
  });
});
