import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { installCommunityApk, parseAdbDevices, selectSingleAdbDevice, verifyReleaseChecksum } from './android.js';

describe('Community APK ADB install helpers', () => {
  it('uses only authorized online ADB devices', () => {
    const devices = parseAdbDevices('List of devices attached\nABC\tdevice product:test\nDEF\tunauthorized\n\n');
    expect(devices).toEqual(['ABC']);
    expect(selectSingleAdbDevice(devices)).toBe('ABC');
    expect(() => selectSingleAdbDevice([])).toThrow(/no authorized/i);
    expect(() => selectSingleAdbDevice(['A', 'B'])).toThrow(/multiple/i);
  });

  it('matches APK bytes against the named release checksum entry', () => {
    const bytes = Buffer.from('apk');
    const digest = createHash('sha256').update(bytes).digest('hex');
    expect(verifyReleaseChecksum(bytes, `${digest}  DSH-EasyRemote-Community.apk\n`, 'DSH-EasyRemote-Community.apk')).toBe(true);
    expect(verifyReleaseChecksum(bytes, `${'0'.repeat(64)}  other.apk\n`, 'DSH-EasyRemote-Community.apk')).toBe(false);
  });

  it('verifies the release before installing to the one authorized device', async () => {
    const bytes = Buffer.from('apk');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const fetcher = vi.fn(async (url: string) => url.endsWith('SHA256SUMS')
      ? new Response(`${digest}  DSH-EasyRemote-Community.apk\n`)
      : new Response(bytes));
    const run = vi.fn(async () => {});
    const destination = join(mkdtempSync(join(tmpdir(), 'apk-install-')), 'DSH-EasyRemote-Community.apk');
    await installCommunityApk({
      apkUrl: 'https://release/DSH-EasyRemote-Community.apk',
      checksumUrl: 'https://release/SHA256SUMS',
      destination,
      fetcher: fetcher as any,
      capture: async () => 'List of devices attached\nABC\tdevice\n',
      run,
    });
    expect(run).toHaveBeenCalledWith('adb', ['-s', 'ABC', 'install', '-r', destination]);
  });
});
