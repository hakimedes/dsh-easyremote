import { createHash, timingSafeEqual } from 'node:crypto';

export const CLOUDFLARED_VERSION = '2026.7.2';

export type CloudflaredArtifact = { name: string; sha256: string; archive: 'binary' | 'tgz' };

const artifacts: Record<string, CloudflaredArtifact> = {
  'darwin-arm64': {
    name: 'cloudflared-darwin-arm64.tgz',
    sha256: '0588df58494a6cadd38b9deb6078908a5054063c80784d92fdb8d4a5f3de1c67',
    archive: 'tgz',
  },
  'darwin-x64': {
    name: 'cloudflared-darwin-amd64.tgz',
    sha256: 'a5afb0ba3da859da47bebc9a918d5b196bf7e4aec23589419b46356731bcc75f',
    archive: 'tgz',
  },
  'linux-arm64': {
    name: 'cloudflared-linux-arm64',
    sha256: '405df476437e027fc6d18729a5a77155c0a33a6082aeee60a799a688f3052e66',
    archive: 'binary',
  },
  'linux-x64': {
    name: 'cloudflared-linux-amd64',
    sha256: 'ec905ea7b7e327ff8abdde8cb64697a2152de74dbcdbf6aec9db8364eb3886cd',
    archive: 'binary',
  },
  'win32-x64': {
    name: 'cloudflared-windows-amd64.exe',
    sha256: 'cdb5d4432f6ae1595654a692a51308b69d2bf7af961f5578d9391837cf072df9',
    archive: 'binary',
  },
};

export function artifactFor(platform: NodeJS.Platform, arch: string): CloudflaredArtifact {
  const artifact = artifacts[`${platform}-${arch}`];
  if (!artifact) throw new Error(`Unsupported cloudflared platform: ${platform}/${arch}`);
  return artifact;
}

export function artifactUrl(artifact: CloudflaredArtifact) {
  return `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${artifact.name}`;
}

export function verifySha256(bytes: Uint8Array, expected: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(expected)) return false;
  const actual = createHash('sha256').update(bytes).digest();
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

export function parseQuickTunnelOrigin(text: string): string | null {
  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com(?:[^\s]*)?/i);
  if (!match) return null;
  const url = new URL(match[0]);
  if (url.protocol !== 'https:' || !url.hostname.toLowerCase().endsWith('.trycloudflare.com')) return null;
  return url.origin;
}
