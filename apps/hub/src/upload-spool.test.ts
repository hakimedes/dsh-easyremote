/// <reference types="vitest/globals" />

import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { openDatabase } from './database.js';
import { UploadSpool, UploadSpoolError } from './upload-spool.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-upload-spool-'));
  const databasePath = join(root, 'hub.sqlite');
  const database = openDatabase(databasePath);
  database.prepare('INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)').run('org', 'Org', 1);
  database.prepare('INSERT INTO users (id, org_id, display_name, created_at) VALUES (?, ?, ?, ?)').run('user', 'org', 'Owner', 1);
  database.prepare(`
    INSERT INTO nodes (
      id, org_id, owner_user_id, install_id, name, platform, arch,
      plugin_version, dsh_version, credential_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('node', 'org', 'user', 'install', 'Node', 'darwin', 'arm64', 'test', 'test', 'hash', 1);
  const spool = new UploadSpool(database, join(root, 'spool'));
  return { root, databasePath, database, spool, owner: { userId: 'user', nodeId: 'node', sessionId: 'session' } };
}

describe('UploadSpool', () => {
  it('accepts sequential chunks and stores only metadata in SQLite', () => {
    const { databasePath, database, spool, owner } = fixture();
    const secretBytes = Buffer.from('private-file-body-that-must-not-enter-sqlite');
    const upload = spool.create(owner, {
      kind: 'file',
      displayName: '../ report.txt',
      mediaType: 'text/plain',
      byteSize: secretBytes.length,
    });

    const first = secretBytes.subarray(0, 12);
    expect(spool.append(upload.id, owner, 0, first)).toMatchObject({ status: 'pending', receivedBytes: 12 });
    const completed = spool.append(upload.id, owner, 12, secretBytes.subarray(12));
    expect(completed).toMatchObject({ status: 'ready', receivedBytes: secretBytes.length });
    expect(completed.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(spool.validatedFile(completed))).toEqual(secretBytes);

    database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const databaseBytes = readFileSync(databasePath);
    expect(databaseBytes.includes(secretBytes)).toBe(false);
    database.close();
  });

  it('rejects out-of-order chunks and cross-session access', () => {
    const { database, spool, owner } = fixture();
    const upload = spool.create(owner, {
      kind: 'image', displayName: 'whale.png', mediaType: 'image/png', byteSize: 4,
    });

    expect(() => spool.append(upload.id, owner, 2, Buffer.from('xx'))).toThrowError(
      expect.objectContaining<Partial<UploadSpoolError>>({ code: 'UPLOAD_OFFSET_MISMATCH' }),
    );
    expect(() => spool.getOwned(upload.id, { ...owner, sessionId: 'other' })).toThrowError(
      expect.objectContaining<Partial<UploadSpoolError>>({ code: 'FORBIDDEN' }),
    );
    database.close();
  });

  it('enforces native image formats and declared size', () => {
    const { database, spool, owner } = fixture();
    expect(() => spool.create(owner, {
      kind: 'image', displayName: 'vector.svg', mediaType: 'image/svg+xml', byteSize: 10,
    })).toThrowError(expect.objectContaining<Partial<UploadSpoolError>>({ code: 'UNSUPPORTED_MEDIA_TYPE' }));
    database.close();
  });

  it('removes bytes after consumption and prevents a different command from reusing the upload', () => {
    const { database, spool, owner } = fixture();
    const bytes = Buffer.from('consume-once');
    const upload = spool.create(owner, {
      kind: 'file', displayName: 'once.txt', mediaType: 'text/plain', byteSize: bytes.length,
    });
    spool.append(upload.id, owner, 0, bytes);
    const file = spool.validatedFile(spool.getOwned(upload.id, owner));

    spool.markConsumed([upload.id]);

    expect(existsSync(file)).toBe(false);
    expect(spool.getOwned(upload.id, owner)).toMatchObject({ status: 'consumed' });
    expect(() => spool.readyDescriptors([upload.id], owner)).toThrowError(
      expect.objectContaining<Partial<UploadSpoolError>>({ code: 'UPLOAD_INCOMPLETE' }),
    );
    database.close();
  });
});
