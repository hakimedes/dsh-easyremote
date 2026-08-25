import type { ProcessLaunch } from './runtime.js';
import { join } from 'node:path';

const CONNECTOR_PACKAGE = '@hakimedes/dsh-easyremote-connector';
const CONNECTOR_BLOCK = `\n# DSH EasyRemote Connector (managed by dsh-easyremote)\n- insert:\n    - id: dsh-easyremote-connector\n      name: '${CONNECTOR_PACKAGE}'\n`;

export function buildConnectorInstallLaunch(dshExecutable: string, profile: string, packagePath: string): ProcessLaunch {
  if (!/^[a-zA-Z0-9._-]+$/.test(profile)) throw new Error('Invalid DSH profile name');
  return {
    command: dshExecutable,
    args: ['plugin', '--profile', profile, 'add', packagePath],
  };
}

export function updateCordisPatch(existing: string): string {
  let updated = existing
    .replaceAll("name: '@dsh-remote/hub-connector'", `name: '${CONNECTOR_PACKAGE}'`)
    .replaceAll('id: dsh-remote-hub-connector', 'id: dsh-easyremote-connector');
  if (!updated.includes(`name: '${CONNECTOR_PACKAGE}'`)) updated = `${updated.trimEnd()}${CONNECTOR_BLOCK}`;
  if (!updated.endsWith('\n')) updated += '\n';
  return updated;
}

export function inferDshHomeFromLauncher(contents: string) {
  const assignments = new Map<string, string>();
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, '');
    const match = line.match(/^(DSH_HOME|DSH_WORKSPACE)=(["']?)([^"';&|`]+)\2$/);
    if (match) assignments.set(match[1], match[3]);
  }
  const home = assignments.get('DSH_HOME');
  if (home && home.startsWith('/') && !home.includes('$')) return home;
  const workspace = assignments.get('DSH_WORKSPACE');
  if (workspace?.startsWith('/') && home?.includes('$DSH_WORKSPACE/.dsh-home')) {
    return join(workspace, '.dsh-home');
  }
  if (workspace?.startsWith('/') && contents.includes('export DSH_HOME="$DSH_WORKSPACE/.dsh-home"')) {
    return join(workspace, '.dsh-home');
  }
  return null;
}
