import type { SessionMessage } from '../domain/types';
import { contentFingerprint, parseRenderUiInput, splitRichContent, type GenuiSpec } from './protocol';

export type SessionPanel = { spec: GenuiSpec; stateKey: string };

function appendPanel(previous: GenuiSpec | null, incoming: GenuiSpec) {
  if (!previous || !incoming.append) return { ...incoming, panel: true, append: false };
  const previousTabs = previous.items.length === 1 && previous.items[0]?.type === 'tabs' ? previous.items[0] : null;
  const incomingTabs = incoming.items.length === 1 && incoming.items[0]?.type === 'tabs' ? incoming.items[0] : null;
  if (previousTabs && incomingTabs && Array.isArray(previousTabs.tabs) && Array.isArray(incomingTabs.tabs)) {
    const tabs: Array<Record<string, unknown>> = previousTabs.tabs.map((tab) => ({ ...(tab as Record<string, unknown>), items: [...((tab as Record<string, unknown>).items as unknown[] || [])] }));
    for (const raw of incomingTabs.tabs) {
      const tab = raw as Record<string, unknown>;
      const match = tabs.find((item) => item.label === tab.label);
      if (match) match.items = [...(match.items as unknown[]), ...(Array.isArray(tab.items) ? tab.items : [])];
      else tabs.push({ ...tab });
    }
    return { ...incoming, append: false, items: [{ ...incomingTabs, tabs }] };
  }
  return { ...incoming, append: false, items: [...previous.items, ...incoming.items] };
}
export function collectSessionPanel(messages: SessionMessage[], hubKey: string, sessionId: string): SessionPanel | null {
  let panel: GenuiSpec | null = null;
  let stateKey = '';
  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const segment of splitRichContent(message.text, Boolean(message.streaming))) {
        if (segment.type !== 'genui' || !segment.spec.panel || segment.partial) continue;
        panel = appendPanel(panel, segment.spec);
        stateKey = `${hubKey}:${sessionId}:${message.sourceSeq}:${segment.fenceIndex}:${contentFingerprint(segment.raw)}`;
      }
    }
    if (message.role === 'tool' && message.tool?.name === 'render_ui') {
      const spec = parseRenderUiInput(message.tool.input);
      if (!spec?.panel) continue;
      panel = appendPanel(panel, spec);
      stateKey = `${hubKey}:${sessionId}:${message.sourceSeq}:tool:${contentFingerprint(message.tool.input || '')}`;
    }
  }
  return panel && stateKey ? { spec: panel, stateKey } : null;
}
