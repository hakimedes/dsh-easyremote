import type { Node, SessionMessage, SessionSummary } from './types';

export type HomeSessionEntry = { session: SessionSummary; node: Node };

export function selectHomeSession(
  items: HomeSessionEntry[],
  lockedKey: string | null,
): { selected?: HomeSessionEntry; newerAvailable: boolean } {
  const ordered = [...items].sort((left, right) => right.session.updatedAt - left.session.updatedAt);
  const latest = ordered[0];
  if (!latest) return { newerAvailable: false };
  if (!lockedKey) return { selected: latest, newerAvailable: false };
  const locked = ordered.find(({ node, session }) => `${node.id}:${session.sessionId}` === lockedKey);
  if (!locked) return { selected: latest, newerAvailable: false };
  return {
    selected: locked,
    newerAvailable: latest.session.sessionId !== locked.session.sessionId
      && latest.session.updatedAt > locked.session.updatedAt,
  };
}

export function lastConversationTurn(messages: SessionMessage[]) {
  let userIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      userIndex = index;
      break;
    }
  }
  if (userIndex < 0) {
    const assistant = [...messages].reverse().find((message) => message.role === 'assistant');
    return assistant ? [assistant] : [];
  }
  const turn = [messages[userIndex]!];
  const assistant = [...messages.slice(userIndex + 1)].reverse()
    .find((message) => message.role === 'assistant');
  if (assistant) turn.push(assistant);
  return turn;
}
