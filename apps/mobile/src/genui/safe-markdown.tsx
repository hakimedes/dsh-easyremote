import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { parseInline, parseMarkdown } from './markdown-parser';
import { radii, spacing, type, useTheme } from '../ui/theme';

function InlineText({ value }: { value: string }) {
  const theme = useTheme();
  return <Text selectable style={[styles.body, { color: theme.colors.text }]}>{parseInline(value).map((part, index) => part.type === 'link'
    ? <Text key={index} onPress={() => void Linking.openURL(part.url)} accessibilityRole="link" style={{ color: theme.colors.accent, textDecorationLine: 'underline' }}>{part.label}</Text>
    : <Text key={index} style={[part.bold && styles.bold, part.code && { fontFamily: 'monospace', backgroundColor: theme.colors.surfaceSoft }]}>{part.text}</Text>)}</Text>;
}

export function SafeMarkdown({ value, compact = false }: { value: string; compact?: boolean }) {
  const theme = useTheme();
  const blocks = parseMarkdown(value);
  return <View style={[styles.root, compact && styles.compact]}>{blocks.map((block, index) => {
    if (block.type === 'heading') return <Text key={index} selectable style={[styles.heading, block.level === 1 && styles.headingOne, block.level === 3 && styles.headingThree, { color: theme.colors.text }]}>{block.text}</Text>;
    if (block.type === 'paragraph') return <InlineText key={index} value={block.text} />;
    if (block.type === 'list') return <View key={index} style={styles.list}>{block.items.map((item, itemIndex) => <View key={itemIndex} style={styles.listRow}><Text style={[styles.bullet, { color: theme.colors.accent }]}>{block.ordered ? `${itemIndex + 1}.` : '•'}</Text><View style={styles.flex}><InlineText value={item} /></View></View>)}</View>;
    if (block.type === 'code') return <ScrollView key={index} horizontal showsHorizontalScrollIndicator={false} style={[styles.code, { backgroundColor: theme.colors.surface, borderColor: theme.colors.line }]}><View><Text style={[styles.codeLanguage, { color: theme.colors.faint }]}>{block.language || 'CODE'}</Text><Text selectable style={[styles.codeText, { color: theme.colors.text }]}>{block.code}</Text></View></ScrollView>;
    if (block.type === 'image') return <View key={index} style={styles.imageWrap}><Image source={{ uri: block.url }} resizeMode="contain" accessibilityLabel={block.alt || 'Markdown image'} style={[styles.image, { backgroundColor: theme.colors.surface }]} />{block.alt && <Text style={[styles.caption, { color: theme.colors.muted }]}>{block.alt}</Text>}</View>;
    return <ScrollView key={index} horizontal showsHorizontalScrollIndicator style={[styles.table, { borderColor: theme.colors.line }]}><View>{[block.columns, ...block.rows].map((row, rowIndex) => <View key={rowIndex} style={[styles.tableRow, rowIndex === 0 && { backgroundColor: theme.colors.surfaceSoft }]}>{block.columns.map((_, columnIndex) => <Text key={columnIndex} selectable style={[styles.cell, rowIndex === 0 && styles.bold, { color: theme.colors.text, borderColor: theme.colors.line }]}>{row[columnIndex] || ''}</Text>)}</View>)}</View></ScrollView>;
  })}</View>;
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm, minWidth: 0 },
  compact: { maxHeight: 260, overflow: 'hidden' },
  flex: { flex: 1 },
  body: { fontSize: type.body, lineHeight: 24 },
  bold: { fontWeight: '700' },
  heading: { fontSize: type.heading, lineHeight: 25, fontWeight: '700', marginTop: 4 },
  headingOne: { fontSize: type.title, lineHeight: 33 },
  headingThree: { fontSize: type.body, lineHeight: 24 },
  list: { gap: 5 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bullet: { width: 20, fontSize: type.body, lineHeight: 24, textAlign: 'right' },
  code: { maxHeight: 360, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.sm },
  codeLanguage: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginBottom: 6 },
  codeText: { fontFamily: 'monospace', fontSize: 12, lineHeight: 19 },
  imageWrap: { gap: 5 },
  image: { width: '100%', minHeight: 190, maxHeight: 360, borderRadius: radii.md },
  caption: { fontSize: type.micro, lineHeight: 16 },
  table: { maxWidth: '100%', borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.sm },
  tableRow: { flexDirection: 'row' },
  cell: { width: 140, minHeight: 40, padding: spacing.sm, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, fontSize: type.caption, lineHeight: 18 },
});
