#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const variant = process.argv[2];
const buildType = process.argv[3];
if (!['community', 'internal'].includes(variant) || !['debug', 'release'].includes(buildType)) {
  console.error('Usage: android-build.mjs <community|internal> <debug|release>');
  process.exit(2);
}

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const androidRoot = resolve(mobileRoot, 'android');
const executable = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const capitalize = (value) => `${value[0].toUpperCase()}${value.slice(1)}`;
const task = `assemble${capitalize(variant)}${capitalize(buildType)}`;
const result = spawnSync(executable, [task, '--no-daemon'], {
  cwd: androidRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || (buildType === 'release' ? 'production' : 'development'),
    EXPO_PUBLIC_APP_VARIANT: variant,
  },
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
