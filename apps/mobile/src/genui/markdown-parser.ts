import { safeExternalUrl } from './protocol';

export type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; language?: string; code: string }
  | { type: 'table'; columns: string[]; rows: string[][] }
  | { type: 'image'; alt: string; url: string };

export type InlinePart =
  | { type: 'text'; text: string; bold?: boolean; code?: boolean }
  | { type: 'link'; label: string; url: string };

const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function cells(line: string) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

export function parseMarkdown(value: string): MarkdownBlock[] {
  const lines = value.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.trim()) { index += 1; continue; }
    const fence = line.match(/^```([\w+-]*)\s*$/);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index]!)) body.push(lines[index++]!);
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', ...(fence[1] ? { language: fence[1] } : {}), code: body.join('\n').slice(0, 12_000) });
      continue;
    }
    const image = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    const imageUrl = image && safeExternalUrl(image[2]);
    if (image && imageUrl?.startsWith('https://')) {
      blocks.push({ type: 'image', alt: image[1].slice(0, 500), url: imageUrl });
      index += 1;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].slice(0, 2_000) });
      index += 1;
      continue;
    }
    if (index + 1 < lines.length && line.includes('|') && TABLE_RULE.test(lines[index + 1]!)) {
      const columns = cells(line).slice(0, 12);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index]!.includes('|') && lines[index]!.trim()) {
        rows.push(cells(lines[index]!).slice(0, columns.length).map((cell) => cell.slice(0, 256)));
        index += 1;
        if (rows.length >= 50) break;
      }
      blocks.push({ type: 'table', columns, rows });
      continue;
    }
    const listMatch = line.match(/^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = Boolean(listMatch[2]);
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index]!.match(/^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/);
        if (!match || Boolean(match[2]) !== ordered) break;
        items.push(match[3].slice(0, 2_000));
        index += 1;
        if (items.length >= 50) break;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index]!.trim()) {
      const next = lines[index]!;
      if (/^(?:#{1,3}\s|```|\s*(?:[-*+]|\d+\.)\s+)/.test(next)) break;
      if (next.includes('|') && index + 1 < lines.length && TABLE_RULE.test(lines[index + 1]!)) break;
      paragraph.push(next.trim());
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraph.join('\n').slice(0, 12_000) });
  }
  return blocks;
}

export function parseInline(value: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const at = match.index || 0;
    if (at > cursor) parts.push({ type: 'text', text: value.slice(cursor, at) });
    const token = match[0];
    if (token.startsWith('**')) parts.push({ type: 'text', text: token.slice(2, -2), bold: true });
    else if (token.startsWith('`')) parts.push({ type: 'text', text: token.slice(1, -1), code: true });
    else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const url = link && safeExternalUrl(link[2]);
      if (link && url) parts.push({ type: 'link', label: link[1], url });
      else parts.push({ type: 'text', text: token });
    }
    cursor = at + token.length;
  }
  if (cursor < value.length) parts.push({ type: 'text', text: value.slice(cursor) });
  return parts.reduce<InlinePart[]>((result, part) => {
    const previous = result.at(-1);
    if (part.type === 'text' && previous?.type === 'text' && !part.bold && !part.code && !previous.bold && !previous.code) {
      previous.text += part.text;
    } else result.push(part);
    return result;
  }, []);
}
