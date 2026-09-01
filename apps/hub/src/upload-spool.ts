import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { v7 as uuidv7 } from 'uuid';

export const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
export const IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024;
export const FILE_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MESSAGE_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MESSAGE_IMAGE_BYTES = 60 * 1024 * 1024;
export const MESSAGE_UPLOAD_COUNT = 10;
export const UPLOAD_TTL_MS = 30 * 60 * 1000;

export type UploadKind = 'image' | 'file';

export type UploadOwner = {
  userId: string;
  nodeId: string;
  sessionId: string;
};

export type UploadRecord = UploadOwner & {
  id: string;
  kind: UploadKind;
  displayName: string;
  mediaType: string;
  byteSize: number;
  receivedBytes: number;
  sha256?: string;
  status: 'pending' | 'ready' | 'consumed';
  createdAt: number;
  expiresAt: number;
  consumedAt?: number;
};

type UploadRow = {
  id: string;
  user_id: string;
  node_id: string;
  session_id: string;
  kind: UploadKind;
  display_name: string;
  media_type: string;
  byte_size: number;
  received_bytes: number;
  sha256: string | null;
  status: UploadRecord['status'];
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
};

export class UploadSpoolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'UploadSpoolError';
  }
}

function fromRow(row: UploadRow): UploadRecord {
  return {
    id: row.id,
    userId: row.user_id,
    nodeId: row.node_id,
    sessionId: row.session_id,
    kind: row.kind,
    displayName: row.display_name,
    mediaType: row.media_type,
    byteSize: Number(row.byte_size),
    receivedBytes: Number(row.received_bytes),
    ...(row.sha256 ? { sha256: row.sha256 } : {}),
    status: row.status,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    ...(row.consumed_at ? { consumedAt: Number(row.consumed_at) } : {}),
  };
}

export function safeUploadName(value: string) {
  const stripped = basename(value.trim()).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!stripped || stripped === '.' || stripped === '..' || stripped.length > 255) {
    throw new UploadSpoolError('INVALID_REQUEST', 'Upload name is invalid');
  }
  return stripped;
}

export function assertUploadMedia(kind: UploadKind, mediaType: string, byteSize: number) {
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0) {
    throw new UploadSpoolError('INVALID_REQUEST', 'Upload size must be a positive integer');
  }
  const normalized = mediaType.trim().toLowerCase() || 'application/octet-stream';
  if (kind === 'image') {
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(normalized)) {
      throw new UploadSpoolError('UNSUPPORTED_MEDIA_TYPE', 'Only PNG, JPEG, WebP and GIF images are supported');
    }
    if (byteSize > IMAGE_UPLOAD_BYTES) {
      throw new UploadSpoolError('UPLOAD_TOO_LARGE', 'Image exceeds the 20 MiB limit');
    }
  } else if (byteSize > FILE_UPLOAD_BYTES) {
    throw new UploadSpoolError('UPLOAD_TOO_LARGE', 'File exceeds the 50 MiB limit');
  }
  return normalized;
}

export class UploadSpool {
  readonly root: string;

  constructor(private readonly database: DatabaseSync, root: string) {
    const requestedRoot = resolve(root);
    mkdirSync(requestedRoot, { recursive: true, mode: 0o700 });
    this.root = realpathSync(requestedRoot);
    chmodSync(this.root, 0o700);
  }

  private filePath(uploadId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(uploadId)) {
      throw new UploadSpoolError('UPLOAD_NOT_FOUND', 'Upload not found');
    }
    const candidate = resolve(this.root, `${uploadId}.part`);
    if (!candidate.startsWith(`${this.root}${sep}`)) {
      throw new UploadSpoolError('UPLOAD_NOT_FOUND', 'Upload not found');
    }
    return candidate;
  }

  create(owner: UploadOwner, input: { kind: UploadKind; displayName: string; mediaType: string; byteSize: number }) {
    const now = Date.now();
    const id = uuidv7();
    const displayName = safeUploadName(input.displayName);
    const mediaType = assertUploadMedia(input.kind, input.mediaType, input.byteSize);
    const file = this.filePath(id);
    const descriptor = openSync(file, 'wx', 0o600);
    closeSync(descriptor);
    this.database.prepare(`
      INSERT INTO uploads (
        id, user_id, node_id, session_id, kind, display_name, media_type,
        byte_size, received_bytes, status, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?)
    `).run(
      id,
      owner.userId,
      owner.nodeId,
      owner.sessionId,
      input.kind,
      displayName,
      mediaType,
      input.byteSize,
      now,
      now + UPLOAD_TTL_MS,
    );
    return this.getOwned(id, owner);
  }

  get(id: string) {
    const row = this.database.prepare('SELECT * FROM uploads WHERE id = ?').get(id) as UploadRow | undefined;
    return row ? fromRow(row) : null;
  }

  getOwned(id: string, owner: UploadOwner) {
    const record = this.get(id);
    if (!record) throw new UploadSpoolError('UPLOAD_NOT_FOUND', 'Upload not found');
    if (record.userId !== owner.userId || record.nodeId !== owner.nodeId || record.sessionId !== owner.sessionId) {
      throw new UploadSpoolError('FORBIDDEN', 'Upload belongs to another session');
    }
    if (record.expiresAt <= Date.now()) {
      this.remove(id);
      throw new UploadSpoolError('UPLOAD_EXPIRED', 'Upload expired');
    }
    return record;
  }

  append(id: string, owner: UploadOwner, offset: number, bytes: Buffer) {
    const record = this.getOwned(id, owner);
    if (record.status !== 'pending') {
      throw new UploadSpoolError('UPLOAD_COMPLETE', 'Upload is already complete');
    }
    if (!Number.isSafeInteger(offset) || offset !== record.receivedBytes) {
      throw new UploadSpoolError('UPLOAD_OFFSET_MISMATCH', `Expected offset ${record.receivedBytes}`);
    }
    if (bytes.length <= 0 || bytes.length > UPLOAD_CHUNK_BYTES) {
      throw new UploadSpoolError('INVALID_REQUEST', 'Chunk must contain between 1 byte and 4 MiB');
    }
    if (offset + bytes.length > record.byteSize) {
      throw new UploadSpoolError('UPLOAD_TOO_LARGE', 'Chunk exceeds declared upload size');
    }

    const file = this.filePath(id);
    const descriptor = openSync(file, 'r+');
    try {
      writeSync(descriptor, bytes, 0, bytes.length, offset);
    } finally {
      closeSync(descriptor);
    }
    const receivedBytes = offset + bytes.length;
    if (receivedBytes === record.byteSize) {
      const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
      this.database.prepare(`
        UPDATE uploads SET received_bytes = ?, sha256 = ?, status = 'ready' WHERE id = ?
      `).run(receivedBytes, sha256, id);
    } else {
      this.database.prepare('UPDATE uploads SET received_bytes = ? WHERE id = ?').run(receivedBytes, id);
    }
    return this.getOwned(id, owner);
  }

  readyDescriptors(ids: string[], owner: UploadOwner) {
    const records = ids.map((id) => this.getOwned(id, owner));
    if (records.length > MESSAGE_UPLOAD_COUNT) {
      throw new UploadSpoolError('UPLOAD_LIMIT_EXCEEDED', 'A message can include at most 10 uploads');
    }
    if (records.some((record) => record.status !== 'ready')) {
      throw new UploadSpoolError('UPLOAD_INCOMPLETE', 'All uploads must finish before sending');
    }
    const total = records.reduce((sum, record) => sum + record.byteSize, 0);
    const images = records.filter((record) => record.kind === 'image').reduce((sum, record) => sum + record.byteSize, 0);
    if (total > MESSAGE_UPLOAD_BYTES || images > MESSAGE_IMAGE_BYTES) {
      throw new UploadSpoolError('UPLOAD_LIMIT_EXCEEDED', 'Message upload limits exceeded');
    }
    return records.map((record) => ({
      uploadId: record.id,
      kind: record.kind,
      displayName: record.displayName,
      mediaType: record.mediaType,
      byteSize: record.byteSize,
      sha256: record.sha256!,
    }));
  }

  markConsumed(ids: string[]) {
    const now = Date.now();
    const update = this.database.prepare("UPDATE uploads SET status = 'consumed', consumed_at = ? WHERE id = ?");
    for (const id of ids) {
      update.run(now, id);
      try {
        const file = this.filePath(id);
        if (existsSync(file)) rmSync(file, { force: true });
      } catch {
        // The metadata remains consumed so periodic cleanup can retry without
        // turning an already accepted DSH prompt into a client-visible failure.
      }
    }
  }

  remove(id: string) {
    const file = this.filePath(id);
    if (existsSync(file)) rmSync(file, { force: true });
    this.database.prepare('DELETE FROM uploads WHERE id = ?').run(id);
  }

  cleanupExpired(now = Date.now()) {
    const rows = this.database.prepare('SELECT id FROM uploads WHERE expires_at <= ? OR consumed_at IS NOT NULL').all(now) as Array<{ id: string }>;
    for (const row of rows) this.remove(row.id);
    return rows.length;
  }

  validatedFile(record: UploadRecord) {
    const file = this.filePath(record.id);
    const stat = statSync(file);
    if (!stat.isFile() || stat.size !== record.byteSize) {
      throw new UploadSpoolError('UPLOAD_INVALID', 'Spool file does not match upload metadata');
    }
    return file;
  }

  attachmentPath(token: string) {
    if (!/^[0-9a-f-]{36}$/i.test(token)) throw new UploadSpoolError('ATTACHMENT_NOT_FOUND', 'Attachment export not found');
    return join(this.root, `${token}.attachment`);
  }

  validatedAttachment(token: string) {
    const path = this.attachmentPath(token);
    if (!existsSync(path)) throw new UploadSpoolError('ATTACHMENT_NOT_FOUND', 'Attachment export not found');
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || !realpathSync(path).startsWith(`${this.root}${sep}`)) {
      throw new UploadSpoolError('ATTACHMENT_NOT_FOUND', 'Attachment export is invalid');
    }
    return { path, bytes: stat.size };
  }

  removeAttachment(token: string) {
    const path = this.attachmentPath(token);
    if (existsSync(path)) rmSync(path, { force: true });
  }

  artifactPath(token: string) {
    if (!/^[0-9a-f-]{36}$/i.test(token)) throw new UploadSpoolError('ARTIFACT_NOT_FOUND', 'Artifact export not found');
    return join(this.root, `${token}.artifact`);
  }

  validatedArtifact(token: string) {
    const path = this.artifactPath(token);
    if (!existsSync(path)) throw new UploadSpoolError('ARTIFACT_NOT_FOUND', 'Artifact export not found');
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || !realpathSync(path).startsWith(`${this.root}${sep}`)) {
      throw new UploadSpoolError('ARTIFACT_NOT_FOUND', 'Artifact export is invalid');
    }
    return { path, bytes: stat.size };
  }

  removeArtifact(token: string) {
    const path = this.artifactPath(token);
    if (existsSync(path)) rmSync(path, { force: true });
  }
}
