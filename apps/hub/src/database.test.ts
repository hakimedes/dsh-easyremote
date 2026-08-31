/// <reference types="vitest/globals" />

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { getOrCreateHubId, openDatabase } from './database.js';

describe('Hub database migrations', () => {
  it('keeps an existing SQLite file compatible and removes historical chat-bearing results', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'dsh-easyremote-db-')), 'hub.sqlite');
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE commands (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        session_id TEXT,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        acked_at INTEGER,
        error_code TEXT,
        result_json TEXT,
        UNIQUE(user_id, request_id)
      );
    `);
    legacy.prepare(`
      INSERT INTO commands (
        id, request_id, user_id, device_id, node_id, action, status, created_at, expires_at, result_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'legacy-command',
      'legacy-request',
      'legacy-user',
      'legacy-device',
      'legacy-node',
      'session.snapshot',
      'completed',
      1,
      2,
      JSON.stringify({ result: { events: [{ data: { text: 'must be removed' } }] } }),
    );
    legacy.close();

    const migrated = openDatabase(path);
    const versions = migrated
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>;
    const command = migrated
      .prepare("SELECT result_json FROM commands WHERE id = 'legacy-command'")
      .get() as { result_json: string | null };
    const firstHubId = getOrCreateHubId(migrated);
    migrated.close();

    const reopened = openDatabase(path);
    const secondHubId = getOrCreateHubId(reopened);
    reopened.close();

    expect(versions.map(({ version }) => Number(version))).toEqual([1, 2, 3, 4, 5]);
    expect(command.result_json).toBeNull();
    expect(secondHubId).toBe(firstHubId);
  });
});
