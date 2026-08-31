import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export type UploadDescriptor = {
  uploadId: string;
  kind: 'image' | 'file';
  displayName: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
};

export type WorkspaceReference = {
  path: string;
  kind: 'file' | 'dir';
  name?: string;
};

export type PromptPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string; name?: string };

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const EXCLUDED_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'dist', 'build', 'coverage', '.next', '.expo',
  '.turbo', '.cache', '.venv', 'venv', '__pycache__', 'target', 'vendor',
]);

export class MobileContentError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'MobileContentError';
  }
}

function within(root: string, candidate: string) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function safeName(value: string) {
  const result = basename(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!result || result === '.' || result === '..' || result.length > 255) {
    throw new MobileContentError('INVALID_REQUEST', 'Upload name is invalid');
  }
  return result;
}

function hashFile(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function validateSpoolUpload(spoolDir: string, descriptor: UploadDescriptor) {
  if (!/^[0-9a-f-]{36}$/i.test(descriptor.uploadId)) {
    throw new MobileContentError('UPLOAD_INVALID', 'Upload identity is invalid');
  }
  const root = realpathSync(resolve(spoolDir));
  const expected = resolve(root, `${descriptor.uploadId}.part`);
  if (!within(root, expected) || !existsSync(expected)) {
    throw new MobileContentError('UPLOAD_NOT_FOUND', 'Upload spool file is missing');
  }
  const stat = lstatSync(expected);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new MobileContentError('UPLOAD_INVALID', 'Upload spool entry is not a regular file');
  }
  const actual = realpathSync(expected);
  if (!within(root, actual) || stat.size !== descriptor.byteSize) {
    throw new MobileContentError('UPLOAD_INVALID', 'Upload spool metadata does not match the file');
  }
  if (hashFile(actual) !== descriptor.sha256.toLowerCase()) {
    throw new MobileContentError('UPLOAD_INVALID', 'Upload checksum mismatch');
  }
  if (descriptor.kind === 'image' && !IMAGE_TYPES.has(descriptor.mediaType.toLowerCase())) {
    throw new MobileContentError('UNSUPPORTED_MEDIA_TYPE', 'DSH supports PNG, JPEG, WebP and GIF images');
  }
  return actual;
}

function ensureDirectory(path: string, workspaceRoot: string) {
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new MobileContentError('WORKSPACE_PATH_UNSAFE', 'Upload directory is not a regular directory');
    }
    if (!within(workspaceRoot, realpathSync(path))) {
      throw new MobileContentError('WORKSPACE_PATH_UNSAFE', 'Upload directory escapes the workspace');
    }
    return;
  }
  mkdirSync(path, { mode: 0o700 });
}

function availableDestination(directory: string, name: string) {
  const extensionIndex = name.lastIndexOf('.');
  const stem = extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
  const extension = extensionIndex > 0 ? name.slice(extensionIndex) : '';
  for (let index = 0; index < 10_000; index += 1) {
    const candidate = join(directory, index === 0 ? name : `${stem} (${index})${extension}`);
    if (!existsSync(candidate)) return candidate;
  }
  throw new MobileContentError('WORKSPACE_UPLOAD_FAILED', 'Could not choose a unique upload name');
}

export function formatFileMention(path: string) {
  const normalized = path.replaceAll('\\', '/');
  return /\s/.test(normalized) ? `@${JSON.stringify(normalized)}` : `@${normalized}`;
}

export function prepareMobilePrompt(input: {
  spoolDir: string;
  cwd: string;
  sessionId: string;
  content: string;
  references?: Array<{ path: string; kind: 'file' | 'dir' }>;
  uploads?: UploadDescriptor[];
}) {
  const workspaceRoot = realpathSync(resolve(input.cwd));
  const uploadRoot = join(workspaceRoot, '.dsh-easyremote');
  const uploadsRoot = join(uploadRoot, 'uploads');
  const safeSession = input.sessionId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 96) || 'session';
  const sessionRoot = join(uploadsRoot, safeSession);
  const createdFiles: string[] = [];
  const imageParts: PromptPart[] = [];
  const mentions = new Set<string>();

  for (const reference of input.references || []) {
    if (reference.path.trim()) mentions.add(formatFileMention(reference.path.trim()));
  }

  try {
    for (const upload of input.uploads || []) {
      const spoolFile = validateSpoolUpload(input.spoolDir, upload);
      if (upload.kind === 'image') {
        imageParts.push({
          type: 'image',
          mediaType: upload.mediaType.toLowerCase(),
          data: readFileSync(spoolFile).toString('base64'),
          name: safeName(upload.displayName),
        });
        continue;
      }

      ensureDirectory(uploadRoot, workspaceRoot);
      ensureDirectory(uploadsRoot, workspaceRoot);
      ensureDirectory(sessionRoot, workspaceRoot);
      const destination = availableDestination(sessionRoot, safeName(upload.displayName));
      const temporary = join(sessionRoot, `.${basename(destination)}.${randomUUID()}.part`);
      copyFileSync(spoolFile, temporary);
      chmodSync(temporary, 0o600);
      renameSync(temporary, destination);
      createdFiles.push(destination);
      mentions.add(formatFileMention(relative(workspaceRoot, destination)));
    }
  } catch (error) {
    for (const path of createdFiles) rmSync(path, { force: true });
    throw error;
  }

  const text = [input.content.trim(), ...mentions].filter(Boolean).join('\n\n');
  const parts: PromptPart[] = [...(text ? [{ type: 'text' as const, text }] : []), ...imageParts];
  if (parts.length === 0) throw new MobileContentError('INVALID_REQUEST', 'Prompt contains no content');

  return {
    parts,
    workspacePaths: createdFiles.map((path) => relative(workspaceRoot, path).replaceAll('\\', '/')),
    rollback() {
      for (const path of createdFiles) rmSync(path, { force: true });
    },
  };
}

function normalizedQuery(value: string) {
  return value.trim().replace(/^@/, '').replace(/^"/, '').replaceAll('\\', '/').toLowerCase();
}

function scoreCandidate(path: string, query: string) {
  const value = path.toLowerCase();
  if (!query) return 10;
  if (value === query) return 1000;
  if (value.startsWith(query)) return 700 - value.length;
  const leaf = basename(value);
  if (leaf.startsWith(query)) return 600 - value.length;
  const index = value.indexOf(query);
  return index >= 0 ? 300 - index - value.length / 1000 : -1;
}

export function fallbackWorkspaceReferences(cwd: string, rawQuery: string, options: {
  maxEntries?: number;
  maxResults?: number;
} = {}): WorkspaceReference[] {
  const workspaceRoot = realpathSync(resolve(cwd));
  const maxEntries = Math.min(options.maxEntries ?? 50_000, 50_000);
  const maxResults = Math.min(options.maxResults ?? 50, 100);
  const query = normalizedQuery(rawQuery);
  const queue = [workspaceRoot];
  const matches: Array<WorkspaceReference & { score: number }> = [];
  let visited = 0;

  while (queue.length && visited < maxEntries) {
    const directory = queue.shift()!;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (visited >= maxEntries) break;
      visited += 1;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      if (!entry.isDirectory() && !entry.isFile()) continue;
      const absolute = join(directory, entry.name);
      const relativePath = relative(workspaceRoot, absolute).replaceAll('\\', '/');
      const score = scoreCandidate(relativePath, query);
      if (score >= 0) matches.push({ path: relativePath, kind: entry.isDirectory() ? 'dir' : 'file', name: entry.name, score });
      if (entry.isDirectory()) queue.push(absolute);
    }
  }

  return matches
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, maxResults)
    .map(({ score: _score, ...reference }) => reference);
}
