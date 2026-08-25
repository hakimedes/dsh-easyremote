import { useEffect, useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  AccessibilityInfo,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { filterHistorySessions, groupHistorySessions, type HistorySession } from '../domain/history';
import { useAppStore } from '../state/app-store';
import { useI18n } from './i18n';
import { WhaleMark } from './primitives';
import { radii, spacing, type, useTheme } from './theme';

export function HistoryDrawer({ visible, sessions, onClose }: {
  visible: boolean;
  sessions: HistorySession[];
  onClose: () => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { language, t } = useI18n();
  const user = useAppStore((state) => state.user);
  const [query, setQuery] = useState('');
  const [reduceMotion, setReduceMotion] = useState(false);
  const drawerWidth = Math.min(width * 0.88, 430);
  const translateX = useRef(new Animated.Value(-drawerWidth)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    translateX.setValue(reduceMotion ? 0 : -drawerWidth);
    backdropOpacity.setValue(reduceMotion ? 1 : 0);
    if (!reduceMotion) Animated.parallel([
      Animated.timing(translateX, { toValue: 0, duration: 230, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [backdropOpacity, drawerWidth, reduceMotion, translateX, visible]);

  const groups = useMemo(
    () => groupHistorySessions(filterHistorySessions(sessions, query), language),
    [language, query, sessions],
  );

  function close(next?: () => void) {
    if (reduceMotion) {
      onClose();
      next?.();
      return;
    }
    Animated.parallel([
      Animated.timing(translateX, { toValue: -drawerWidth, duration: 190, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(() => {
      onClose();
      next?.();
    });
  }

  function openSession(entry: HistorySession) {
    close(() => router.push({
      pathname: '/session/[sessionId]',
      params: { nodeId: entry.node.id, sessionId: entry.session.sessionId },
    }));
  }

  return <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={() => close()}>
    <View style={styles.root}>
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} accessibilityLabel={t('back')} />
      </Animated.View>
      <Animated.View style={[styles.drawer, { width: drawerWidth, backgroundColor: theme.colors.background, transform: [{ translateX }] }]}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
          <View style={styles.searchRow}>
            <View style={[styles.searchBox, { backgroundColor: theme.colors.surface, borderColor: theme.colors.line }]}>
              <Ionicons name="search-outline" size={20} color={theme.colors.faint} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t('searchConversations')}
                placeholderTextColor={theme.colors.faint}
                selectionColor={theme.colors.accent}
                style={[styles.searchInput, { color: theme.colors.text }]}
                accessibilityLabel={t('searchConversations')}
              />
              {query.length > 0 && <Pressable onPress={() => setQuery('')} accessibilityLabel="Clear search"><Ionicons name="close-circle" size={18} color={theme.colors.faint} /></Pressable>}
            </View>
            <Pressable onPress={() => close(() => router.push('/scan'))} accessibilityRole="button" accessibilityLabel={t('scanPc')} style={({ pressed }) => [styles.scanButton, { backgroundColor: theme.colors.surface, borderColor: theme.colors.line, opacity: pressed ? 0.65 : 1 }]}>
              <Ionicons name="qr-code-outline" size={21} color={theme.colors.accent} />
            </Pressable>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {groups.length === 0 && <View style={styles.empty}>
              <Ionicons name="chatbubbles-outline" size={30} color={theme.colors.faint} />
              <Text style={[styles.emptyText, { color: theme.colors.muted }]}>{t('noConversations')}</Text>
            </View>}
            {groups.map((group) => <View key={group.key} style={styles.group}>
              <Text style={[styles.month, { color: theme.colors.faint }]}>{group.label}</Text>
              {group.sessions.map((entry) => <Pressable
                key={`${entry.node.id}:${entry.session.sessionId}`}
                onPress={() => openSession(entry)}
                accessibilityRole="button"
                accessibilityLabel={entry.session.title}
                style={({ pressed }) => [styles.sessionRow, { backgroundColor: pressed ? theme.colors.surface : 'transparent' }]}
              >
                <Text numberOfLines={1} style={[styles.sessionTitle, { color: theme.colors.text }]}>{entry.session.title}</Text>
                {entry.session.status === 'running' && <View style={[styles.runningDot, { backgroundColor: theme.colors.accent }]} />}
              </Pressable>)}
            </View>)}
          </ScrollView>

          <Pressable onPress={() => close(() => router.push('/settings'))} accessibilityRole="button" accessibilityLabel={t('settings')} style={({ pressed }) => [styles.account, { borderTopColor: theme.colors.line, backgroundColor: pressed ? theme.colors.surface : theme.colors.background }]}>
            <WhaleMark size={42} />
            <View style={styles.accountCopy}>
              <Text numberOfLines={1} style={[styles.accountName, { color: theme.colors.text }]}>{user?.displayName || 'DSH Owner'}</Text>
              <Text style={[styles.accountMeta, { color: theme.colors.faint }]}>{t('settings')}</Text>
            </View>
            <Ionicons name="ellipsis-horizontal" size={22} color={theme.colors.faint} />
          </Pressable>
        </SafeAreaView>
      </Animated.View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#00000078' },
  drawer: { height: '100%', shadowColor: '#000000', shadowOpacity: 0.28, shadowRadius: 24, shadowOffset: { width: 8, height: 0 }, elevation: 20 },
  safe: { flex: 1 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md },
  searchBox: { flex: 1, minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.pill, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, minWidth: 0, fontSize: type.body, paddingVertical: 0 },
  scanButton: { width: 48, height: 48, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
  group: { marginBottom: spacing.lg },
  month: { marginBottom: spacing.sm, paddingHorizontal: spacing.sm, fontSize: type.caption, fontWeight: '600' },
  sessionRow: { minHeight: 48, borderRadius: 12, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sessionTitle: { flex: 1, fontSize: type.body, lineHeight: 22 },
  runningDot: { width: 7, height: 7, borderRadius: 4 },
  empty: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xxl },
  emptyText: { fontSize: type.caption },
  account: { minHeight: 76, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  accountCopy: { flex: 1, minWidth: 0 },
  accountName: { fontSize: type.body, fontWeight: '700' },
  accountMeta: { marginTop: 3, fontSize: type.micro },
});
