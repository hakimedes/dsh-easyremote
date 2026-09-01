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

function extension(mediaType: string) {
  const normalized = mediaType.split(';', 1)[0]?.trim().toLowerCase();
  return normalized === 'image/svg+xml' ? 'svg'
    : normalized === 'image/png' ? 'png'
      : normalized === 'image/gif' ? 'gif'
        : normalized === 'image/webp' ? 'webp' : 'jpg';
}

async function cachedMedia(input: {
  hubId: string;
  id: string;
  mediaType: string;
  url: string;
  headers: Record<string, string>;
}) {
  const FileSystem = await import('expo-file-system');
  const directory = `${root(FileSystem.cacheDirectory)}${stableKey(input.hubId)}/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const target = `${directory}${stableKey(input.id)}.${extension(input.mediaType)}`;
  const metadata = `${target}.json`;
  const existing = await FileSystem.getInfoAsync(target);
  if (existing.exists && !existing.isDirectory) {
    try {
      const saved = JSON.parse(await FileSystem.readAsStringAsync(metadata)) as { hubId?: string; id?: string; mediaType?: string };
      if (saved.hubId === input.hubId && saved.id === input.id && saved.mediaType === input.mediaType) return target;
    } catch {}
    await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
    await FileSystem.deleteAsync(metadata, { idempotent: true }).catch(() => undefined);
  }
  const temporary = `${target}.download`;
  try {
    const result = await FileSystem.downloadAsync(input.url, temporary, { headers: input.headers });
    if (result.status !== 200) throw new Error(`Media download failed (${result.status})`);
    await FileSystem.moveAsync({ from: temporary, to: target });
    await FileSystem.writeAsStringAsync(metadata, JSON.stringify({ hubId: input.hubId, id: input.id, mediaType: input.mediaType }));
    return target;
  } catch (error) {
    await FileSystem.deleteAsync(temporary, { idempotent: true }).catch(() => undefined);
    throw error;
  }
}

export async function cachedAttachment(input: {
  api: ApiClient;
  hubId: string;
  nodeId: string;
  sessionId: string;
  attachmentId: string;
  mediaType: string;
}) {
  return cachedMedia({
    hubId: input.hubId,
    id: `attachment:${input.attachmentId}`,
    mediaType: input.mediaType,
    url: input.api.attachmentUrl(input.nodeId, input.sessionId, input.attachmentId),
    headers: input.api.authorizationHeaders(),
  });
}

export async function cachedArtifact(input: {
  api: ApiClient;
  hubId: string;
  nodeId: string;
  sessionId: string;
  artifactId: string;
  mediaType: string;
}) {
  return cachedMedia({
    hubId: input.hubId,
    id: `artifact:${input.artifactId}`,
    mediaType: input.mediaType,
    url: input.api.artifactUrl(input.nodeId, input.sessionId, input.artifactId),
    headers: input.api.authorizationHeaders(),
  });
}

export async function clearAttachmentCache() {
  const FileSystem = await import('expo-file-system');
  await FileSystem.deleteAsync(root(FileSystem.cacheDirectory), { idempotent: true }).catch(() => undefined);
}
