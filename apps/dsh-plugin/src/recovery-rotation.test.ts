import { describe, expect, it } from 'vitest';

import { shouldRotateRecoveryAfterReconnect } from './index.js';

describe('recovery credential rotation', () => {
  it('rotates only when a paired Connector changes Hub endpoint', () => {
    expect(shouldRotateRecoveryAfterReconnect(true, 'node-1')).toBe(true);
    expect(shouldRotateRecoveryAfterReconnect(false, 'node-1')).toBe(false);
    expect(shouldRotateRecoveryAfterReconnect(true, undefined)).toBe(false);
  });
});
