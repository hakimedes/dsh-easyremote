import { existsSync, readFileSync } from 'node:fs';

import type { ProcessLaunch } from './runtime.js';

export function buildLoginLaunch(executable: string): ProcessLaunch {
  return { command: executable, args: ['tunnel', 'login'] };
}

export function buildCreateTunnelLaunch(
  executable: string,
  originCertificate: string,
  credentialsFile: string,
  tunnelName: string,
): ProcessLaunch {
  return {
    command: executable,
    args: [
      'tunnel', '--origincert', originCertificate, '--credentials-file', credentialsFile,
      'create', tunnelName,
    ],
  };
}

export function buildDnsRouteLaunch(
  executable: string,
  originCertificate: string,
  tunnelId: string,
  hostname: string,
): ProcessLaunch {
  return {
    command: executable,
    args: ['tunnel', '--origincert', originCertificate, 'route', 'dns', tunnelId, hostname],
  };
}

export function readTunnelCredentials(credentialsFile: string) {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(credentialsFile, 'utf8'));
  } catch (error) {
    throw new Error(`Tunnel credentials are not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof (value as Record<string, unknown>).TunnelID !== 'string') {
    throw new Error('Tunnel credentials do not contain TunnelID');
  }
  return { tunnelId: (value as { TunnelID: string }).TunnelID, credentialsFile };
}

export async function provisionNamedTunnel(options: {
  executable: string;
  originCertificate: string;
  credentialsFile: string;
  tunnelName: string;
  hostname: string;
  exists?: (path: string) => boolean;
  run: (launch: ProcessLaunch, interactive?: boolean) => Promise<void>;
}) {
  const exists = options.exists ?? existsSync;
  if (!exists(options.originCertificate)) {
    await options.run(buildLoginLaunch(options.executable), true);
    if (!existsSync(options.originCertificate)) {
      throw new Error('Cloudflare authorization completed without creating cert.pem');
    }
  }
  if (!exists(options.credentialsFile)) {
    await options.run(buildCreateTunnelLaunch(
      options.executable,
      options.originCertificate,
      options.credentialsFile,
      options.tunnelName,
    ));
  }
  const credentials = readTunnelCredentials(options.credentialsFile);
  await options.run(buildDnsRouteLaunch(
    options.executable,
    options.originCertificate,
    credentials.tunnelId,
    options.hostname,
  ));
  return credentials;
}
