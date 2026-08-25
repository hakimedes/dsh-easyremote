import { describe, expect, it } from 'vitest';

import { buildConnectorInstallLaunch, inferDshHomeFromLauncher, updateCordisPatch } from './connector-install.js';

describe('Connector installation', () => {
  it('installs the packaged Connector through the selected DSH profile', () => {
    expect(buildConnectorInstallLaunch('/usr/local/bin/dsh', 'web', '/state/connector.tgz')).toEqual({
      command: '/usr/local/bin/dsh',
      args: ['plugin', '--profile', 'web', 'add', '/state/connector.tgz'],
    });
  });

  it('upgrades the old package name without duplicating the loader entry', () => {
    const existing = `# user config\n- insert:\n    - id: dsh-remote-hub-connector\n      name: '@dsh-remote/hub-connector'\n`;
    const updated = updateCordisPatch(existing);
    expect(updated).toContain("name: '@hakimedes/dsh-easyremote-connector'");
    expect(updated.match(/id: dsh-easyremote-connector/g)).toHaveLength(1);
    expect(updated).not.toContain("name: '@dsh-remote/hub-connector'");
  });

  it('appends one connector entry while preserving unrelated user config', () => {
    const updated = updateCordisPatch('# user config\n');
    expect(updated.startsWith('# user config')).toBe(true);
    expect(updated.match(/name: '@hakimedes\/dsh-easyremote-connector'/g)).toHaveLength(1);
  });

  it('infers DSH_HOME from a launcher without executing its shell contents', () => {
    const launcher = '#!/bin/sh\nDSH_WORKSPACE=/Users/test/dsh_WorkSpace\nexport DSH_HOME="$DSH_WORKSPACE/.dsh-home"\nexec node app.js\n';
    expect(inferDshHomeFromLauncher(launcher)).toBe('/Users/test/dsh_WorkSpace/.dsh-home');
    expect(inferDshHomeFromLauncher('rm -rf /')).toBeNull();
  });
});
