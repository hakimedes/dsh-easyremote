import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';

export function parseAdbDevices(output: string): string[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^([^\s]+)\s+device(?:\s|$)/);
    return match ? [match[1]] : [];
  });
}

export function selectSingleAdbDevice(devices: string[]) {
  if (devices.length === 0) throw new Error('No authorized online ADB device was detected');
  if (devices.length > 1) throw new Error('Multiple ADB devices are connected; keep exactly one device connected');
  return devices[0];
}

export function verifyReleaseChecksum(bytes: Uint8Array, checksumFile: string, fileName: string) {
  const line = checksumFile.split(/\r?\n/).find((value) => {
    const parts = value.trim().split(/\s+/);
    return parts.length >= 2 && parts.at(-1)?.replace(/^\*/, '') === fileName;
  });
  if (!line) return false;
  const expected = line.trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{64}$/i.test(expected)) return false;
  const actual = createHash('sha256').update(bytes).digest();
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

export async function installCommunityApk(options: {
  apkUrl: string;
  checksumUrl: string;
  destination: string;
  fetcher?: typeof fetch;
  capture: (command: string, args: string[]) => Promise<string>;
  run: (command: string, args: string[]) => Promise<void>;
}) {
  const fetcher = options.fetcher ?? fetch;
  const [apkResponse, checksumResponse] = await Promise.all([
    fetcher(options.apkUrl),
    fetcher(options.checksumUrl),
  ]);
  if (!apkResponse.ok || !checksumResponse.ok) {
    throw new Error(`Unable to download the APK release (${apkResponse.status}/${checksumResponse.status})`);
  }
  const bytes = Buffer.from(await apkResponse.arrayBuffer());
  const checksums = await checksumResponse.text();
  if (!verifyReleaseChecksum(bytes, checksums, basename(options.destination))) {
    throw new Error('Community APK checksum verification failed');
  }
  const device = selectSingleAdbDevice(parseAdbDevices(await options.capture('adb', ['devices', '-l'])));
  mkdirSync(dirname(options.destination), { recursive: true, mode: 0o700 });
  writeFileSync(options.destination, bytes, { mode: 0o600 });
  await options.run('adb', ['-s', device, 'install', '-r', options.destination]);
  return { device, destination: options.destination };
}
