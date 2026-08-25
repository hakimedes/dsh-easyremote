import { Alert } from 'react-native';
import { IS_COMMUNITY_BUILD } from '../config';
import type { PairingPayload } from '../domain/types';

export function confirmPairingServer(pairing: PairingPayload) {
  if (!IS_COMMUNITY_BUILD) return Promise.resolve(true);

  const host = new URL(pairing.server).host;
  const identity = pairing.hubId ? `\n\nHub ID: ${pairing.hubId}` : '';
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      'Connect to this Hub?',
      `DSH EasyRemote will send its pairing token and future requests to:\n\n${host}${identity}\n\nOnly continue if this is the address you configured.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Connect', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
