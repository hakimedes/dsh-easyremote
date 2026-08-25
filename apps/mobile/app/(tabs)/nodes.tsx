import { useEffect } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Card, EmptyState, ErrorBanner, PrimaryButton, Screen, SectionLabel, StatusPill, TopBar } from '@/ui/primitives';
import { useAppStore } from '@/state/app-store';
import { spacing, type, useTheme } from '@/ui/theme';
import type { Node } from '@/domain/types';

function NodeCard({ node, onRevoke }: { node: Node; onRevoke: () => void }) {
  const theme = useTheme();
  const revoked = Boolean(node.revokedAt);
  return <Card style={styles.nodeCard}>
    <View style={styles.nodeHeader}><View style={[styles.nodeAvatar, { backgroundColor: `${node.online ? theme.colors.accent : theme.colors.muted}12` }]}><Ionicons name="desktop-outline" size={21} color={node.online ? theme.colors.accent : theme.colors.muted} /></View><View style={styles.nodeCopy}><Text numberOfLines={1} style={[styles.nodeName, { color: theme.colors.text }]}>{node.name}</Text><Text numberOfLines={1} style={[styles.nodeMeta, { color: theme.colors.muted }]}>{node.platform} · {node.arch} · DSH {node.dshVersion}</Text></View><StatusPill label={revoked ? 'Removed' : node.online ? 'Online' : 'Offline'} tone={revoked || !node.online ? 'offline' : 'online'} /></View>
    {!node.online && !revoked && <View style={[styles.offlineRow, { backgroundColor: `${theme.colors.coral}0D` }]}><Ionicons name="cloud-offline-outline" size={16} color={theme.colors.coral} /><Text style={[styles.offlineCopy, { color: theme.colors.coral }]}>Cached sessions are read-only</Text></View>}
    {!revoked && <Pressable onPress={onRevoke} style={styles.revokeButton} accessibilityRole="button" accessibilityLabel={`Remove remote access from ${node.name}`}><Ionicons name="unlink-outline" size={16} color={theme.colors.danger} /><Text style={[styles.revokeText, { color: theme.colors.danger }]}>Remove remote access</Text></Pressable>}
  </Card>;
}

export default function NodesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const nodes = useAppStore((state) => state.nodes);
  const errorMessage = useAppStore((state) => state.errorMessage);
  const clearError = useAppStore((state) => state.clearError);
  const refreshNodes = useAppStore((state) => state.refreshNodes);
  const revokeNode = useAppStore((state) => state.revokeNode);
  useEffect(() => { void refreshNodes().catch(() => undefined); }, [refreshNodes]);

  function confirmRevoke(node: Node) {
    Alert.alert('Remove remote access?', `${node.name} will stop accepting remote control. Pair it again from DSH Web to reconnect.`, [
      { text: 'Keep node', style: 'cancel' },
      { text: 'Remove access', style: 'destructive', onPress: () => void revokeNode(node.id) },
    ]);
  }

  return <Screen>
    <TopBar title="Nodes" eyebrow="Your DeepSeek Harness machines" />
    {errorMessage && <ErrorBanner message={errorMessage} onDismiss={clearError} />}
    <SectionLabel right={<Text style={[styles.count, { color: theme.colors.faint }]}>{nodes.length}</Text>}>Connected nodes</SectionLabel>
    <View style={styles.list}>{nodes.map((node) => <NodeCard key={node.id} node={node} onRevoke={() => confirmRevoke(node)} />)}</View>
    {!nodes.length && <EmptyState title="No nodes paired" message="Scan the QR code in DSH Web to connect a local Harness." action={<PrimaryButton label="Scan Harness QR" icon="qr-code-outline" onPress={() => router.push('/scan')} />} />}
  </Screen>;
}

const styles = StyleSheet.create({
  count: { fontSize: type.caption, fontWeight: '600' },
  list: { gap: spacing.sm },
  nodeCard: { gap: spacing.sm },
  nodeHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  nodeAvatar: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  nodeCopy: { flex: 1, minWidth: 0, gap: 3 },
  nodeName: { fontSize: type.body, fontWeight: '700' },
  nodeMeta: { fontSize: type.caption },
  offlineRow: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 9, paddingHorizontal: spacing.sm, paddingVertical: 7 },
  offlineCopy: { fontSize: type.caption, fontWeight: '600' },
  revokeButton: { alignSelf: 'flex-start', minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: spacing.xs },
  revokeText: { fontSize: type.caption, fontWeight: '700' },
});
