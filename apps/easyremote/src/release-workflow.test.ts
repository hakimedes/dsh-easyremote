import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

describe('GitHub Release workflow', () => {
  it('downloads only the public npm package and Community APK artifacts', () => {
    const workflow = readFileSync(
      new URL('../../../.github/workflows/release.yml', import.meta.url),
      'utf8',
    );
    const releaseJob = workflow.slice(workflow.indexOf('\n  github-release:'));

    expect(releaseJob).toContain('name: npm-package');
    expect(releaseJob).toContain('name: community-apk');
    expect(releaseJob).not.toMatch(
      /uses: actions\/download-artifact@v4\n\s+with:\n\s+path: release/,
    );
  });

  it('passes the npm tarball as an explicit local file path', () => {
    const workflow = readFileSync(
      new URL('../../../.github/workflows/release.yml', import.meta.url),
      'utf8',
    );
    const publishStep = workflow.match(
      /- name: Publish npm package\n\s+run: \|\n((?:\s{10}.*\n?)+)/,
    );

    expect(publishStep).not.toBeNull();

    const script = publishStep![1].replace(/^ {10}/gm, '');
    const workspace = mkdtempSync(join(tmpdir(), 'dsh-release-workflow-'));
    const fakeBin = join(workspace, 'bin');
    const capturedArgs = join(workspace, 'npm-args.txt');

    try {
      mkdirSync(join(workspace, 'release'));
      mkdirSync(fakeBin);
      writeFileSync(
        join(workspace, 'release', 'hakimedes-dsh-easyremote-9.9.9.tgz'),
        'package',
      );
      writeFileSync(
        join(fakeBin, 'npm'),
        '#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURED_ARGS"\n',
      );
      chmodSync(join(fakeBin, 'npm'), 0o755);

      execFileSync('bash', ['-e', '-c', script], {
        cwd: workspace,
        env: {
          ...process.env,
          CAPTURED_ARGS: capturedArgs,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        },
      });

      expect(readFileSync(capturedArgs, 'utf8').trim().split('\n')).toEqual([
        'publish',
        './release/hakimedes-dsh-easyremote-9.9.9.tgz',
        '--access',
        'public',
      ]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
