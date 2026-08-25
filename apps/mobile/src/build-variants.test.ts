import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mobileRoot = resolve(import.meta.dirname, '..');

describe('Android distribution variants', () => {
  it('builds Community and internal APKs with coexistable application IDs', () => {
    const gradle = readFileSync(resolve(mobileRoot, 'android/app/build.gradle'), 'utf8');
    const appConfig = JSON.parse(readFileSync(resolve(mobileRoot, 'app.json'), 'utf8'));
    const packageJson = JSON.parse(readFileSync(resolve(mobileRoot, 'package.json'), 'utf8'));
    const buildScript = readFileSync(resolve(mobileRoot, 'scripts/android-build.mjs'), 'utf8');

    expect(gradle).toContain("flavorDimensions 'distribution'");
    expect(gradle).toContain("applicationId 'io.github.hakimedes.dsheasyremote'");
    expect(gradle).toContain("applicationId 'cc.infomind.dshremote'");
    expect(gradle).not.toContain("storeFile file('debug.keystore')");
    expect(appConfig.expo.android.package).toBe('io.github.hakimedes.dsheasyremote');
    expect(packageJson.scripts['android:community:release']).toContain('android-build.mjs community release');
    expect(packageJson.scripts['android:internal:release']).toContain('android-build.mjs internal release');
    expect(buildScript).toContain("NODE_ENV: process.env.NODE_ENV || (buildType === 'release' ? 'production' : 'development')");
  });
});
