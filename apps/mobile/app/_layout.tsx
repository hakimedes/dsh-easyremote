import 'react-native-gesture-handler';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApprovalSheet } from '@/ui/approval-sheet';
import { useAppBootstrap, useAppStore } from '@/state/app-store';
import { LaunchExperience } from '@/ui/launch-experience';
import { useTheme } from '@/ui/theme';

const queryClient = new QueryClient();

export default function RootLayout() {
  const bootstrap = useAppBootstrap();
  const theme = useTheme();
  const initialSyncComplete = useAppStore((state) => state.initialSyncComplete);

  useEffect(() => { void bootstrap(); }, [bootstrap]);

  return <GestureHandlerRootView style={{ flex: 1 }}>
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style={theme.isDark ? 'light' : 'dark'} backgroundColor={theme.colors.background} />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background }, animation: 'slide_from_right' }} />
        <ApprovalSheet />
        <LaunchExperience ready={initialSyncComplete} />
      </SafeAreaProvider>
    </QueryClientProvider>
  </GestureHandlerRootView>;
}
