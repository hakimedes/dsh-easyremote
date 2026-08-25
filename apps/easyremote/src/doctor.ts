import WebSocket from 'ws';

export type DoctorCheck = { ok: boolean; detail: string };
export type DoctorResult = DoctorCheck & { name: string };

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
