import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { lastConversationTurn, selectHomeSession } from '@/domain/home-session';
import { ApiError, type AgentPreset } from '@/domain/types';
import { selectDefaultPreset } from '@/domain/session-config';
import { ErrorBanner, Screen, StatusPill, WhaleMark } from '@/ui/primitives';
import { Composer, MessageRow, SessionStatus } from '@/ui/session-components';
import { ModelChip, ModelPickerSheet } from '@/ui/session-config-sheets';
import { HistoryDrawer } from '@/ui/history-drawer';
import { useI18n } from '@/ui/i18n';
import { useAppStore } from '@/state/app-store';
import { radii, spacing, type, useTheme } from '@/ui/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

function presetIcon(id: string): IconName {
  const normalized = id.toLowerCase();
  if (normalized.includes('minimal')) return 'flash-outline';
  if (normalized.includes('ptc') || normalized.includes('code')) return 'construct-outline';
  if (normalized.includes('creative') || normalized.includes('cordis')) return 'color-wand-outline';
  return 'sparkles-outline';
}

export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const focused = useIsFocused();
  const { t } = useI18n();
  const nodes = useAppStore((state) => state.nodes);
  const sessionsByNode = useAppStore((state) => state.sessionsByNode);
  const sessionViews = useAppStore((state) => state.sessionViews);
  const sessionModels = useAppStore((state) => state.sessionModels);
  const agentPresetsByNode = useAppStore((state) => state.agentPresetsByNode);
  const cloudAvailable = useAppStore((state) => state.cloudAvailable);
  const errorMessage = useAppStore((state) => state.errorMessage);
  const clearError = useAppStore((state) => state.clearError);
  const refreshNodes = useAppStore((state) => state.refreshNodes);
  const loadSessions = useAppStore((state) => state.loadSessions);
  const openSession = useAppStore((state) => state.openSession);
  const loadAgentPresets = useAppStore((state) => state.loadAgentPresets);
  const createSession = useAppStore((state) => state.createSession);
  const loadSessionModels = useAppStore((state) => state.loadSessionModels);
  const sendFollowup = useAppStore((state) => state.sendFollowup);
  const sendSteer = useAppStore((state) => state.sendSteer);
  const stopSession = useAppStore((state) => state.stopSession);
  const [lockedKey, setLockedKey] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const [draftNodeId, setDraftNodeId] = useState('');
  const [loadingModes, setLoadingModes] = useState(false);
  const [creatingPreset, setCreatingPreset] = useState<string | null>(null);
  const [legacyMode, setLegacyMode] = useState(false);
  const [modeMessage, setModeMessage] = useState<string | null>(null);
  const [modelSheet, setModelSheet] = useState(false);
  const [steering, setSteering] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);

  useEffect(() => { void refreshNodes().catch(() => undefined); }, [refreshNodes]);
  useEffect(() => { for (const node of nodes) void loadSessions(node.id); }, [nodes, loadSessions]);

  const allSessions = useMemo(() => nodes.flatMap((node) =>
    (sessionsByNode[node.id] || []).map((session) => ({ session, node }))), [nodes, sessionsByNode]);
  const latest = useMemo(() => [...allSessions].sort((left, right) => right.session.updatedAt - left.session.updatedAt)[0], [allSessions]);
  const latestKey = latest ? `${latest.node.id}:${latest.session.sessionId}` : null;
  const latestKeyRef = useRef<string | null>(latestKey);
  latestKeyRef.current = latestKey;
  const onlineNodes = useMemo(() => nodes.filter((node) => node.online && !node.revokedAt), [nodes]);

  useFocusEffect(useCallback(() => {
    setLockedKey(latestKeyRef.current);
    setCreatingNew(!latestKeyRef.current);
    return () => {
      setHasDraft(false);
      setSteering(false);
    };
  }, []));

  useEffect(() => {
    if (focused && !creatingNew && !lockedKey && latestKey) setLockedKey(latestKey);
  }, [creatingNew, focused, latestKey, lockedKey]);

  useEffect(() => {
    if (!creatingNew) return;
    if (!onlineNodes.some((node) => node.id === draftNodeId)) setDraftNodeId(onlineNodes[0]?.id || '');
  }, [creatingNew, draftNodeId, onlineNodes]);

  const presets = agentPresetsByNode[draftNodeId] || [];
  useEffect(() => {
    if (!creatingNew || !draftNodeId) return;
    let active = true;
    setLoadingModes(true);
    setLegacyMode(false);
    setModeMessage(null);
    void loadAgentPresets(draftNodeId).then((items) => {
      if (!active) return;
      setLegacyMode(items.length === 0);
    }).catch((error) => {
      if (!active) return;
      const compatibleFallback = error instanceof ApiError
        && (error.code === 'CAPABILITY_UNAVAILABLE' || error.status === 404 || error.status === 409);
      setLegacyMode(compatibleFallback);
      setModeMessage(compatibleFallback ? t('modeUnavailable') : error instanceof Error ? error.message : t('modeUnavailable'));
      if (compatibleFallback) clearError();
    }).finally(() => {
      if (active) setLoadingModes(false);
    });
    return () => { active = false; };
  }, [clearError, creatingNew, draftNodeId, loadAgentPresets, t]);

  const homeSelection = useMemo(() => selectHomeSession(allSessions, lockedKey), [allSessions, lockedKey]);
  const selected = creatingNew ? undefined : homeSelection.selected;
  const selectedKey = selected ? `${selected.node.id}:${selected.session.sessionId}` : '';
  const view = selectedKey ? sessionViews[selectedKey] : undefined;
  const models = selectedKey ? sessionModels[selectedKey] : undefined;
  const messages = useMemo(() => lastConversationTurn(view?.messages || []), [view?.messages]);
  const anyOnline = onlineNodes.length > 0;
  const connectionTone = !cloudAvailable ? 'warning' : anyOnline ? 'online' : 'offline';
  const connectionLabel = !cloudAvailable ? t('cloudUnavailable') : anyOnline ? t('online') : t('pcOffline');
  const offline = Boolean(!selected?.node.online || view?.isOfflineSnapshot);

  useEffect(() => {
    if (!selected) return;
    void openSession(selected.node.id, selected.session.sessionId);
    if (selected.node.online) void loadSessionModels(selected.node.id, selected.session.sessionId).catch(() => undefined);
  }, [loadSessionModels, openSession, selected?.node.id, selected?.node.online, selected?.session.sessionId]);

  function openFullSession() {
    if (!selected) return;
    router.push({ pathname: '/session/[sessionId]', params: { sessionId: selected.session.sessionId, nodeId: selected.node.id } });
  }

  function beginNew() {
    const apply = () => {
      setCreatingNew(true);
      setDraftNodeId(onlineNodes[0]?.id || '');
      setModeMessage(null);
      setHasDraft(false);
      setSteering(false);
    };
    if (!hasDraft) return apply();
    Alert.alert(t('newConversation'), t('newerConversationBody'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('newConversation'), onPress: apply },
    ]);
  }

  function switchToNewest() {
    const apply = () => {
      setLockedKey(latestKeyRef.current);
      setHasDraft(false);
      setSteering(false);
    };
    if (!hasDraft) return apply();
    Alert.alert(t('newerConversation'), t('newerConversationBody'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('switch'), onPress: apply },
    ]);
  }

  async function startWithPreset(preset?: AgentPreset) {
    if (!draftNodeId || creatingPreset || preset?.broken) return;
    const presetId = preset?.id || 'default';
    setCreatingPreset(presetId);
    setModeMessage(null);
    try {
      const sessionId = await createSession(draftNodeId, legacyMode ? undefined : preset?.id);
      const key = `${draftNodeId}:${sessionId}`;
      setLockedKey(key);
      setCreatingNew(false);
      await openSession(draftNodeId, sessionId);
      void loadSessionModels(draftNodeId, sessionId).catch(() => undefined);
    } catch (error) {
      setModeMessage(error instanceof Error ? error.message : t('modeUnavailable'));
    } finally {
      setCreatingPreset(null);
    }
  }

  async function send(content: string) {
    if (!selected) return;
    if (steering) await sendSteer(selected.node.id, selected.session.sessionId, content);
    else await sendFollowup(selected.node.id, selected.session.sessionId, content);
  }

  async function stop() {
    if (!selected) return;
    setStopping(true);
    try { await stopSession(selected.node.id, selected.session.sessionId); } finally { setStopping(false); }
  }

  const reasoningLabel = models?.current.reasoningEffort || t('automatic');

  return <>
    <Screen scroll={false} style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => setHistoryOpen(true)} accessibilityRole="button" accessibilityLabel={t('menu')} style={({ pressed }) => [styles.headerButton, { backgroundColor: theme.colors.surface, opacity: pressed ? 0.65 : 1 }]}>
          <Ionicons name="menu-outline" size={25} color={theme.colors.text} />
        </Pressable>
        <View style={styles.brandCenter}>
          <WhaleMark size={34} framed={false} />
          <StatusPill label={connectionLabel} tone={connectionTone} />
        </View>
        <Pressable onPress={beginNew} disabled={!anyOnline} accessibilityRole="button" accessibilityLabel={t('newConversation')} style={({ pressed }) => [styles.headerButton, { backgroundColor: theme.colors.surface, opacity: !anyOnline ? 0.35 : pressed ? 0.65 : 1 }]}>
          <Ionicons name="chatbubble-ellipses-outline" size={23} color={theme.colors.text} />
          <View style={[styles.plusBadge, { backgroundColor: theme.colors.accent }]}><Ionicons name="add" size={10} color={theme.colors.accentInk} /></View>
        </Pressable>
      </View>

      {errorMessage && <ErrorBanner message={errorMessage} onDismiss={clearError} />}

      {creatingNew ? <View style={styles.quickStart}>
        <View style={styles.quickHero}>
          <WhaleMark size={74} framed={false} />
          <Text style={[styles.quickTitle, { color: theme.colors.text }]}>{t('chooseModeTitle')}</Text>
          <Text style={[styles.quickBody, { color: theme.colors.muted }]}>{t('chooseModeBody')}</Text>
        </View>

        {onlineNodes.length > 1 && <View style={styles.nodeArea}>
          <Text style={[styles.fieldLabel, { color: theme.colors.faint }]}>{t('selectNode')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.nodeRow}>
            {onlineNodes.map((node) => <Pressable key={node.id} onPress={() => setDraftNodeId(node.id)} style={[styles.nodeChip, { borderColor: node.id === draftNodeId ? theme.colors.accent : theme.colors.line, backgroundColor: node.id === draftNodeId ? `${theme.colors.accent}12` : theme.colors.surface }]}>
              <View style={[styles.onlineDot, { backgroundColor: theme.colors.accent }]} />
              <Text style={[styles.nodeName, { color: node.id === draftNodeId ? theme.colors.accent : theme.colors.text }]}>{node.name}</Text>
            </Pressable>)}
          </ScrollView>
        </View>}

        <View style={styles.modeArea}>
          {loadingModes ? <View style={styles.loadingModes}><ActivityIndicator color={theme.colors.accent} /><Text style={[styles.loadingText, { color: theme.colors.muted }]}>{t('loadingModes')}</Text></View> : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modeRow}>
            {legacyMode && <ModeButton id="default" name={t('defaultMode')} description={t('defaultModeBody')} selected={creatingPreset === 'default'} loading={creatingPreset === 'default'} onPress={() => void startWithPreset()} />}
            {!legacyMode && presets.map((preset) => <ModeButton key={preset.id} id={preset.id} name={preset.name || preset.id} description={preset.broken || preset.description} disabled={Boolean(preset.broken)} selected={creatingPreset === preset.id || (!creatingPreset && selectDefaultPreset(presets)?.id === preset.id)} loading={creatingPreset === preset.id} onPress={() => void startWithPreset(preset)} />)}
          </ScrollView>}
          {modeMessage && <Text style={[styles.modeMessage, { color: legacyMode ? theme.colors.amber : theme.colors.danger }]}>{modeMessage}</Text>}
          {!anyOnline && <Text style={[styles.modeMessage, { color: theme.colors.danger }]}>{t('noOnlineNode')}</Text>}
        </View>

        <View style={[styles.previewComposer, { backgroundColor: theme.colors.surface, borderColor: theme.colors.line }]}>
          <Text style={[styles.previewPlaceholder, { color: theme.colors.faint }]}>{creatingPreset ? t('creatingConversation') : t('selectModeFirst')}</Text>
          <View style={[styles.previewToolbar, { borderTopColor: theme.colors.line }]}>
            <View style={styles.previewChip}><Ionicons name="hardware-chip-outline" size={15} color={theme.colors.faint} /><Text style={[styles.previewChipText, { color: theme.colors.faint }]}>{t('model')}</Text></View>
            <View style={styles.previewChip}><Ionicons name="planet-outline" size={15} color={theme.colors.faint} /><Text style={[styles.previewChipText, { color: theme.colors.faint }]}>{t('reasoning')}</Text></View>
          </View>
        </View>
      </View> : selected ? <View style={styles.conversation}>
        {homeSelection.newerAvailable && <Pressable onPress={switchToNewest} style={[styles.newerBanner, { backgroundColor: `${theme.colors.accent}0D`, borderColor: `${theme.colors.accent}30` }]} accessibilityRole="button">
          <Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.colors.accent} />
          <View style={styles.flex}><Text style={[styles.newerTitle, { color: theme.colors.text }]}>{t('newerConversation')}</Text><Text style={[styles.newerCopy, { color: theme.colors.muted }]}>{t('newerConversationBody')}</Text></View>
          <Text style={[styles.switchText, { color: theme.colors.accent }]}>{t('switch')}</Text>
        </Pressable>}

        <Pressable onPress={openFullSession} style={styles.sessionHeader} accessibilityRole="button" accessibilityLabel={selected.session.title}>
          <View style={styles.flex}>
            <Text numberOfLines={1} style={[styles.sessionTitle, { color: theme.colors.text }]}>{selected.session.title}</Text>
            <Text numberOfLines={1} style={[styles.sessionMeta, { color: theme.colors.muted }]}>{selected.node.name}{selected.session.agentPreset ? ` · ${selected.session.agentPreset}` : ''}</Text>
          </View>
          <SessionStatus running={Boolean(view?.isRunning) && !stopping} offline={offline} />
          <Ionicons name="chevron-forward" size={17} color={theme.colors.faint} />
        </Pressable>

        {offline && <View style={[styles.offlineRow, { backgroundColor: `${theme.colors.coral}0D` }]}><Ionicons name="cloud-offline-outline" size={16} color={theme.colors.coral} /><Text style={[styles.offlineText, { color: theme.colors.coral }]}>{t('offlineSnapshot')}</Text></View>}
        <ScrollView style={styles.turnScroll} contentContainerStyle={[styles.turnContent, messages.length === 0 && styles.emptyTurn]} showsVerticalScrollIndicator={false}>
          {messages.length ? messages.map((message) => <MessageRow key={message.id} message={message} />) : <View style={styles.emptyConversation}>
            <WhaleMark size={70} framed={false} />
            <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>{t('readyTitle')}</Text>
            <Text style={[styles.emptyBody, { color: theme.colors.muted }]}>{t('readyBody')}</Text>
          </View>}
        </ScrollView>
        <Composer
          key={selectedKey}
          disabled={offline}
          running={Boolean(view?.isRunning) && !stopping}
          steering={steering}
          onToggleSteering={() => setSteering((current) => !current)}
          onDraftChange={setHasDraft}
          onSend={send}
          onStop={stop}
          placeholder={t('messagePlaceholder')}
          toolbar={<>
            <ModelChip models={models} disabled={offline} onPress={() => setModelSheet(true)} />
            <Pressable disabled={offline} onPress={() => setModelSheet(true)} style={({ pressed }) => [styles.reasoningChip, { borderColor: theme.colors.line, opacity: offline ? 0.45 : pressed ? 0.65 : 1 }]} accessibilityRole="button" accessibilityLabel={`${t('reasoning')} ${reasoningLabel}`}>
              <Ionicons name="planet-outline" size={14} color={theme.colors.accent} />
              <Text numberOfLines={1} style={[styles.reasoningText, { color: theme.colors.text }]}>{t('reasoning')} · {reasoningLabel}</Text>
              <Ionicons name="chevron-down" size={13} color={theme.colors.faint} />
            </Pressable>
          </>}
        />
      </View> : <View style={styles.noConversation}>
        <WhaleMark size={82} framed={false} />
        <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>{t('noOnlineNode')}</Text>
      </View>}
    </Screen>

    <HistoryDrawer visible={historyOpen} sessions={allSessions} onClose={() => setHistoryOpen(false)} />
    {selected && <ModelPickerSheet visible={modelSheet} nodeId={selected.node.id} sessionId={selected.session.sessionId} running={Boolean(view?.isRunning)} offline={offline} onClose={() => setModelSheet(false)} />}
  </>;
}

function ModeButton({ id, name, description, disabled = false, selected = false, loading = false, onPress }: {
  id: string;
  name: string;
  description?: string;
  disabled?: boolean;
  selected?: boolean;
  loading?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return <Pressable disabled={disabled || loading} onPress={onPress} accessibilityRole="button" accessibilityState={{ disabled, selected }} style={({ pressed }) => [styles.modeButton, {
    borderColor: selected ? theme.colors.accent : theme.colors.line,
    backgroundColor: selected ? `${theme.colors.accent}14` : theme.colors.surface,
    opacity: disabled ? 0.42 : pressed ? 0.7 : 1,
  }]}>
    <View style={[styles.modeIcon, { backgroundColor: `${selected ? theme.colors.accent : theme.colors.muted}12` }]}>{loading ? <ActivityIndicator size="small" color={theme.colors.accent} /> : <Ionicons name={presetIcon(id)} size={19} color={selected ? theme.colors.accent : theme.colors.muted} />}</View>
    <Text numberOfLines={1} style={[styles.modeName, { color: selected ? theme.colors.accent : theme.colors.text }]}>{name}</Text>
    {description && <Text numberOfLines={2} style={[styles.modeDescription, { color: disabled ? theme.colors.danger : theme.colors.muted }]}>{description}</Text>}
  </Pressable>;
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: spacing.md },
  header: { height: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerButton: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  plusBadge: { position: 'absolute', right: 6, top: 6, width: 15, height: 15, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  brandCenter: { alignItems: 'center', gap: 3 },
  quickStart: { flex: 1, minHeight: 0 },
  quickHero: { flex: 1, minHeight: 170, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  quickTitle: { marginTop: spacing.md, textAlign: 'center', fontSize: 24, lineHeight: 31, fontWeight: '700', letterSpacing: -0.5 },
  quickBody: { marginTop: 7, textAlign: 'center', fontSize: type.caption, lineHeight: 19 },
  nodeArea: { gap: spacing.sm, marginBottom: spacing.md },
  fieldLabel: { fontSize: type.micro, fontWeight: '800', letterSpacing: 0.8 },
  nodeRow: { gap: spacing.sm },
  nodeChip: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: spacing.md },
  nodeName: { fontSize: type.caption, fontWeight: '700' },
  onlineDot: { width: 7, height: 7, borderRadius: 4 },
  modeArea: { minHeight: 112, justifyContent: 'center', marginHorizontal: -spacing.md },
  modeRow: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  modeButton: { width: 142, minHeight: 96, borderWidth: 1, borderRadius: 18, padding: spacing.sm },
  modeIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  modeName: { marginTop: 8, fontSize: type.caption, fontWeight: '800' },
  modeDescription: { marginTop: 3, fontSize: type.micro, lineHeight: 15 },
  loadingModes: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, minHeight: 96 },
  loadingText: { fontSize: type.caption },
  modeMessage: { paddingHorizontal: spacing.md, marginTop: spacing.xs, fontSize: type.micro, lineHeight: 16 },
  previewComposer: { minHeight: 108, borderWidth: StyleSheet.hairlineWidth, borderRadius: 22, marginTop: spacing.md, marginBottom: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  previewPlaceholder: { flex: 1, fontSize: type.body },
  previewToolbar: { minHeight: 42, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  previewChip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  previewChipText: { fontSize: type.micro, fontWeight: '700' },
  conversation: { flex: 1, minHeight: 0 },
  newerBanner: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: spacing.sm, marginBottom: spacing.sm },
  newerTitle: { fontSize: type.caption, fontWeight: '700' },
  newerCopy: { marginTop: 2, fontSize: type.micro },
  switchText: { fontSize: type.caption, fontWeight: '700' },
  sessionHeader: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xs, paddingBottom: spacing.sm },
  sessionTitle: { fontSize: type.heading, fontWeight: '700' },
  sessionMeta: { marginTop: 4, fontSize: type.micro },
  offlineRow: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 9, paddingHorizontal: spacing.sm, paddingVertical: 7 },
  offlineText: { fontSize: type.caption, fontWeight: '600' },
  turnScroll: { flex: 1 },
  turnContent: { paddingTop: spacing.md, paddingBottom: spacing.md },
  emptyTurn: { flexGrow: 1, justifyContent: 'center' },
  emptyConversation: { alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl },
  emptyTitle: { marginTop: spacing.sm, textAlign: 'center', fontSize: type.heading, fontWeight: '700' },
  emptyBody: { textAlign: 'center', fontSize: type.caption, lineHeight: 20 },
  reasoningChip: { maxWidth: 180, minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.pill, paddingHorizontal: 10 },
  reasoningText: { flexShrink: 1, fontSize: type.micro, fontWeight: '700' },
  noConversation: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  flex: { flex: 1, minWidth: 0 },
});
