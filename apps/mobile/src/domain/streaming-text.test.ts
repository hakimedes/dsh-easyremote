import { describe, expect, it } from 'vitest';
import { nextStreamingTextLength } from './streaming-text';

describe('nextStreamingTextLength', () => {
  it('reveals small deltas gently and catches up faster for large buffered chunks', () => {
    expect(nextStreamingTextLength(0, 8)).toBe(2);
    expect(nextStreamingTextLength(0, 60)).toBe(4);
    expect(nextStreamingTextLength(0, 180)).toBe(10);
    expect(nextStreamingTextLength(0, 500)).toBe(24);
  });

  it('never runs beyond the canonical text', () => {
    expect(nextStreamingTextLength(9, 10)).toBe(10);
    expect(nextStreamingTextLength(10, 10)).toBe(10);
  });
});
