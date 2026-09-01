import { describe, expect, it } from 'vitest';
import type { SessionEvent, SessionSummary } from '../domain/types';
import { emptySessionView, messagesFromSnapshot, reduceSessionEvents } from './session-reducer';

const summary: SessionSummary = {
  nodeId: 'node-1',
  sessionId: 'session-1',
  title: 'Test session',
  status: 'running',
  lastEventSeq: 0,
  createdAt: 1,
  updatedAt: 1,
};

function event(sourceSeq: number, type: SessionEvent['event']['type'], data: Record<string, unknown>): SessionEvent {
  return { v: 1, kind: 'session.event', nodeId: summary.nodeId, sessionId: summary.sessionId, sourceSeq, event: { type, data } };
}

describe('reduceSessionEvents', () => {
  it('batches assistant deltas into one visible message and ignores duplicates', () => {
    const view = emptySessionView(summary);
    const next = reduceSessionEvents(view, [
      event(1, 'assistant.delta', { text: 'Ship ' }),
      event(2, 'assistant.delta', { text: 'it.' }),
      event(2, 'assistant.delta', { text: 'duplicate' }),
    ]);

    expect(next.lastSourceSeq).toBe(2);
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0]?.text).toBe('Ship it.');
  });

  it('settles the streamed assistant message without appending a duplicate final block', () => {
    const next = reduceSessionEvents(emptySessionView(summary), [
      event(1, 'assistant.delta', { text: '探索' }),
      event(2, 'assistant.delta', { text: '未至之境' }),
      event(3, 'assistant.message', { text: '探索未至之境' }),
    ]);

    expect(next.messages).toHaveLength(1);
    expect(next.messages[0]).toMatchObject({ text: '探索未至之境', sourceSeq: 3 });
  });

  it('applies a durable session title event without creating a transcript row', () => {
    const next = reduceSessionEvents(emptySessionView(summary), [
      event(1, 'session.title', { title: '深海探索计划' }),
    ]);

    expect(next.session.title).toBe('深海探索计划');
    expect(next.messages).toEqual([]);
  });

  it('turn.end returns the agent to a non-running state', () => {
    const next = reduceSessionEvents(emptySessionView(summary), [event(1, 'turn.end', {})]);
    expect(next.isRunning).toBe(false);
  });

  it('keeps the first native DSH event whose source sequence is zero', () => {
    const next = messagesFromSnapshot([
      { sourceSeq: 0, event: { type: 'user.message', data: { text: 'first event' } } },
    ], summary.nodeId, summary.sessionId);

    expect(next.messages[0]?.text).toBe('first event');
    expect(next.lastSourceSeq).toBe(0);
  });

  it('keeps signed workspace media on the tool result that created it', () => {
    const next = reduceSessionEvents(emptySessionView(summary), [
      event(1, 'tool.result', {
        name: 'write',
        output: 'Created art/mickey.svg',
        blocks: [{
          type: 'workspace-media',
          artifactId: 'signed.artifact',
          mediaType: 'image/svg+xml',
          bytes: 321,
          name: 'mickey.svg',
          path: 'art/mickey.svg',
          source: 'tool',
        }],
      }),
    ]);

    expect(next.messages[0]).toMatchObject({
      role: 'tool',
      blocks: [{
        type: 'workspace-media',
        artifactId: 'signed.artifact',
        path: 'art/mickey.svg',
        source: 'tool',
      }],
    });
  });

  it('keeps the paths that must be hidden when a Markdown preview duplicates a tool artifact', () => {
    const next = reduceSessionEvents(emptySessionView(summary), [
      event(1, 'assistant.message', {
        text: '![Mickey](art/mickey.svg)',
        suppressedWorkspaceMediaPaths: ['art/mickey.svg'],
      }),
    ]);

    expect(next.messages[0]).toMatchObject({
      text: '![Mickey](art/mickey.svg)',
      suppressedWorkspaceMediaPaths: ['art/mickey.svg'],
    });
  });
});
