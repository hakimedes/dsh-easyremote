import { Children, isValidElement, type ComponentProps, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type StyleProp,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { radii, spacing, type, useTheme } from './theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

const whaleSource = require('../../assets/brand/dsh-whale.png');

export function Screen({ children, scroll = true, style, edges = ['top'] }: { children: ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle>; edges?: Array<'top' | 'right' | 'bottom' | 'left'> }) {
  const theme = useTheme();
  const childArray = Children.toArray(children);
  const tabs = childArray.filter((child) => isValidElement(child) && child.type === BottomTabs);
  const body = childArray.filter((child) => !(isValidElement(child) && child.type === BottomTabs));
  const content = scroll
    ? <ScrollView style={styles.fill} contentContainerStyle={[styles.scrollContent, style]} showsVerticalScrollIndicator={false}>{body}</ScrollView>
    : <View style={[styles.fill, style]}>{body}</View>;
  return <SafeAreaView edges={edges} style={[styles.safe, { backgroundColor: theme.colors.background }]}>{content}{tabs}</SafeAreaView>;
}

export function WhaleMark({ size = 40, framed = true }: { size?: number; framed?: boolean }) {
  const theme = useTheme();
  const imageSize = framed ? Math.round(size * 0.72) : size;
  return <View accessibilityLabel="DeepSeek Harness whale" style={framed ? [styles.whaleFrame, { width: size, height: size, borderRadius: Math.round(size * 0.28), borderColor: theme.colors.line }] : undefined}>
    <Image source={whaleSource} resizeMode="contain" style={{ width: imageSize, height: imageSize }} />
  </View>;
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  const theme = useTheme();
  return <View style={styles.brandRow} accessibilityLabel="DeepSeek Harness Remote">
    <WhaleMark size={compact ? 38 : 42} />
    {!compact && <View style={styles.wordmarkRow}>
      <Text style={[styles.brandName, { color: theme.colors.text }]}>deepseek</Text>
      <View style={[styles.harnessBadge, { backgroundColor: theme.colors.black }]}><Text style={styles.harnessText}>HARNESS</Text></View>
      <Text style={[styles.remoteText, { color: theme.colors.faint }]}>REMOTE</Text>
    </View>}
  </View>;
}

export function TopBar({ title, eyebrow, right }: { title: string; eyebrow?: string; right?: ReactNode }) {
  const theme = useTheme();
  return <View style={styles.topBar}>
    <View style={styles.topBarText}>
      {eyebrow && <Text style={[styles.eyebrow, { color: theme.colors.muted }]}>{eyebrow}</Text>}
      <Text style={[styles.topBarTitle, { color: theme.colors.text }]}>{title}</Text>
    </View>
    {right}
  </View>;
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const theme = useTheme();
  return <View style={styles.sectionRow}><Text style={[styles.sectionLabel, { color: theme.colors.text }]}>{children}</Text>{right}</View>;
}

export function StatusPill({ label, tone = 'neutral', dot = true }: { label: string; tone?: 'online' | 'offline' | 'running' | 'neutral' | 'warning'; dot?: boolean }) {
  const theme = useTheme();
  const color = tone === 'online' || tone === 'running' ? theme.colors.accent : tone === 'warning' ? theme.colors.amber : tone === 'offline' ? theme.colors.coral : theme.colors.muted;
  return <View style={[styles.statusPill, { backgroundColor: `${color}12` }]}>
    {dot && <View style={[styles.statusDot, { backgroundColor: color }]} />}
    <Text style={[styles.statusText, { color }]}>{label}</Text>
  </View>;
}

export function Card({ children, style, onPress, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string }) {
  const theme = useTheme();
  const content = <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.line }, style]}>{children}</View>;
  return onPress
    ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}>{content}</Pressable>
    : content;
}

export function PrimaryButton({ label, onPress, disabled = false, icon }: { label: string; onPress: () => void; disabled?: boolean; icon?: IconName }) {
  const theme = useTheme();
  return <Pressable disabled={disabled} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.primaryButton, { backgroundColor: disabled ? theme.colors.surfaceSoft : theme.colors.accent, opacity: pressed ? 0.82 : 1 }]}>
    {icon && <Ionicons name={icon} size={20} color={disabled ? theme.colors.faint : theme.colors.accentInk} />}
    <Text style={[styles.primaryButtonText, { color: disabled ? theme.colors.faint : theme.colors.accentInk }]}>{label}</Text>
  </Pressable>;
}

export function SecondaryButton({ label, onPress, disabled = false, destructive = false }: { label: string; onPress: () => void; disabled?: boolean; destructive?: boolean }) {
  const theme = useTheme();
  const color = destructive ? theme.colors.danger : theme.colors.text;
  return <Pressable disabled={disabled} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.secondaryButton, { backgroundColor: theme.colors.surface, opacity: pressed ? 0.68 : disabled ? 0.45 : 1 }]}>
    <Text style={[styles.secondaryButtonText, { color }]}>{label}</Text>
  </Pressable>;
}

export function IconButton({ label, icon, onPress }: { label: string; icon: IconName; onPress: () => void }) {
  const theme = useTheme();
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.iconButton, { backgroundColor: theme.colors.surface, opacity: pressed ? 0.62 : 1 }]}>
    <Ionicons name={icon} size={21} color={theme.colors.text} />
  </Pressable>;
}

export function Input({ style, ...props }: TextInputProps) {
  const theme = useTheme();
  return <TextInput placeholderTextColor={theme.colors.faint} selectionColor={theme.colors.accent} style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.line, color: theme.colors.text }, style]} {...props} />;
}

export function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  const theme = useTheme();
  return <View style={styles.emptyState}><WhaleMark size={66} /><Text style={[styles.emptyTitle, { color: theme.colors.text }]}>{title}</Text><Text style={[styles.emptyMessage, { color: theme.colors.muted }]}>{message}</Text>{action}</View>;
}

export function BottomTabs({ active, onNavigate }: { active: 'home' | 'sessions' | 'nodes' | 'settings'; onNavigate: (tab: 'home' | 'sessions' | 'nodes' | 'settings') => void }) {
  const theme = useTheme();
  const tabs: Array<{ key: 'home' | 'sessions' | 'nodes' | 'settings'; label: string; icon: IconName; selectedIcon: IconName }> = [
    { key: 'home', label: 'Home', icon: 'home-outline', selectedIcon: 'home' },
    { key: 'sessions', label: 'Sessions', icon: 'chatbubble-ellipses-outline', selectedIcon: 'chatbubble-ellipses' },
    { key: 'nodes', label: 'Nodes', icon: 'desktop-outline', selectedIcon: 'desktop' },
    { key: 'settings', label: 'Settings', icon: 'settings-outline', selectedIcon: 'settings' },
  ];
  return <SafeAreaView edges={['bottom']} style={{ backgroundColor: theme.colors.background }}><View style={[styles.bottomTabs, { backgroundColor: `${theme.colors.background}F7`, borderTopColor: theme.colors.line }]}>{tabs.map((tab) => {
    const selected = tab.key === active;
    return <Pressable key={tab.key} onPress={() => onNavigate(tab.key)} accessibilityRole="tab" accessibilityState={{ selected }} style={styles.tab}>
      <Ionicons name={selected ? tab.selectedIcon : tab.icon} size={21} color={selected ? theme.colors.accent : theme.colors.faint} />
      <Text style={[styles.tabLabel, { color: selected ? theme.colors.accent : theme.colors.faint }]}>{tab.label}</Text>
    </Pressable>;
  })}</View></SafeAreaView>;
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  const theme = useTheme();
  return <Pressable onPress={onDismiss} style={[styles.errorBanner, { backgroundColor: `${theme.colors.danger}10` }]} accessibilityRole="alert">
    <Ionicons name="alert-circle-outline" size={18} color={theme.colors.danger} />
    <Text style={[styles.errorText, { color: theme.colors.danger }]}>{message}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  fill: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  whaleFrame: { backgroundColor: '#FFFFFF', borderWidth: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wordmarkRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  brandName: { fontSize: 16, lineHeight: 20, fontWeight: '700', letterSpacing: -0.3 },
  harnessBadge: { borderRadius: 5, paddingHorizontal: 5, paddingVertical: 3 },
  harnessText: { color: '#FFFFFF', fontSize: 8, lineHeight: 10, fontWeight: '800', letterSpacing: 0.6 },
  remoteText: { fontSize: 8, lineHeight: 10, fontWeight: '700', letterSpacing: 0.7 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.sm, paddingBottom: spacing.lg },
  topBarText: { flex: 1, gap: 3 },
  eyebrow: { fontSize: type.caption, lineHeight: 18 },
  topBarTitle: { fontSize: type.title, lineHeight: 32, fontWeight: '700', letterSpacing: -0.5 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xl, marginBottom: spacing.sm },
  sectionLabel: { fontSize: type.body, lineHeight: 22, fontWeight: '700' },
  statusPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: type.micro, lineHeight: 14, fontWeight: '700' },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.md },
  primaryButton: { minHeight: 52, borderRadius: 14, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryButtonText: { fontSize: type.body, fontWeight: '700' },
  secondaryButton: { minHeight: 50, borderRadius: 14, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { fontSize: type.body, fontWeight: '600' },
  iconButton: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 50, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 15, fontSize: type.body },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg, gap: 9 },
  emptyTitle: { marginTop: spacing.sm, fontSize: type.heading, fontWeight: '700' },
  emptyMessage: { textAlign: 'center', fontSize: type.body, lineHeight: 23 },
  bottomTabs: { minHeight: 70, flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, paddingBottom: 7, paddingHorizontal: 4 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 50 },
  tabLabel: { fontSize: 10, lineHeight: 13, fontWeight: '600' },
  errorBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 12, padding: spacing.sm, marginBottom: spacing.md },
  errorText: { flex: 1, fontSize: type.caption, lineHeight: 18 },
});
