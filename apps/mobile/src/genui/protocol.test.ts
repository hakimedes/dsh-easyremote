import { describe, expect, it } from 'vitest';
import { collectPartialCandidates, GENUI_LIMITS, parsePartialGenuiSpec, parseRenderUiInput, sanitizeGenuiSpec, splitRichContent } from './protocol';

describe('mobile dsh-ui protocol', () => {
  it('renders only closed nodes from a streaming fence', () => {
    const source = '{"title":"Live","items":[{"type":"text","content":"ready"},{"type":"card","items":[{"type":"tex';
    expect(parsePartialGenuiSpec(source)).toEqual({ title: 'Live', items: [{ type: 'text', content: 'ready' }] });
    expect(collectPartialCandidates(source).length).toBeLessThanOrEqual(32);
  });

  it('repairs a settled trailing comma but returns a diagnostic for unsafe JSON', () => {
    const repaired = splitRichContent('Before\n```dsh-ui\n{"items":[{"type":"text","content":"ok"},]}\n```\nAfter');
    expect(repaired.map((segment) => segment.type)).toEqual(['markdown', 'genui', 'markdown']);
    const unsafe = splitRichContent('```dsh-ui\n{"items":[{"type":"iframe","src":"https://evil.invalid"}]}\n```');
    expect(unsafe[0]?.type).toBe('diagnostic');
  });

  it('enforces node/depth/string limits and strips executable chart fields', () => {
    const many = Array.from({ length: 240 }, (_, index) => ({ type: 'text', content: `${index}`.repeat(3_000) }));
    const spec = sanitizeGenuiSpec({ items: many });
    expect(spec?.items).toHaveLength(GENUI_LIMITS.maxNodes);
    expect(String(spec?.items[0]?.content)).toHaveLength(GENUI_LIMITS.maxString);
    const chart = sanitizeGenuiSpec({ items: [{ type: 'echart', option: { series: [{ type: 'bar', data: [1, 2] }], formatter: 'javascript:alert(1)', graphic: [{ image: 'https://evil.invalid' }] } }] });
    expect(chart?.items[0]?.option).toEqual({ series: [{ type: 'bar', data: [1, 2] }] });
  });

  it('blocks sensitive fields and accepts render_ui tool argument wrappers', () => {
    const spec = parseRenderUiInput(JSON.stringify({ spec: { panel: true, items: [{ type: 'input', id: 'api_token', label: 'Token' }] } }));
    expect(spec?.panel).toBe(true);
    expect(spec?.items[0]?.sensitive).toBe(true);
  });
});
