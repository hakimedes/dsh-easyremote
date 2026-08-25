import { describe, expect, it } from 'vitest';
import { resolveAppearance, resolveLanguage } from './preferences';

describe('mobile preferences', () => {
  it('follows the system appearance until the user chooses an override', () => {
    expect(resolveAppearance('system', 'dark')).toBe('dark');
    expect(resolveAppearance('system', null)).toBe('light');
    expect(resolveAppearance('light', 'dark')).toBe('light');
    expect(resolveAppearance('dark', 'light')).toBe('dark');
  });

  it('uses Chinese by default and preserves an explicit English preference', () => {
    expect(resolveLanguage(null)).toBe('zh');
    expect(resolveLanguage('zh')).toBe('zh');
    expect(resolveLanguage('en')).toBe('en');
    expect(resolveLanguage('unsupported')).toBe('zh');
  });
});
