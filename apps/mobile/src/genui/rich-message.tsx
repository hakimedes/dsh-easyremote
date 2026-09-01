import { useEffect, useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { MessageBlock, SessionMessage } from '../domain/types';
import { apiClient } from '../api/client';
import { cachedArtifact, cachedAttachment } from '../storage/attachment-cache';
import { radii, spacing, type, useTheme } from '../ui/theme';
import { contentFingerprint, parseRenderUiInput, splitRichContent } from './protocol';
import { GenuiRenderer, type GenuiAction } from './renderer';
import { SafeMarkdown } from './safe-markdown';
import type { SessionPanel } from './panel';
import { SafeImagePreview } from './safe-image-preview';
import { withoutWorkspaceMediaMarkdown } from './workspace-media';

export type RichMessageContext = {
  nodeId: string;
  sessionId: string;
  interactive?: boolean;
  compact?: boolean;
  onAction?: (event: GenuiAction) => void | Promise<void>;
};

function AttachmentImage({ block, nodeId, sessionId }: { block: Extract<MessageBlock, { type: 'image' }>; nodeId: string; sessionId: string }) {
  const theme = useTheme();
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setFailed(false);
    setUri(null);
    void cachedAttachment({
      api: apiClient,
      hubId: apiClient.hubId || apiClient.server,
      nodeId,
      sessionId,
      attachmentId: block.attachmentId,
      mediaType: block.mediaType,
    }).then((value) => { if (active) setUri(value); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [block.attachmentId, block.mediaType, nodeId, sessionId]);
  const aspectRatio = block.width > 0 && block.height > 0 ? Math.max(0.5, Math.min(2.2, block.width / block.height)) : 1.2;
  if (failed) return <View style={[styles.attachmentFailed, { backgroundColor: theme.colors.surface, borderColor: theme.colors.line }]}><Ionicons name="image-outline" size={20} color={theme.colors.faint} /><Text style={[styles.attachmentLabel, { color: theme.colors.muted }]}>Image unavailable · tap after reconnecting</Text></View>;
  if (!uri) return <View style={[styles.attachmentLoading, { backgroundColor: theme.colors.surface }]}><ActivityIndicator color={theme.colors.accent} /></View>;
  return <View style={styles.attachmentWrap}><SafeImagePreview uri={uri} mediaType={block.mediaType} aspectRatio={aspectRatio} accessibilityLabel={block.name || 'DSH image attachment'} frameStyle={styles.attachmentImage} />{block.name && <Text style={[styles.attachmentName, { color: theme.colors.muted }]}>{block.name}</Text>}</View>;
}

function WorkspaceMedia({ block, context }: { block: Extract<MessageBlock, { type: 'workspace-media' }>; context: RichMessageContext }) {
  const theme = useTheme();
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setFailed(false);
    setUri(null);
    void cachedArtifact({
      api: apiClient,
      hubId: apiClient.hubId || apiClient.server,
      nodeId: context.nodeId,
      sessionId: context.sessionId,
      artifactId: block.artifactId,
      mediaType: block.mediaType,
    }).then((value) => { if (active) setUri(value); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attempt, block.artifactId, block.mediaType, context.nodeId, context.sessionId]);

  if (failed) {
    const content = <><Ionicons name="cloud-offline-outline" size={20} color={theme.colors.faint} /><Text style={[styles.attachmentLabel, { color: theme.colors.muted }]}>{context.interactive ? 'Preview unavailable · tap to retry' : 'Preview unavailable while offline'}</Text><Text numberOfLines={1} style={[styles.attachmentName, { color: theme.colors.faint }]}>{block.path}</Text></>;
    return context.interactive
      ? <Pressable onPress={() => setAttempt((value) => value + 1)} accessibilityRole="button" accessibilityLabel={`Retry ${block.name} preview`} style={[styles.attachmentFailed, { backgroundColor: theme.colors.surface, borderColor: theme.colors.line }]}>{content}</Pressable>
      : <View style={[styles.attachmentFailed, { backgroundColor: theme.colors.surface, borderColor: theme.colors.line }]}>{content}</View>;
  }
  if (!uri) return <View style={[styles.attachmentLoading, { backgroundColor: theme.colors.surface }]}><ActivityIndicator color={theme.colors.accent} /></View>;
  return <View style={styles.attachmentWrap}><SafeImagePreview uri={uri} mediaType={block.mediaType} accessibilityLabel={`${block.name} workspace preview`} frameStyle={[styles.attachmentImage, context.compact && styles.compactImage]} /><Text numberOfLines={1} style={[styles.attachmentName, { color: theme.colors.muted }]}>{block.path}</Text></View>;
}

function RichBlocks({ message, context }: { message: SessionMessage; context: RichMessageContext }) {
  const theme = useTheme();
  return <>{message.blocks?.filter((block) => block.type !== 'text').map((block, index) => {
    if (block.type === 'image') return <AttachmentImage key={`${block.attachmentId}:${index}`} block={block} nodeId={context.nodeId} sessionId={context.sessionId} />;
    if (block.type === 'workspace-media') return <WorkspaceMedia key={`${block.artifactId}:${index}`} block={block} context={context} />;
    return <View key={`${block.path}:${index}`} style={[styles.reference, { backgroundColor: theme.colors.surface, borderColor: theme.colors.line }]}><Ionicons name={block.kind === 'dir' ? 'folder-outline' : 'document-outline'} size={15} color={theme.colors.accent} /><Text numberOfLines={1} style={[styles.referenceText, { color: theme.colors.text }]}>{block.path}</Text></View>;
  })}</>;
}

export function RichMessage({ message, visibleText, context }: { message: SessionMessage; visibleText: string; context: RichMessageContext }) {
  const theme = useTheme();
  const rawSource = visibleText || message.blocks?.filter((block) => block.type === 'text').map((block) => block.text).join('\n') || '';
  const markdownMediaPaths = [
    ...(message.blocks?.flatMap((block) => block.type === 'workspace-media' && block.source === 'markdown' ? [block.path] : []) || []),
    ...(message.suppressedWorkspaceMediaPaths || []),
  ];
  const source = withoutWorkspaceMediaMarkdown(rawSource, markdownMediaPaths);
  const segments = useMemo(() => splitRichContent(source, Boolean(message.streaming)), [message.streaming, source]);
  return <View style={styles.richRoot}>
    {segments.map((segment, index) => {
      if (segment.type === 'markdown') return segment.text.trim() ? <SafeMarkdown key={index} value={segment.text} compact={context.compact} /> : null;
      if (segment.type === 'diagnostic') return <View key={index} style={[styles.diagnostic, { backgroundColor: `${theme.colors.danger}0D`, borderColor: `${theme.colors.danger}40` }]}><View style={styles.diagnosticTitle}><Ionicons name="code-slash-outline" size={15} color={theme.colors.danger} /><Text style={[styles.diagnosticLabel, { color: theme.colors.danger }]}>UI could not be rendered</Text></View><Text selectable numberOfLines={context.compact ? 4 : undefined} style={[styles.diagnosticCode, { color: theme.colors.muted }]}>{segment.raw}</Text></View>;
      if (segment.spec.panel) return null;
      const stateKey = `${apiClient.hubId || apiClient.server}:${context.sessionId}:${message.sourceSeq}:${segment.fenceIndex}:${contentFingerprint(segment.raw)}`;
      return <GenuiRenderer key={index} spec={segment.spec} stateKey={stateKey} interactive={Boolean(context.interactive) && !segment.partial} onAction={context.onAction} />;
    })}
    <RichBlocks message={message} context={context} />
  </View>;
}

export function ToolGenui({ message, context }: { message: SessionMessage; context: RichMessageContext }) {
  const spec = parseRenderUiInput(message.tool?.input);
  if (!spec || spec.panel) return null;
  return <View style={styles.toolGenui}><GenuiRenderer spec={spec} stateKey={`${apiClient.hubId || apiClient.server}:${context.sessionId}:${message.sourceSeq}:tool:${contentFingerprint(message.tool?.input || '')}`} interactive={Boolean(context.interactive) && message.tool?.status !== 'running'} onAction={context.onAction} /></View>;
}

export function SessionPanelCard({ panel, interactive, onAction }: { panel: SessionPanel; interactive: boolean; onAction?: RichMessageContext['onAction'] }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(true);
  return <View style={[styles.panel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.line }]}><Pressable onPress={() => setExpanded((value) => !value)} style={styles.panelHeader} accessibilityRole="button" accessibilityLabel="Session panel"><View style={[styles.panelIcon, { backgroundColor: `${theme.colors.accent}18` }]}><Ionicons name="apps-outline" size={16} color={theme.colors.accent} /></View><Text style={[styles.panelTitle, { color: theme.colors.text }]}>Session Panel</Text><Ionicons name={expanded ? 'chevron-down' : 'chevron-up'} size={16} color={theme.colors.faint} /></Pressable>{expanded && <View style={[styles.panelBody, { borderTopColor: theme.colors.line }]}><GenuiRenderer spec={panel.spec} stateKey={panel.stateKey} interactive={interactive} onAction={onAction} /></View>}</View>;
}

const styles = StyleSheet.create({
  richRoot: { width: '100%', gap: spacing.sm },
  diagnostic: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.sm, gap: 7 },
  diagnosticTitle: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  diagnosticLabel: { fontSize: type.caption, fontWeight: '700' },
  diagnosticCode: { fontFamily: 'monospace', fontSize: 11, lineHeight: 17 },
  attachmentWrap: { gap: 5 },
  attachmentImage: { width: '100%', minHeight: 180, maxHeight: 420, borderRadius: radii.md },
  compactImage: { minHeight: 120, maxHeight: 220 },
  attachmentName: { fontSize: type.micro, lineHeight: 16 },
  attachmentLoading: { minHeight: 180, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  attachmentFailed: { minHeight: 80, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', gap: 6, padding: spacing.md },
  attachmentLabel: { fontSize: type.caption, textAlign: 'center' },
  reference: { alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 7 },
  referenceText: { flexShrink: 1, fontSize: type.caption },
  toolGenui: { width: '100%', marginBottom: spacing.md, paddingLeft: 38 },
  panel: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, overflow: 'hidden', marginBottom: spacing.sm },
  panelHeader: { minHeight: 44, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  panelIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  panelTitle: { flex: 1, fontSize: type.caption, fontWeight: '800' },
  panelBody: { borderTopWidth: StyleSheet.hairlineWidth, padding: spacing.md },
});
