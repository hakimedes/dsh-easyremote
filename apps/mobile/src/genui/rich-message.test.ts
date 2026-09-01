import { describe, expect, it } from 'vitest';
import type { SessionMessage } from '../domain/types';
import { collectSessionPanel } from './panel';
import { withoutWorkspaceMediaMarkdown } from './workspace-media';

describe('session panel collection', () => {
  it('replaces and appends settled panel specs while ignoring streaming partials', () => {
    const messages: SessionMessage[] = [
      { id: '1', role: 'assistant', text: '```dsh-ui\n{"panel":true,"items":[{"type":"text","content":"A"}]}\n```', timestamp: 1, sourceSeq: 1 },
      { id: '2', role: 'assistant', text: '```dsh-ui\n{"panel":true,"append":true,"items":[{"type":"text","content":"B"}]}\n```', timestamp: 2, sourceSeq: 2 },
      { id: '3', role: 'assistant', text: '```dsh-ui\n{"panel":true,"items":[{"type":"text","content":"C"}', timestamp: 3, sourceSeq: 3, streaming: true },
    ];
    const panel = collectSessionPanel(messages, 'hub', 'session');
    expect(panel?.spec.items.map((item) => item.content)).toEqual(['A', 'B']);
  });
});

describe('workspace media markdown', () => {
  it('hides only explicit markdown images already represented by an artifact block', () => {
    expect(withoutWorkspaceMediaMarkdown(
      'Preview:\n\n![Mickey](art/mickey.svg)\n\nKeep `art/mickey.svg` for later.',
      ['art/mickey.svg'],
    )).toBe('Preview:\n\nKeep `art/mickey.svg` for later.');
  });

  it('does not remove external images or unrelated workspace paths', () => {
    const source = '![Remote](https://example.com/a.png)\n![Other](art/other.svg)';
    expect(withoutWorkspaceMediaMarkdown(source, ['art/mickey.svg'])).toBe(source);
  });
});
