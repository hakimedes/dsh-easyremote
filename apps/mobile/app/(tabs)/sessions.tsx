import { useEffect, useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Card, EmptyState, Screen, SectionLabel, StatusPill, TopBar } from '@/ui/primitives';
import { NewSessionSheet } from '@/ui/session-config-sheets';
import { useAppStore } from '@/state/app-store';
import { spacing, type, useTheme } from '@/ui/theme';
import type { SessionSummary } from '@/domain/types';

function formatDate(value: number) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value));
}

export default function SessionsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const nodes = useAppStore((state) => state.nodes);
  const sessionsByNode = useAppStore((state) => state.sessionsByNode);
  const loadSessions = useAppStore((state) => state.loadSessions);
  const [newSheet, setNewSheet] = useState(false);
  useEffect(() => { for (const node of nodes) void loadSessions(node.id); }, [nodes, loadSessions]);
  const sessions = useMemo(() => nodes.flatMap((node) => (sessionsByNode[node.id] || []).map((session) => ({ session, node }))).sort((a, b) => (a.session.status === 'running' ? -1 : 1) - (b.session.status === 'running' ? -1 : 1) || b.session.updatedAt - a.session.updatedAt), [nodes, sessionsByNode]);

  function open(session: SessionSummary) {
    router.push({ pathname: '/session/[sessionId]', params: { sessionId: session.sessionId, nodeId: session.nodeId } });
  }

  function openCreated(nodeId: string, sessionId: string) {
    router.push({ pathname: '/session/[sessionId]', params: { sessionId, nodeId } });
  }

  return <>
    <Screen>
    <TopBar title="Sessions" eyebrow="Continue your local work" right={<Pressable onPress={() => setNewSheet(true)} disabled={!nodes.some((node) => node.online)} accessibilityRole="button" accessibilityLabel="New session" style={({ pressed }) => [styles.newButton, { backgroundColor: theme.colors.accent, opacity: pressed ? 0.75 : nodes.some((node) => node.online) ? 1 : 0.35 }]}><Ionicons name="add" size={20} color={theme.colors.accentInk} /><Text style={[styles.newText, { color: theme.colors.accentInk }]}>New</Text></Pressable>} />
    <SectionLabel right={<Text style={[styles.count, { color: theme.colors.faint }]}>{sessions.length}</Text>}>All sessions</SectionLabel>
    <View style={styles.list}>{sessions.map(({ session, node }) => {
      const running = session.status === 'running';
      const meta = `${node.name} · ${formatDate(session.updatedAt)} · ${session.workspaceLabel || 'Local workspace'}${session.agentPreset ? ` · ${session.agentPreset}` : ''}`;
      return <Card key={`${node.id}:${session.sessionId}`} onPress={() => open(session)} style={[styles.card, running && { backgroundColor: `${theme.colors.accent}0A`, borderColor: `${theme.colors.accent}30` }]} accessibilityLabel={`Open ${session.title}`}>
        <View style={styles.cardHeader}><View style={[styles.icon, { backgroundColor: `${running ? theme.colors.accent : theme.colors.muted}12` }]}><Ionicons name={running ? 'sparkles-outline' : 'chatbubble-outline'} size={18} color={running ? theme.colors.accent : theme.colors.muted} /></View><View style={styles.copy}><Text numberOfLines={1} style={[styles.title, { color: theme.colors.text }]}>{session.title}</Text><Text numberOfLines={1} ellipsizeMode="middle" style={[styles.metaText, { color: theme.colors.muted }]}>{meta}</Text></View><StatusPill label={running ? 'Running' : 'Idle'} tone={running ? 'running' : 'neutral'} /><Ionicons name="chevron-forward" size={17} color={theme.colors.faint} /></View>
      </Card>;
    })}</View>
    {!sessions.length && <EmptyState title="No sessions yet" message="Start one from an online DeepSeek Harness node." />}
    </Screen>
    <NewSessionSheet visible={newSheet} onClose={() => setNewSheet(false)} onCreated={openCreated} />
  </>;
}

const styles = StyleSheet.create({
  newButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 12, paddingHorizontal: 12 },
  newText: { fontSize: type.caption, fontWeight: '700' },
  count: { fontSize: type.caption, fontWeight: '600' },
  list: { gap: spacing.sm },
  card: { padding: spacing.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  icon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  title: { fontSize: type.body, fontWeight: '700' },
  metaText: { fontSize: type.caption },
});
