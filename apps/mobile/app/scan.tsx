import { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { Card, ErrorBanner, Input, PrimaryButton, Screen, SecondaryButton, TopBar } from '@/ui/primitives';
import { PairingQrError, parsePairingQr } from '@/domain/qr';
import { useAppStore } from '@/state/app-store';
import { radii, spacing, type, useTheme } from '@/ui/theme';
import { confirmPairingServer } from '@/ui/pairing-confirmation';

export default function ScanScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [manual, setManual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const claimPairing = useAppStore((state) => state.claimPairing);

  useEffect(() => {
    if (!permission?.granted) void requestPermission();
  }, [permission?.granted, requestPermission]);

  async function handleRaw(value: string) {
    if (claiming) return;
    setError(null);
    try {
      const pairing = parsePairingQr(value);
      setScanned(true);
      if (!await confirmPairingServer(pairing)) {
        setScanned(false);
        return;
      }
      setClaiming(true);
      await claimPairing(pairing);
      router.replace('/pairing-success');
    } catch (err) {
      setScanned(false);
      setClaiming(false);
      setError(err instanceof PairingQrError || err instanceof Error ? err.message : 'Pairing failed');
    }
  }

  if (!permission) return <View style={[styles.loading, { backgroundColor: theme.colors.background }]}><ActivityIndicator color={theme.colors.accent} /></View>;

  return <Screen scroll={false} edges={['top', 'bottom']} style={styles.screen}>
    <TopBar title="Pair your Harness" eyebrow="Scan the QR shown in DSH Web" />
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {permission.granted ? <View style={[styles.scannerWrap, { backgroundColor: theme.colors.black }]}>
        <CameraView style={styles.camera} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={scanned ? undefined : ({ data }) => void handleRaw(data)} />
        <View pointerEvents="none" style={styles.scanFrame}><View style={[styles.scanCorner, styles.cornerTopLeft, { borderColor: theme.colors.accent }]} /><View style={[styles.scanCorner, styles.cornerTopRight, { borderColor: theme.colors.accent }]} /><View style={[styles.scanCorner, styles.cornerBottomLeft, { borderColor: theme.colors.accent }]} /><View style={[styles.scanCorner, styles.cornerBottomRight, { borderColor: theme.colors.accent }]} /></View>
        <View style={styles.cameraLabel}><Ionicons name={claiming ? 'sync-outline' : 'qr-code-outline'} size={16} color="#FFFFFF" /><Text style={styles.cameraLabelText}>{claiming ? 'Connecting…' : 'Align the QR inside the frame'}</Text></View>
      </View> : <Card style={styles.permissionCard}><View style={[styles.permissionIcon, { backgroundColor: `${theme.colors.accent}12` }]}><Ionicons name="camera-outline" size={25} color={theme.colors.accent} /></View><Text style={[styles.permissionTitle, { color: theme.colors.text }]}>Camera access is off</Text><Text style={[styles.permissionBody, { color: theme.colors.muted }]}>Allow camera access to scan the one-time pairing code.</Text><PrimaryButton label="Allow camera" icon="camera-outline" onPress={() => void requestPermission()} /></Card>}

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      <View style={styles.manualBlock}>
        <Text style={[styles.manualLabel, { color: theme.colors.text }]}>Use a pairing link</Text>
        <Text style={[styles.manualHelp, { color: theme.colors.muted }]}>Paste the link if this phone cannot scan the screen.</Text>
        <Input value={manual} onChangeText={setManual} autoCapitalize="none" autoCorrect={false} placeholder="dshremote://pair?..." accessibilityLabel="Pairing link" />
        <View style={styles.manualActions}><View style={styles.action}><PrimaryButton label="Connect" onPress={() => void handleRaw(manual)} disabled={!manual.trim() || claiming} /></View><View style={styles.action}><SecondaryButton label="Cancel" onPress={() => router.back()} /></View></View>
      </View>
    </KeyboardAvoidingView>
  </Screen>;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fill: { flex: 1 },
  screen: { paddingHorizontal: spacing.lg },
  scannerWrap: { height: 350, borderRadius: radii.lg, overflow: 'hidden', marginBottom: spacing.lg, position: 'relative' },
  camera: { flex: 1 },
  scanFrame: { position: 'absolute', width: 218, height: 218, left: '50%', top: '50%', marginLeft: -109, marginTop: -120 },
  scanCorner: { width: 34, height: 34, position: 'absolute', borderWidth: 4 },
  cornerTopLeft: { left: 0, top: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 14 },
  cornerTopRight: { right: 0, top: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 14 },
  cornerBottomLeft: { left: 0, bottom: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 14 },
  cornerBottomRight: { right: 0, bottom: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 14 },
  cameraLabel: { position: 'absolute', bottom: 14, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 18, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: '#101216CC' },
  cameraLabelText: { color: '#FFFFFF', fontSize: type.caption, fontWeight: '600' },
  permissionCard: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg, paddingVertical: spacing.xl },
  permissionIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  permissionTitle: { marginTop: spacing.xs, fontSize: type.heading, fontWeight: '700' },
  permissionBody: { textAlign: 'center', fontSize: type.body, lineHeight: 23, marginBottom: spacing.sm },
  manualBlock: { gap: spacing.sm, marginTop: 'auto', paddingBottom: spacing.md },
  manualLabel: { fontSize: type.body, fontWeight: '700' },
  manualHelp: { fontSize: type.caption, lineHeight: 18 },
  manualActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  action: { flex: 1 },
});
