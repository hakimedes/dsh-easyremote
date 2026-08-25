import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { createBackup, restoreBackup } from './maintenance.js';
import { createRuntimePaths } from './runtime.js';

describe('backup and restore', () => {
  it('creates a consistent SQLite backup with non-secret installation metadata', async () => {
    const paths = createRuntimePaths(mkdtempSync(join(tmpdir(), 'easyremote-maintenance-')));
    mkdirSync(paths.dataDir, { recursive: true });
    const db = new DatabaseSync(paths.database);
    db.exec('CREATE TABLE example(value TEXT); INSERT INTO example VALUES (\'whale\')');
    db.close();
    writeFileSync(paths.installState, '{"schemaVersion":1}\n');
    const backup = await createBackup(paths, join(paths.backupsDir, 'test-backup'));
    expect(existsSync(join(backup, 'hub.sqlite'))).toBe(true);
    expect(readFileSync(join(backup, 'install.json'), 'utf8')).toContain('schemaVersion');
    expect(existsSync(join(backup, 'jwt-secret'))).toBe(false);
  });

  it('restores data only while the local service is stopped', async () => {
    const paths = createRuntimePaths(mkdtempSync(join(tmpdir(), 'easyremote-maintenance-')));
    const source = join(paths.backupsDir, 'source');
    const sourcePaths = createRuntimePaths(source);
    mkdirSync(sourcePaths.dataDir, { recursive: true });
    const db = new DatabaseSync(sourcePaths.database);
    db.exec('CREATE TABLE restored(value TEXT)');
    db.close();
    writeFileSync(sourcePaths.installState, '{"schemaVersion":1}\n');
    await expect(restoreBackup(paths, source, { isRunning: () => true })).rejects.toThrow(/stop/i);
    await restoreBackup(paths, source, { isRunning: () => false });
    expect(existsSync(paths.database)).toBe(true);
  });
});
