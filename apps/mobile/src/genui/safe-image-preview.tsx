import { useEffect, useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { radii, spacing, type, useTheme } from '../ui/theme';
import { isSvgImageSource, sanitizeSvgXml, SVG_PREVIEW_MAX_CHARS, type SafeSvgDocument } from './svg-preview';

type LoadState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; document: SafeSvgDocument }
  | { status: 'failed' };

export function SafeImagePreview({
  uri,
  xml,
  mediaType,
  accessibilityLabel,
  aspectRatio = 1.2,
  headers,
  frameStyle,
}: {
  uri?: string;
  xml?: string;
  mediaType?: string;
  accessibilityLabel: string;
  aspectRatio?: number;
  headers?: Record<string, string>;
  frameStyle?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const isSvg = Boolean(xml) || isSvgImageSource(uri, mediaType);
  const inlineDocument = useMemo(() => {
    if (!xml) return null;
    try { return sanitizeSvgXml(xml); } catch { return false as const; }
  }, [xml]);
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [bitmapFailed, setBitmapFailed] = useState(false);
  const headersKey = JSON.stringify(headers || {});

  useEffect(() => {
    setBitmapFailed(false);
  }, [uri]);

  useEffect(() => {
    if (!isSvg || inlineDocument || inlineDocument === false || !uri) {
      setLoadState({ status: 'idle' });
      return;
    }
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    setLoadState({ status: 'loading' });
    void (async () => {
      let value: string;
      if (/^(?:file|content):\/\//i.test(uri)) {
        const FileSystem = await import('expo-file-system');
        value = await FileSystem.readAsStringAsync(uri);
      } else if (/^https:\/\//i.test(uri)) {
        const response = await fetch(uri, { headers, signal: controller.signal });
        if (!response.ok) throw new Error(`SVG preview download failed (${response.status})`);
        const declaredLength = Number(response.headers.get('content-length'));
        if (Number.isFinite(declaredLength) && declaredLength > SVG_PREVIEW_MAX_CHARS) throw new Error('SVG preview is too large');
        value = await response.text();
      } else {
        throw new Error('SVG preview source is not allowed');
      }
      const document = sanitizeSvgXml(value);
      if (active) setLoadState({ status: 'ready', document });
    })().catch(() => { if (active) setLoadState({ status: 'failed' }); }).finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [headersKey, inlineDocument, isSvg, uri]);

  const document = inlineDocument
    ? inlineDocument
    : loadState.status === 'ready' ? loadState.document : null;
  const failed = inlineDocument === false || loadState.status === 'failed' || (!isSvg && bitmapFailed);
  const ratio = Math.max(0.5, Math.min(2.2, document?.aspectRatio || aspectRatio));

  return <View accessibilityRole="image" accessibilityLabel={accessibilityLabel} style={[styles.frame, { aspectRatio: ratio, backgroundColor: theme.colors.surfaceSoft }, frameStyle]}>
    {failed
      ? <View style={styles.status}><Ionicons name="image-outline" size={22} color={theme.colors.faint} /><Text style={[styles.statusText, { color: theme.colors.muted }]}>Image preview unavailable</Text></View>
      : isSvg
        ? document
          ? <SvgXml xml={document.xml} width="100%" height="100%" onError={() => undefined} fallback={<View style={styles.status}><Text style={[styles.statusText, { color: theme.colors.muted }]}>SVG preview unavailable</Text></View>} />
          : <View style={styles.status}><ActivityIndicator color={theme.colors.accent} /></View>
        : uri
          ? <Image source={{ uri, ...(headers ? { headers } : {}) }} resizeMode="contain" onError={() => setBitmapFailed(true)} style={StyleSheet.absoluteFill} />
          : <View style={styles.status}><Text style={[styles.statusText, { color: theme.colors.muted }]}>Image preview unavailable</Text></View>}
  </View>;
}

const styles = StyleSheet.create({
  frame: { width: '100%', minHeight: 180, maxHeight: 420, overflow: 'hidden', borderRadius: radii.md },
  status: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, padding: spacing.sm },
  statusText: { fontSize: type.caption, lineHeight: 18, textAlign: 'center' },
});
