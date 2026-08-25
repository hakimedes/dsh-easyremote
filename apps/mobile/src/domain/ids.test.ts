import { describe, expect, it } from 'vitest';
import { isUuidv7, uuidv7 } from './ids';

describe('uuidv7', () => {
  it('creates sortable UUIDv7 request ids', () => {
    const value = uuidv7(1_750_000_000_000);
    expect(isUuidv7(value)).toBe(true);
    expect(value[14]).toBe('7');
  });
});
