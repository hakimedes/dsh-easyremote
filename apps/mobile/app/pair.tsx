import { useEffect, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { PairingQrError, parsePairingQr } from '@/domain/qr';
import { HUB_HTTP_URL } from '@/config';
import { PrimaryButton, Screen, WhaleMark } from '@/ui/primitives';
import { useAppStore } from '@/state/app-store';
import { spacing, type, useTheme } from '@/ui/theme';
import { confirmPairingServer } from '@/ui/pairing-confirmation';

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default function PairLinkScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ server?: string | string[]; token?: string | string[]; hubId?: string | string[] }>();
  const claimPairing = useAppStore((state) => state.claimPairing);
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const server = first(params.server) || HUB_HTTP_URL;
    const token = first(params.token);
    const hubId = first(params.hubId);
    if (!token) {
      setError('This pairing link is incomplete. Scan a new QR in DSH Web.');
      return;
    }
    const link = `dshremote://pair?server=${encodeURIComponent(server)}&token=${encodeURIComponent(token)}${hubId ? `&hubId=${encodeURIComponent(hubId)}` : ''}`;
    try {
      const pairing = parsePairingQr(link);
      void confirmPairingServer(pairing).then((confirmed) => {
        if (!confirmed) {
          router.replace('/');
          return;
        }
        return claimPairing(pairing).then(() => router.replace('/pairing-success'));
      }).catch((reason) => {
        setError(reason instanceof Error ? reason.message : 'Pairing failed');
      });
    } catch (reason) {
      setError(reason instanceof PairingQrError || reason instanceof Error ? reason.message : 'Pairing failed');
    }
  }, [claimPairing, params.hubId, params.server, params.token, router]);

  return <Screen scroll={false} style={styles.screen} edges={['top', 'bottom']}>
    <View style={styles.content}>
      <WhaleMark size={82} />
      {error ? <>
        <View style={[styles.iconCircle, { backgroundColor: `${theme.colors.danger}10` }]}><Ionicons name="alert-circle-outline" size={25} color={theme.colors.danger} /></View>
        <Text style={[styles.title, { color: theme.colors.text }]}>Could not connect</Text>
        <Text style={[styles.body, { color: theme.colors.muted }]}>{error}</Text>
        <View style={styles.action}><PrimaryButton label="Scan another QR" icon="qr-code-outline" onPress={() => router.replace('/scan')} /></View>
      </> : <>
        <ActivityIndicator style={styles.spinner} color={theme.colors.accent} />
        <Text style={[styles.title, { color: theme.colors.text }]}>Connecting your Harness…</Text>
        <Text style={[styles.body, { color: theme.colors.muted }]}>Verifying this one-time link with DSH Hub.</Text>
      </>}
    </View>
  </Screen>;
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: spacing.lg },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: spacing.xxl },
  spinner: { marginTop: spacing.xl },
  iconCircle: { width: 48, height: 48, borderRadius: 15, marginTop: spacing.xl, alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: spacing.md, textAlign: 'center', fontSize: type.title, lineHeight: 32, fontWeight: '700' },
  body: { marginTop: spacing.sm, maxWidth: 330, textAlign: 'center', fontSize: type.body, lineHeight: 23 },
  action: { width: '100%', marginTop: spacing.xl },
});
