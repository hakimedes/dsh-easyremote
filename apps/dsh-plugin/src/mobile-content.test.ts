import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  fallbackWorkspaceReferences,
  formatFileMention,
  MobileContentError,
  prepareMobilePrompt,
  validateSpoolUpload,
} from './mobile-content.js';

function sha256(value: Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function fixture(kind: 'image' | 'file' = 'file') {
  const root = mkdtempSync(join(tmpdir(), 'dsh-mobile-content-'));
  const spoolDir = join(root, 'spool');
  const cwd = join(root, 'workspace');
  mkdirSync(spoolDir);
  mkdirSync(cwd);
  const uploadId = '018f47e2-7c42-7abc-8def-123456789abc';
  const bytes = Buffer.from(kind === 'image' ? 'fake-png-for-contract-test' : 'report-body');
  writeFileSync(join(spoolDir, `${uploadId}.part`), bytes, { mode: 0o600 });
  return {
    root, spoolDir, cwd, bytes,
    descriptor: {
      uploadId,
      kind,
      displayName: kind === 'image' ? 'whale.png' : 'quarterly report.txt',
      mediaType: kind === 'image' ? 'image/png' : 'text/plain',
      byteSize: bytes.length,
      sha256: sha256(bytes),
    } as const,
  };
}

describe('mobile content preparation', () => {
  it('copies ordinary files atomically and inserts quoted @ references', () => {
    const value = fixture('file');
    const prepared = prepareMobilePrompt({
      spoolDir: value.spoolDir,
      cwd: value.cwd,
      sessionId: 'session/unsafe',
      content: 'Summarize this',
      uploads: [value.descriptor],
    });
    expect(prepared.parts).toEqual([{ type: 'text', text: expect.stringContaining('@".dsh-easyremote/uploads/session_unsafe/quarterly report.txt"') }]);
    expect(readFileSync(join(value.cwd, prepared.workspacePaths[0]!))).toEqual(value.bytes);
  });

  it('keeps images as native prompt parts instead of workspace files', () => {
    const value = fixture('image');
    const prepared = prepareMobilePrompt({
      spoolDir: value.spoolDir,
      cwd: value.cwd,
      sessionId: 'session-1',
      content: 'Describe this',
      uploads: [value.descriptor],
    });
    expect(prepared.parts).toEqual([
      { type: 'text', text: 'Describe this' },
      { type: 'image', mediaType: 'image/png', data: value.bytes.toString('base64'), name: 'whale.png' },
    ]);
    expect(prepared.workspacePaths).toEqual([]);
  });

  it('rejects symlinked spool entries and checksum mismatches', () => {
    const value = fixture('file');
    const otherId = '018f47e2-7c42-7abc-8def-abcdefabcdef';
    symlinkSync(join(value.spoolDir, `${value.descriptor.uploadId}.part`), join(value.spoolDir, `${otherId}.part`));
    expect(() => validateSpoolUpload(value.spoolDir, { ...value.descriptor, uploadId: otherId })).toThrowError(
      expect.objectContaining<Partial<MobileContentError>>({ code: 'UPLOAD_INVALID' }),
    );
    expect(() => validateSpoolUpload(value.spoolDir, { ...value.descriptor, sha256: '0'.repeat(64) })).toThrowError(
      expect.objectContaining<Partial<MobileContentError>>({ code: 'UPLOAD_INVALID' }),
    );
  });

  it('indexes paths only, skips generated directories and never follows symlinks', () => {
    const value = fixture('file');
    mkdirSync(join(value.cwd, 'src'));
    mkdirSync(join(value.cwd, 'node_modules'));
    writeFileSync(join(value.cwd, 'src', 'main.ts'), 'secret-source');
    writeFileSync(join(value.cwd, 'node_modules', 'hidden.ts'), 'hidden');
    symlinkSync(join(value.cwd, 'src'), join(value.cwd, 'linked-src'));
    expect(fallbackWorkspaceReferences(value.cwd, 'main')).toEqual([
      { path: 'src/main.ts', kind: 'file', name: 'main.ts' },
    ]);
  });

  it('quotes file mentions containing spaces', () => {
    expect(formatFileMention('docs/my file.md')).toBe('@"docs/my file.md"');
    expect(formatFileMention('src/main.ts')).toBe('@src/main.ts');
  });
});
