import { useEffect, useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ErrorBanner, IconButton, Screen, WhaleMark } from '@/ui/primitives';
import { Composer, MessageRow, SessionStatus } from '@/ui/session-components';
import { ModelChip, ModelPickerSheet, SessionRenameSheet } from '@/ui/session-config-sheets';
import { useAppStore } from '@/state/app-store';
import { spacing, type, useTheme } from '@/ui/theme';
import type { SessionMessage } from '@/domain/types';
import type { SendFollowupOptions } from '@/state/app-store';
import { collectSessionPanel } from '@/genui/panel';
import { SessionPanelCard } from '@/genui/rich-message';
import type { GenuiAction } from '@/genui/renderer';
import { apiClient } from '@/api/client';

export default function SessionDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId: string; nodeId?: string }>();
  const sessionId = Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId;
  const requestedNodeId = Array.isArray(params.nodeId) ? params.nodeId[0] : params.nodeId;
  const nodes = useAppStore((state) => state.nodes);
  const sessionsByNode = useAppStore((state) => state.sessionsByNode);
  const sessionViews = useAppStore((state) => state.sessionViews);
  const sessionModels = useAppStore((state) => state.sessionModels);
  const openSession = useAppStore((state) => state.openSession);
  const loadSessionModels = useAppStore((state) => state.loadSessionModels);
  const sendFollowup = useAppStore((state) => state.sendFollowup);
  const sendSteer = useAppStore((state) => state.sendSteer);
  const stopSession = useAppStore((state) => state.stopSession);
  const errorMessage = useAppStore((state) => state.errorMessage);
  const clearError = useAppStore((state) => state.clearError);
  const [steering, setSteering] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [nearBottom, setNearBottom] = useState(true);
  const [newOutput, setNewOutput] = useState(false);
  const [modelSheet, setModelSheet] = useState(false);
  const [renameSheet, setRenameSheet] = useState(false);
  const listRef = useRef<FlatList<SessionMessage>>(null);

  const nodeId = requestedNodeId || nodes.flatMap((node) => sessionsByNode[node.id] || []).find((session) => session.sessionId === sessionId)?.nodeId || nodes[0]?.id || '';
  const key = `${nodeId}:${sessionId}`;
  const view = sessionViews[key];
  const models = sessionModels[key];
  const node = nodes.find((item) => item.id === nodeId);
  const offline = Boolean(view?.isOfflineSnapshot || node && !node.online);
  const messages = useMemo(() => view?.messages || [], [view?.messages]);
  const panel = useMemo(() => collectSessionPanel(messages, apiClient.hubId || apiClient.server, sessionId || ''), [messages, sessionId]);
  const lastOutputVersion = messages.length
    ? `${messages[messages.length - 1]?.sourceSeq}:${messages[messages.length - 1]?.text.length}`
    : '';

  useEffect(() => {
    if (nodeId && sessionId) void openSession(nodeId, sessionId);
  }, [nodeId, sessionId, openSession]);

  useEffect(() => {
    if (nodeId && sessionId && node?.online) void loadSessionModels(nodeId, sessionId).catch(() => undefined);
  }, [loadSessionModels, node?.online, nodeId, sessionId]);

  useEffect(() => {
    if (nearBottom) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 40);
      setNewOutput(false);
    } else if ((view?.messages.length || 0) > 0) {
      setNewOutput(true);
    }
  }, [lastOutputVersion, messages.length, nearBottom]);

  async function send(content: string, options?: SendFollowupOptions) {
    if (!sessionId) return;
    if (steering) await sendSteer(nodeId, sessionId, content);
    else await sendFollowup(nodeId, sessionId, content, options);
  }

  async function stop() {
    setStopping(true);
    if (!sessionId) return;
    try { await stopSession(nodeId, sessionId); } finally { setStopping(false); }
  }

  async function sendGenuiAction(event: GenuiAction) {
    if (!sessionId || offline) return;
    await sendFollowup(nodeId, sessionId, `[genui-action] ${JSON.stringify({ action: event.action, payload: event.payload })}`);
  }

  return <KeyboardAvoidingView style={[styles.root, { backgroundColor: theme.colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
    <Screen scroll={false} edges={['top']} style={styles.screen}>
      <View style={[styles.header, { borderBottomColor: theme.colors.line }]}><IconButton label="Back" icon="chevron-back" onPress={() => router.back()} /><View style={styles.headerCopy}><Pressable onPress={() => setRenameSheet(true)} disabled={!view} accessibilityRole="button" accessibilityLabel="Rename conversation" style={styles.titleButton}><Text numberOfLines={1} style={[styles.sessionTitle, { color: theme.colors.text }]}>{view?.session.title || 'Session'}</Text><Ionicons name="pencil-outline" size={14} color={theme.colors.faint} /></Pressable><Text numberOfLines={1} style={[styles.nodeName, { color: theme.colors.muted }]}>{node?.name || 'DeepSeek Harness'}{view?.session.agentPreset ? ` · ${view.session.agentPreset}` : ''}</Text></View><SessionStatus running={Boolean(view?.isRunning) && !stopping} offline={offline} /></View>
      <View style={styles.modelBar}><Text style={[styles.modelHint, { color: theme.colors.faint }]}>MODEL FOR NEXT STEP</Text><ModelChip models={models} disabled={offline} onPress={() => setModelSheet(true)} /></View>
      {errorMessage && <ErrorBanner message={errorMessage} onDismiss={clearError} />}
      {view?.isOfflineSnapshot && <View style={[styles.offlineRow, { backgroundColor: `${theme.colors.coral}0D` }]}><Ionicons name="cloud-offline-outline" size={16} color={theme.colors.coral} /><Text style={[styles.offlineText, { color: theme.colors.coral }]}>Offline snapshot · read-only</Text></View>}
      <View style={styles.transcriptWrap}>
        <FlatList ref={listRef} data={messages} keyExtractor={(item) => item.id} renderItem={({ item }) => <MessageRow message={item} nodeId={nodeId} sessionId={sessionId} interactive={!offline} onAction={sendGenuiAction} />} contentContainerStyle={[styles.transcript, messages.length === 0 && styles.emptyTranscript]} onScroll={({ nativeEvent }) => { const distance = nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height - nativeEvent.contentOffset.y; setNearBottom(distance < 80); }} scrollEventThrottle={100} showsVerticalScrollIndicator={false} ListEmptyComponent={<View style={styles.empty}><WhaleMark size={76} /><Text style={[styles.emptyTitle, { color: theme.colors.text }]}>Your Harness is listening.</Text><Text style={[styles.emptyBody, { color: theme.colors.muted }]}>Send a follow-up here and the same local session will continue on your computer.</Text></View>} />
        {newOutput && <Pressable onPress={() => { listRef.current?.scrollToEnd({ animated: true }); setNearBottom(true); setNewOutput(false); }} style={[styles.newOutput, { backgroundColor: theme.colors.accent }]}><Ionicons name="arrow-down" size={15} color={theme.colors.accentInk} /><Text style={[styles.newOutputText, { color: theme.colors.accentInk }]}>New output</Text></Pressable>}
      </View>
      {panel && <SessionPanelCard panel={panel} interactive={!offline} onAction={sendGenuiAction} />}
      <Composer disabled={offline} running={Boolean(view?.isRunning) && !stopping} steering={steering} onToggleSteering={() => setSteering((value) => !value)} onSend={send} onStop={stop} nodeId={nodeId} sessionId={sessionId} capabilities={node?.capabilities || []} />
    </Screen>
    <ModelPickerSheet visible={modelSheet} nodeId={nodeId} sessionId={sessionId} running={Boolean(view?.isRunning)} offline={offline} onClose={() => setModelSheet(false)} />
    <SessionRenameSheet visible={renameSheet} nodeId={nodeId} sessionId={sessionId} currentTitle={view?.session.title || 'Session'} offline={offline} onClose={() => setRenameSheet(false)} />
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  screen: { paddingHorizontal: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  headerCopy: { flex: 1, minWidth: 0, gap: 2 },
  titleButton: { alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 5 },
  sessionTitle: { flexShrink: 1, fontSize: type.body, fontWeight: '700' },
  nodeName: { fontSize: type.micro },
  modelBar: { minHeight: 45, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingTop: spacing.sm },
  modelHint: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  offlineRow: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 9, paddingHorizontal: spacing.sm, paddingVertical: 7, marginTop: spacing.sm },
  offlineText: { fontSize: type.caption, fontWeight: '600' },
  transcriptWrap: { flex: 1, position: 'relative' },
  transcript: { paddingTop: spacing.lg, paddingBottom: spacing.sm },
  emptyTranscript: { flexGrow: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl },
  emptyTitle: { marginTop: spacing.md, textAlign: 'center', fontSize: type.heading, fontWeight: '700' },
  emptyBody: { textAlign: 'center', fontSize: type.body, lineHeight: 23 },
  newOutput: { position: 'absolute', alignSelf: 'center', bottom: 12, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: 9 },
  newOutputText: { fontSize: type.caption, fontWeight: '700' },
});
