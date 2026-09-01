import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildConnectorInstallLaunch,
  buildDshProfileProbeLaunch,
  cleanupLegacyConnectorPatches,
  connectorUpgradeRequired,
  inferDshHomeFromLauncher,
  inferDshHomeFromProfileOutput,
  readInstalledConnectorVersion,
} from './connector-install.js';

describe('Connector installation', () => {
  it('detects an older Connector installed in the selected DSH profile', () => {
    const dshHome = mkdtempSync(join(tmpdir(), 'dsh-easyremote-connector-'));
    const packageDirectory = join(
      dshHome,
      'profiles',
      'web',
      'node_modules',
      '@hakimedes',
      'dsh-easyremote-connector',
    );
    mkdirSync(packageDirectory, { recursive: true });
    writeFileSync(join(packageDirectory, 'package.json'), JSON.stringify({ version: '0.2.9' }));

    const installed = readInstalledConnectorVersion(dshHome, 'web');
    expect(installed).toBe('0.2.9');
    expect(connectorUpgradeRequired(installed, '0.3.2')).toBe(true);
    expect(connectorUpgradeRequired('0.3.2', '0.3.2')).toBe(false);
    expect(connectorUpgradeRequired('0.3.3', '0.3.2')).toBe(false);
    expect(connectorUpgradeRequired('0.3.2-rc.1', '0.3.2')).toBe(true);
  });

  it('installs the packaged Connector through the selected DSH profile', () => {
    const env = { PATH: '/state/bin:/usr/bin' };
    expect(buildConnectorInstallLaunch('/usr/local/bin/dsh', 'web', '/state/connector.tgz', env)).toEqual({
      command: '/usr/local/bin/dsh',
      args: ['plugin', '--profile', 'web', 'add', '/state/connector.tgz'],
      env,
    });
  });

  it('leaves the default user overlay empty because DSH activates the Connector bundle', () => {
    const existing = [
      '# Your patch layer for this dsh profile, applied after every bundle layer:',
      '# a top-level YAML array of loader patch entries.',
      '[]',
      '',
    ].join('\n');

    expect(cleanupLegacyConnectorPatches(existing)).toBe(existing);
  });

  it('repairs the invalid user overlay written by earlier EasyRemote installers', () => {
    const broken = [
      '# Your patch layer for this dsh profile, applied after every bundle layer:',
      '[]',
      '# DSH EasyRemote Connector (managed by dsh-easyremote)',
      '- insert:',
      '    - id: dsh-easyremote-connector',
      "      name: '@hakimedes/dsh-easyremote-connector'",
      '',
    ].join('\n');

    const repaired = cleanupLegacyConnectorPatches(broken);
    expect(repaired).toBe([
      '# Your patch layer for this dsh profile, applied after every bundle layer:',
      '[]',
      '',
    ].join('\n'));
    expect(cleanupLegacyConnectorPatches(repaired)).toBe(repaired);
  });

  it('removes legacy Connector rows while preserving unrelated user patches', () => {
    const existing = [
      '# user config',
      '- id: user-theme',
      '  config:',
      '    appearance: dark',
      '# DSH Remote Hub connector',
      '- insert:',
      '    - id: dsh-remote-hub-connector',
      "      name: '@dsh-remote/hub-connector'",
      '# DSH EasyRemote Connector (managed by dsh-easyremote)',
      '- insert:',
      '    - id: dsh-easyremote-connector',
      "      name: '@hakimedes/dsh-easyremote-connector'",
      '',
    ].join('\n');

    expect(cleanupLegacyConnectorPatches(existing)).toBe([
      '# user config',
      '- id: user-theme',
      '  config:',
      '    appearance: dark',
      '',
    ].join('\n'));
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
    const env = { Path: 'C:\\State\\bin;C:\\Windows' };
    expect(buildDshProfileProbeLaunch('C:\\Tools\\node\\dsh.cmd', 'web', env)).toEqual({
      command: 'C:\\Tools\\node\\dsh.cmd',
      args: ['plugin', '--profile', 'web', 'exec', 'node', '-p', 'process.cwd()'],
      env,
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
