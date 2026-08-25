import { useEffect, useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, type ModelCatalogModel, type ModelSelection, type Node } from '../domain/types';
import { modelSelectionLabel, selectDefaultPreset } from '../domain/session-config';
import { useAppStore } from '../state/app-store';
import { radii, spacing, type, useTheme } from './theme';

function Sheet({ visible, title, subtitle, onClose, children }: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
    <View style={styles.modalRoot}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <SafeAreaView edges={['bottom']} style={[styles.sheet, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.handle, { backgroundColor: theme.colors.line }]} />
        <View style={styles.sheetHeader}>
          <View style={styles.sheetHeaderCopy}>
            <Text style={[styles.sheetTitle, { color: theme.colors.text }]}>{title}</Text>
            {subtitle && <Text style={[styles.sheetSubtitle, { color: theme.colors.muted }]}>{subtitle}</Text>}
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={[styles.close, { backgroundColor: theme.colors.surface }]}>
            <Ionicons name="close" size={20} color={theme.colors.text} />
          </Pressable>
        </View>
        {children}
      </SafeAreaView>
    </View>
  </Modal>;
}

function InlineNotice({ icon, text, tone = 'muted' }: { icon: keyof typeof Ionicons.glyphMap; text: string; tone?: 'muted' | 'warning' | 'danger' }) {
  const theme = useTheme();
  const color = tone === 'warning' ? theme.colors.amber : tone === 'danger' ? theme.colors.danger : theme.colors.muted;
  return <View style={[styles.notice, { backgroundColor: `${color}10` }]}>
    <Ionicons name={icon} size={16} color={color} />
    <Text style={[styles.noticeText, { color }]}>{text}</Text>
  </View>;
}

export function NewSessionSheet({ visible, onClose, onCreated }: {
  visible: boolean;
  onClose: () => void;
  onCreated: (nodeId: string, sessionId: string) => void;
}) {
  const theme = useTheme();
  const nodes = useAppStore((state) => state.nodes);
  const presetsByNode = useAppStore((state) => state.agentPresetsByNode);
  const loadAgentPresets = useAppStore((state) => state.loadAgentPresets);
  const createSession = useAppStore((state) => state.createSession);
  const clearError = useAppStore((state) => state.clearError);
  const onlineNodes = useMemo(() => nodes.filter((node) => node.online && !node.revokedAt), [nodes]);
  const [nodeId, setNodeId] = useState('');
  const [presetId, setPresetId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const presets = presetsByNode[nodeId] || [];

  useEffect(() => {
    if (!visible) return;
    const firstNode = onlineNodes[0];
    setNodeId(firstNode?.id || '');
    setPresetId(undefined);
    setLegacy(false);
    setMessage(null);
  }, [visible, onlineNodes]);

  useEffect(() => {
    if (!visible || !nodeId) return;
    let active = true;
    setLoading(true);
    setMessage(null);
    setLegacy(false);
    void loadAgentPresets(nodeId).then((items) => {
      if (!active) return;
      setPresetId(selectDefaultPreset(items)?.id);
      if (items.length === 0) setLegacy(true);
    }).catch((error) => {
      if (!active) return;
      const compatibleFallback = error instanceof ApiError
        && (error.code === 'CAPABILITY_UNAVAILABLE' || error.status === 404 || error.status === 409);
      setLegacy(compatibleFallback);
      setMessage(compatibleFallback
        ? 'This Connector supports default mode only. Update it to choose an Agent mode.'
        : error instanceof Error ? error.message : 'Could not load Agent modes.');
      if (compatibleFallback) clearError();
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [clearError, loadAgentPresets, nodeId, visible]);

  async function create() {
    if (!nodeId || creating || (!legacy && presets.length > 0 && !presetId)) return;
    setCreating(true);
    setMessage(null);
    try {
      const sessionId = await createSession(nodeId, legacy ? undefined : presetId);
      onClose();
      onCreated(nodeId, sessionId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create the session.');
    } finally {
      setCreating(false);
    }
  }

  return <Sheet visible={visible} title="New conversation" subtitle="Choose how your local Harness should work" onClose={onClose}>
    <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
      {onlineNodes.length > 1 && <>
        <Text style={[styles.fieldLabel, { color: theme.colors.muted }]}>HARNESS NODE</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {onlineNodes.map((node) => <NodeChip key={node.id} node={node} selected={node.id === nodeId} onPress={() => setNodeId(node.id)} />)}
        </ScrollView>
      </>}
      {onlineNodes.length === 1 && <View style={[styles.singleNode, { borderColor: theme.colors.line }]}>
        <View style={[styles.nodeGlyph, { backgroundColor: `${theme.colors.accent}12` }]}><Ionicons name="desktop-outline" size={18} color={theme.colors.accent} /></View>
        <View style={styles.flex}><Text style={[styles.nodeTitle, { color: theme.colors.text }]}>{onlineNodes[0]?.name}</Text><Text style={[styles.nodeDetail, { color: theme.colors.muted }]}>Online · Ready</Text></View>
      </View>}
      {!onlineNodes.length && <InlineNotice icon="cloud-offline-outline" text="No online Harness node is available." tone="danger" />}

      <Text style={[styles.fieldLabel, { color: theme.colors.muted }]}>AGENT MODE</Text>
      {loading && <View style={styles.loadingRow}><ActivityIndicator color={theme.colors.accent} /><Text style={[styles.loadingText, { color: theme.colors.muted }]}>Loading modes from your Harness…</Text></View>}
      {!loading && legacy && <Pressable style={[styles.modeCard, { borderColor: theme.colors.accent, backgroundColor: `${theme.colors.accent}0B` }]}>
        <View style={[styles.modeIcon, { backgroundColor: `${theme.colors.accent}15` }]}><Ionicons name="sparkles-outline" size={19} color={theme.colors.accent} /></View>
        <View style={styles.flex}><Text style={[styles.modeName, { color: theme.colors.text }]}>Default mode</Text><Text style={[styles.modeDescription, { color: theme.colors.muted }]}>Use the mode configured on this Harness.</Text></View>
        <Ionicons name="checkmark-circle" size={21} color={theme.colors.accent} />
      </Pressable>}
      {!loading && !legacy && <View style={styles.modeList}>{presets.map((preset) => {
        const selected = preset.id === presetId;
        const disabled = Boolean(preset.broken);
        return <Pressable key={preset.id} disabled={disabled} onPress={() => setPresetId(preset.id)} accessibilityRole="radio" accessibilityState={{ selected, disabled }} style={({ pressed }) => [styles.modeCard, {
          borderColor: selected ? theme.colors.accent : theme.colors.line,
          backgroundColor: selected ? `${theme.colors.accent}0B` : theme.colors.surface,
          opacity: disabled ? 0.48 : pressed ? 0.75 : 1,
        }]}>
          <View style={[styles.modeIcon, { backgroundColor: `${selected ? theme.colors.accent : theme.colors.muted}12` }]}><Ionicons name={preset.id === 'minimal' ? 'flash-outline' : preset.id === 'code' ? 'code-slash-outline' : preset.id === 'cordis' ? 'color-wand-outline' : 'sparkles-outline'} size={19} color={selected ? theme.colors.accent : theme.colors.muted} /></View>
          <View style={styles.flex}>
            <View style={styles.modeTitleRow}><Text style={[styles.modeName, { color: theme.colors.text }]}>{preset.name || preset.id}</Text>{preset.trust === 'user' && <Text style={[styles.userBadge, { color: theme.colors.amber, backgroundColor: `${theme.colors.amber}12` }]}>USER PRESET</Text>}</View>
            <Text style={[styles.modeDescription, { color: disabled ? theme.colors.danger : theme.colors.muted }]}>{preset.broken || preset.description || 'Agent capabilities configured by this Harness.'}</Text>
          </View>
          <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={21} color={selected ? theme.colors.accent : theme.colors.faint} />
        </Pressable>;
      })}</View>}
      {message && <InlineNotice icon={legacy ? 'information-circle-outline' : 'alert-circle-outline'} text={message} tone={legacy ? 'warning' : 'danger'} />}
      <InlineNotice icon="lock-closed-outline" text="Agent mode is fixed after the first message. You can still switch models inside the conversation." />
    </ScrollView>
    <View style={[styles.sheetFooter, { borderTopColor: theme.colors.line }]}>
      <Pressable onPress={() => void create()} disabled={!nodeId || loading || creating || (!legacy && presets.length > 0 && !presetId)} accessibilityRole="button" accessibilityLabel="Create conversation" style={[styles.primaryAction, { backgroundColor: theme.colors.accent, opacity: !nodeId || loading || creating || (!legacy && presets.length > 0 && !presetId) ? 0.38 : 1 }]}>
        {creating ? <ActivityIndicator color={theme.colors.accentInk} /> : <><Text style={[styles.primaryActionText, { color: theme.colors.accentInk }]}>Start conversation</Text><Ionicons name="arrow-forward" size={18} color={theme.colors.accentInk} /></>}
      </Pressable>
    </View>
  </Sheet>;
}

function NodeChip({ node, selected, onPress }: { node: Node; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} style={[styles.nodeChip, { borderColor: selected ? theme.colors.accent : theme.colors.line, backgroundColor: selected ? `${theme.colors.accent}0B` : theme.colors.surface }]}>
    <View style={[styles.onlineDot, { backgroundColor: theme.colors.accent }]} /><Text style={[styles.nodeChipText, { color: theme.colors.text }]}>{node.name}</Text>
  </Pressable>;
}

export function ModelChip({ models, disabled = false, onPress }: {
  models?: ReturnType<typeof useAppStore.getState>['sessionModels'][string];
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return <Pressable disabled={disabled} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Model ${modelSelectionLabel(models)}`} style={({ pressed }) => [styles.modelChip, { backgroundColor: theme.colors.surface, borderColor: theme.colors.line, opacity: disabled ? 0.45 : pressed ? 0.68 : 1 }]}>
    <Ionicons name="hardware-chip-outline" size={14} color={models?.routable === false ? theme.colors.danger : theme.colors.accent} />
    <Text numberOfLines={1} style={[styles.modelChipText, { color: theme.colors.text }]}>{modelSelectionLabel(models)}</Text>
    <Ionicons name="chevron-down" size={13} color={theme.colors.faint} />
  </Pressable>;
}

export function ModelPickerSheet({ visible, nodeId, sessionId, running, offline, onClose }: {
  visible: boolean;
  nodeId: string;
  sessionId: string;
  running: boolean;
  offline: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const key = `${nodeId}:${sessionId}`;
  const models = useAppStore((state) => state.sessionModels[key]);
  const loadSessionModels = useAppStore((state) => state.loadSessionModels);
  const selectSessionModel = useAppStore((state) => state.selectSessionModel);
  const [selection, setSelection] = useState<ModelSelection | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !nodeId || !sessionId || offline) return;
    let active = true;
    setLoading(true);
    setMessage(null);
    void loadSessionModels(nodeId, sessionId).then((value) => {
      if (active) setSelection(value.current);
    }).catch((error) => {
      if (active) setMessage(error instanceof Error ? error.message : 'Could not load models.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [loadSessionModels, nodeId, offline, sessionId, visible]);

  const chosenModel = useMemo(() => {
    if (!models || !selection) return undefined;
    return models.groups.find((group) => group.id === selection.provider)
      ?.models.find((model) => model.id === selection.model);
  }, [models, selection]);

  function choose(provider: string, model: ModelCatalogModel) {
    const isCurrent = models?.current.provider === provider && models.current.model === model.id;
    setSelection({
      provider,
      model: model.id,
      ...(isCurrent && models?.current.reasoningEffort
        ? { reasoningEffort: models.current.reasoningEffort }
        : model.reasoning?.defaultEffort
          ? { reasoningEffort: model.reasoning.defaultEffort }
          : {}),
    });
  }

  async function apply() {
    if (!selection || saving || offline) return;
    setSaving(true);
    setMessage(null);
    try {
      await selectSessionModel(nodeId, sessionId, selection);
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not switch models.');
    } finally {
      setSaving(false);
    }
  }

  return <Sheet visible={visible} title="Choose model" subtitle="Applies to this conversation and future new sessions" onClose={onClose}>
    <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
      {offline && <InlineNotice icon="cloud-offline-outline" text="Reconnect this Harness to switch models." tone="danger" />}
      {running && <InlineNotice icon="time-outline" text="The new model applies to the next step; the current response keeps its assembled model." tone="warning" />}
      {loading && <View style={styles.loadingRow}><ActivityIndicator color={theme.colors.accent} /><Text style={[styles.loadingText, { color: theme.colors.muted }]}>Loading model catalog…</Text></View>}
      {!loading && models && <>
        {!models.routable && <InlineNotice icon="alert-circle-outline" text="The current model route is unavailable. Select a routable model before sending." tone="danger" />}
        {models.groups.map((group) => <View key={group.id} style={styles.providerGroup}>
          <Text style={[styles.providerName, { color: theme.colors.muted }]}>{group.name.toUpperCase()}</Text>
          <View style={styles.modelList}>{group.models.map((model) => {
            const selected = selection?.provider === group.id && selection.model === model.id;
            return <Pressable key={`${group.id}:${model.id}`} onPress={() => choose(group.id, model)} accessibilityRole="radio" accessibilityState={{ selected }} style={({ pressed }) => [styles.modelRow, { borderColor: selected ? theme.colors.accent : theme.colors.line, backgroundColor: selected ? `${theme.colors.accent}0B` : theme.colors.surface, opacity: pressed ? 0.72 : 1 }]}>
              <View style={[styles.modelGlyph, { backgroundColor: `${selected ? theme.colors.accent : theme.colors.muted}12` }]}><Ionicons name="hardware-chip-outline" size={18} color={selected ? theme.colors.accent : theme.colors.muted} /></View>
              <View style={styles.flex}><Text style={[styles.modelName, { color: theme.colors.text }]}>{model.name}</Text>{model.description && <Text numberOfLines={2} style={[styles.modelDescription, { color: theme.colors.muted }]}>{model.description}</Text>}</View>
              <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={21} color={selected ? theme.colors.accent : theme.colors.faint} />
            </Pressable>;
          })}</View>
        </View>)}
        {chosenModel?.reasoning && <View style={styles.reasoningSection}>
          <Text style={[styles.fieldLabel, { color: theme.colors.muted }]}>REASONING EFFORT</Text>
          <View style={styles.effortRow}>
            <EffortChip label="Default" selected={!selection?.reasoningEffort} onPress={() => setSelection((current) => current ? ({ provider: current.provider, model: current.model }) : current)} />
            {chosenModel.reasoning.efforts.map((effort) => <EffortChip key={effort.id} label={effort.name} selected={selection?.reasoningEffort === effort.id} onPress={() => setSelection((current) => current ? { ...current, reasoningEffort: effort.id } : current)} />)}
          </View>
        </View>}
        {models.failures.map((failure) => <InlineNotice key={failure.id} icon="warning-outline" text={`${failure.name}: ${failure.message}`} tone="warning" />)}
      </>}
      {message && <InlineNotice icon="alert-circle-outline" text={message} tone="danger" />}
    </ScrollView>
    <View style={[styles.sheetFooter, { borderTopColor: theme.colors.line }]}>
      <Pressable onPress={() => void apply()} disabled={!selection || loading || saving || offline} accessibilityRole="button" accessibilityLabel="Apply model" style={[styles.primaryAction, { backgroundColor: theme.colors.accent, opacity: !selection || loading || saving || offline ? 0.38 : 1 }]}>
        {saving ? <ActivityIndicator color={theme.colors.accentInk} /> : <><Text style={[styles.primaryActionText, { color: theme.colors.accentInk }]}>Use this model</Text><Ionicons name="checkmark" size={18} color={theme.colors.accentInk} /></>}
      </Pressable>
    </View>
  </Sheet>;
}

export function SessionRenameSheet({ visible, nodeId, sessionId, currentTitle, offline, onClose }: {
  visible: boolean;
  nodeId: string;
  sessionId: string;
  currentTitle: string;
  offline: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const renameSession = useAppStore((state) => state.renameSession);
  const [title, setTitle] = useState(currentTitle);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTitle(currentTitle);
    setMessage(null);
  }, [currentTitle, visible]);

  async function save() {
    const nextTitle = title.trim();
    if (!nextTitle || saving || offline || nextTitle === currentTitle.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      await renameSession(nodeId, sessionId, nextTitle);
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not rename this conversation.');
    } finally {
      setSaving(false);
    }
  }

  const canSave = Boolean(title.trim()) && title.trim() !== currentTitle.trim() && !offline && !saving;
  return <Sheet visible={visible} title="Conversation title" subtitle="Use a concise topic name you can find later" onClose={onClose}>
    <View style={styles.renameContent}>
      <Text style={[styles.fieldLabel, { color: theme.colors.muted }]}>TITLE</Text>
      <TextInput
        value={title}
        onChangeText={setTitle}
        autoFocus
        maxLength={200}
        returnKeyType="done"
        onSubmitEditing={() => void save()}
        selectTextOnFocus
        placeholder="Conversation topic"
        placeholderTextColor={theme.colors.faint}
        style={[styles.renameInput, { color: theme.colors.text, backgroundColor: theme.colors.surface, borderColor: theme.colors.line }]}
      />
      {offline && <InlineNotice icon="cloud-offline-outline" text="Reconnect this Harness to rename the conversation." tone="danger" />}
      {message && <InlineNotice icon="alert-circle-outline" text={message} tone="danger" />}
    </View>
    <View style={[styles.sheetFooter, { borderTopColor: theme.colors.line }]}> 
      <Pressable onPress={() => void save()} disabled={!canSave} accessibilityRole="button" accessibilityLabel="Save conversation title" style={[styles.primaryAction, { backgroundColor: theme.colors.accent, opacity: canSave ? 1 : 0.38 }]}> 
        {saving ? <ActivityIndicator color={theme.colors.accentInk} /> : <><Text style={[styles.primaryActionText, { color: theme.colors.accentInk }]}>Save title</Text><Ionicons name="checkmark" size={18} color={theme.colors.accentInk} /></>}
      </Pressable>
    </View>
  </Sheet>;
}

function EffortChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} style={[styles.effortChip, { borderColor: selected ? theme.colors.accent : theme.colors.line, backgroundColor: selected ? `${theme.colors.accent}12` : theme.colors.surface }]}>
    <Text style={[styles.effortText, { color: selected ? theme.colors.accent : theme.colors.muted }]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#00000072' },
  sheet: { maxHeight: '90%', borderTopLeftRadius: 26, borderTopRightRadius: 26, overflow: 'hidden' },
  handle: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 9 },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.md },
  sheetHeaderCopy: { flex: 1, gap: 4 },
  sheetTitle: { fontSize: type.title, lineHeight: 31, fontWeight: '700', letterSpacing: -0.5 },
  sheetSubtitle: { fontSize: type.caption, lineHeight: 18 },
  close: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sheetScroll: { flexShrink: 1 },
  sheetContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg, gap: spacing.sm },
  sheetFooter: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  fieldLabel: { marginTop: spacing.sm, fontSize: type.micro, lineHeight: 16, fontWeight: '800', letterSpacing: 1 },
  chipRow: { gap: spacing.sm, paddingVertical: 2 },
  nodeChip: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: spacing.md },
  onlineDot: { width: 7, height: 7, borderRadius: 4 },
  nodeChipText: { fontSize: type.caption, fontWeight: '700' },
  singleNode: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, paddingHorizontal: spacing.sm },
  nodeGlyph: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  nodeTitle: { fontSize: type.caption, fontWeight: '700' },
  nodeDetail: { marginTop: 2, fontSize: type.micro },
  modeList: { gap: spacing.sm },
  modeCard: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: radii.md, padding: spacing.sm },
  modeIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  modeTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  modeName: { flexShrink: 1, fontSize: type.body, fontWeight: '700' },
  modeDescription: { marginTop: 3, fontSize: type.micro, lineHeight: 16 },
  userBadge: { borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2, fontSize: 8, lineHeight: 11, fontWeight: '800', letterSpacing: 0.45 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, borderRadius: 11, padding: spacing.sm },
  noticeText: { flex: 1, fontSize: type.caption, lineHeight: 18 },
  loadingRow: { minHeight: 72, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.sm },
  loadingText: { fontSize: type.caption },
  primaryAction: { minHeight: 52, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryActionText: { fontSize: type.body, fontWeight: '700' },
  modelChip: { maxWidth: 190, minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.pill, paddingHorizontal: 10 },
  modelChipText: { flexShrink: 1, fontSize: type.micro, fontWeight: '700' },
  renameContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg, gap: spacing.sm },
  renameInput: { minHeight: 54, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, fontSize: type.body, fontWeight: '600' },
  providerGroup: { gap: spacing.sm },
  providerName: { marginTop: spacing.sm, fontSize: type.micro, lineHeight: 16, fontWeight: '800', letterSpacing: 1 },
  modelList: { gap: spacing.sm },
  modelRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: radii.md, padding: spacing.sm },
  modelGlyph: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  modelName: { fontSize: type.caption, fontWeight: '700' },
  modelDescription: { marginTop: 2, fontSize: type.micro, lineHeight: 16 },
  reasoningSection: { gap: spacing.sm },
  effortRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  effortChip: { minHeight: 38, justifyContent: 'center', borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: spacing.md },
  effortText: { fontSize: type.caption, fontWeight: '700' },
  flex: { flex: 1, minWidth: 0 },
});
