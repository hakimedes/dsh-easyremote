import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadSetupProgress, saveSetupProgress } from './setup-progress.js';

describe('resumable setup progress', () => {
  it('persists the exact deep configuration checkpoint without credentials', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'setup-progress-')), 'setup.json');
    const progress = {
      schemaVersion: 1 as const,
      mode: 'named' as const,
      phase: 'nameservers-pending' as const,
      rootDomain: 'example.com',
      hostname: 'dsh.example.com',
      nameservers: ['lia.ns.cloudflare.com', 'walt.ns.cloudflare.com'] as [string, string],
      updatedAt: 123,
    };
    saveSetupProgress(path, progress);
    expect(loadSetupProgress(path)).toEqual(progress);
  });
});
