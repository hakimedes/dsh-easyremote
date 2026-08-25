import { ALLOW_LOCAL_HUB, APP_SCHEME, FIXED_HUB_SERVER } from '../config';
import type { PairingPayload } from './types';

const PAIR_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const HUB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class PairingQrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PairingQrError';
  }
}

export function parsePairingQr(raw: string, options?: { allowLocal?: boolean; expectedServer?: string | null }): PairingPayload {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new PairingQrError('This is not a valid DSH pairing QR.');
  }

  if (url.protocol !== `${APP_SCHEME}:` || url.hostname !== 'pair') {
    throw new PairingQrError('Use a DSH Remote pairing QR code.');
  }

  const server = url.searchParams.get('server') || '';
  const pairToken = url.searchParams.get('token') || '';
  const hubId = url.searchParams.get('hubId') || undefined;
  if (!PAIR_TOKEN_PATTERN.test(pairToken)) {
    throw new PairingQrError('This pairing QR has an invalid token.');
  }

  let serverUrl: URL;
  try {
    serverUrl = new URL(server);
  } catch {
    throw new PairingQrError('This pairing QR has an invalid server.');
  }

  const allowLocal = options?.allowLocal ?? ALLOW_LOCAL_HUB;
  const localHost = ['localhost', '127.0.0.1', '10.0.2.2'].includes(serverUrl.hostname);
  if (serverUrl.protocol !== 'https:' && !(allowLocal && serverUrl.protocol === 'http:' && localHost)) {
    throw new PairingQrError('Pairing is only allowed with a secure DSH server.');
  }

  if (serverUrl.username || serverUrl.password || serverUrl.pathname !== '/' || serverUrl.search || serverUrl.hash) {
    throw new PairingQrError('This pairing QR has an invalid server origin.');
  }

  if (hubId && !HUB_ID_PATTERN.test(hubId)) {
    throw new PairingQrError('This pairing QR has an invalid Hub identity.');
  }

  const expected = options && 'expectedServer' in options ? options.expectedServer : FIXED_HUB_SERVER;
  if (!allowLocal && expected && serverUrl.origin !== new URL(expected).origin) {
    throw new PairingQrError('This QR belongs to a different DSH server.');
  }

  return { server: serverUrl.origin, pairToken, ...(hubId ? { hubId } : {}) };
}
