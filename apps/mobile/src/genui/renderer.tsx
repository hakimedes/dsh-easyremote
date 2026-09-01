import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import type { GenuiNode, GenuiSpec } from './protocol';
import { readGenuiFormState, writeGenuiFormState } from '../storage/database';
import { radii, spacing, type, useTheme, type AppTheme } from '../ui/theme';
import { SandboxVisual } from './sandbox-visual';
import { SafeImagePreview } from './safe-image-preview';

export type GenuiAction = { action: string; payload: Record<string, unknown> };

type Fields = Record<string, string | boolean | number>;
type RenderContext = {
  fields: Fields;
  interactive: boolean;
  theme: AppTheme;
  setField: (id: string, value: string | boolean | number) => void;
  emit: (action: unknown, payload: Record<string, unknown>) => void;
};

function str(value: unknown, fallback = '') { return typeof value === 'string' ? value : fallback; }
function num(value: unknown, fallback = 0) { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function array(value: unknown) { return Array.isArray(value) ? value : []; }
function nodes(value: unknown) { return array(value).filter((item): item is GenuiNode => Boolean(item && typeof item === 'object' && typeof (item as GenuiNode).type === 'string')); }
function fieldId(node: GenuiNode, path: string) { return str(node.id) || str(node.group) || path; }

function Children({ value, path, context }: { value: unknown; path: string; context: RenderContext }) {
  return <>{nodes(value).map((node, index) => <NodeView key={`${path}.${index}`} node={node} path={`${path}.${index}`} context={context} />)}</>;
}

function Chart({ node }: { node: GenuiNode }) {
  const theme = useTheme();
  const data = array(node.data).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const entry = item as Record<string, unknown>;
    return typeof entry.label === 'string' && typeof entry.value === 'number' ? [{ label: entry.label, value: entry.value, color: str(entry.color, theme.colors.accent) }] : [];
  });
  if (!data.length) return null;
  const width = 300;
  const height = 180;
  const max = Math.max(1, ...data.map((item) => Math.abs(item.value)));
  if (node.kind === 'donut') {
    const total = Math.max(1, data.reduce((sum, item) => sum + Math.abs(item.value), 0));
    let offset = 0;
    return <View style={styles.chartRow}><Svg width={150} height={150} viewBox="0 0 150 150">{data.map((item, index) => { const length = Math.abs(item.value) / total * 339; const at = offset; offset += length; return <Circle key={index} cx={75} cy={75} r={54} fill="none" stroke={item.color} strokeWidth={20} strokeDasharray={`${length} ${339 - length}`} strokeDashoffset={-at} rotation={-90} origin="75,75" />; })}</Svg><View style={styles.legend}>{data.map((item, index) => <View key={index} style={styles.legendRow}><View style={[styles.legendDot, { backgroundColor: item.color }]} /><Text style={[styles.legendText, { color: theme.colors.muted }]}>{item.label} · {item.value}</Text></View>)}</View></View>;
  }
  const points = data.map((item, index) => ({ x: 24 + index * (width - 48) / Math.max(1, data.length - 1), y: height - 32 - Math.abs(item.value) / max * (height - 58), ...item }));
  return <ScrollView horizontal showsHorizontalScrollIndicator={false}><Svg width={Math.max(width, data.length * 54)} height={height}>{node.kind === 'line'
    ? <><Polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke={theme.colors.accent} strokeWidth={3} />{points.map((point, index) => <Circle key={index} cx={point.x} cy={point.y} r={4} fill={theme.colors.accent} />)}</>
    : points.map((point, index) => <Rect key={index} x={point.x - 14} y={point.y} width={28} height={height - 32 - point.y} rx={5} fill={point.color} />)}{points.map((point, index) => <SvgText key={`label-${index}`} x={point.x} y={height - 10} fill={theme.colors.muted} fontSize={10} textAnchor="middle">{point.label.slice(0, 10)}</SvgText>)}</Svg></ScrollView>;
}

function NodeView({ node, path, context }: { node: GenuiNode; path: string; context: RenderContext }): ReactNode {
  const { theme } = context;
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState<number | null>(0);
  const id = fieldId(node, path);

  if (node.type === 'row') return <View style={[styles.row, node.wrap === true && styles.wrap]}><Children value={node.items} path={path} context={context} /></View>;
  if (node.type === 'col') return <View style={{ gap: Math.min(24, num(node.gap, spacing.sm)) }}><Children value={node.items} path={path} context={context} /></View>;
  if (node.type === 'grid') return <View style={styles.grid}>{nodes(node.items).map((item, index) => <View key={index} style={{ width: num(node.cols, 2) <= 1 ? '100%' : '48%' }}><NodeView node={item} path={`${path}.${index}`} context={context} /></View>)}</View>;
  if (node.type === 'card') return <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.line }]}>{Boolean(node.title) && <Text style={[styles.cardTitle, { color: theme.colors.text }]}>{str(node.title)}</Text>}<Children value={node.items} path={path} context={context} /></View>;
  if (node.type === 'text') {
    const size = str(node.size, 'body');
    return <Text selectable style={[styles.text, size === 'h1' && styles.h1, size === 'h2' && styles.h2, size === 'h3' && styles.h3, size === 'caption' && styles.caption, size === 'muted' && { color: theme.colors.muted }, node.center === true && styles.center, { color: size === 'muted' ? theme.colors.muted : theme.colors.text }]}>{str(node.content)}</Text>;
  }
  if (node.type === 'button' || node.type === 'submit') {
    const tone = str(node.tone, 'primary');
    const action = str(node.action);
    const disabled = !context.interactive || !action;
    return <Pressable disabled={disabled} onPress={() => context.emit(action, node.type === 'submit' ? { type: 'submit', fields: context.fields } : { type: 'button', label: node.label })} style={({ pressed }) => [styles.button, node.full === true && styles.full, { backgroundColor: tone === 'ghost' ? theme.colors.surfaceSoft : tone === 'danger' ? `${theme.colors.danger}20` : theme.colors.accent, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }]}><Text style={[styles.buttonText, { color: tone === 'ghost' || tone === 'danger' ? (tone === 'danger' ? theme.colors.danger : theme.colors.text) : theme.colors.accentInk }]}>{str(node.label)}</Text></Pressable>;
  }
  if (node.type === 'input' || node.type === 'textarea') {
    if (node.sensitive === true) return <View style={[styles.blocked, { borderColor: `${theme.colors.danger}50`, backgroundColor: `${theme.colors.danger}0D` }]}><Ionicons name="shield-outline" size={17} color={theme.colors.danger} /><Text style={[styles.blockedText, { color: theme.colors.danger }]}>Sensitive fields are blocked in Mobile GenUI.</Text></View>;
    const current = String(context.fields[id] ?? node.value ?? '');
    return <View style={styles.field}>{Boolean(node.label) && <Text style={[styles.label, { color: theme.colors.muted }]}>{str(node.label)}</Text>}<TextInput value={current} editable={context.interactive} multiline={node.type === 'textarea'} numberOfLines={node.type === 'textarea' ? num(node.rows, 4) : 1} placeholder={str(node.placeholder)} placeholderTextColor={theme.colors.faint} onChangeText={(value) => context.setField(id, value)} onBlur={() => context.emit(node.action, { type: node.type, id, value: current })} style={[styles.input, node.type === 'textarea' && styles.textarea, { color: theme.colors.text, backgroundColor: theme.colors.background, borderColor: theme.colors.line }]} /></View>;
  }
  if (node.type === 'select' || node.type === 'radio') {
    const options = array(node.options).map(String);
    const selected = num(context.fields[id], num(node.selected, -1));
    return <View style={styles.field}>{Boolean(node.label) && <Text style={[styles.label, { color: theme.colors.muted }]}>{str(node.label)}</Text>}<View style={styles.choiceRow}>{options.map((option, index) => <Pressable key={index} disabled={!context.interactive} onPress={() => { context.setField(id, index); context.emit(node.action, { type: node.type, id, index, value: option }); }} style={[styles.choice, { borderColor: selected === index ? theme.colors.accent : theme.colors.line, backgroundColor: selected === index ? `${theme.colors.accent}18` : theme.colors.surface }]}><Text style={[styles.choiceText, { color: selected === index ? theme.colors.accent : theme.colors.text }]}>{option}</Text></Pressable>)}</View></View>;
  }
  if (node.type === 'checkbox' || node.type === 'switch') {
    const checked = Boolean(context.fields[id] ?? node.checked);
    return <View style={styles.switchRow}><Text style={[styles.text, styles.flex, { color: theme.colors.text }]}>{str(node.label)}</Text><Switch disabled={!context.interactive} value={checked} trackColor={{ false: theme.colors.line, true: `${theme.colors.accent}80` }} thumbColor={checked ? theme.colors.accent : theme.colors.faint} onValueChange={(value) => { context.setField(id, value); context.emit(node.action, { type: node.type, id, value }); }} /></View>;
  }
  if (node.type === 'slider') {
    const min = num(node.min, 0), max = num(node.max, 100), step = num(node.step, 1);
    const current = num(context.fields[id], num(node.value, min));
    const change = (next: number) => { const value = Math.max(min, Math.min(max, next)); context.setField(id, value); context.emit(node.action, { type: 'slider', id, value }); };
    return <View style={styles.field}><View style={styles.switchRow}><Text style={[styles.label, styles.flex, { color: theme.colors.muted }]}>{str(node.label, 'Value')}</Text><Text style={[styles.sliderValue, { color: theme.colors.text }]}>{current}</Text></View><View style={styles.sliderRow}><Pressable disabled={!context.interactive || current <= min} onPress={() => change(current - step)} style={[styles.stepper, { backgroundColor: theme.colors.surfaceSoft }]}><Ionicons name="remove" size={18} color={theme.colors.text} /></Pressable><View style={[styles.track, { backgroundColor: theme.colors.line }]}><View style={[styles.trackFill, { width: `${max === min ? 0 : (current - min) / (max - min) * 100}%`, backgroundColor: theme.colors.accent }]} /></View><Pressable disabled={!context.interactive || current >= max} onPress={() => change(current + step)} style={[styles.stepper, { backgroundColor: theme.colors.surfaceSoft }]}><Ionicons name="add" size={18} color={theme.colors.text} /></Pressable></View></View>;
  }
  if (node.type === 'link') return node.href ? <Text accessibilityRole="link" onPress={() => void Linking.openURL(str(node.href))} style={[styles.link, { color: theme.colors.accent }]}>{str(node.label)}</Text> : <Text style={[styles.text, { color: theme.colors.muted }]}>{str(node.label)}</Text>;
  if (node.type === 'image') return <View style={styles.media}><SafeImagePreview uri={str(node.src)} accessibilityLabel={str(node.alt, 'Generated image')} frameStyle={styles.mediaImage} />{Boolean(node.alt) && <Text style={[styles.caption, { color: theme.colors.muted }]}>{str(node.alt)}</Text>}</View>;
  if (node.type === 'badge') return <View style={[styles.badge, { backgroundColor: `${node.tone === 'danger' ? theme.colors.danger : theme.colors.accent}18` }]}><Text style={[styles.badgeText, { color: node.tone === 'danger' ? theme.colors.danger : theme.colors.accent }]}>{str(node.label)}</Text></View>;
  if (node.type === 'stat') return <View style={[styles.stat, { backgroundColor: theme.colors.surface, borderColor: theme.colors.line }]}><Text style={[styles.statLabel, { color: theme.colors.muted }]}>{str(node.label)}</Text><Text style={[styles.statValue, { color: theme.colors.text }]}>{str(node.value)}</Text>{Boolean(node.delta) && <Text style={[styles.statDelta, { color: theme.colors.accent }]}>{str(node.delta)}</Text>}</View>;
  if (node.type === 'progress') return <View style={styles.field}><View style={styles.switchRow}><Text style={[styles.label, { color: theme.colors.muted }]}>{str(node.label)}</Text><Text style={[styles.label, { color: theme.colors.text }]}>{str(node.valueLabel, `${num(node.value)}%`)}</Text></View><View style={[styles.progress, { backgroundColor: theme.colors.line }]}><View style={[styles.progressFill, { width: `${num(node.value)}%`, backgroundColor: theme.colors.accent }]} /></View></View>;
  if (node.type === 'divider') return <View style={[styles.divider, { backgroundColor: theme.colors.line }]} />;
  if (node.type === 'spacer') return <View style={{ height: spacing.md }} />;
  if (node.type === 'avatar') return <View style={[styles.avatar, { backgroundColor: str(node.color, theme.colors.accent) }]}><Text style={styles.avatarText}>{str(node.name).slice(0, 2).toUpperCase()}</Text></View>;
  if (node.type === 'list') return <View style={styles.list}>{array(node.items).map((item, index) => typeof item === 'string' ? <View key={index} style={styles.listRow}><Text style={{ color: theme.colors.accent }}>•</Text><Text style={[styles.text, styles.flex, { color: theme.colors.text }]}>{item}</Text></View> : item && typeof item === 'object' && typeof (item as GenuiNode).type === 'string' ? <NodeView key={index} node={item as GenuiNode} path={`${path}.${index}`} context={context} /> : <View key={index}><Text style={[styles.text, { color: theme.colors.text }]}>{str((item as Record<string, unknown>)?.title)}</Text><Text style={[styles.caption, { color: theme.colors.muted }]}>{str((item as Record<string, unknown>)?.desc)}</Text></View>)}</View>;
  if (node.type === 'table') {
    const columns = array(node.columns).map(String), rows = array(node.rows).map((row) => array(row).map(String));
    return <ScrollView horizontal showsHorizontalScrollIndicator style={[styles.table, { borderColor: theme.colors.line }]}><View>{[columns, ...rows].map((row, rowIndex) => <View key={rowIndex} style={[styles.tableRow, rowIndex === 0 && { backgroundColor: theme.colors.surfaceSoft }]}>{columns.map((_, columnIndex) => <Text key={columnIndex} selectable style={[styles.cell, rowIndex === 0 && styles.bold, { color: theme.colors.text, borderColor: theme.colors.line }]}>{row[columnIndex] || ''}</Text>)}</View>)}</View></ScrollView>;
  }
  if (node.type === 'chart') return <Chart node={node} />;
  if (node.type === 'tabs') {
    const tabs = array(node.tabs).filter((tab) => tab && typeof tab === 'object') as Array<Record<string, unknown>>;
    const tab = tabs[Math.min(active, tabs.length - 1)];
    return <View style={styles.field}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>{tabs.map((item, index) => <Pressable key={index} onPress={() => setActive(index)} style={[styles.tab, { borderBottomColor: active === index ? theme.colors.accent : 'transparent' }]}><Text style={[styles.tabText, { color: active === index ? theme.colors.accent : theme.colors.muted }]}>{str(item.label)}</Text></Pressable>)}</ScrollView>{tab && <View style={styles.tabBody}><Children value={tab.items} path={`${path}.tab${active}`} context={context} /></View>}</View>;
  }
  if (node.type === 'accordion') {
    const items = array(node.items).filter((item) => item && typeof item === 'object') as Array<Record<string, unknown>>;
    return <View style={[styles.accordion, { borderColor: theme.colors.line }]}>{items.map((item, index) => <View key={index}><Pressable onPress={() => setOpen(open === index ? null : index)} style={[styles.accordionHeader, { borderBottomColor: theme.colors.line }]}><Text style={[styles.cardTitle, styles.flex, { color: theme.colors.text }]}>{str(item.title)}</Text><Ionicons name={open === index ? 'chevron-up' : 'chevron-down'} size={16} color={theme.colors.muted} /></Pressable>{open === index && <View style={styles.accordionBody}><Children value={item.items} path={`${path}.accordion${index}`} context={context} /></View>}</View>)}</View>;
  }
  if (node.type === 'callout') {
    const color = node.tone === 'error' ? theme.colors.danger : node.tone === 'warning' ? theme.colors.amber : theme.colors.accent;
    return <View style={[styles.callout, { borderColor: `${color}60`, backgroundColor: `${color}0D` }]}>{Boolean(node.title) && <Text style={[styles.cardTitle, { color }]}>{str(node.title)}</Text>}<Text selectable style={[styles.text, { color: theme.colors.text }]}>{str(node.content)}</Text></View>;
  }
  if (node.type === 'code' || node.type === 'copy' || node.type === 'json') {
    const value = node.type === 'code' ? str(node.code) : node.type === 'copy' ? str(node.text) : JSON.stringify(node.value, null, 2);
    return <ScrollView horizontal style={[styles.code, { backgroundColor: theme.colors.surface, borderColor: theme.colors.line }]}><View><Text style={[styles.codeLabel, { color: theme.colors.faint }]}>{str(node.lang, node.type.toUpperCase())}</Text><Text selectable style={[styles.codeText, { color: theme.colors.text }]}>{value}</Text></View></ScrollView>;
  }
  if (node.type === 'diff') return <View style={styles.field}>{array(node.diffs).map((diff, index) => { const entry = diff as Record<string, unknown>; return <View key={index} style={[styles.code, { backgroundColor: theme.colors.surface, borderColor: theme.colors.line }]}><Text style={[styles.codeLabel, { color: theme.colors.muted }]}>{str(entry.path)}</Text>{str(entry.oldText) && <Text selectable style={[styles.codeText, { color: theme.colors.danger }]}>- {str(entry.oldText)}</Text>}<Text selectable style={[styles.codeText, { color: theme.colors.accent }]}>+ {str(entry.newText)}</Text></View>; })}</View>;
  if (['echart', 'mermaid', 'diagram', 'scene3d'].includes(node.type)) return <SandboxVisual node={node} />;
  if (node.type === 'steps' || node.type === 'timeline') {
    const items = array(node.type === 'steps' ? node.steps : node.items) as Array<Record<string, unknown>>;
    return <View style={styles.list}>{items.map((item, index) => <View key={index} style={styles.timelineRow}><View style={[styles.timelineDot, { backgroundColor: index < num(node.current, items.length) ? theme.colors.accent : theme.colors.line }]} /><View style={styles.flex}><Text style={[styles.cardTitle, { color: theme.colors.text }]}>{str(item.title)}</Text><Text style={[styles.caption, { color: theme.colors.muted }]}>{str(item.time)}{item.time && item.desc ? ' · ' : ''}{str(item.desc)}</Text></View></View>)}</View>;
  }
  if (node.type === 'keyvalue') return <View style={styles.list}>{array(node.pairs).map((pair, index) => { const item = pair as Record<string, unknown>; return <View key={index} style={styles.keyValue}><Text style={[styles.label, { color: theme.colors.muted }]}>{str(item.key)}</Text><Text selectable style={[styles.text, styles.flex, styles.right, { color: theme.colors.text }]}>{str(item.value)}</Text></View>; })}</View>;
  if (node.type === 'breadcrumb') return <View style={styles.row}>{array(node.items).map((item, index) => <Text key={index} style={[styles.caption, { color: index === array(node.items).length - 1 ? theme.colors.text : theme.colors.muted }]}>{index ? '› ' : ''}{String(item)}</Text>)}</View>;
  if (node.type === 'file-tree') return <View style={styles.list}>{array(node.items).map((item, index) => { const entry = item as Record<string, unknown>; return <View key={index} style={styles.listRow}><Ionicons name={entry.type === 'dir' ? 'folder-outline' : 'document-outline'} size={15} color={theme.colors.muted} /><Text style={[styles.text, { color: theme.colors.text }]}>{str(entry.name)}</Text></View>; })}</View>;
  if (node.type === 'quiz') {
    const options = array(node.options) as Array<Record<string, unknown>>;
    const selected = num(context.fields[id], -1);
    return <View style={styles.field}><Text style={[styles.cardTitle, { color: theme.colors.text }]}>{str(node.question)}</Text>{options.map((option, index) => <Pressable key={index} disabled={!context.interactive} onPress={() => { context.setField(id, index); context.emit(node.action, { type: 'quiz', question: node.question, answer: option.label, correct: option.correct === true }); }} style={[styles.choice, { borderColor: selected === index ? theme.colors.accent : theme.colors.line, backgroundColor: selected === index ? `${theme.colors.accent}18` : theme.colors.surface }]}><Text style={[styles.choiceText, { color: theme.colors.text }]}>{str(option.label)}</Text></Pressable>)}</View>;
  }
  return null;
}

export function GenuiRenderer({ spec, stateKey, interactive = true, onAction }: { spec: GenuiSpec; stateKey: string; interactive?: boolean; onAction?: (event: GenuiAction) => void | Promise<void> }) {
  const theme = useTheme();
  const [fields, setFields] = useState<Fields>(() => readGenuiFormState(stateKey));
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => setFields(readGenuiFormState(stateKey)), [stateKey]);
  useEffect(() => () => { for (const timer of timers.current.values()) clearTimeout(timer); }, []);
  const context = useMemo<RenderContext>(() => ({
    fields,
    interactive,
    theme,
    setField(id, value) {
      setFields((current) => {
        const next = { ...current, [id]: value };
        writeGenuiFormState(stateKey, next);
        return next;
      });
    },
    emit(actionValue, payload) {
      const action = str(actionValue);
      if (!interactive || !action || !onAction) return;
      const previous = timers.current.get(action);
      if (previous) clearTimeout(previous);
      timers.current.set(action, setTimeout(() => {
        timers.current.delete(action);
        void onAction({ action, payload });
      }, 300));
    },
  }), [fields, interactive, onAction, stateKey, theme]);
  return <View style={[styles.root, { gap: Math.min(24, spec.gap || spacing.sm) }]}>{spec.title && <Text style={[styles.specTitle, { color: theme.colors.text }]}>{spec.title}</Text>}<Children value={spec.items} path="root" context={context} /></View>;
}

const styles = StyleSheet.create({
  root: { width: '100%' },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  wrap: { flexWrap: 'wrap' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.md, gap: spacing.sm },
  cardTitle: { fontSize: type.caption, lineHeight: 19, fontWeight: '700' },
  specTitle: { fontSize: type.heading, lineHeight: 25, fontWeight: '800' },
  text: { fontSize: type.body, lineHeight: 23 },
  h1: { fontSize: type.title, lineHeight: 32, fontWeight: '800' },
  h2: { fontSize: type.heading, lineHeight: 26, fontWeight: '800' },
  h3: { fontSize: type.body, lineHeight: 24, fontWeight: '700' },
  caption: { fontSize: type.caption, lineHeight: 18 },
  center: { textAlign: 'center' },
  bold: { fontWeight: '700' },
  right: { textAlign: 'right' },
  button: { minHeight: 42, alignSelf: 'flex-start', borderRadius: radii.pill, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  full: { width: '100%' },
  buttonText: { fontSize: type.caption, fontWeight: '800' },
  field: { gap: 7 },
  label: { fontSize: type.caption, lineHeight: 18, fontWeight: '600' },
  input: { minHeight: 44, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: type.body },
  textarea: { minHeight: 96, textAlignVertical: 'top' },
  blocked: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.sm, padding: spacing.sm },
  blockedText: { flex: 1, fontSize: type.caption, lineHeight: 18, fontWeight: '600' },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  choice: { minHeight: 38, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: 8, justifyContent: 'center' },
  choiceText: { fontSize: type.caption, fontWeight: '600' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  sliderValue: { fontSize: type.body, fontWeight: '800' },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepper: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  track: { flex: 1, height: 7, borderRadius: 4, overflow: 'hidden' },
  trackFill: { height: '100%', borderRadius: 4 },
  link: { fontSize: type.body, lineHeight: 23, textDecorationLine: 'underline' },
  media: { gap: 5 },
  mediaImage: { width: '100%', minHeight: 190, maxHeight: 360, borderRadius: radii.md },
  badge: { alignSelf: 'flex-start', borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  badgeText: { fontSize: type.micro, lineHeight: 15, fontWeight: '800' },
  stat: { minWidth: 118, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.md, gap: 3 },
  statLabel: { fontSize: type.micro, lineHeight: 15, fontWeight: '700' },
  statValue: { fontSize: type.heading, lineHeight: 26, fontWeight: '800' },
  statDelta: { fontSize: type.micro, fontWeight: '700' },
  progress: { height: 8, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  divider: { height: StyleSheet.hairlineWidth, width: '100%' },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontWeight: '800' },
  list: { gap: 7 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  table: { maxWidth: '100%', borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.sm },
  tableRow: { flexDirection: 'row' },
  cell: { width: 140, minHeight: 40, padding: spacing.sm, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, fontSize: type.caption, lineHeight: 18 },
  chartRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  legend: { flex: 1, gap: 5 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: type.micro, lineHeight: 15 },
  tabs: { gap: spacing.md },
  tab: { paddingVertical: 8, borderBottomWidth: 2 },
  tabText: { fontSize: type.caption, fontWeight: '700' },
  tabBody: { paddingTop: spacing.sm, gap: spacing.sm },
  accordion: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, overflow: 'hidden' },
  accordionHeader: { minHeight: 44, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  accordionBody: { padding: spacing.md, gap: spacing.sm },
  callout: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.md, gap: 5 },
  code: { maxHeight: 360, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.sm },
  codeLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.7, marginBottom: 5 },
  codeText: { fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },
  timelineRow: { minHeight: 44, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  timelineDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  keyValue: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
});
