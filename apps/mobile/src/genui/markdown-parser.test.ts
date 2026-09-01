import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from './markdown-parser';
import { sanitizeSvgXml, SVG_PREVIEW_MAX_CHARS } from './svg-preview';

describe('safe mobile markdown', () => {
  it('parses headings, lists, code, images and horizontal tables', () => {
    const blocks = parseMarkdown('# Title\n\n- One\n- Two\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```ts\nconst x = 1\n```\n\n![plot](https://example.com/chart.png)');
    expect(blocks.map((block) => block.type)).toEqual(['heading', 'list', 'table', 'code', 'image']);
  });

  it('keeps raw HTML inert and rejects active links', () => {
    expect(parseMarkdown('<script>alert(1)</script>')).toEqual([{ type: 'paragraph', text: '<script>alert(1)</script>' }]);
    expect(parseInline('[bad](javascript:alert(1))')).toEqual([{ type: 'text', text: '[bad](javascript:alert(1))' }]);
  });

  it('classifies a fenced SVG as a preview instead of executable markup or plain code', () => {
    expect(parseMarkdown('```svg\n<svg viewBox="0 0 100 50"><rect width="100" height="50" /></svg>\n```')).toEqual([
      { type: 'svg', xml: '<svg viewBox="0 0 100 50"><rect width="100" height="50" /></svg>' },
    ]);
  });

  it('preserves an over-limit marker so oversized fenced SVG cannot become a truncated valid preview', () => {
    const blocks = parseMarkdown(`\`\`\`svg\n<svg><text>${'x'.repeat(SVG_PREVIEW_MAX_CHARS)}</text></svg>\n\`\`\``);
    const block = blocks[0];
    expect(block?.type).toBe('svg');
    if (!block || block.type !== 'svg') throw new Error('Expected SVG block');
    expect(() => sanitizeSvgXml(block.xml)).toThrow(/too large/i);
  });
});
