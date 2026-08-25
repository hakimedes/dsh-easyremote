import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as LocalAuthentication from 'expo-local-authentication';
import { useAppStore } from '@/state/app-store';
import { radii, spacing, type, useTheme } from './theme';

export function ApprovalSheet() {
  const theme = useTheme();
  const approval = useAppStore((state) => state.approvals[0]);
  const respondApproval = useAppStore((state) => state.respondApproval);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!approval) return null;

  async function deny() {
    setBusy(true);
    try { await respondApproval(approval.approvalId, 'deny'); await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } finally { setBusy(false); }
  }

  async function allowOnce() {
    setError(null);
    setBusy(true);
    try {
      const hardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hardware || !enrolled) {
        setError('Device biometrics are required to allow a command.');
        return;
      }
      const auth = await LocalAuthentication.authenticateAsync({ promptMessage: 'Approve once', cancelLabel: 'Cancel', disableDeviceFallback: false });
      if (!auth.success) return;
      await respondApproval(approval.approvalId, 'allow_once');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally { setBusy(false); }
  }

  return <Modal visible transparent animationType="slide" onRequestClose={() => void deny()}>
    <View style={styles.scrim}><View style={[styles.sheet, { backgroundColor: theme.colors.background, borderColor: theme.colors.line }]}>
      <View style={[styles.handle, { backgroundColor: theme.colors.line }]} />
      <View style={styles.sheetHeader}><View style={[styles.approvalIcon, { backgroundColor: `${theme.colors.amber}12` }]}><Ionicons name="shield-checkmark-outline" size={23} color={theme.colors.amber} /></View><View style={styles.headerCopy}><Text style={[styles.eyebrow, { color: theme.colors.amber }]}>Remote approval</Text><Text style={[styles.title, { color: theme.colors.text }]}>Harness wants to run</Text></View></View>
      <Text selectable style={[styles.command, { color: theme.colors.text }]}>{approval.summary || approval.title}</Text>
      <View style={[styles.details, { backgroundColor: theme.colors.surface }]}><Detail label="Working directory" value={approval.cwd || 'Local workspace'} /><View style={[styles.divider, { backgroundColor: theme.colors.line }]} /><Detail label="Risk" value={approval.risk ? `${approval.risk[0].toUpperCase()}${approval.risk.slice(1)}` : 'Unknown'} /></View>
      {error && <View style={[styles.errorRow, { backgroundColor: `${theme.colors.danger}10` }]}><Ionicons name="alert-circle-outline" size={17} color={theme.colors.danger} /><Text style={[styles.error, { color: theme.colors.danger }]}>{error}</Text></View>}
      <View style={styles.actions}><Pressable disabled={busy} onPress={() => void deny()} style={[styles.deny, { backgroundColor: theme.colors.surface }]}><Text style={[styles.denyText, { color: theme.colors.text }]}>Deny</Text></Pressable><Pressable disabled={busy} onPress={() => void allowOnce()} style={[styles.allow, { backgroundColor: theme.colors.accent }]}>{busy ? <ActivityIndicator color={theme.colors.accentInk} /> : <View style={styles.allowCopy}><Ionicons name="finger-print" size={19} color={theme.colors.accentInk} /><Text style={[styles.allowText, { color: theme.colors.accentInk }]}>Allow once</Text></View>}</Pressable></View>
      <Text style={[styles.disclaimer, { color: theme.colors.faint }]}>Biometric confirmation is required. This request expires automatically.</Text>
    </View></View>
  </Modal>;
}

function Detail({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return <View style={styles.detail}><Text style={[styles.detailLabel, { color: theme.colors.muted }]}>{label}</Text><Text numberOfLines={1} style={[styles.detailValue, { color: theme.colors.text }]}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' },
  sheet: { borderTopWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, paddingBottom: spacing.xl },
  handle: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.lg },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  approvalIcon: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, gap: 2 },
  eyebrow: { fontSize: type.caption, lineHeight: 17, fontWeight: '600' },
  title: { fontSize: type.heading, lineHeight: 24, fontWeight: '700' },
  command: { fontSize: 20, lineHeight: 28, fontWeight: '600', marginBottom: spacing.md },
  details: { borderRadius: radii.md, paddingHorizontal: spacing.md, marginBottom: spacing.md },
  detail: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  detailLabel: { flex: 1, fontSize: type.caption },
  detailValue: { maxWidth: '60%', fontSize: type.caption, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth },
  errorRow: { flexDirection: 'row', gap: 7, borderRadius: 10, padding: spacing.sm, marginBottom: spacing.sm },
  error: { flex: 1, fontSize: type.caption, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  deny: { flex: 0.8, minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  denyText: { fontSize: type.body, fontWeight: '600' },
  allow: { flex: 1.4, minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  allowCopy: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  allowText: { fontSize: type.body, fontWeight: '700' },
  disclaimer: { textAlign: 'center', fontSize: type.micro, lineHeight: 16, marginTop: spacing.md },
});
