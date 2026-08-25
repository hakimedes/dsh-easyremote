import { describe, expect, it } from 'vitest';

import { buildFollowupEvents } from './events.js';

describe('buildFollowupEvents', () => {
  it('emits the canonical user message and turn boundaries in source order', () => {
    const events = buildFollowupEvents('run the tests');

    expect(events.map((event) => event.type)).toEqual([
      'user.message',
      'turn.start',
      'assistant.delta',
      'assistant.message',
      'turn.end',
    ]);
    expect(events[0]?.data).toEqual({ text: 'run the tests' });
    expect(events[2]?.data).toEqual({ text: 'received followup: run the tests' });
    expect(events[3]?.data).toEqual({ text: 'done: run the tests' });
  });
});
