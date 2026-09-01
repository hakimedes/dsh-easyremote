function normalizedPath(value: string) {
  const path = value.trim().replaceAll('\\', '/').replace(/^\.\//, '');
  try { return decodeURIComponent(path); } catch { return path; }
}

export function withoutWorkspaceMediaMarkdown(value: string, paths: string[]) {
  const hidden = new Set(paths.map(normalizedPath));
  if (!hidden.size) return value;
  return value
    .replace(/^[ \t]*!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)[ \t]*(?:\r?\n)?/gm, (match, anglePath: string | undefined, plainPath: string | undefined) => (
      hidden.has(normalizedPath(anglePath || plainPath || '')) ? '' : match
    ))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
