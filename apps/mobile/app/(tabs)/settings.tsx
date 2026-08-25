import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { APP_VERSION } from '@/config';
import type { AppearancePreference, LanguagePreference } from '@/domain/preferences';
import { Card, Screen, SectionLabel, StatusPill, WhaleMark } from '@/ui/primitives';
import { useI18n } from '@/ui/i18n';
import { useAppStore } from '@/state/app-store';
import { usePreferencesStore } from '@/state/preferences-store';
import { radii, spacing, type, useTheme } from '@/ui/theme';

export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useI18n();
  const user = useAppStore((state) => state.user);
  const nodes = useAppStore((state) => state.nodes);
  const logout = useAppStore((state) => state.logout);
  const appearance = usePreferencesStore((state) => state.appearance);
  const language = usePreferencesStore((state) => state.language);
  const setAppearance = usePreferencesStore((state) => state.setAppearance);
  const setLanguage = usePreferencesStore((state) => state.setLanguage);
  const connectedNodes = nodes.filter((node) => !node.revokedAt).sort((left, right) => Number(right.online) - Number(left.online));

  function confirmLogout() {
    Alert.alert(t('signOutTitle'), t('signOutBody'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('signOut'), style: 'destructive', onPress: () => void logout().then(() => router.replace('/')) },
    ]);
  }

  return <Screen style={styles.screen}>
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('back')} style={({ pressed }) => [styles.backButton, { backgroundColor: theme.colors.surface, opacity: pressed ? 0.65 : 1 }]}>
        <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
      </Pressable>
      <Text style={[styles.title, { color: theme.colors.text }]}>{t('settings')}</Text>
      <View style={styles.headerSpacer} />
    </View>

    <SectionLabel>{t('account')}</SectionLabel>
    <Card style={styles.account}>
      <WhaleMark size={46} />
      <View style={styles.accountCopy}>
        <Text numberOfLines={1} style={[styles.accountName, { color: theme.colors.text }]}>{user?.displayName || 'DSH Owner'}</Text>
        <Text style={[styles.accountMeta, { color: theme.colors.muted }]}>{t('owner')} · DSH Mobile</Text>
      </View>
      <StatusPill label={t('protected')} tone="online" />
    </Card>

    <SectionLabel>{t('connectedDevices')}</SectionLabel>
    {connectedNodes.length ? <Card style={styles.deviceCard}>
      {connectedNodes.map((node, index) => <View key={node.id} style={[styles.deviceRow, index > 0 && { borderTopColor: theme.colors.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
        <View style={[styles.deviceIcon, { backgroundColor: `${node.online ? theme.colors.accent : theme.colors.muted}12` }]}>
          <Ionicons name={node.platform === 'darwin' ? 'laptop-outline' : 'desktop-outline'} size={20} color={node.online ? theme.colors.accent : theme.colors.muted} />
        </View>
        <View style={styles.deviceCopy}>
          <Text numberOfLines={1} style={[styles.deviceName, { color: theme.colors.text }]}>{node.name}</Text>
          <Text numberOfLines={1} style={[styles.deviceMeta, { color: theme.colors.faint }]}>{node.platform} · Connector {node.pluginVersion}</Text>
        </View>
        <StatusPill label={node.online ? t('connected') : t('disconnected')} tone={node.online ? 'online' : 'offline'} />
      </View>)}
    </Card> : <Card style={styles.noDevices}><Ionicons name="desktop-outline" size={22} color={theme.colors.faint} /><Text style={[styles.noDevicesText, { color: theme.colors.muted }]}>{t('noConnectedDevices')}</Text></Card>}

    <SectionLabel>{t('connection')}</SectionLabel>
    <Card style={styles.actionCard} onPress={() => router.push('/scan')} accessibilityLabel={t('scanPc')}>
      <View style={[styles.actionIcon, { backgroundColor: `${theme.colors.accent}12` }]}><Ionicons name="qr-code-outline" size={21} color={theme.colors.accent} /></View>
      <View style={styles.actionCopy}><Text style={[styles.actionTitle, { color: theme.colors.text }]}>{t('scanPc')}</Text><Text style={[styles.actionDescription, { color: theme.colors.muted }]}>{t('scanPcBody')}</Text></View>
      <Ionicons name="chevron-forward" size={18} color={theme.colors.faint} />
    </Card>

    <SectionLabel>{t('preferences')}</SectionLabel>
    <Card style={styles.preferenceCard}>
      <View style={styles.preferenceBlock}>
        <View style={styles.preferenceHeading}><Ionicons name="language-outline" size={19} color={theme.colors.muted} /><Text style={[styles.preferenceTitle, { color: theme.colors.text }]}>{t('language')}</Text></View>
        <SegmentedControl<LanguagePreference>
          value={language}
          onChange={setLanguage}
          options={[{ value: 'zh', label: t('chinese') }, { value: 'en', label: t('english') }]}
        />
      </View>
      <View style={[styles.preferenceBlock, styles.preferenceDivider, { borderTopColor: theme.colors.line }]}>
        <View style={styles.preferenceHeading}><Ionicons name="contrast-outline" size={19} color={theme.colors.muted} /><Text style={[styles.preferenceTitle, { color: theme.colors.text }]}>{t('appearance')}</Text></View>
        <SegmentedControl<AppearancePreference>
          value={appearance}
          onChange={setAppearance}
          options={[{ value: 'system', label: t('system') }, { value: 'light', label: t('light') }, { value: 'dark', label: t('dark') }]}
        />
      </View>
    </Card>

    <SectionLabel>{t('about')}</SectionLabel>
    <Card style={styles.versionCard}>
      <View style={[styles.actionIcon, { backgroundColor: theme.colors.surfaceSoft }]}><Ionicons name="information-circle-outline" size={21} color={theme.colors.muted} /></View>
      <Text style={[styles.versionTitle, { color: theme.colors.text }]}>{t('version')}</Text>
      <Text style={[styles.versionValue, { color: theme.colors.accent }]}>{APP_VERSION}</Text>
    </Card>

    <Pressable onPress={confirmLogout} accessibilityRole="button" accessibilityLabel={t('signOut')} style={({ pressed }) => [styles.logoutButton, { backgroundColor: `${theme.colors.danger}10`, opacity: pressed ? 0.68 : 1 }]}>
      <Ionicons name="log-out-outline" size={20} color={theme.colors.danger} />
      <Text style={[styles.logoutText, { color: theme.colors.danger }]}>{t('signOut')}</Text>
    </Pressable>
    <View style={styles.noteRow}><Ionicons name="lock-closed-outline" size={15} color={theme.colors.faint} /><Text style={[styles.note, { color: theme.colors.faint }]}>{t('localDataNote')}</Text></View>
  </Screen>;
}

function SegmentedControl<T extends string>({ value, options, onChange }: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return <View style={[styles.segmented, { backgroundColor: theme.colors.surfaceSoft }]}>
    {options.map((option) => {
      const selected = option.value === value;
      return <Pressable key={option.value} onPress={() => onChange(option.value)} accessibilityRole="radio" accessibilityState={{ selected }} style={[styles.segment, selected && { backgroundColor: theme.colors.surfaceRaised }]}>
        <Text style={[styles.segmentText, { color: selected ? theme.colors.accent : theme.colors.muted }]}>{option.label}</Text>
      </Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  header: { height: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  headerSpacer: { width: 42 },
  title: { fontSize: type.heading, fontWeight: '800' },
  account: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  accountCopy: { flex: 1, minWidth: 0 },
  accountName: { fontSize: type.body, fontWeight: '700' },
  accountMeta: { marginTop: 3, fontSize: type.micro },
  deviceCard: { paddingVertical: 0 },
  deviceRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  deviceIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  deviceCopy: { flex: 1, minWidth: 0 },
  deviceName: { fontSize: type.caption, fontWeight: '700' },
  deviceMeta: { marginTop: 3, fontSize: type.micro },
  noDevices: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  noDevicesText: { fontSize: type.caption },
  actionCard: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actionIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionCopy: { flex: 1, minWidth: 0 },
  actionTitle: { fontSize: type.body, fontWeight: '700' },
  actionDescription: { marginTop: 3, fontSize: type.micro, lineHeight: 16 },
  preferenceCard: { paddingVertical: 0 },
  preferenceBlock: { paddingVertical: spacing.md, gap: spacing.sm },
  preferenceDivider: { borderTopWidth: StyleSheet.hairlineWidth },
  preferenceHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  preferenceTitle: { fontSize: type.body, fontWeight: '700' },
  segmented: { minHeight: 42, flexDirection: 'row', borderRadius: radii.md, padding: 3 },
  segment: { flex: 1, minHeight: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontSize: type.caption, fontWeight: '700' },
  versionCard: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  versionTitle: { flex: 1, fontSize: type.body, fontWeight: '600' },
  versionValue: { fontSize: type.caption, fontWeight: '800' },
  logoutButton: { minHeight: 52, marginTop: spacing.xl, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  logoutText: { fontSize: type.body, fontWeight: '700' },
  noteRow: { marginTop: spacing.md, flexDirection: 'row', alignItems: 'flex-start', gap: 7, paddingHorizontal: spacing.xs },
  note: { flex: 1, fontSize: type.micro, lineHeight: 17 },
});
