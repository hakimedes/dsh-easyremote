/*
 * DSH EasyRemote's mobile dsh-ui compatibility layer.
 *
 * The bounded partial-JSON strategy and protocol vocabulary are derived from
 * dsh-genui v0.9.6 (commit 6298f8c), MIT licensed by dsh-external. This is a
 * React Native-specific, security-reduced implementation: unknown components,
 * raw HTML, functions and executable chart options are never accepted.
 */

export const GENUI_LIMITS = {
  maxDepth: 8,
  maxNodes: 200,
  maxString: 2_000,
  maxCode: 12_000,
  maxTableRows: 50,
  maxTableCols: 12,
  maxChartPoints: 60,
  maxOptions: 50,
  maxArray: 500,
  maxOptionDepth: 10,
  maxOptionNodes: 2_000,
} as const;

export type GenuiNode = { type: string; [key: string]: unknown };

export type GenuiSpec = {
  title?: string;
  gap?: number;
  panel?: boolean;
  append?: boolean;
  items: GenuiNode[];
};

export type RichSegment =
  | { type: 'markdown'; text: string }
  | { type: 'genui'; spec: GenuiSpec; fenceIndex: number; partial: boolean; raw: string }
  | { type: 'diagnostic'; raw: string; fenceIndex: number; reason: string };

const KNOWN_TYPES = new Set([
  'text', 'row', 'col', 'grid', 'card', 'button', 'input', 'textarea', 'select',
  'radio', 'checkbox', 'switch', 'slider', 'submit', 'link', 'image', 'badge',
  'stat', 'progress', 'divider', 'avatar', 'spacer', 'list', 'table', 'chart',
  'tabs', 'accordion', 'callout', 'steps', 'keyvalue', 'diff', 'json', 'code',
  'copy', 'mermaid', 'scene3d', 'diagram', 'timeline', 'file-tree', 'breadcrumb',
  'quiz', 'echart',
]);

const CONTAINERS = new Set(['row', 'col', 'grid', 'card']);
const PROTOTYPE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const SAFE_COLOR = /^(?:#[\da-f]{3,8}|rgba?\([^)]{0,64}\)|hsla?\([^)]{0,64}\))$/i;
const SAFE_ACTION = /^[\w.:-]{1,200}$/;
const SENSITIVE_FIELD = /(?:password|passcode|secret|token|api[\s_-]?key|credential)/i;
const ECHART_ROOT_KEYS = new Set([
  'animation', 'animationDuration', 'animationEasing', 'aria', 'backgroundColor',
  'color', 'dataZoom', 'dataset', 'grid', 'legend', 'polar', 'radar', 'radiusAxis',
  'angleAxis', 'series', 'textStyle', 'title', 'toolbox', 'tooltip', 'visualMap',
  'xAxis', 'yAxis',
]);

function object(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown, cap: number = GENUI_LIMITS.maxString) {
  return typeof value === 'string' ? value.slice(0, cap) : undefined;
}

function finite(value: unknown, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : undefined;
}

function integer(value: unknown, min: number, max: number) {
  const result = finite(value, min, max);
  return result === undefined ? undefined : Math.trunc(result);
}

function enumValue<T extends string>(value: unknown, values: readonly T[]) {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? value as T : undefined;
}

function safeColor(value: unknown) {
  const result = text(value, 64)?.trim();
  return result && SAFE_COLOR.test(result) ? result : undefined;
}

export function safeExternalUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2_048) return undefined;
  const result = value.trim();
  return /^https:\/\//i.test(result) || /^mailto:[^@\s]+@[^@\s]+$/i.test(result) ? result : undefined;
}

function strings(value: unknown, cap: number = GENUI_LIMITS.maxOptions) {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, cap).flatMap((item) => {
    if (typeof item === 'string') return [item.slice(0, GENUI_LIMITS.maxString)];
    const source = object(item);
    const label = source && (text(source.label) || text(source.value) || text(source.title));
    return label ? [label] : [];
  });
}

function sanitizeJson(value: unknown, depth = 0, budget = { value: 1_000 }): unknown {
  if (budget.value-- <= 0 || depth > 8) return undefined;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.slice(0, GENUI_LIMITS.maxCode);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeJson(item, depth + 1, budget)).filter((item) => item !== undefined);
  const source = object(value);
  if (!source) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source).slice(0, 100)) {
    if (PROTOTYPE_KEYS.has(key)) continue;
    const safe = sanitizeJson(item, depth + 1, budget);
    if (safe !== undefined) result[key.slice(0, 128)] = safe;
  }
  return result;
}

function sanitizeEChartOption(value: unknown) {
  const remaining = { value: GENUI_LIMITS.maxOptionNodes };
  function walk(input: unknown, depth: number): unknown {
    if (remaining.value-- <= 0 || depth > GENUI_LIMITS.maxOptionDepth) return undefined;
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'number') return Number.isFinite(input) ? input : undefined;
    if (typeof input === 'string') {
      if (/^(?:javascript|data|file):/i.test(input.trim()) || /url\s*\(/i.test(input)) return undefined;
      return input.slice(0, GENUI_LIMITS.maxString);
    }
    if (Array.isArray(input)) return input.slice(0, GENUI_LIMITS.maxArray).map((item) => walk(item, depth + 1)).filter((item) => item !== undefined);
    const source = object(input);
    if (!source) return undefined;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(source)) {
      if (PROTOTYPE_KEYS.has(key) || /^on/i.test(key) || /formatter|renderItem|transform|graphic/i.test(key)) continue;
      const safe = walk(item, depth + 1);
      if (safe !== undefined) result[key.slice(0, 128)] = safe;
    }
    return result;
  }
  const root = object(value);
  if (!root) return undefined;
  const safeRoot: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(root)) {
    if (!ECHART_ROOT_KEYS.has(key)) continue;
    const safe = walk(item, 1);
    if (safe !== undefined) safeRoot[key] = safe;
  }
  return Object.keys(safeRoot).length ? safeRoot : undefined;
}

type GuardContext = { remaining: number };

function sanitizeItems(value: unknown, context: GuardContext, depth: number): GenuiNode[] {
  if (!Array.isArray(value) || depth > GENUI_LIMITS.maxDepth) return [];
  const result: GenuiNode[] = [];
  for (const item of value) {
    if (context.remaining <= 0) break;
    context.remaining -= 1;
    const safe = sanitizeNode(item, context, depth);
    if (safe) result.push(safe);
  }
  return result;
}

function action(value: unknown) {
  const result = text(value, 200);
  return result && SAFE_ACTION.test(result) ? result : undefined;
}

function sanitizeChartData(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, GENUI_LIMITS.maxChartPoints).flatMap((item) => {
    const source = object(item);
    const label = source && text(source.label, 128);
    const number = source && finite(source.value, -1e12, 1e12);
    if (!label || number === undefined) return [];
    return [{ label, value: number, ...(safeColor(source.color) ? { color: safeColor(source.color) } : {}) }];
  });
}

function sanitizeNode(value: unknown, context: GuardContext, depth: number): GenuiNode | null {
  if (depth > GENUI_LIMITS.maxDepth) return null;
  const source = object(value);
  const type = source && text(source.type, 32);
  if (!source || !type || !KNOWN_TYPES.has(type)) return null;

  if (CONTAINERS.has(type)) {
    return {
      type,
      items: sanitizeItems(source.items, context, depth + 1),
      ...(type === 'card' && text(source.title) ? { title: text(source.title) } : {}),
      ...(type === 'grid' ? { cols: integer(source.cols, 1, 4) || 1 } : {}),
      ...(type === 'col' && finite(source.gap, 0, 48) !== undefined ? { gap: finite(source.gap, 0, 48) } : {}),
      ...(type === 'row' && source.wrap === true ? { wrap: true } : {}),
    };
  }
  if (type === 'text') {
    const content = text(source.content) || text(source.text);
    return content === undefined ? null : { type, content, ...(enumValue(source.size, ['h1', 'h2', 'h3', 'body', 'muted', 'caption'] as const) ? { size: source.size } : {}), ...(source.center === true ? { center: true } : {}) };
  }
  if (type === 'button') {
    const label = text(source.label);
    return label ? { type, label, ...(action(source.action) ? { action: action(source.action) } : {}), ...(enumValue(source.tone, ['primary', 'danger', 'success', 'ghost'] as const) ? { tone: source.tone } : {}), ...(source.full === true ? { full: true } : {}) } : null;
  }
  if (type === 'input' || type === 'textarea') {
    const id = text(source.id, 200);
    const label = text(source.label);
    const sensitive = source.inputType === 'password' || Boolean(id && SENSITIVE_FIELD.test(id)) || Boolean(label && SENSITIVE_FIELD.test(label));
    return {
      type, ...(label ? { label } : {}), ...(text(source.placeholder) ? { placeholder: text(source.placeholder) } : {}),
      ...(text(source.value) ? { value: text(source.value) } : {}), ...(id ? { id } : {}),
      ...(action(source.action) ? { action: action(source.action) } : {}), ...(sensitive ? { sensitive: true } : {}),
      ...(type === 'textarea' ? { rows: integer(source.rows, 1, 12) || 4 } : {}),
    };
  }
  if (type === 'select' || type === 'radio') {
    const options = strings(source.options);
    if (!options?.length) return null;
    return { type, options, ...(text(source.label) ? { label: text(source.label) } : {}), ...(text(source.id, 200) ? { id: text(source.id, 200) } : {}), ...(text(source.group, 200) ? { group: text(source.group, 200) } : {}), ...(integer(source.selected, 0, options.length - 1) !== undefined ? { selected: integer(source.selected, 0, options.length - 1) } : {}), ...(action(source.action) ? { action: action(source.action) } : {}) };
  }
  if (type === 'checkbox' || type === 'switch') {
    const label = text(source.label);
    return label ? { type, label, ...(source.checked === true ? { checked: true } : {}), ...(action(source.action) ? { action: action(source.action) } : {}) } : null;
  }
  if (type === 'slider') {
    const min = finite(source.min, -1e9, 1e9) ?? 0;
    const max = finite(source.max, -1e9, 1e9) ?? 100;
    return { type, min: Math.min(min, max), max: Math.max(min, max), value: finite(source.value, Math.min(min, max), Math.max(min, max)) ?? min, ...(finite(source.step, 0.000001, 1e9) ? { step: finite(source.step, 0.000001, 1e9) } : {}), ...(text(source.label) ? { label: text(source.label) } : {}), ...(text(source.id, 200) ? { id: text(source.id, 200) } : {}), ...(action(source.action) ? { action: action(source.action) } : {}) };
  }
  if (type === 'submit') {
    const label = text(source.label);
    return label ? { type, label, ...(action(source.action) ? { action: action(source.action) } : {}), ...(strings(source.groups) ? { groups: strings(source.groups) } : {}) } : null;
  }
  if (type === 'link') {
    const label = text(source.label);
    return label ? { type, label, ...(safeExternalUrl(source.href) ? { href: safeExternalUrl(source.href) } : {}) } : null;
  }
  if (type === 'image') {
    const src = safeExternalUrl(source.src);
    return src?.startsWith('https://') ? { type, src, ...(text(source.alt) ? { alt: text(source.alt) } : {}) } : null;
  }
  if (type === 'badge') {
    const label = text(source.label) || text(source.text) || text(source.value);
    return label ? { type, label, ...(enumValue(source.tone, ['success', 'warn', 'danger', 'accent'] as const) ? { tone: source.tone } : {}) } : null;
  }
  if (type === 'stat') {
    const label = text(source.label);
    const statValue = text(source.value, 128);
    return label && statValue ? { type, label, value: statValue, ...(text(source.delta, 64) ? { delta: text(source.delta, 64) } : {}) } : null;
  }
  if (type === 'progress') {
    const progress = finite(source.value, 0, 100);
    return progress === undefined ? null : { type, value: progress, ...(text(source.label) ? { label: text(source.label) } : {}), ...(text(source.valueLabel, 64) ? { valueLabel: text(source.valueLabel, 64) } : {}) };
  }
  if (type === 'divider' || type === 'spacer') return { type };
  if (type === 'avatar') {
    const name = text(source.name, 64);
    return name ? { type, name, ...(safeColor(source.color) ? { color: safeColor(source.color) } : {}) } : null;
  }
  if (type === 'list') {
    if (!Array.isArray(source.items)) return null;
    const items: unknown[] = [];
    for (const item of source.items.slice(0, 50)) {
      if (typeof item === 'string') {
        items.push(item.slice(0, GENUI_LIMITS.maxString));
        continue;
      }
      const entry = object(item);
      if (!entry) continue;
      if (typeof entry.type === 'string') {
        if (context.remaining <= 0) break;
        context.remaining -= 1;
        const child = sanitizeNode(entry, context, depth + 1);
        if (child) items.push(child);
        continue;
      }
      const title = text(entry.title);
      if (title) items.push({ title, ...(text(entry.desc) ? { desc: text(entry.desc) } : {}) });
    }
    return { type, items };
  }
  if (type === 'table') {
    const columns = strings(source.columns, GENUI_LIMITS.maxTableCols);
    if (!columns || !Array.isArray(source.rows)) return null;
    const rows = source.rows.slice(0, GENUI_LIMITS.maxTableRows).flatMap((row) => Array.isArray(row)
      ? [row.slice(0, GENUI_LIMITS.maxTableCols).map((cell) => typeof cell === 'number' && Number.isFinite(cell) ? cell : String(cell ?? '').slice(0, 256))]
      : []);
    return { type, columns, rows };
  }
  if (type === 'chart') {
    const data = sanitizeChartData(source.data);
    return data ? { type, data, ...(enumValue(source.kind, ['bars', 'line', 'donut'] as const) ? { kind: source.kind } : {}) } : null;
  }
  if (type === 'tabs') {
    if (!Array.isArray(source.tabs)) return null;
    return { type, tabs: source.tabs.slice(0, 12).flatMap((tab) => { const entry = object(tab); const label = entry && text(entry.label); return entry && label ? [{ label, items: sanitizeItems(entry.items, context, depth + 1) }] : []; }) };
  }
  if (type === 'accordion') {
    if (!Array.isArray(source.items)) return null;
    return { type, items: source.items.slice(0, 24).flatMap((item) => { const entry = object(item); const title = entry && text(entry.title); return entry && title ? [{ title, items: sanitizeItems(entry.items, context, depth + 1) }] : []; }) };
  }
  if (type === 'callout') {
    const content = text(source.content);
    return content ? { type, content, ...(text(source.title) ? { title: text(source.title) } : {}), ...(enumValue(source.tone, ['info', 'success', 'warning', 'error'] as const) ? { tone: source.tone } : {}) } : null;
  }
  if (type === 'code' || type === 'copy') {
    const code = text(type === 'code' ? source.code : source.text, GENUI_LIMITS.maxCode);
    return code === undefined ? null : { type, ...(type === 'code' ? { code, ...(text(source.lang, 64) ? { lang: text(source.lang, 64) } : {}) } : { text: code, ...(text(source.label, 128) ? { label: text(source.label, 128) } : {}) }) };
  }
  if (type === 'diff') {
    if (!Array.isArray(source.diffs)) return null;
    return { type, diffs: source.diffs.slice(0, 24).flatMap((diff) => { const entry = object(diff); const path = entry && text(entry.path, 1_024); const next = entry && text(entry.newText, 20_000); return path && next !== undefined ? [{ path, oldText: typeof entry.oldText === 'string' ? entry.oldText.slice(0, 20_000) : null, newText: next }] : []; }) };
  }
  if (type === 'json') return 'value' in source ? { type, value: sanitizeJson(source.value) } : null;
  if (type === 'steps' || type === 'timeline' || type === 'keyvalue' || type === 'breadcrumb' || type === 'file-tree' || type === 'quiz') {
    const safe = sanitizeJson(source);
    return object(safe) ? { ...object(safe)!, type } as GenuiNode : null;
  }
  if (type === 'mermaid') {
    const code = text(source.code, 8_000);
    return code && /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt)\b/m.test(code.trim()) ? { type, code } : null;
  }
  if (type === 'scene3d') {
    if (!Array.isArray(source.meshes)) return null;
    const meshes = source.meshes.slice(0, 5).flatMap((mesh) => { const item = object(mesh); const shape = item && enumValue(item.shape, ['box', 'sphere', 'cone', 'cylinder', 'torus'] as const); return item && shape ? [{ shape, ...(safeColor(item.color) ? { color: safeColor(item.color) } : {}), ...(Array.isArray(item.position) ? { position: item.position.slice(0, 3).map((value) => finite(value, -1e6, 1e6) || 0) } : {}) }] : []; });
    return { type, meshes, ...(text(source.title) ? { title: text(source.title) } : {}) };
  }
  if (type === 'diagram') {
    if (!Array.isArray(source.nodes)) return null;
    const nodes = source.nodes.slice(0, 9).flatMap((node) => { const item = object(node); const id = item && text(item.id, 128); const label = item && text(item.label); return item && id && label ? [{ id, label, ...(text(item.sub, 256) ? { sub: text(item.sub, 256) } : {}) }] : []; });
    const edges = Array.isArray(source.edges) ? source.edges.slice(0, 12).flatMap((edge) => { const item = object(edge); const from = item && text(item.from, 128); const to = item && text(item.to, 128); return from && to ? [{ from, to, ...(text(item.label, 14) ? { label: text(item.label, 14) } : {}) }] : []; }) : [];
    return { type, kind: text(source.kind, 64) || 'flowchart', nodes, edges, ...(text(source.title, 256) ? { title: text(source.title, 256) } : {}) };
  }
  if (type === 'echart') {
    const option = sanitizeEChartOption(source.option);
    const data = sanitizeChartData(source.data);
    if (!option && !data) return null;
    return { type, ...(option ? { option } : {}), ...(data ? { data } : {}), ...(enumValue(source.preset, ['bar', 'line', 'area', 'pie', 'scatter'] as const) ? { preset: source.preset } : {}), ...(text(source.title) ? { title: text(source.title) } : {}), height: integer(source.height, 160, 520) || 280 };
  }
  return null;
}

export function sanitizeGenuiSpec(value: unknown): GenuiSpec | null {
  const source = object(value);
  if (!source) return null;
  const root = Array.isArray(source.items) ? source : typeof source.type === 'string' ? { items: [source], panel: source.panel, append: source.append } : null;
  if (!root) return null;
  const context = { remaining: GENUI_LIMITS.maxNodes };
  const items = sanitizeItems(root.items, context, 0);
  if (!items.length) return null;
  return {
    items,
    ...(text(source.title) ? { title: text(source.title) } : {}),
    ...(finite(source.gap, 0, 48) !== undefined ? { gap: finite(source.gap, 0, 48) } : {}),
    ...(source.panel === true ? { panel: true } : {}),
    ...(source.append === true ? { append: true } : {}),
  };
}

function parseCandidate(raw: string) {
  try { return sanitizeGenuiSpec(JSON.parse(raw)); } catch { return null; }
}

type PartialCandidate = { end: number; closingSuffix: string };

export function collectPartialCandidates(raw: string): PartialCandidate[] {
  const stack: string[] = [];
  const candidates: PartialCandidate[] = [];
  let inString = false;
  let escaped = false;
  const push = (candidate: PartialCandidate) => {
    if (candidates.length >= 32) candidates.shift();
    candidates.push(candidate);
  };
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{' || char === '[') { stack.push(char); continue; }
    if (char !== '}' && char !== ']') continue;
    const open = stack.pop();
    if (open !== (char === '}' ? '{' : '[')) break;
    if (char === '}' && stack.length <= GENUI_LIMITS.maxDepth) {
      push({ end: index + 1, closingSuffix: [...stack].reverse().map((item) => item === '{' ? '}' : ']').join('') });
    }
    if (!stack.length) push({ end: index + 1, closingSuffix: '' });
  }
  return candidates.sort((left, right) => right.end - left.end).filter((candidate, index, list) => index === 0 || candidate.end !== list[index - 1]!.end).slice(0, 32);
}

export function parsePartialGenuiSpec(raw: string) {
  const full = parseCandidate(raw.trim());
  if (full) return full;
  const source = raw.trim();
  for (const candidate of collectPartialCandidates(source)) {
    const parsed = parseCandidate(source.slice(0, candidate.end) + candidate.closingSuffix);
    if (parsed) return parsed;
  }
  return null;
}

function repairFence(raw: string, structural: boolean) {
  let output = '';
  const stack: Array<'}' | ']'> = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (escaped) { output += char; escaped = false; continue; }
    if (inString && char === '\\') { output += char; escaped = true; continue; }
    if (char === '"') {
      if (!inString) { inString = true; output += char; continue; }
      let next = index + 1;
      while (/\s/.test(raw[next] || '')) next += 1;
      if ([',', ']', '}', ':', ''].includes(raw[next] || '')) { inString = false; output += char; } else output += '\\"';
      continue;
    }
    if (!inString && (char === '{' || char === '[')) { stack.push(char === '{' ? '}' : ']'); output += char; continue; }
    if (!inString && (char === '}' || char === ']')) {
      if (stack.at(-1) === char) { stack.pop(); output += char; }
      else if (!structural) output += char;
      continue;
    }
    if (!inString && char === ',') {
      let next = index + 1;
      while (/\s/.test(raw[next] || '')) next += 1;
      if ([']', '}', ''].includes(raw[next] || '')) continue;
    }
    output += char;
  }
  if (structural) {
    if (inString) output += '"';
    while (stack.length) output += stack.pop();
  }
  return output;
}

function parseSettled(raw: string) {
  return parseCandidate(raw.trim()) || parseCandidate(repairFence(raw, false)) || parseCandidate(repairFence(raw, true));
}

export function splitRichContent(value: string, streaming = false): RichSegment[] {
  const segments: RichSegment[] = [];
  let cursor = 0;
  let fenceIndex = 0;
  while (cursor < value.length) {
    const open = value.indexOf('```dsh-ui', cursor);
    if (open < 0) {
      if (value.slice(cursor)) segments.push({ type: 'markdown', text: value.slice(cursor) });
      break;
    }
    if (open > cursor) segments.push({ type: 'markdown', text: value.slice(cursor, open) });
    const bodyStart = value.indexOf('\n', open + 9);
    if (bodyStart < 0) {
      if (!streaming) segments.push({ type: 'diagnostic', raw: value.slice(open), fenceIndex, reason: 'dsh-ui fence has no JSON body' });
      break;
    }
    const close = value.indexOf('\n```', bodyStart + 1);
    const raw = value.slice(bodyStart + 1, close < 0 ? value.length : close);
    const spec = close < 0 && streaming ? parsePartialGenuiSpec(raw) : parseSettled(raw);
    if (spec) segments.push({ type: 'genui', spec, fenceIndex, partial: close < 0, raw });
    else if (close >= 0 || !streaming) segments.push({ type: 'diagnostic', raw, fenceIndex, reason: 'Invalid or unsafe dsh-ui JSON' });
    fenceIndex += 1;
    if (close < 0) break;
    cursor = close + 4;
  }
  return segments;
}

export function parseRenderUiInput(value?: string) {
  if (!value) return null;
  try {
    const source = JSON.parse(value) as unknown;
    const root = object(source);
    return sanitizeGenuiSpec(root?.spec ?? root?.ui ?? root);
  } catch {
    return null;
  }
}

export function contentFingerprint(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
