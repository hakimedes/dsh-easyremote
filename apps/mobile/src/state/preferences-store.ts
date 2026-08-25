import { create } from 'zustand';
import { resolveLanguage, type AppearancePreference, type LanguagePreference } from '../domain/preferences';
import { readAppPreference, writeAppPreference } from '../storage/database';

type PreferencesState = {
  appearance: AppearancePreference;
  language: LanguagePreference;
  setAppearance: (appearance: AppearancePreference) => void;
  setLanguage: (language: LanguagePreference) => void;
};

function initialAppearance(): AppearancePreference {
  const value = readAppPreference('appearance');
  return value === 'light' || value === 'dark' ? value : 'system';
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
  appearance: initialAppearance(),
  language: resolveLanguage(readAppPreference('language')),
  setAppearance: (appearance) => {
    writeAppPreference('appearance', appearance);
    set({ appearance });
  },
  setLanguage: (language) => {
    writeAppPreference('language', language);
    set({ language });
  },
}));
