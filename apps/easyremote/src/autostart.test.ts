import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { installUserAutostart, removeUserAutostart, renderUserService } from './autostart.js';

describe('user-login autostart', () => {
  it('renders user-scoped definitions without sudo', () => {
    const command = { executable: '/node', args: ['/app/cli.js', 'service-run'] };
    const mac = renderUserService('darwin', '/Users/test', command);
    expect(mac.path).toContain('/Users/test/Library/LaunchAgents/');
    expect(mac.contents).toContain('<key>RunAtLoad</key>');
    const linux = renderUserService('linux', '/home/test', command);
    expect(linux.path).toContain('/home/test/.config/systemd/user/');
    expect(linux.contents).toContain('WantedBy=default.target');
    expect(`${mac.contents}${linux.contents}`).not.toContain('sudo');
  });

  it('writes the definition and invokes only the current-user service manager', async () => {
    const home = mkdtempSync(join(tmpdir(), 'autostart-home-'));
    const run = vi.fn(async () => {});
    const definition = await installUserAutostart({
      platform: 'linux',
      home,
      command: { executable: '/node', args: ['/app/cli.js', 'service-run'] },
      run,
    });
    expect(readFileSync(definition.path, 'utf8')).toContain('ExecStart=/node /app/cli.js service-run');
    expect(run.mock.calls).toEqual([
      ['systemctl', ['--user', 'daemon-reload']],
      ['systemctl', ['--user', 'enable', '--now', 'dsh-easyremote.service']],
    ]);
  });

  it('removes only the user service and leaves application data untouched', async () => {
    const home = mkdtempSync(join(tmpdir(), 'autostart-home-'));
    const run = vi.fn(async () => {});
    const command = { executable: '/node', args: ['/app/cli.js', 'service-run'] };
    const definition = await installUserAutostart({ platform: 'linux', home, command, run });
    await removeUserAutostart({ platform: 'linux', home, command, run });
    expect(() => readFileSync(definition.path)).toThrow();
    expect(run.mock.calls.slice(-2)).toEqual([
      ['systemctl', ['--user', 'disable', '--now', 'dsh-easyremote.service']],
      ['systemctl', ['--user', 'daemon-reload']],
    ]);
  });
});
