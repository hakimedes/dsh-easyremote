import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from './markdown-parser';

describe('safe mobile markdown', () => {
  it('parses headings, lists, code, images and horizontal tables', () => {
    const blocks = parseMarkdown('# Title\n\n- One\n- Two\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```ts\nconst x = 1\n```\n\n![plot](https://example.com/chart.png)');
    expect(blocks.map((block) => block.type)).toEqual(['heading', 'list', 'table', 'code', 'image']);
  });

  it('keeps raw HTML inert and rejects active links', () => {
    expect(parseMarkdown('<script>alert(1)</script>')).toEqual([{ type: 'paragraph', text: '<script>alert(1)</script>' }]);
    expect(parseInline('[bad](javascript:alert(1))')).toEqual([{ type: 'text', text: '[bad](javascript:alert(1))' }]);
  });
});
