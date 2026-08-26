import { existsSync, readFileSync } from 'node:fs';

export type LocalPairingState = {
  schemaVersion: 1;
  status: string;
  hub: string;
  nodeName: string;
  nodeId: string | null;
  qrPayload?: string;
  pairingExpiresAt: number | null;
  error?: string | null;
  updatedAt: number;
};

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function loadPairingState(path: string, now = Date.now()): LocalPairingState | null {
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    if (
      value.schemaVersion !== 1
      || typeof value.status !== 'string'
      || typeof value.hub !== 'string'
      || typeof value.nodeName !== 'string'
      || (value.nodeId !== null && typeof value.nodeId !== 'string')
      || typeof value.updatedAt !== 'number'
    ) return null;

    const parsedHub = new URL(value.hub);
    if (!['http:', 'https:'].includes(parsedHub.protocol)) return null;

    const qrPayload = optionalString(value.qrPayload);
    const pairingExpiresAt = typeof value.pairingExpiresAt === 'number' ? value.pairingExpiresAt : null;
    const liveQr = Boolean(qrPayload && pairingExpiresAt && pairingExpiresAt > now);
    if (liveQr) {
      const parsedQr = new URL(qrPayload!);
      if (parsedQr.protocol !== 'dshremote:' || parsedQr.hostname !== 'pair') return null;
    }

    return {
      schemaVersion: 1,
      status: value.status,
      hub: parsedHub.origin,
      nodeName: value.nodeName,
      nodeId: value.nodeId,
      ...(liveQr ? { qrPayload } : {}),
      pairingExpiresAt: liveQr ? pairingExpiresAt : null,
      error: optionalString(value.error) ?? null,
      updatedAt: value.updatedAt,
    };
  } catch {
    return null;
  }
}
