import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('DSH plugin manifest', () => {
  it('ships the same version and required host services as the package', () => {
    const root = resolve(import.meta.dirname, '..');
    const manifest = JSON.parse(readFileSync(resolve(root, 'dsh.plugin.json'), 'utf8'));
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

    expect(manifest.version).toBe(pkg.version);
    expect(pkg.name).toBe('@hakimedes/dsh-easyremote-connector');
    expect(manifest.name).toBe(pkg.name);
    expect(manifest.entry.name).toBe(pkg.name);
    expect(manifest.entry.inject).toContain('apiProxy');
  });
});
