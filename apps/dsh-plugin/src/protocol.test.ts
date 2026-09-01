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
      event: { type: 'user.message', data: { text: 'hello', blocks: [{ type: 'text', text: 'hello' }] } },
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

    expect(normalizeDshEvent({
      seq: 6,
      time: 458,
      type: 'tool/call',
      data: { callId: 'call-ui', name: 'render_ui', arguments: { spec: { items: [{ type: 'text', content: 'Hello' }] } } },
    })?.event.data.input).toBe('{"spec":{"items":[{"type":"text","content":"Hello"}]}}');
  });

  it('maps the native durable session title projection', () => {
    expect(normalizeDshEvent({
      seq: 6,
      time: 458,
      type: 'session/title',
      data: { title: '探索深海模型', source: 'generated' },
    })?.event).toEqual({ type: 'session.title', data: { title: '探索深海模型' } });
  });

  it('publishes durable image metadata without exposing attachment bytes', () => {
    const normalized = normalizeDshEvent({
      seq: 7,
      time: 459,
      type: 'user/message',
      data: {
        content: [
          { type: 'text', text: 'Describe this whale' },
          {
            type: 'image',
            attachment: {
              attachmentId: 'sha256:opaque',
              mediaType: 'image/png',
              bytes: 1234,
              width: 640,
              height: 480,
              name: 'whale.png',
            },
          },
        ],
      },
    });
    expect(normalized?.event).toEqual({
      type: 'user.message',
      data: {
        text: 'Describe this whale',
        blocks: [
          { type: 'text', text: 'Describe this whale' },
          {
            type: 'image', attachmentId: 'sha256:opaque', mediaType: 'image/png',
            bytes: 1234, width: 640, height: 480, name: 'whale.png',
          },
        ],
      },
    });
    expect(JSON.stringify(normalized)).not.toContain('base64');
  });

  it('publishes native images nested inside tool results even when DSH Web does not render them', () => {
    const toolNames = new Map<string, string>();
    normalizeDshEvent({
      seq: 8,
      time: 460,
      type: 'tool/call',
      data: { callId: 'call-image', name: 'generate_image', arguments: '{}' },
    }, toolNames);
    const normalized = normalizeDshEvent({
      seq: 9,
      time: 461,
      type: 'tool/result',
      data: {
        message: {
          content: [{
            type: 'tool-result',
            toolCallId: 'call-image',
            content: [{
              type: 'image',
              attachment: {
                attachmentId: 'sha256:tool-image', mediaType: 'image/png',
                bytes: 64, width: 8, height: 8, name: 'generated.png',
              },
            }],
          }],
        },
      },
    }, toolNames);
    expect(normalized?.event).toEqual({
      type: 'tool.result',
      data: {
        toolCallId: 'call-image',
        name: 'generate_image',
        output: '',
        blocks: [{
          type: 'image', attachmentId: 'sha256:tool-image', mediaType: 'image/png',
          bytes: 64, width: 8, height: 8, name: 'generated.png',
        }],
      },
    });
  });

  it('ignores internal events outside the public canonical contract', () => {
    expect(normalizeDshEvent({ seq: 8, time: 500, type: 'request/header', data: {} })).toBeNull();
  });
});
