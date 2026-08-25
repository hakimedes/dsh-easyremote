export type AppearancePreference = 'system' | 'light' | 'dark';
export type LanguagePreference = 'zh' | 'en';

export function resolveAppearance(preference: AppearancePreference, systemScheme: 'light' | 'dark' | null | undefined) {
  if (preference === 'light' || preference === 'dark') return preference;
  return systemScheme === 'dark' ? 'dark' : 'light';
}

export function resolveLanguage(value: string | null | undefined): LanguagePreference {
  return value === 'en' ? 'en' : 'zh';
}
