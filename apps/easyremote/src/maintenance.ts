import { backup, DatabaseSync } from 'node:sqlite';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';

import type { RuntimePaths } from './runtime.js';

const SAFE_METADATA = [
  'installState',
  'connectorConfig',
  'publicEntry',
  'setupProgress',
  'namedConfig',
  'cloudflaredManifest',
] as const;

export async function createBackup(paths: RuntimePaths, destination?: string) {
  if (!existsSync(paths.database)) throw new Error('Hub database does not exist');
  const backupDirectory = destination ?? join(paths.backupsDir, new Date().toISOString().replaceAll(':', '-'));
  mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(paths.database, { readOnly: true });
  try {
    await backup(database, join(backupDirectory, 'hub.sqlite'));
  } finally {
    database.close();
  }
  for (const key of SAFE_METADATA) {
    const source = paths[key];
    if (existsSync(source)) copyFileSecure(source, join(backupDirectory, basename(source)));
  }
  writeFileSync(join(backupDirectory, 'backup.json'), `${JSON.stringify({
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    includesSecrets: false,
  }, null, 2)}\n`, { mode: 0o600 });
  return backupDirectory;
}

export async function restoreBackup(
  paths: RuntimePaths,
  source: string,
  options: { isRunning: () => boolean },
) {
  if (options.isRunning()) throw new Error('Stop DSH EasyRemote before restoring a backup');
  const sourcePaths = [join(source, 'hub.sqlite'), join(source, 'data', 'hub.sqlite')];
  const sourceDatabase = sourcePaths.find(existsSync);
  if (!sourceDatabase) throw new Error('Backup does not contain hub.sqlite');
  mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 });
  const temporaryDatabase = `${paths.database}.restore-${process.pid}`;
  copyFileSecure(sourceDatabase, temporaryDatabase);
  renameSync(temporaryDatabase, paths.database);
  if (process.platform !== 'win32') chmodSync(paths.database, 0o600);

  const installState = join(source, 'install.json');
  if (existsSync(installState)) copyFileSecure(installState, paths.installState);
}

function copyFileSecure(source: string, destination: string) {
  copyFileSync(source, destination);
  if (process.platform !== 'win32') chmodSync(destination, 0o600);
}
