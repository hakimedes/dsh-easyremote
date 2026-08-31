import type { ApiClient } from '../api/client';

function stableKey(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function root(cacheDirectory: string | null) {
  if (!cacheDirectory) throw new Error('Attachment cache is unavailable');
  return `${cacheDirectory}dsh-easyremote-attachments/`;
}

export async function cachedAttachment(input: {
  api: ApiClient;
  hubId: string;
  nodeId: string;
  sessionId: string;
  attachmentId: string;
  mediaType: string;
}) {
  const FileSystem = await import('expo-file-system');
  const directory = `${root(FileSystem.cacheDirectory)}${stableKey(input.hubId)}/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const extension = input.mediaType === 'image/png' ? 'png'
    : input.mediaType === 'image/gif' ? 'gif'
      : input.mediaType === 'image/webp' ? 'webp' : 'jpg';
  const target = `${directory}${stableKey(input.attachmentId)}.${extension}`;
  const existing = await FileSystem.getInfoAsync(target);
  if (existing.exists && !existing.isDirectory) return target;
  const temporary = `${target}.download`;
  try {
    const result = await FileSystem.downloadAsync(
      input.api.attachmentUrl(input.nodeId, input.sessionId, input.attachmentId),
      temporary,
      { headers: input.api.authorizationHeaders() },
    );
    if (result.status !== 200) throw new Error(`Attachment download failed (${result.status})`);
    await FileSystem.moveAsync({ from: temporary, to: target });
    return target;
  } catch (error) {
    await FileSystem.deleteAsync(temporary, { idempotent: true }).catch(() => undefined);
    throw error;
  }
}

export async function clearAttachmentCache() {
  const FileSystem = await import('expo-file-system');
  await FileSystem.deleteAsync(root(FileSystem.cacheDirectory), { idempotent: true }).catch(() => undefined);
}
