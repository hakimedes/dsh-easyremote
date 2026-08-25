import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { BrandMark, Card, PrimaryButton, Screen, WhaleMark } from '@/ui/primitives';
import { useAppStore } from '@/state/app-store';
import { spacing, type, useTheme } from '@/ui/theme';

export default function PairingSuccessScreen() {
  const theme = useTheme();
  const router = useRouter();
  const pairing = useAppStore((state) => state.activePairing);

  return <Screen scroll={false} style={styles.screen} edges={['top', 'bottom']}>
    <BrandMark />
    <View style={styles.center}>
      <View style={styles.markWrap}><WhaleMark size={108} /><View style={[styles.check, { backgroundColor: theme.colors.accent, borderColor: theme.colors.background }]}><Ionicons name="checkmark" size={22} color={theme.colors.accentInk} /></View></View>
      <Text style={[styles.kicker, { color: theme.colors.accent }]}>CONNECTED</Text>
      <Text style={[styles.title, { color: theme.colors.text }]}>Your Harness is ready.</Text>
      <Text style={[styles.body, { color: theme.colors.muted }]}>This phone can now continue sessions and approve work while your computer remains the source of truth.</Text>
      <Card style={styles.nodeMeta}><View style={[styles.nodeIcon, { backgroundColor: `${theme.colors.accent}12` }]}><Ionicons name="desktop-outline" size={21} color={theme.colors.accent} /></View><View style={styles.nodeCopy}><Text numberOfLines={1} style={[styles.nodeName, { color: theme.colors.text }]}>{pairing?.nodeName || 'DeepSeek Harness'}</Text><Text style={[styles.nodeType, { color: theme.colors.muted }]}>Online · Ready for control</Text></View><View style={[styles.dot, { backgroundColor: theme.colors.accent }]} /></Card>
    </View>
    <View style={styles.footer}><PrimaryButton label="Continue" icon="arrow-forward" onPress={() => router.replace('/home')} /><Text style={[styles.footnote, { color: theme.colors.faint }]}>You will not need to scan again on this phone.</Text></View>
  </Screen>;
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: spacing.xl },
  markWrap: { position: 'relative', marginBottom: spacing.xl },
  check: { position: 'absolute', right: -2, bottom: -2, width: 38, height: 38, borderRadius: 19, borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontSize: type.micro, letterSpacing: 1.8, fontWeight: '800', marginBottom: spacing.sm },
  title: { textAlign: 'center', fontSize: 30, lineHeight: 38, fontWeight: '700', letterSpacing: -0.6 },
  body: { textAlign: 'center', fontSize: type.body, lineHeight: 24, maxWidth: 340, marginTop: spacing.sm },
  nodeMeta: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl },
  nodeIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  nodeCopy: { flex: 1, minWidth: 0, gap: 3 },
  nodeName: { fontSize: type.body, fontWeight: '700' },
  nodeType: { fontSize: type.caption },
  dot: { width: 8, height: 8, borderRadius: 4 },
  footer: { gap: spacing.md },
  footnote: { textAlign: 'center', fontSize: type.caption },
});
