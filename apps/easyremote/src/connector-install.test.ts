import { describe, expect, it } from 'vitest';

import {
  buildConnectorInstallLaunch,
  buildDshProfileProbeLaunch,
  inferDshHomeFromLauncher,
  inferDshHomeFromProfileOutput,
  updateCordisPatch,
} from './connector-install.js';

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

  it('infers DSH_HOME from generic Windows launchers without assuming an installer directory', () => {
    const cmdLauncher = [
      '@echo off',
      'set "DSH_WORKSPACE=%USERPROFILE%\\Tools\\DSH Workspace"',
      'set "DSH_HOME=%DSH_WORKSPACE%\\.dsh-home"',
      'node "%DSH_WORKSPACE%\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" %*',
    ].join('\r\n');
    const powershellLauncher = [
      "$env:DSH_WORKSPACE = 'D:\\Portable\\DSH'",
      '$env:DSH_HOME = "$env:DSH_WORKSPACE\\.dsh-home"',
      '& node "$env:DSH_WORKSPACE\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" $args',
    ].join('\r\n');

    expect(inferDshHomeFromLauncher(cmdLauncher, { USERPROFILE: 'C:\\Users\\Example' }))
      .toBe('C:\\Users\\Example\\Tools\\DSH Workspace\\.dsh-home');
    expect(inferDshHomeFromLauncher(powershellLauncher)).toBe('D:\\Portable\\DSH\\.dsh-home');
  });

  it('asks DSH for its real profile directory when the launcher is only a package-manager shim', () => {
    expect(buildDshProfileProbeLaunch('C:\\Tools\\node\\dsh.cmd', 'web')).toEqual({
      command: 'C:\\Tools\\node\\dsh.cmd',
      args: ['plugin', '--profile', 'web', 'exec', 'node', '-p', 'process.cwd()'],
    });
    expect(inferDshHomeFromProfileOutput(
      'C:\\Users\\Example\\AppData\\Local\\DSH Data\\profiles\\web\r\n',
      'web',
    )).toBe('C:\\Users\\Example\\AppData\\Local\\DSH Data');
    expect(inferDshHomeFromProfileOutput('/opt/custom/dsh/profiles/web\n', 'web'))
      .toBe('/opt/custom/dsh');
    expect(inferDshHomeFromProfileOutput('not a profile directory\n', 'web')).toBeNull();
  });

  it('infers DSH_HOME from generic macOS zsh launchers and expands the user home', () => {
    const launcher = [
      '#!/bin/zsh',
      'typeset -gx DSH_WORKSPACE=~/Library/Application\\ Support/DeepSeek\\ Harness',
      'typeset -gx DSH_HOME="${DSH_WORKSPACE}/.dsh-home"',
      'exec node "$DSH_WORKSPACE/node_modules/@deepseek-ai/dsh/lib/bin.js" "$@"',
    ].join('\n');

    expect(inferDshHomeFromLauncher(launcher, { HOME: '/Users/Example' }))
      .toBe('/Users/Example/Library/Application Support/DeepSeek Harness/.dsh-home');
  });
});
