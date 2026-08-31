import { useEffect, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SessionMessage } from '../domain/types';
import type { LocalUpload, WorkspaceReference } from '../domain/types';
import type { SendFollowupOptions } from '../state/app-store';
import { nextStreamingTextLength } from '../domain/streaming-text';
import { Input, StatusPill, WhaleMark } from './primitives';
import { radii, spacing, type, useTheme } from './theme';
import { ComposerAttachmentButton, ComposerSelections } from './composer-rich-tools';
import { RichMessage, ToolGenui } from '../genui/rich-message';
import type { GenuiAction } from '../genui/renderer';
import { parseRenderUiInput } from '../genui/protocol';

export function MessageRow({ message, nodeId = '', sessionId = '', interactive = true, compact = false, onAction }: { message: SessionMessage; nodeId?: string; sessionId?: string; interactive?: boolean; compact?: boolean; onAction?: (event: GenuiAction) => void | Promise<void> }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [visibleText, setVisibleText] = useState(message.text);

  useEffect(() => {
    setVisibleText((current) => {
      if (message.role !== 'assistant') return message.text;
      return message.text.startsWith(current) ? current : message.text;
    });
  }, [message.role, message.text]);

  useEffect(() => {
    if (message.role !== 'assistant' || visibleText.length >= message.text.length) return;
    const timer = setTimeout(() => {
      setVisibleText(message.text.slice(0, nextStreamingTextLength(visibleText.length, message.text.length)));
    }, 16);
    return () => clearTimeout(timer);
  }, [message.role, message.text, visibleText]);

  if (message.role === 'tool' && message.tool) {
    if (message.tool.name === 'render_ui' && parseRenderUiInput(message.tool.input)) {
      return <ToolGenui message={message} context={{ nodeId, sessionId, interactive, compact, onAction }} />;
    }
    const failed = message.tool.status === 'failed';
    return <View style={styles.toolWrap}><Pressable onPress={() => setExpanded((value) => !value)} style={[styles.toolCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.line }]} accessibilityRole="button" accessibilityLabel={`${message.tool.name} tool event`}>
      <View style={styles.toolHeader}>
        <View style={[styles.toolIcon, { backgroundColor: `${failed ? theme.colors.danger : theme.colors.accent}12` }]}><Ionicons name={failed ? 'alert-circle-outline' : 'terminal-outline'} size={17} color={failed ? theme.colors.danger : theme.colors.accent} /></View>
        <View style={styles.toolCopy}><Text numberOfLines={1} style={[styles.toolName, { color: theme.colors.text }]}>{message.tool.name}</Text><Text style={[styles.toolStatus, { color: failed ? theme.colors.danger : theme.colors.muted }]}>{message.tool.status === 'running' ? 'Running' : failed ? 'Failed' : 'Completed'}</Text></View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={17} color={theme.colors.faint} />
      </View>
      {expanded && <View style={[styles.toolDetail, { borderTopColor: theme.colors.line }]}>{message.tool.input && <Text selectable style={[styles.toolOutput, { color: theme.colors.muted }]}>{message.tool.input}</Text>}{message.tool.output && <Text selectable style={[styles.toolOutput, { color: theme.colors.text }]}>{message.tool.output}</Text>}</View>}
    </Pressable></View>;
  }

  const isUser = message.role === 'user';
  return <View style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}>
    {!isUser && <WhaleMark size={29} />}
    <View style={[styles.bubble, isUser ? { backgroundColor: `${theme.colors.accent}12` } : styles.assistantBubble]}>
      {visibleText || message.blocks?.length ? <RichMessage message={message} visibleText={visibleText} context={{ nodeId, sessionId, interactive, compact, onAction }} /> : <Text selectable style={[styles.messageText, { color: theme.colors.text }]}>…</Text>}
    </View>
  </View>;
}

export function Composer({ onSend, onStop, disabled = false, running = false, steering = false, onToggleSteering, onDraftChange, toolbar, placeholder, nodeId = '', sessionId = '', capabilities = [] }: { onSend: (value: string, options?: SendFollowupOptions) => Promise<void>; onStop: () => Promise<void>; disabled?: boolean; running?: boolean; steering?: boolean; onToggleSteering: () => void; onDraftChange?: (hasDraft: boolean) => void; toolbar?: ReactNode; placeholder?: string; nodeId?: string; sessionId?: string; capabilities?: string[] }) {
  const theme = useTheme();
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [uploads, setUploads] = useState<LocalUpload[]>([]);
  const [references, setReferences] = useState<WorkspaceReference[]>([]);
  const [progress, setProgress] = useState<number | undefined>();
  const [localError, setLocalError] = useState<string | null>(null);
  const [uploadController, setUploadController] = useState<AbortController | null>(null);

  function draftChanged(nextValue = value, nextUploads = uploads, nextReferences = references) {
    onDraftChange?.(Boolean(nextValue.trim() || nextUploads.length || nextReferences.length));
  }

  async function submit() {
    const content = value.trim();
    if ((!content && !uploads.length && !references.length) || sending || disabled) return;
    setSending(true);
    setLocalError(null);
    const controller = new AbortController();
    setUploadController(controller);
    try {
      await onSend(content, steering ? undefined : {
        uploads,
        references,
        signal: controller.signal,
        onProgress: (next) => setProgress(next),
      });
      setValue('');
      if (!steering) {
        setUploads([]);
        setReferences([]);
      }
      onDraftChange?.(false);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Could not send this message.');
    } finally {
      setSending(false);
      setProgress(undefined);
      setUploadController(null);
    }
  }

  const canSend = Boolean(value.trim() || uploads.length || references.length) && !disabled && !sending;
  return <View style={[styles.composer, { backgroundColor: theme.colors.background, borderTopColor: theme.colors.line }]}>
    {steering && <View style={[styles.steerBanner, { backgroundColor: `${theme.colors.amber}12` }]}><View style={styles.steerCopy}><Ionicons name="navigate-outline" size={15} color={theme.colors.amber} /><Text style={[styles.steerBannerText, { color: theme.colors.amber }]}>Steering current run</Text></View><Pressable onPress={onToggleSteering}><Text style={[styles.steerCancel, { color: theme.colors.amber }]}>Cancel</Text></Pressable></View>}
    {localError && <View style={[styles.localError, { backgroundColor: `${theme.colors.danger}12` }]}><Text style={[styles.localErrorText, { color: theme.colors.danger }]}>{localError}</Text><Pressable onPress={() => setLocalError(null)}><Ionicons name="close" size={16} color={theme.colors.danger} /></Pressable></View>}
    <View style={[styles.composerShell, { backgroundColor: theme.colors.surface, borderColor: theme.colors.line }]}> 
      {!steering && <ComposerSelections uploads={uploads} references={references} progress={progress} onRemoveUpload={(id) => { const next = uploads.filter((item) => item.localId !== id); setUploads(next); draftChanged(value, next, references); }} onRemoveReference={(path) => { const next = references.filter((item) => item.path !== path); setReferences(next); draftChanged(value, uploads, next); }} />}
      <View style={styles.composerRow}>
        {!steering && <ComposerAttachmentButton nodeId={nodeId} sessionId={sessionId} capabilities={capabilities} disabled={disabled || sending} value={value} onValueChange={(next) => { setValue(next); draftChanged(next, uploads, references); }} uploads={uploads} onUploadsChange={(next) => { setUploads(next); draftChanged(value, next, references); }} references={references} onReferencesChange={(next) => { setReferences(next); draftChanged(value, uploads, next); }} />}
        {(running || steering) && <Pressable onPress={onToggleSteering} accessibilityRole="button" accessibilityLabel={steering ? 'Switch to follow-up' : 'Steer current run'} style={styles.modeButton}><Ionicons name={steering ? 'navigate' : 'navigate-outline'} size={20} color={steering ? theme.colors.amber : theme.colors.muted} /></Pressable>}
        <Input value={value} onChangeText={(next) => { setValue(next); draftChanged(next, uploads, references); }} multiline editable={!disabled && !sending} placeholder={steering ? 'Redirect the current run…' : placeholder || 'Message your Harness…'} style={styles.composerInput} accessibilityLabel={steering ? 'Steer current run' : 'Follow up with your DSH'} />
        <Pressable onPress={() => sending ? uploadController?.abort(new Error('Upload cancelled')) : void submit()} disabled={!canSend && !sending} style={[styles.sendButton, { backgroundColor: canSend ? theme.colors.accent : sending ? `${theme.colors.danger}18` : theme.colors.surfaceSoft }]} accessibilityRole="button" accessibilityLabel={sending ? 'Cancel upload' : steering ? 'Send steer instruction' : 'Send follow-up'}>
          {sending ? <Ionicons name="close" size={19} color={theme.colors.danger} /> : <Ionicons name="arrow-up" size={20} color={canSend ? theme.colors.accentInk : theme.colors.faint} />}
        </Pressable>
      </View>
      {toolbar && <View style={[styles.composerToolbar, { borderTopColor: theme.colors.line }]}>{toolbar}</View>}
    </View>
    {running && <Pressable onPress={() => void onStop()} accessibilityRole="button" accessibilityLabel="Stop current run" style={styles.stopRow}><Ionicons name="stop-circle-outline" size={16} color={theme.colors.danger} /><Text style={[styles.stopButton, { color: theme.colors.danger }]}>Stop current run</Text></Pressable>}
  </View>;
}

export function SessionStatus({ running, offline }: { running: boolean; offline: boolean }) {
  return <StatusPill label={offline ? 'Offline' : running ? 'Running' : 'Ready'} tone={offline ? 'offline' : running ? 'running' : 'neutral'} />;
}

const styles = StyleSheet.create({
  messageRow: { width: '100%', marginBottom: spacing.md, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  userRow: { justifyContent: 'flex-end' },
  assistantRow: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '86%', borderRadius: 16, paddingHorizontal: spacing.md, paddingVertical: 11 },
  assistantBubble: { flex: 1, paddingHorizontal: 0, paddingTop: 4 },
  messageText: { fontSize: type.body, lineHeight: 24 },
  toolWrap: { width: '100%', marginBottom: spacing.md, paddingLeft: 38 },
  toolCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, overflow: 'hidden' },
  toolHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm },
  toolIcon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  toolCopy: { flex: 1, minWidth: 0, gap: 1 },
  toolName: { fontSize: type.caption, fontWeight: '700' },
  toolStatus: { fontSize: type.micro, lineHeight: 15 },
  toolDetail: { borderTopWidth: StyleSheet.hairlineWidth, gap: 8, padding: spacing.sm },
  toolOutput: { fontSize: type.caption, lineHeight: 19 },
  composer: { paddingTop: spacing.sm, paddingBottom: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, gap: 7 },
  steerBanner: { minHeight: 34, borderRadius: 10, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  steerCopy: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  steerBannerText: { fontSize: type.caption, fontWeight: '600' },
  steerCancel: { fontSize: type.caption, fontWeight: '700' },
  localError: { minHeight: 34, borderRadius: 10, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  localErrorText: { flex: 1, fontSize: type.micro, lineHeight: 16 },
  composerShell: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 22, overflow: 'hidden' },
  composerRow: { flexDirection: 'row', padding: 5, alignItems: 'flex-end' },
  composerToolbar: { minHeight: 40, marginHorizontal: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  modeButton: { width: 40, height: 42, alignItems: 'center', justifyContent: 'center' },
  composerInput: { flex: 1, borderWidth: 0, backgroundColor: 'transparent', minHeight: 42, maxHeight: 110, paddingHorizontal: 4, paddingTop: 10, paddingBottom: 8 },
  sendButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', margin: 1 },
  stopRow: { alignSelf: 'center', minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.sm },
  stopButton: { fontSize: type.caption, fontWeight: '700' },
});
