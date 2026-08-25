import { describe, expect, it } from 'vitest';

import type { Node, SessionMessage, SessionSummary } from './types';
import { lastConversationTurn, selectHomeSession } from './home-session';

const node: Node = {
  id: 'node-1',
  name: 'Harness',
  platform: 'darwin',
  arch: 'arm64',
  pluginVersion: '0.2.0',
  dshVersion: 'test',
  createdAt: 1,
  lastSeenAt: 1,
  revokedAt: null,
  online: true,
};

function session(sessionId: string, updatedAt: number): SessionSummary {
  return {
    nodeId: node.id,
    sessionId,
    title: sessionId,
    status: 'idle',
    lastEventSeq: 1,
    createdAt: 1,
    updatedAt,
  };
}

describe('selectHomeSession', () => {
  it('selects the most recently updated conversation without prioritizing running status', () => {
    const oldRunning = { session: { ...session('running-old', 100), status: 'running' as const }, node };
    const recentIdle = { session: session('idle-recent', 200), node };

    expect(selectHomeSession([oldRunning, recentIdle], null)).toEqual({
      selected: recentIdle,
      newerAvailable: false,
    });
  });

  it('keeps a focused Home session pinned while reporting a newer conversation', () => {
    const pinned = { session: session('pinned', 100), node };
    const newer = { session: session('newer', 300), node };

    expect(selectHomeSession([newer, pinned], 'node-1:pinned')).toEqual({
      selected: pinned,
      newerAvailable: true,
    });
  });
});

describe('lastConversationTurn', () => {
  it('returns only the latest user message and the assistant reply after it', () => {
    const messages: SessionMessage[] = [
      { id: 'u1', role: 'user', text: 'old question', timestamp: 1, sourceSeq: 1 },
      { id: 'a1', role: 'assistant', text: 'old answer', timestamp: 2, sourceSeq: 2 },
      { id: 't1', role: 'tool', text: '', timestamp: 3, sourceSeq: 3, tool: { name: 'shell', status: 'complete' } },
      { id: 'u2', role: 'user', text: 'latest question', timestamp: 4, sourceSeq: 4 },
      { id: 'a2', role: 'assistant', text: 'latest answer', timestamp: 5, sourceSeq: 5 },
    ];

    expect(lastConversationTurn(messages).map((message) => message.id)).toEqual(['u2', 'a2']);
  });
});
