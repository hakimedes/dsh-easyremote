import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';

export const SVG_ARTIFACT_BYTES = 1_000_000;
export const RASTER_ARTIFACT_BYTES = 20 * 1024 * 1024;

export type WorkspaceMediaSource = 'tool' | 'markdown';

export type WorkspaceMediaBlock = {
  type: 'workspace-media';
  artifactId: string;
  mediaType: 'image/svg+xml' | 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  bytes: number;
  name: string;
  path: string;
  source: WorkspaceMediaSource;
};

type WorkspaceTarget = { targetKey: unknown; displayPath: string };

export type WorkspaceFileSystem = {
  resolve(path: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<WorkspaceTarget>;
  processPath(target: WorkspaceTarget): string;
  contains(parent: WorkspaceTarget, child: WorkspaceTarget): boolean;
  stat(target: WorkspaceTarget, signal?: AbortSignal): Promise<{ type: 'file' | 'directory' | 'other'; size?: number } | undefined>;
  lstat(path: string, options?: { cwd?: string }, signal?: AbortSignal): Promise<{ type: 'file' | 'directory' | 'symlink' | 'other'; size?: number } | undefined>;
  readBytes(target: WorkspaceTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>;
};

export class WorkspaceMediaError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'WorkspaceMediaError';
  }
}

type LocalTarget = WorkspaceTarget & { targetKey: string };

export class LocalWorkspaceFileSystem implements WorkspaceFileSystem {
  async resolve(path: string, options?: { cwd?: string }) {
    const absolute = resolve(options?.cwd || process.cwd(), path);
    const canonical = realpathSync(absolute);
    return { targetKey: canonical, displayPath: canonical } satisfies LocalTarget;
  }

  processPath(target: WorkspaceTarget) {
    return String(target.targetKey);
  }

  contains(parent: WorkspaceTarget, child: WorkspaceTarget) {
    const root = String(parent.targetKey);
    const candidate = String(child.targetKey);
    return candidate === root || candidate.startsWith(`${root}${sep}`);
  }

  async stat(target: WorkspaceTarget) {
    try {
      const value = statSync(String(target.targetKey));
      return { type: value.isFile() ? 'file' as const : value.isDirectory() ? 'directory' as const : 'other' as const, size: value.size };
    } catch {
      return undefined;
    }
  }

  async lstat(path: string, options?: { cwd?: string }) {
    try {
      const value = lstatSync(resolve(options?.cwd || process.cwd(), path));
      return {
        type: value.isSymbolicLink() ? 'symlink' as const : value.isFile() ? 'file' as const : value.isDirectory() ? 'directory' as const : 'other' as const,
        size: value.size,
      };
    } catch {
      return undefined;
    }
  }

  async readBytes(target: WorkspaceTarget, _signal: AbortSignal | undefined, maxBytes: number) {
    const path = String(target.targetKey);
    const info = statSync(path);
    if (!info.isFile()) throw new WorkspaceMediaError('ARTIFACT_PATH_INVALID', 'Workspace media is not a regular file');
    if (info.size > maxBytes) throw new WorkspaceMediaError('ARTIFACT_TOO_LARGE', 'Workspace media exceeds the preview limit');
    return readFileSync(path);
  }
}

type MediaCandidate = { path: string; source: WorkspaceMediaSource };
type EventLike = { type: string; data: Record<string, unknown> };

const MEDIA_EXTENSION = /\.(?:svg|png|jpe?g|webp|gif)$/i;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parsedArguments(value: unknown) {
  if (record(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return null;
  try { return record(JSON.parse(value)); } catch { return null; }
}

function relativeMediaPath(value: string) {
  const trimmed = value.trim().replace(/^<|>$/g, '');
  if (!trimmed || !MEDIA_EXTENSION.test(trimmed) || isAbsolute(trimmed)) return null;
  const normalized = trimmed.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized.split('/').some((part) => part === '..' || part === '')) return null;
  return normalized;
}

export function markdownWorkspaceMediaPaths(value: string) {
  const paths: string[] = [];
  const pattern = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g;
  for (const match of value.matchAll(pattern)) {
    const candidate = relativeMediaPath(match[1] || match[2] || '');
    if (candidate && !paths.includes(candidate)) paths.push(candidate);
  }
  return paths;
}

function toolResult(value: EventLike) {
  const message = record(value.data.message);
  const block = Array.isArray(message?.content)
    ? message.content.map(record).find((item) => item?.type === 'tool-result')
    : null;
  return {
    callId: typeof block?.toolCallId === 'string' ? block.toolCallId : typeof value.data.callId === 'string' ? value.data.callId : '',
    failed: Boolean(value.data.error || block?.isError),
  };
}

function mutationPresentationPaths(data: Record<string, unknown>) {
  const presentation = record(data.presentation);
  if (!presentation || (presentation.card !== 'diff' && presentation.kind !== 'edit')) return [];
  const values = [
    ...(Array.isArray(presentation.locations) ? presentation.locations : []),
    ...(Array.isArray(presentation.diffs) ? presentation.diffs : []),
  ];
  return values.flatMap((value) => {
    const path = record(value)?.path;
    const normalized = typeof path === 'string' ? relativeMediaPath(path) : null;
    return normalized ? [normalized] : [];
  }).filter((path, index, paths) => paths.indexOf(path) === index);
}

export class WorkspaceMediaTracker {
  private readonly calls = new Map<string, { name: string; arguments: Record<string, unknown> | null; presentedPaths: string[] }>();
  private readonly emittedArtifacts = new Set<string>();

  acceptArtifact(artifactId: string) {
    if (this.emittedArtifacts.has(artifactId)) return false;
    this.emittedArtifacts.add(artifactId);
    return true;
  }

  observe(event: { type: string; data: Record<string, unknown> }) {
    if (event.type !== 'tool/call') return;
    const callId = typeof event.data.callId === 'string' ? event.data.callId : '';
    if (!callId) return;
    this.calls.set(callId, {
      name: typeof event.data.name === 'string' ? event.data.name : '',
      arguments: parsedArguments(event.data.arguments),
      presentedPaths: mutationPresentationPaths(event.data),
    });
  }

  mediaPathsFor(event: EventLike): MediaCandidate[] {
    if (event.type === 'tool/call') {
      this.observe(event);
      return [];
    }
    if (event.type === 'assistant/message') {
      const message = record(event.data.message);
      const content = Array.isArray(message?.content) ? message.content : [];
      const text = content.map(record).filter(Boolean).flatMap((item) => item?.type === 'text' && typeof item.text === 'string' ? [item.text] : []).join('\n');
      return markdownWorkspaceMediaPaths(text).map((path) => ({ path, source: 'markdown' as const }));
    }
    if (event.type !== 'tool/result') return [];
    const result = toolResult(event);
    const call = this.calls.get(result.callId);
    if (result.callId) this.calls.delete(result.callId);
    if (!call || result.failed) return [];
    if (call.presentedPaths.length) return call.presentedPaths.map((path) => ({ path, source: 'tool' as const }));
    const leaf = call.name.toLowerCase().split(/[./:]/).at(-1);
    if (leaf !== 'write' && leaf !== 'edit') return [];
    const rawPath = typeof call.arguments?.file_path === 'string'
      ? call.arguments.file_path
      : typeof call.arguments?.path === 'string' ? call.arguments.path : '';
    const path = relativeMediaPath(rawPath);
    return path ? [{ path, source: 'tool' }] : [];
  }
}

const ACTIVE_SVG = /<\s*(?:script|foreignObject|iframe|object|embed|audio|video|canvas|style|link|meta)\b|\son[a-z][\w:.-]*\s*=|<!\s*(?:DOCTYPE|ENTITY)\b|(?:javascript|vbscript|data\s*:\s*text\/html)\s*:/i;

function safeSvg(bytes: Uint8Array) {
  const xml = Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, '').trim();
  const root = xml.replace(/^<\?xml\s[^?]*\?>\s*/i, '').replace(/^(?:<!--[^]*?-->\s*)+/i, '');
  if (!/^<svg(?:\s|>)/i.test(root) || ACTIVE_SVG.test(xml)) return false;
  for (const match of xml.matchAll(/(?:href|xlink:href)\s*=\s*(["'])(.*?)\1/gis)) {
    if (!match[2]?.trim().startsWith('#')) return false;
  }
  for (const match of xml.matchAll(/url\s*\(\s*(["']?)(.*?)\1\s*\)/gis)) {
    if (!match[2]?.trim().startsWith('#')) return false;
  }
  return true;
}

function detectedMediaType(bytes: Uint8Array): WorkspaceMediaBlock['mediaType'] | null {
  const value = Buffer.from(bytes);
  if (value.length >= 8 && value.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (value.length >= 3 && value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff) return 'image/jpeg';
  if (value.length >= 6 && (value.subarray(0, 6).toString('ascii') === 'GIF87a' || value.subarray(0, 6).toString('ascii') === 'GIF89a')) return 'image/gif';
  if (value.length >= 12 && value.subarray(0, 4).toString('ascii') === 'RIFF' && value.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (safeSvg(value)) return 'image/svg+xml';
  return null;
}

function expectedMediaType(path: string): WorkspaceMediaBlock['mediaType'] | null {
  switch (extname(path).toLowerCase()) {
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    default: return null;
  }
}

type ArtifactPayload = {
  v: 1;
  sessionId: string;
  path: string;
  sha256: string;
  bytes: number;
  mediaType: WorkspaceMediaBlock['mediaType'];
  name: string;
};

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

export class WorkspaceArtifactBridge {
  constructor(private readonly options: { secret: string; fileSystem: WorkspaceFileSystem; spoolDir: string }) {}

  private sign(encoded: string) {
    return createHmac('sha256', this.options.secret).update(encoded).digest('base64url');
  }

  private artifactId(payload: ArtifactPayload) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${encoded}.${this.sign(encoded)}`;
  }

  private payload(artifactId: string) {
    const [encoded, signature, extra] = artifactId.split('.');
    if (!encoded || !signature || extra) throw new WorkspaceMediaError('ARTIFACT_INVALID', 'Workspace artifact id is invalid');
    const expected = Buffer.from(this.sign(encoded));
    const supplied = Buffer.from(signature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new WorkspaceMediaError('ARTIFACT_INVALID', 'Workspace artifact signature is invalid');
    }
    try {
      const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ArtifactPayload;
      if (value.v !== 1 || !value.sessionId || !value.path || !value.sha256 || !value.mediaType) throw new Error('invalid payload');
      return value;
    } catch {
      throw new WorkspaceMediaError('ARTIFACT_INVALID', 'Workspace artifact payload is invalid');
    }
  }

  private async read(cwd: string, path: string) {
    const normalized = relativeMediaPath(path);
    if (!normalized) throw new WorkspaceMediaError('ARTIFACT_PATH_INVALID', 'Workspace media path is invalid');
    const fileSystem = this.options.fileSystem;
    const pathInfo = await fileSystem.lstat(normalized, { cwd });
    if (!pathInfo || pathInfo.type !== 'file') throw new WorkspaceMediaError('ARTIFACT_PATH_INVALID', 'Workspace media must be a regular non-symlink file');
    const [root, target] = await Promise.all([fileSystem.resolve('.', { cwd }), fileSystem.resolve(normalized, { cwd })]);
    if (!fileSystem.contains(root, target)) throw new WorkspaceMediaError('ARTIFACT_PATH_INVALID', 'Workspace media is outside the session workspace');
    const info = await fileSystem.stat(target);
    if (!info || info.type !== 'file') throw new WorkspaceMediaError('ARTIFACT_PATH_INVALID', 'Workspace media is unavailable');
    const expected = expectedMediaType(normalized);
    if (!expected) throw new WorkspaceMediaError('ARTIFACT_MEDIA_INVALID', 'Workspace media type is unsupported');
    const limit = expected === 'image/svg+xml' ? SVG_ARTIFACT_BYTES : RASTER_ARTIFACT_BYTES;
    if (typeof info.size === 'number' && info.size > limit) throw new WorkspaceMediaError('ARTIFACT_TOO_LARGE', 'Workspace media exceeds the preview limit');
    const bytes = await fileSystem.readBytes(target, AbortSignal.timeout(10_000), limit);
    const mediaType = detectedMediaType(bytes);
    if (!mediaType || mediaType !== expected) throw new WorkspaceMediaError('ARTIFACT_MEDIA_INVALID', 'Workspace media content does not match its file type');
    return { normalized, bytes, mediaType };
  }

  async inspect(input: { sessionId: string; cwd: string; path: string; source: WorkspaceMediaSource }): Promise<WorkspaceMediaBlock> {
    const value = await this.read(input.cwd, input.path);
    const payload: ArtifactPayload = {
      v: 1,
      sessionId: input.sessionId,
      path: value.normalized,
      sha256: sha256(value.bytes),
      bytes: value.bytes.length,
      mediaType: value.mediaType,
      name: basename(value.normalized),
    };
    return {
      type: 'workspace-media',
      artifactId: this.artifactId(payload),
      mediaType: payload.mediaType,
      bytes: payload.bytes,
      name: payload.name,
      path: payload.path,
      source: input.source,
    };
  }

  async export(sessionId: string, artifactId: string) {
    const payload = this.payload(artifactId);
    if (payload.sessionId !== sessionId) throw new WorkspaceMediaError('ARTIFACT_FORBIDDEN', 'Workspace artifact belongs to another session');
    const cwd = this.exportCwd?.(sessionId);
    if (!cwd) throw new WorkspaceMediaError('ARTIFACT_UNAVAILABLE', 'Workspace artifact session is unavailable');
    const value = await this.read(cwd, payload.path);
    if (value.bytes.length !== payload.bytes || value.mediaType !== payload.mediaType || sha256(value.bytes) !== payload.sha256) {
      throw new WorkspaceMediaError('ARTIFACT_CHANGED', 'Workspace artifact changed after this message');
    }
    mkdirSync(this.options.spoolDir, { recursive: true, mode: 0o700 });
    const exportToken = randomUUID();
    writeFileSync(resolve(this.options.spoolDir, `${exportToken}.artifact`), value.bytes, { mode: 0o600, flag: 'wx' });
    return {
      exportToken,
      artifact: { mediaType: payload.mediaType, bytes: payload.bytes, name: payload.name },
    };
  }

  private exportCwd?: (sessionId: string) => string | undefined;

  setSessionCwdResolver(resolveCwd: (sessionId: string) => string | undefined) {
    this.exportCwd = resolveCwd;
  }
}

export async function enrichWorkspaceMediaEvent(input: {
  tracker: WorkspaceMediaTracker;
  bridge: WorkspaceArtifactBridge;
  sessionId: string;
  cwd: string;
  source: { type: string; data: Record<string, unknown> };
  canonical: { sourceSeq: number; createdAt: number; event: { type: string; data: Record<string, unknown> } };
}) {
  const candidates = input.tracker.mediaPathsFor(input.source);
  if (!candidates.length) return input.canonical;
  const existing = Array.isArray(input.canonical.event.data.blocks)
    ? input.canonical.event.data.blocks.filter(record)
    : [];
  const blocks = [...existing];
  const suppressedPaths = Array.isArray(input.canonical.event.data.suppressedWorkspaceMediaPaths)
    ? input.canonical.event.data.suppressedWorkspaceMediaPaths.filter((value): value is string => typeof value === 'string')
    : [];
  for (const candidate of candidates) {
    try {
      const block = await input.bridge.inspect({
        sessionId: input.sessionId,
        cwd: input.cwd,
        path: candidate.path,
        source: candidate.source,
      });
      if (input.tracker.acceptArtifact(block.artifactId)) {
        if (!blocks.some((item) => item.type === 'workspace-media' && item.artifactId === block.artifactId)) blocks.push(block);
      } else if (candidate.source === 'markdown' && !suppressedPaths.includes(block.path)) {
        suppressedPaths.push(block.path);
      }
    } catch (error) {
      if (!(error instanceof WorkspaceMediaError)) throw error;
    }
  }
  return blocks.length === existing.length && suppressedPaths.length === 0
    ? input.canonical
    : {
      ...input.canonical,
      event: {
        ...input.canonical.event,
        data: {
          ...input.canonical.event.data,
          ...(blocks.length !== existing.length ? { blocks } : {}),
          ...(suppressedPaths.length ? { suppressedWorkspaceMediaPaths: suppressedPaths } : {}),
        },
      },
    };
}
