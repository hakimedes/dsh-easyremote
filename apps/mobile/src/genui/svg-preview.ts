export const SVG_PREVIEW_MAX_CHARS = 1_000_000;

export type SafeSvgDocument = {
  xml: string;
  aspectRatio: number;
};

const ACTIVE_TAG = /<\s*(?:script|foreignObject|iframe|object|embed|audio|video|canvas|style|link|meta)\b/i;
const EVENT_HANDLER = /\son[a-z][\w:.-]*\s*=/i;
const XML_ENTITY = /<!\s*(?:DOCTYPE|ENTITY)\b/i;
const ACTIVE_PROTOCOL = /(?:javascript|vbscript|data\s*:\s*text\/html)\s*:/i;

export function isSvgImageSource(uri?: string, mediaType?: string) {
  if (mediaType?.split(';', 1)[0]?.trim().toLowerCase() === 'image/svg+xml') return true;
  if (!uri) return false;
  try {
    return new URL(uri).pathname.toLowerCase().endsWith('.svg');
  } catch {
    return uri.split(/[?#]/, 1)[0]!.toLowerCase().endsWith('.svg');
  }
}

function numericAttribute(xml: string, name: string) {
  const match = xml.match(new RegExp(`\\s${name}\\s*=\\s*["']\\s*([+-]?(?:\\d+\\.?\\d*|\\.\\d+))`, 'i'));
  const value = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function previewRatio(xml: string) {
  const viewBox = xml.match(/\sviewBox\s*=\s*["']\s*([+-]?(?:\d+\.?\d*|\.\d+))[\s,]+([+-]?(?:\d+\.?\d*|\.\d+))[\s,]+([+-]?(?:\d+\.?\d*|\.\d+))[\s,]+([+-]?(?:\d+\.?\d*|\.\d+))\s*["']/i);
  const width = viewBox ? Number(viewBox[3]) : numericAttribute(xml, 'width');
  const height = viewBox ? Number(viewBox[4]) : numericAttribute(xml, 'height');
  const ratio = width && height && width > 0 && height > 0 ? width / height : 1.2;
  return Math.max(0.5, Math.min(2.2, ratio));
}

function rejectExternalReferences(xml: string) {
  const references = xml.matchAll(/(?:href|xlink:href)\s*=\s*(["'])(.*?)\1/gis);
  for (const reference of references) {
    if (!reference[2]!.trim().startsWith('#')) throw new Error('SVG external resource references are not allowed');
  }
  const urls = xml.matchAll(/url\s*\(\s*(["']?)(.*?)\1\s*\)/gis);
  for (const url of urls) {
    if (!url[2]!.trim().startsWith('#')) throw new Error('SVG external resource references are not allowed');
  }
}

export function sanitizeSvgXml(value: string): SafeSvgDocument {
  if (typeof value !== 'string' || value.length > SVG_PREVIEW_MAX_CHARS) throw new Error('SVG preview is too large');
  const xml = value.replace(/^\uFEFF/, '').trim();
  const root = xml.replace(/^<\?xml\s[^?]*\?>\s*/i, '').replace(/^(?:<!--[^]*?-->\s*)+/i, '');
  if (!/^<svg(?:\s|>)/i.test(root)) throw new Error('SVG root element is required');
  if (XML_ENTITY.test(xml) || ACTIVE_TAG.test(xml)) throw new Error('SVG active content is not allowed');
  if (EVENT_HANDLER.test(xml)) throw new Error('SVG event handlers are not allowed');
  if (ACTIVE_PROTOCOL.test(xml) || /<\?(?!xml\b)/i.test(xml)) throw new Error('SVG active content is not allowed');
  rejectExternalReferences(xml);
  return { xml, aspectRatio: previewRatio(root) };
}
