import { useColorScheme } from 'react-native';
import { resolveAppearance } from '../domain/preferences';
import { usePreferencesStore } from '../state/preferences-store';

export const darkTheme = {
  colors: {
    background: '#0F1115',
    surface: '#181A20',
    surfaceRaised: '#20232B',
    surfaceSoft: '#252830',
    line: '#30343D',
    text: '#F5F7FA',
    muted: '#A6AAB4',
    faint: '#737985',
    accent: '#6D84FF',
    accentInk: '#FFFFFF',
    coral: '#FF7875',
    amber: '#F5B94C',
    blue: '#6D84FF',
    danger: '#FF7875',
    white: '#FFFFFF',
    black: '#000000',
  },
  isDark: true,
};

export const lightTheme = {
  colors: {
    background: '#FFFFFF',
    surface: '#F5F6F8',
    surfaceRaised: '#FFFFFF',
    surfaceSoft: '#F0F2F5',
    line: '#E5E6EB',
    text: '#171A1F',
    muted: '#656B76',
    faint: '#9AA0AA',
    accent: '#4D6BFE',
    accentInk: '#FFFFFF',
    coral: '#E95C59',
    amber: '#D98B21',
    blue: '#4D6BFE',
    danger: '#D94A48',
    white: '#FFFFFF',
    black: '#000000',
  },
  isDark: false,
};

export type AppTheme = typeof darkTheme;

export function useTheme(): AppTheme {
  const systemScheme = useColorScheme();
  const appearance = usePreferencesStore((state) => state.appearance);
  return resolveAppearance(appearance, systemScheme) === 'dark' ? darkTheme : lightTheme;
}

export const spacing = {
  xs: 5,
  sm: 9,
  md: 14,
  lg: 20,
  xl: 28,
  xxl: 40,
};

export const radii = {
  sm: 8,
  md: 14,
  lg: 20,
  pill: 999,
};

export const type = {
  display: 32,
  title: 25,
  heading: 18,
  body: 16,
  caption: 13,
  micro: 11,
};
