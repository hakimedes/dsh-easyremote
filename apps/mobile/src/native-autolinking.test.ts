import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

type ResolvedExpoModule = {
  packageName: string;
  packageVersion: string;
  projects: Array<{ modules: string[] }>;
};

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('Android native autolinking', () => {
  it('includes an SDK-compatible ExpoLinking module', () => {
    const resolved = JSON.parse(execFileSync(
      'pnpm',
      ['exec', 'expo-modules-autolinking', 'resolve', '--platform', 'android', '--json'],
      { cwd: appRoot, encoding: 'utf8' },
    )) as { modules: ResolvedExpoModule[] };
    const bundledVersions = JSON.parse(readFileSync(
      join(appRoot, 'node_modules/expo/bundledNativeModules.json'),
      'utf8',
    )) as Record<string, string>;

    const linking = resolved.modules.find((module) => module.packageName === 'expo-linking');
    const expectedMajorMinor = bundledVersions['expo-linking']
      .replace(/^~/, '')
      .split('.')
      .slice(0, 2);

    expect(linking, 'expo-linking must be included in Android autolinking').toBeDefined();
    expect(linking?.packageVersion.split('.').slice(0, 2)).toEqual(expectedMajorMinor);
    expect(linking?.projects.some((project) => project.modules.length > 0)).toBe(true);
  });
});
