import { describe, expect, it } from 'vitest';
import { isSvgImageSource, sanitizeSvgXml } from './svg-preview';

describe('safe SVG preview', () => {
  it('recognizes SVG media types and HTTPS paths with query strings', () => {
    expect(isSvgImageSource('https://example.com/asset', 'image/svg+xml; charset=utf-8')).toBe(true);
    expect(isSvgImageSource('https://example.com/chart.SVG?raw=1')).toBe(true);
    expect(isSvgImageSource('https://example.com/chart.png')).toBe(false);
  });

  it('accepts static SVG and derives a bounded preview ratio from its viewBox', () => {
    const result = sanitizeSvgXml('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 160"><rect width="320" height="160" fill="#111" /></svg>');
    expect(result).toEqual({
      xml: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 160"><rect width="320" height="160" fill="#111" /></svg>',
      aspectRatio: 2,
    });
  });

  it('rejects executable SVG features and external resource references', () => {
    expect(() => sanitizeSvgXml('<svg onload="alert(1)"><rect /></svg>')).toThrow(/event handler/i);
    expect(() => sanitizeSvgXml('<svg><script>alert(1)</script></svg>')).toThrow(/active content/i);
    expect(() => sanitizeSvgXml('<svg><image href="https://tracker.example/pixel.png" /></svg>')).toThrow(/external resource/i);
    expect(() => sanitizeSvgXml('<svg><rect fill="url(https://tracker.example/fill.svg)" /></svg>')).toThrow(/external resource/i);
  });

  it('rejects malformed or oversized SVG documents', () => {
    expect(() => sanitizeSvgXml('<html></html>')).toThrow(/svg root/i);
    expect(() => sanitizeSvgXml(`<svg><text>${'x'.repeat(1_000_001)}</text></svg>`)).toThrow(/too large/i);
  });
});
