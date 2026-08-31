import { useEffect, useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { LocalUpload, WorkspaceReference } from '../domain/types';
import { validateLocalUploads } from '../domain/upload-limits';
import { useAppStore } from '../state/app-store';
import { radii, spacing, type, useTheme } from './theme';

function localId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function fileSize(uri: string, known?: number | null) {
  if (typeof known === 'number' && known > 0) return known;
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || info.isDirectory || typeof info.size !== 'number') throw new Error('Could not read the selected file size.');
  return info.size;
}

function mention(path: string) {
  return /\s/.test(path) ? `@${JSON.stringify(path)}` : `@${path}`;
}

function replaceActiveMention(value: string, path: string) {
  const token = /(^|\s)@"?[^\s"]*$/;
  const replacement = `${value.match(token)?.[1] || ''}${mention(path)} `;
  return token.test(value) ? value.replace(token, replacement) : `${value}${value && !value.endsWith(' ') ? ' ' : ''}${mention(path)} `;
}

export function activeMentionQuery(value: string) {
  const match = value.match(/(?:^|\s)@"?([^\s"]*)$/);
  return match ? match[1] : null;
}

export function ComposerAttachmentButton({
  nodeId,
  sessionId,
  capabilities,
  disabled,
  value,
  onValueChange,
  uploads,
  onUploadsChange,
  references,
  onReferencesChange,
}: {
  nodeId: string;
  sessionId: string;
  capabilities: string[];
  disabled: boolean;
  value: string;
  onValueChange: (value: string) => void;
  uploads: LocalUpload[];
  onUploadsChange: (uploads: LocalUpload[]) => void;
  references: WorkspaceReference[];
  onReferencesChange: (references: WorkspaceReference[]) => void;
}) {
  const theme = useTheme();
  const searchWorkspaceReferences = useAppStore((state) => state.searchWorkspaceReferences);
  const [menu, setMenu] = useState(false);
  const [workspace, setWorkspace] = useState(false);
  const [query, setQuery] = useState('');
  const [prefix, setPrefix] = useState('');
  const [results, setResults] = useState<WorkspaceReference[]>([]);
  const [searching, setSearching] = useState(false);
  const canImages = capabilities.includes('session.prompt.parts');
  const canFiles = capabilities.includes('workspace.upload');
  const canReferences = capabilities.includes('workspace.references');
  const supported = canImages || canFiles || canReferences;

  const atQuery = activeMentionQuery(value);
  useEffect(() => {
    if (disabled || !canReferences || atQuery === null) return;
    setPrefix('');
    setQuery(atQuery);
    setWorkspace(true);
  }, [atQuery, canReferences, disabled]);

  useEffect(() => {
    if (!workspace || !canReferences || !nodeId || !sessionId) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      const fullQuery = [prefix, query].filter(Boolean).join('/');
      void searchWorkspaceReferences(nodeId, sessionId, fullQuery)
        .then((items) => { if (!controller.signal.aborted) setResults(items); })
        .catch(() => { if (!controller.signal.aborted) setResults([]); })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 180);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [canReferences, nodeId, prefix, query, searchWorkspaceReferences, sessionId, workspace]);

  function addUpload(upload: LocalUpload) {
    try {
      const next = [...uploads, upload];
      validateLocalUploads(next);
      onUploadsChange(next);
    } catch (error) {
      Alert.alert('Attachment unavailable', error instanceof Error ? error.message : 'Could not attach this file.');
    }
  }

  async function chooseImage(camera: boolean) {
    setMenu(false);
    const permission = camera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert('Permission required', camera ? 'Camera permission is required.' : 'Photo permission is required.');
    const result = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsMultipleSelection: true, selectionLimit: 10 });
    if (result.canceled) return;
    for (const asset of result.assets) {
      const mediaType = asset.mimeType || (asset.fileName?.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mediaType)) {
        Alert.alert('Unsupported image', 'Use PNG, JPEG, WebP, or GIF.');
        continue;
      }
      addUpload({
        localId: localId(), uri: asset.uri, kind: 'image', displayName: asset.fileName || `image-${Date.now()}.jpg`,
        mediaType, byteSize: await fileSize(asset.uri, asset.fileSize), width: asset.width, height: asset.height,
      });
    }
  }

  async function chooseFile() {
    setMenu(false);
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (result.canceled) return;
    for (const asset of result.assets) addUpload({
      localId: localId(), uri: asset.uri, kind: 'file', displayName: asset.name,
      mediaType: asset.mimeType || 'application/octet-stream', byteSize: await fileSize(asset.uri, asset.size),
    });
  }

  function selectReference(item: WorkspaceReference) {
    if (item.kind === 'dir') {
      setPrefix(item.path.replace(/\/$/, ''));
      setQuery('');
      return;
    }
    if (!references.some((reference) => reference.path === item.path)) onReferencesChange([...references, item]);
    onValueChange(replaceActiveMention(value, item.path));
    setWorkspace(false);
    setQuery('');
    setPrefix('');
  }

  function openMenu() {
    if (disabled) return;
    if (!supported) {
      Alert.alert('Connector upgrade required', 'Update DSH EasyRemote Connector to attach files or reference workspace paths.');
      return;
    }
    setMenu(true);
  }

  return <>
    <Pressable onPress={openMenu} disabled={disabled} style={styles.addButton} accessibilityRole="button" accessibilityLabel="Add an image, file, or workspace reference">
      <Ionicons name="add" size={22} color={disabled ? theme.colors.faint : theme.colors.muted} />
    </Pressable>

    <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
      <Pressable style={styles.backdrop} onPress={() => setMenu(false)} />
      <SafeAreaView edges={['bottom']} style={[styles.menuSheet, { backgroundColor: theme.colors.surfaceRaised }]}>
        <Text style={[styles.sheetTitle, { color: theme.colors.text }]}>Add to conversation</Text>
        <View style={styles.actionGrid}>
          <Action icon="camera-outline" label="Camera" disabled={!canImages} onPress={() => void chooseImage(true)} />
          <Action icon="images-outline" label="Photos" disabled={!canImages} onPress={() => void chooseImage(false)} />
          <Action icon="document-attach-outline" label="File" disabled={!canFiles} onPress={() => void chooseFile()} />
          <Action icon="folder-open-outline" label="Workspace" disabled={!canReferences} onPress={() => { setMenu(false); setWorkspace(true); }} />
        </View>
      </SafeAreaView>
    </Modal>

    <Modal visible={workspace} animationType="slide" onRequestClose={() => setWorkspace(false)}>
      <SafeAreaView style={[styles.workspace, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.workspaceHeader, { borderBottomColor: theme.colors.line }]}>
          <Pressable onPress={() => prefix ? setPrefix(prefix.split('/').slice(0, -1).join('/')) : setWorkspace(false)} style={styles.headerButton} accessibilityLabel={prefix ? 'Parent directory' : 'Close workspace picker'}>
            <Ionicons name={prefix ? 'arrow-back' : 'close'} size={22} color={theme.colors.text} />
          </Pressable>
          <View style={[styles.searchBox, { backgroundColor: theme.colors.surface, borderColor: theme.colors.line }]}>
            <Ionicons name="search-outline" size={18} color={theme.colors.faint} />
            <TextInput autoFocus value={query} onChangeText={setQuery} placeholder={prefix || 'Search workspace'} placeholderTextColor={theme.colors.faint} style={[styles.searchInput, { color: theme.colors.text }]} />
            {searching && <ActivityIndicator size="small" color={theme.colors.accent} />}
          </View>
        </View>
        {prefix && <Text numberOfLines={1} style={[styles.breadcrumb, { color: theme.colors.muted }]}>/{prefix}</Text>}
        <FlatList
          data={results}
          keyExtractor={(item) => `${item.kind}:${item.path}`}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.referenceList}
          renderItem={({ item }) => <Pressable onPress={() => selectReference(item)} style={({ pressed }) => [styles.referenceRow, { backgroundColor: pressed ? theme.colors.surface : 'transparent' }]}>
            <Ionicons name={item.kind === 'dir' ? 'folder-outline' : 'document-text-outline'} size={20} color={item.kind === 'dir' ? theme.colors.accent : theme.colors.muted} />
            <View style={styles.referenceCopy}><Text numberOfLines={1} style={[styles.referenceName, { color: theme.colors.text }]}>{item.name || item.path.split('/').at(-1)}</Text><Text numberOfLines={1} style={[styles.referencePath, { color: theme.colors.faint }]}>{item.path}</Text></View>
            <Ionicons name={item.kind === 'dir' ? 'chevron-forward' : 'add-circle-outline'} size={18} color={theme.colors.faint} />
          </Pressable>}
          ListEmptyComponent={!searching ? <Text style={[styles.empty, { color: theme.colors.muted }]}>No matching workspace paths.</Text> : null}
        />
      </SafeAreaView>
    </Modal>
  </>;
}

function Action({ icon, label, disabled, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; disabled: boolean; onPress: () => void }) {
  const theme = useTheme();
  return <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.action, { backgroundColor: theme.colors.surface, opacity: disabled ? 0.35 : pressed ? 0.65 : 1 }]}>
    <View style={[styles.actionIcon, { backgroundColor: `${theme.colors.accent}13` }]}><Ionicons name={icon} size={22} color={theme.colors.accent} /></View>
    <Text style={[styles.actionLabel, { color: theme.colors.text }]}>{label}</Text>
  </Pressable>;
}

export function ComposerSelections({ uploads, references, progress, onRemoveUpload, onRemoveReference }: {
  uploads: LocalUpload[];
  references: WorkspaceReference[];
  progress?: number;
  onRemoveUpload: (id: string) => void;
  onRemoveReference: (path: string) => void;
}) {
  const theme = useTheme();
  const items = useMemo(() => [
    ...uploads.map((upload) => ({ id: upload.localId, label: upload.displayName, icon: upload.kind === 'image' ? 'image-outline' as const : 'document-outline' as const, remove: () => onRemoveUpload(upload.localId) })),
    ...references.map((reference) => ({ id: `ref:${reference.path}`, label: `@${reference.path}`, icon: 'at-outline' as const, remove: () => onRemoveReference(reference.path) })),
  ], [onRemoveReference, onRemoveUpload, references, uploads]);
  if (!items.length) return null;
  return <View style={styles.selectionWrap}>
    {items.map((item) => <View key={item.id} style={[styles.selection, { backgroundColor: theme.colors.surfaceSoft, borderColor: theme.colors.line }]}>
      <Ionicons name={item.icon} size={14} color={theme.colors.accent} />
      <Text numberOfLines={1} style={[styles.selectionText, { color: theme.colors.text }]}>{item.label}</Text>
      <Pressable onPress={item.remove} accessibilityLabel={`Remove ${item.label}`}><Ionicons name="close-circle" size={16} color={theme.colors.faint} /></Pressable>
    </View>)}
    {typeof progress === 'number' && <View style={[styles.progressTrack, { backgroundColor: theme.colors.line }]}><View style={[styles.progressFill, { backgroundColor: theme.colors.accent, width: `${Math.max(0, Math.min(1, progress)) * 100}%` }]} /></View>}
  </View>;
}

const styles = StyleSheet.create({
  addButton: { width: 40, height: 42, alignItems: 'center', justifyContent: 'center' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#00000082' },
  menuSheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, paddingBottom: spacing.xl },
  sheetTitle: { fontSize: type.heading, fontWeight: '800', marginBottom: spacing.md },
  actionGrid: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1, minHeight: 94, borderRadius: radii.md, padding: spacing.sm, alignItems: 'center', justifyContent: 'center', gap: 8 },
  actionIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: type.caption, fontWeight: '700' },
  workspace: { flex: 1 },
  workspaceHeader: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  headerButton: { width: 38, height: 42, alignItems: 'center', justifyContent: 'center' },
  searchBox: { flex: 1, minHeight: 44, borderRadius: radii.pill, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 0, fontSize: type.body },
  breadcrumb: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, fontSize: type.caption },
  referenceList: { padding: spacing.md, flexGrow: 1 },
  referenceRow: { minHeight: 58, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm },
  referenceCopy: { flex: 1, minWidth: 0 },
  referenceName: { fontSize: type.body, fontWeight: '600' },
  referencePath: { marginTop: 2, fontSize: type.micro },
  empty: { textAlign: 'center', marginTop: spacing.xxl, fontSize: type.caption },
  selectionWrap: { paddingHorizontal: spacing.sm, paddingTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  selection: { maxWidth: '100%', height: 30, borderRadius: radii.pill, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 9, paddingRight: 6 },
  selectionText: { maxWidth: 190, fontSize: type.micro, fontWeight: '600' },
  progressTrack: { width: '100%', height: 3, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2 },
});
