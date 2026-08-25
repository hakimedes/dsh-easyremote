import type { Node, SessionSummary } from './types';

export type HistorySession = {
  node: Node;
  session: SessionSummary;
};

export type HistoryMonth = {
  key: string;
  label: string;
  sessions: HistorySession[];
};

function normalized(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function filterHistorySessions(sessions: HistorySession[], query: string) {
  const needle = normalized(query);
  if (!needle) return sessions;
  return sessions.filter(({ node, session }) => normalized([
    session.title,
    session.workspaceLabel || '',
    node.name,
  ].join(' ')).includes(needle));
}

export function groupHistorySessions(sessions: HistorySession[], language: 'zh' | 'en'): HistoryMonth[] {
  const sorted = [...sessions].sort((left, right) => right.session.updatedAt - left.session.updatedAt);
  const groups = new Map<string, HistoryMonth>();

  for (const entry of sorted) {
    const date = new Date(entry.session.updatedAt);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const existing = groups.get(key);
    if (existing) {
      existing.sessions.push(entry);
      continue;
    }
    groups.set(key, {
      key,
      label: language === 'zh'
        ? `${year}年${month}月`
        : new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(date),
      sessions: [entry],
    });
  }

  return [...groups.values()];
}
