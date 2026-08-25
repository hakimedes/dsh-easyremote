import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

type ExpoConfig = {
  expo: {
    icon?: string;
    splash?: { image?: string };
    android?: { adaptiveIcon?: { foregroundImage?: string } };
  };
};

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function pngDimensions(path: string) {
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('DeepSeek Harness mobile branding', () => {
  it('ships configured, decodable whale artwork for every app surface', () => {
    const config = JSON.parse(readFileSync(resolve(appRoot, 'app.json'), 'utf8')) as ExpoConfig;
    const configuredPaths = [
      config.expo.icon,
      config.expo.android?.adaptiveIcon?.foregroundImage,
      config.expo.splash?.image,
      './assets/brand/dsh-whale.png',
    ];

    expect(configuredPaths.every((path): path is string => Boolean(path))).toBe(true);

    for (const relativePath of configuredPaths) {
      if (!relativePath) continue;
      const absolutePath = resolve(appRoot, relativePath);
      expect(existsSync(absolutePath), `${relativePath} must exist`).toBe(true);
      const { width, height } = pngDimensions(absolutePath);
      expect(width, `${relativePath} must be at least 256px wide`).toBeGreaterThanOrEqual(256);
      expect(height, `${relativePath} must be at least 256px high`).toBeGreaterThanOrEqual(256);
    }
  });
});
