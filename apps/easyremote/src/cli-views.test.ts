import { describe, expect, it } from 'vitest';

import { formatHelp, formatStatus } from './cli-views.js';

describe('CLI output', () => {
  it('documents every supported local command and no remote deploy command', () => {
    const help = formatHelp();
    for (const command of ['setup', 'quick', 'start', 'stop', 'status', 'doctor', 'upgrade', 'backup', 'restore', 'uninstall']) {
      expect(help).toContain(command);
    }
    expect(help).not.toMatch(/ssh|remote deploy/i);
  });

  it('makes the local-only availability constraint visible in status', () => {
    expect(formatStatus(null, false)).toContain('Not configured');
    expect(formatStatus({
      activeMode: 'named',
      hub: { host: '127.0.0.1', port: 8787, hubId: 'hub' },
      tunnel: { publicOrigin: 'https://dsh.example.com' },
    } as any, true)).toContain('127.0.0.1:8787');
  });
});
