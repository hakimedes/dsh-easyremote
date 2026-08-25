import { describe, expect, it } from 'vitest';

import { modelSelectionLabel, selectDefaultPreset } from './session-config';

describe('selectDefaultPreset', () => {
  it('ignores a broken default and picks the first usable agent preset', () => {
    expect(selectDefaultPreset([
      { id: 'broken', trust: 'user', isDefault: true, broken: 'Missing plugin' },
      { id: 'standard', trust: 'system', isDefault: false, name: 'Standard mode' },
    ])?.id).toBe('standard');
  });
});

describe('modelSelectionLabel', () => {
  it('uses catalog display metadata for the current model', () => {
    expect(modelSelectionLabel({
      current: { provider: 'deepseek', model: 'deepseek-chat' },
      routable: true,
      failures: [],
      groups: [{
        id: 'deepseek',
        name: 'DeepSeek',
        models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
      }],
    })).toBe('DeepSeek Chat');
  });

  it('falls back to the current model id when it is absent from the catalog', () => {
    expect(modelSelectionLabel({
      current: { provider: 'custom', model: 'private-model' },
      routable: true,
      failures: [],
      groups: [],
    })).toBe('private-model');
  });
});
