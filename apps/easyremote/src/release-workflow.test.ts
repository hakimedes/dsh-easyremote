import { readFileSync } from 'node:fs';

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
});
