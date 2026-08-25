import { describe, expect, it } from 'vitest';
import type { Node, SessionSummary } from './types';
import { filterHistorySessions, groupHistorySessions, type HistorySession } from './history';

const node: Node = {
  id: 'node-1',
  name: 'Martin Mac',
  platform: 'darwin',
  arch: 'arm64',
  pluginVersion: '0.2.0',
  dshVersion: 'test',
  createdAt: 1,
  lastSeenAt: 1,
  revokedAt: null,
  online: true,
};

function entry(id: string, title: string, updatedAt: number, workspaceLabel?: string): HistorySession {
  const session: SessionSummary = {
    nodeId: node.id,
    sessionId: id,
    title,
    status: 'idle',
    lastEventSeq: 1,
    createdAt: updatedAt,
    updatedAt,
    ...(workspaceLabel ? { workspaceLabel } : {}),
  };
  return { node, session };
}

describe('history sessions', () => {
  const july = new Date(2026, 6, 18, 12).getTime();
  const june = new Date(2026, 5, 10, 12).getTime();

  it('groups conversations by month and keeps the newest conversation first', () => {
    const groups = groupHistorySessions([
      entry('june', 'June chat', june),
      entry('july-old', 'Older July chat', july),
      entry('july-new', 'Newer July chat', july + 1000),
    ], 'zh');

    expect(groups.map((group) => group.label)).toEqual(['2026年7月', '2026年6月']);
    expect(groups[0]?.sessions.map(({ session }) => session.sessionId)).toEqual(['july-new', 'july-old']);
  });

  it('searches titles, workspaces, and connected node names without case sensitivity', () => {
    const sessions = [
      entry('one', 'Portfolio review', july, 'DSH Mobile'),
      entry('two', 'Release checklist', june, 'Connector'),
    ];

    expect(filterHistorySessions(sessions, 'portfolio').map(({ session }) => session.sessionId)).toEqual(['one']);
    expect(filterHistorySessions(sessions, 'mobile').map(({ session }) => session.sessionId)).toEqual(['one']);
    expect(filterHistorySessions(sessions, 'MARTIN MAC')).toHaveLength(2);
  });
});
