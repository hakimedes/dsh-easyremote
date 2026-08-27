import { existsSync } from 'node:fs';
import WebSocket from 'ws';

import { loadPairingState } from './pairing-state.js';

export type DoctorCheck = { ok: boolean; detail: string };
export type DoctorResult = DoctorCheck & { name: string };

export function inspectConnectorRuntime(options: {
  pairingStatePath: string;
  expectedHub?: string;
}): DoctorCheck {
  if (!existsSync(options.pairingStatePath)) {
    return {
      ok: false,
      detail: 'pairing handoff missing; restart DSH Web after Connector installation',
    };
  }

  const state = loadPairingState(options.pairingStatePath);
  if (!state) return { ok: false, detail: 'pairing handoff is invalid' };

  if (options.expectedHub) {
    let expectedHub: string;
    try {
      expectedHub = new URL(options.expectedHub).origin;
    } catch {
      return { ok: false, detail: `configured public origin is invalid: ${options.expectedHub}` };
    }
    if (state.hub !== expectedHub) {
      return {
        ok: false,
        detail: `Connector is using ${state.hub}; expected ${expectedHub}`,
      };
    }
  }

  if (state.error) return { ok: false, detail: state.error };
  if (state.nodeId) {
    return {
      ok: true,
      detail: 'connected; generate a recovery QR in DSH Web Settings -> Remote',
    };
  }
  if (state.qrPayload) return { ok: true, detail: 'pairing QR ready' };
  return {
    ok: false,
    detail: `Connector loaded but no active pairing QR (status: ${state.status})`,
  };
}

export async function runDoctor(options: {
  nodeVersion?: string;
  checks: Record<string, () => Promise<DoctorCheck>>;
}) {
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const [major = 0, minor = 0] = nodeVersion.split('.').map(Number);
  const checks: DoctorResult[] = [{
    name: 'node',
    ok: major > 22 || (major === 22 && minor >= 19),
    detail: nodeVersion,
  }];
  for (const [name, check] of Object.entries(options.checks)) {
    try {
      checks.push({ name, ...await check() });
    } catch (error) {
      checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  }
  return { ok: checks.every((check) => check.ok), checks };
}

type ProbeSocket = {
  once: (event: string, listener: (...args: any[]) => void) => unknown;
  close: () => void;
};

export function probeWebSocket(publicOrigin: string, options: {
  timeoutMs?: number;
  createSocket?: (url: string) => ProbeSocket;
} = {}): Promise<DoctorCheck> {
  const url = new URL('/v1/node/connect', publicOrigin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const createSocket = options.createSocket ?? ((value: string) => new WebSocket(value));
  return new Promise((resolve) => {
    const socket = createSocket(url.toString());
    let finished = false;
    const finish = (result: DoctorCheck) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { socket.close(); } catch {}
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, detail: 'WebSocket upgrade timed out' }), options.timeoutMs ?? 5_000);
    socket.once('open', () => finish({ ok: true, detail: 'WebSocket upgrade accepted' }));
    socket.once('error', (error: Error) => finish({ ok: false, detail: error.message || 'WebSocket upgrade failed' }));
    socket.once('unexpected-response', (_request: unknown, response: { statusCode?: number }) => {
      finish({ ok: false, detail: `WebSocket upgrade returned HTTP ${response.statusCode ?? 'unknown'}` });
    });
  });
}
