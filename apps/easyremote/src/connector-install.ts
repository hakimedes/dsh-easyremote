import type { ProcessLaunch } from './runtime.js';
import { posix, win32 } from 'node:path';

const CONNECTOR_PACKAGE = '@hakimedes/dsh-easyremote-connector';
const CONNECTOR_BLOCK = `\n# DSH EasyRemote Connector (managed by dsh-easyremote)\n- insert:\n    - id: dsh-easyremote-connector\n      name: '${CONNECTOR_PACKAGE}'\n`;

function assertProfileName(profile: string) {
  if (!/^[a-zA-Z0-9._-]+$/.test(profile)) throw new Error('Invalid DSH profile name');
}

export function buildConnectorInstallLaunch(dshExecutable: string, profile: string, packagePath: string): ProcessLaunch {
  assertProfileName(profile);
  return {
    command: dshExecutable,
    args: ['plugin', '--profile', profile, 'add', packagePath],
  };
}

export function buildDshProfileProbeLaunch(dshExecutable: string, profile: string): ProcessLaunch {
  assertProfileName(profile);
  return {
    command: dshExecutable,
    args: ['plugin', '--profile', profile, 'exec', 'node', '-p', 'process.cwd()'],
  };
}

export function inferDshHomeFromProfileOutput(output: string, profile: string) {
  assertProfileName(profile);
  for (const rawLine of output.split(/\r?\n/).reverse()) {
    const line = rawLine.trim();
    if (/^[a-z]:[\\/]/i.test(line) || /^\\\\[^\\]+\\[^\\]+/.test(line)) {
      const profileDirectory = win32.normalize(line.replaceAll('/', '\\'));
      if (
        win32.basename(profileDirectory).toLowerCase() === profile.toLowerCase()
        && win32.basename(win32.dirname(profileDirectory)).toLowerCase() === 'profiles'
      ) return win32.dirname(win32.dirname(profileDirectory));
    } else if (line.startsWith('/')) {
      const profileDirectory = posix.normalize(line);
      if (
        posix.basename(profileDirectory) === profile
        && posix.basename(posix.dirname(profileDirectory)) === 'profiles'
      ) return posix.dirname(posix.dirname(profileDirectory));
    }
  }
  return null;
}

export function updateCordisPatch(existing: string): string {
  let updated = existing
    .replaceAll("name: '@dsh-remote/hub-connector'", `name: '${CONNECTOR_PACKAGE}'`)
    .replaceAll('id: dsh-remote-hub-connector', 'id: dsh-easyremote-connector');
  if (!updated.includes(`name: '${CONNECTOR_PACKAGE}'`)) updated = `${updated.trimEnd()}${CONNECTOR_BLOCK}`;
  if (!updated.endsWith('\n')) updated += '\n';
  return updated;
}

export function inferDshHomeFromLauncher(
  contents: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const assignments = new Map<string, string>();
  for (const [name, value] of Object.entries(environment)) {
    if (typeof value === 'string') assignments.set(name.toUpperCase(), value);
  }
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    const shellLine = line
      .replace(/^export\s+/, '')
      .replace(/^readonly\s+/, '')
      .replace(/^typeset(?:\s+-[a-z]+)*\s+/i, '');
    const shell = shellLine
      .match(/^(DSH_HOME|DSH_WORKSPACE)=(["']?)([^"';&|`]+)\2$/i);
    const cmd = line.match(/^set\s+"?(DSH_HOME|DSH_WORKSPACE)=([^";&|`]+)"?$/i);
    const powershell = line.match(/^\$env:(DSH_HOME|DSH_WORKSPACE)\s*=\s*(["'])(.*?)\2$/i);
    if (shell) assignments.set(shell[1].toUpperCase(), shell[3].replace(/\\([\\ "'()])/g, '$1'));
    else if (cmd) assignments.set(cmd[1].toUpperCase(), cmd[2]);
    else if (powershell) assignments.set(powershell[1].toUpperCase(), powershell[3]);
  }

  const resolveVariable = (name: string, seen = new Set<string>()): string | null => {
    const normalized = name.toUpperCase();
    if (seen.has(normalized)) return null;
    const source = assignments.get(normalized);
    if (!source) return null;
    const nextSeen = new Set(seen).add(normalized);
    let unresolved = false;
    const expand = (_token: string, variable: string) => {
      const resolved = resolveVariable(variable, nextSeen);
      if (resolved == null) {
        unresolved = true;
        return '';
      }
      return resolved;
    };
    let value = source
      .replace(/%([A-Z_][A-Z0-9_]*)%/gi, expand)
      .replace(/\$env:([A-Z_][A-Z0-9_]*)/gi, expand)
      .replace(/\$\{([A-Z_][A-Z0-9_]*)\}/gi, expand)
      .replace(/\$([A-Z_][A-Z0-9_]*)/gi, expand);
    if (value === '~' || value.startsWith('~/')) {
      const userHome = resolveVariable('HOME', nextSeen);
      if (!userHome) unresolved = true;
      else value = `${userHome}${value.slice(1)}`;
    }
    return unresolved ? null : value;
  };

  const home = resolveVariable('DSH_HOME');
  if (!home) return null;
  if (/^[a-z]:[\\/]/i.test(home) || /^\\\\[^\\]+\\[^\\]+/.test(home)) {
    return win32.normalize(home.replaceAll('/', '\\'));
  }
  return home.startsWith('/') ? posix.normalize(home) : null;
}
