import { Stack } from 'expo-router';
import { useTheme } from '@/ui/theme';

export default function TabLayout() {
  const theme = useTheme();
  return <Stack
    screenOptions={{
      headerShown: false,
      animation: 'slide_from_right',
      contentStyle: { backgroundColor: theme.colors.background },
    }}
  >
    <Stack.Screen name="home" />
    <Stack.Screen name="settings" />
    <Stack.Screen name="sessions" />
    <Stack.Screen name="nodes" />
  </Stack>;
}
