/**
 * Files and images a person attaches to a request, as references: a
 * screenshot to match, a mockup, a brand guide, a CSV of real numbers.
 *
 * They travel with the request and are never written into the project.
 * The fast model gets them as content blocks next to the prompt; Claude Code
 * gets them as files in a folder outside the project, which it reads.
 */

export type AttachmentKind = 'image' | 'pdf' | 'text';

export interface Attachment {
  name: string;
  kind: AttachmentKind;
  /** image/png, application/pdf, text/csv… */
  mediaType: string;
  /** base64 for images and PDFs, the text itself for text files */
  data: string;
}

/** Images the model reads (SVG is markup, so it goes as text). */
export const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** Text files sent as they are. */
export const TEXT_TYPES: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  ts: 'text/plain',
  tsx: 'text/plain',
  jsx: 'text/plain',
  svg: 'image/svg+xml',
  xml: 'application/xml',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  sql: 'text/plain',
  log: 'text/plain',
};

export const ATTACH_LIMITS = {
  /** attachments on one request */
  count: 6,
  /** an image as sent (the editor scales larger ones down first) */
  imageBytes: 5 * 1024 * 1024,
  /** the longest side an image is scaled down to */
  imageSide: 1568,
  pdfBytes: 10 * 1024 * 1024,
  /** characters of a text file */
  textChars: 200_000,
};

/** What the file picker accepts. */
export const ATTACH_ACCEPT = [...Object.keys(IMAGE_TYPES), 'pdf', ...Object.keys(TEXT_TYPES)].map((e) => '.' + e).join(',');

function ext(name: string): string {
  return (/\.([A-Za-z0-9]+)$/.exec(name)?.[1] ?? '').toLowerCase();
}

/** Which kind a file is by its name and type, or null when it cannot be attached. */
export function attachmentKind(name: string, type = ''): { kind: AttachmentKind; mediaType: string } | null {
  const e = ext(name);
  const t = type.toLowerCase();
  if (IMAGE_TYPES[e]) return { kind: 'image', mediaType: IMAGE_TYPES[e] };
  if (Object.values(IMAGE_TYPES).includes(t)) return { kind: 'image', mediaType: t };
  if (e === 'pdf' || t === 'application/pdf') return { kind: 'pdf', mediaType: 'application/pdf' };
  if (TEXT_TYPES[e]) return { kind: 'text', mediaType: TEXT_TYPES[e] };
  if (t.startsWith('text/')) return { kind: 'text', mediaType: t };
  return null;
}

/** Bytes a base64 string decodes to. */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/** Why a set of attachments cannot be sent, or null when they can. The server checks again. */
export function checkAttachments(list: unknown): string | null {
  if (list === undefined) return null;
  if (!Array.isArray(list)) return 'attachments must be a list';
  if (list.length > ATTACH_LIMITS.count) return `at most ${ATTACH_LIMITS.count} attachments`;
  for (const a of list as Partial<Attachment>[]) {
    if (!a || typeof a.name !== 'string' || !a.name || typeof a.data !== 'string' || typeof a.mediaType !== 'string') return 'bad attachment';
    const k = attachmentKind(a.name, a.mediaType);
    if (!k || k.kind !== a.kind) return `cannot attach ${a.name}`;
    if (a.kind !== 'text' && !/^[A-Za-z0-9+/]*={0,2}$/.test(a.data)) return `${a.name} is not base64`;
    if (a.kind === 'image' && base64Bytes(a.data) > ATTACH_LIMITS.imageBytes) return `${a.name} is over 5 MB`;
    if (a.kind === 'pdf' && base64Bytes(a.data) > ATTACH_LIMITS.pdfBytes) return `${a.name} is over 10 MB`;
    if (a.kind === 'text' && a.data.length > ATTACH_LIMITS.textChars) return `${a.name} is over ${ATTACH_LIMITS.textChars} characters`;
  }
  return null;
}

/** A name safe to write as a file: letters, digits, dot, dash and underscore, the extension kept. */
export function attachmentFileName(name: string, i: number): string {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const e = ext(base);
  const stem = (e ? base.slice(0, -e.length - 1) : base)
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${i + 1}-${stem || 'file'}${e ? '.' + e : ''}`;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string }; title?: string };

/**
 * The attachments as Messages API content blocks, each one labelled with its
 * name and fenced like any other text that came from people.
 */
export function attachmentBlocks(list: Attachment[], nonce: string): ContentBlock[] {
  const out: ContentBlock[] = [];
  list.forEach((a, i) => {
    const label = `attachment ${i + 1}: ${a.name}`;
    if (a.kind === 'image') {
      out.push({ type: 'text', text: label }, { type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } });
    } else if (a.kind === 'pdf') {
      out.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data }, title: a.name });
    } else {
      out.push({ type: 'text', text: `${label}\n⟦untrusted:${nonce}⟧\n${a.data}\n⟦/untrusted:${nonce}⟧` });
    }
  });
  return out;
}

/** One line per attachment, for prompts that only name them. */
export function attachmentSummary(list: Attachment[]): string {
  return list.map((a, i) => `- attachment ${i + 1}: ${a.name} (${a.kind === 'image' ? 'image' : a.kind === 'pdf' ? 'PDF' : 'text'})`).join('\n');
}

export interface ModelMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

/** Why a fast-edit conversation cannot go to the model, or null when it can: only text, image and PDF blocks, within the limits. */
export function checkMessages(list: unknown): string | null {
  if (!Array.isArray(list) || !list.length) return 'messages missing';
  let files = 0;
  for (const m of list as Partial<ModelMessage>[]) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) return 'bad message';
    if (typeof m.content === 'string') continue;
    if (!Array.isArray(m.content) || m.role !== 'user') return 'bad message';
    for (const b of m.content as Partial<ContentBlock>[]) {
      if (b?.type === 'text') {
        if (typeof b.text !== 'string') return 'bad text block';
        continue;
      }
      const src = (b as { source?: { type?: string; media_type?: string; data?: unknown } })?.source;
      if (src?.type !== 'base64' || typeof src.data !== 'string') return 'bad attachment block';
      files++;
      if (b?.type === 'image') {
        if (!Object.values(IMAGE_TYPES).includes(src.media_type ?? '')) return `cannot send an image of type ${src.media_type}`;
        if (base64Bytes(src.data) > ATTACH_LIMITS.imageBytes) return 'an image is over 5 MB';
      } else if (b?.type === 'document') {
        if (src.media_type !== 'application/pdf') return 'only PDF documents';
        if (base64Bytes(src.data) > ATTACH_LIMITS.pdfBytes) return 'a PDF is over 10 MB';
      } else return 'bad block';
    }
  }
  // the same attachments ride along on every retry of one request
  if (files > ATTACH_LIMITS.count) return `at most ${ATTACH_LIMITS.count} attachments`;
  return null;
}
