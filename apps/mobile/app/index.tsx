import { useEffect } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { BrandMark, PrimaryButton, Screen, WhaleMark } from '@/ui/primitives';
import { useAppStore } from '@/state/app-store';
import { spacing, type, useTheme } from '@/ui/theme';

export default function IndexScreen() {
  const theme = useTheme();
  const router = useRouter();
  const bootstrapped = useAppStore((state) => state.bootstrapped);
  const isAuthenticated = useAppStore((state) => state.isAuthenticated);

  useEffect(() => {
    if (bootstrapped && isAuthenticated) router.replace('/home');
  }, [bootstrapped, isAuthenticated, router]);

  if (!bootstrapped) return <View style={[styles.loading, { backgroundColor: theme.colors.background }]}><ActivityIndicator color={theme.colors.accent} /></View>;
  if (isAuthenticated) return <Redirect href="/home" />;

  return <Screen scroll={false} style={styles.screen} edges={['top', 'bottom']}>
    <View style={styles.header}><BrandMark /><Text style={[styles.mobileLabel, { color: theme.colors.faint }]}>MOBILE</Text></View>
    <View style={styles.hero}>
      <WhaleMark size={108} />
      <Text style={[styles.title, { color: theme.colors.text }]}>Your Harness,{`\n`}within reach.</Text>
      <Text style={[styles.body, { color: theme.colors.muted }]}>Continue your local DeepSeek Harness sessions from anywhere. Your work stays on your computer.</Text>
      <View style={[styles.privacy, { backgroundColor: theme.colors.surface }]}><Ionicons name="shield-checkmark-outline" size={17} color={theme.colors.accent} /><Text style={[styles.privacyText, { color: theme.colors.muted }]}>Pair once · control stays private</Text></View>
    </View>
    <View style={styles.footer}>
      <PrimaryButton label="Scan Harness QR" icon="qr-code-outline" onPress={() => router.push('/scan')} />
      <Text style={[styles.footnote, { color: theme.colors.faint }]}>Open the pairing page in DeepSeek Harness Web.</Text>
    </View>
  </Screen>;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  screen: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.sm },
  mobileLabel: { fontSize: type.micro, fontWeight: '700', letterSpacing: 1.3 },
  hero: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: spacing.xl },
  title: { marginTop: spacing.xl, textAlign: 'center', fontSize: 34, lineHeight: 42, fontWeight: '700', letterSpacing: -0.9 },
  body: { marginTop: spacing.md, maxWidth: 340, textAlign: 'center', fontSize: type.body, lineHeight: 24 },
  privacy: { marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  privacyText: { fontSize: type.caption },
  footer: { gap: spacing.md },
  footnote: { textAlign: 'center', fontSize: type.caption, lineHeight: 18 },
});
