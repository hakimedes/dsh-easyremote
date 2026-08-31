import { describe, expect, it } from 'vitest';
import { decodeBase64, validateLocalUploads } from './upload-limits';

describe('Mobile upload limits', () => {
  it('decodes chunk base64 without relying on a browser global', () => {
    expect([...decodeBase64('aGVsbG8=')]).toEqual([104, 101, 108, 108, 111]);
  });

  it('rejects oversized files before starting a remote upload', () => {
    expect(() => validateLocalUploads([{
      localId: 'large', uri: 'file://large', kind: 'file', displayName: 'large.zip',
      mediaType: 'application/zip', byteSize: 50 * 1024 * 1024 + 1,
    }])).toThrow('50 MiB');
  });
});
