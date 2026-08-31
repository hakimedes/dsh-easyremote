import type { ApiClient } from './client';
import type { LocalUpload } from '../domain/types';
import { decodeBase64, UPLOAD_CHUNK_BYTES, validateLocalUploads } from '../domain/upload-limits';

export async function uploadLocalFiles(input: {
  api: ApiClient;
  nodeId: string;
  sessionId: string;
  files: LocalUpload[];
  signal?: AbortSignal;
  onProgress?: (progress: number, file: LocalUpload) => void;
}) {
  validateLocalUploads(input.files);
  const FileSystem = await import('expo-file-system');
  const remoteIds: string[] = [];
  let totalSent = 0;
  const totalBytes = input.files.reduce((sum, file) => sum + file.byteSize, 0);

  try {
    for (const file of input.files) {
      if (input.signal?.aborted) throw input.signal.reason || new Error('Upload cancelled');
      const remote = await input.api.createUpload(input.nodeId, input.sessionId, {
        kind: file.kind,
        displayName: file.displayName,
        mediaType: file.mediaType,
        byteSize: file.byteSize,
      });
      remoteIds.push(remote.id);
      let offset = 0;
      while (offset < file.byteSize) {
        if (input.signal?.aborted) throw input.signal.reason || new Error('Upload cancelled');
        const length = Math.min(UPLOAD_CHUNK_BYTES, file.byteSize - offset);
        const base64 = await FileSystem.readAsStringAsync(file.uri, {
          encoding: FileSystem.EncodingType.Base64,
          position: offset,
          length,
        });
        const bytes = decodeBase64(base64);
        if (bytes.length !== length) throw new Error(`Could not read ${file.displayName}`);
        await input.api.uploadChunk(input.nodeId, input.sessionId, remote.id, offset, bytes);
        offset += bytes.length;
        totalSent += bytes.length;
        input.onProgress?.(totalBytes ? totalSent / totalBytes : 1, file);
      }
    }
    return remoteIds;
  } catch (error) {
    await Promise.allSettled(remoteIds.map((uploadId) => input.api.deleteUpload(input.nodeId, input.sessionId, uploadId)));
    throw error;
  }
}
