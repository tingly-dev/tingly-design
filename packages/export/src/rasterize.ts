import { toCanvas } from 'html-to-image';

export interface RasterOptions {
  /** CSS pixels of the box to draw; defaults to the node's own size. */
  width?: number;
  height?: number;
  /** Output pixels per CSS pixel. */
  pixelRatio?: number;
  /** @font-face CSS with fonts as data: URLs, built once (see `fontCss`) so frames don't fetch them again. */
  fontEmbedCSS?: string;
  backgroundColor?: string;
  /** Let html-to-image read the page's own stylesheets and inline the fonts they name (for a one-off picture of a live page; frames use `fontEmbedCSS`). */
  embedFonts?: boolean;
  /** Styles forced on the root of the picture (a `margin: auto` is copied as the pixels it resolved to, so a node laid out in a wider page needs `margin: '0'`). */
  style?: Partial<CSSStyleDeclaration>;
  /** Return false to leave a node out of the picture. */
  filter?: (node: Node) => boolean;
}

/** A picture of a DOM tree on a canvas: the tree goes into an SVG foreignObject, which the browser draws. */
export function rasterize(node: HTMLElement, o: RasterOptions = {}): Promise<HTMLCanvasElement> {
  return toCanvas(node, {
    width: o.width,
    height: o.height,
    pixelRatio: o.pixelRatio ?? 1,
    fontEmbedCSS: o.fontEmbedCSS ?? '',
    skipFonts: !o.embedFonts && o.fontEmbedCSS === undefined,
    filter: o.filter,
    style: o.style as Record<string, string> | undefined,
    backgroundColor: o.backgroundColor,
    cacheBust: false,
  });
}

/** A canvas as a PNG file. */
export function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the picture could not be encoded'))), 'image/png'));
}

const FONT_MIME: Record<string, string> = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const b = await r.blob();
    const ext = url.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? '';
    const type = b.type && b.type !== 'application/octet-stream' ? b.type : FONT_MIME[ext] ?? 'font/woff2';
    const buf = new Uint8Array(await b.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return `data:${type};base64,${btoa(s)}`;
  } catch {
    return null;
  }
}

/** The characters of `text` as code points, for matching a face's unicode-range. */
function inRange(range: string | undefined, points: Set<number>): boolean {
  if (!range) return true;
  for (const part of range.split(',')) {
    const m = /U\+([0-9A-F?]+)(?:-([0-9A-F]+))?/i.exec(part.trim());
    if (!m) continue;
    let lo: number;
    let hi: number;
    if (m[1].includes('?')) {
      lo = parseInt(m[1].replace(/\?/g, '0'), 16);
      hi = parseInt(m[1].replace(/\?/g, 'F'), 16);
    } else {
      lo = parseInt(m[1], 16);
      hi = m[2] ? parseInt(m[2], 16) : lo;
    }
    for (const p of points) if (p >= lo && p <= hi) return true;
  }
  return false;
}

/**
 * `fontEmbedCSS` for web fonts named by stylesheet URLs (Google Fonts and the
 * like): each sheet is fetched, and each @font-face whose unicode-range covers
 * a character of `text` gets its file inlined as a data: URL. A picture drawn
 * from a foreignObject cannot load a font from the network, so without this it
 * is set in the fallback face. Run it where the network is reachable (the
 * editor, not a sandboxed frame), once per export.
 */
export async function fontCss(sources: (string | { family: string; url: string })[], text = ''): Promise<string> {
  const points = new Set(Array.from(text, (c) => c.codePointAt(0)!));
  points.add(0x20);
  const out: string[] = [];
  for (const source of sources) {
    const href = new URL(typeof source === 'string' ? source : source.url, typeof location !== 'undefined' ? location.href : undefined).href;
    let css: string;
    if (typeof source === 'string') {
      try {
        const r = await fetch(href);
        if (!r.ok) continue;
        css = await r.text();
      } catch {
        continue;
      }
    } else {
      css = `@font-face{font-family:"${source.family.replace(/["\\]/g, '')}";src:url("${href}")}`;
    }
    for (const m of css.matchAll(/@font-face\s*\{[^}]*\}/g)) {
      let rule = m[0];
      if (!inRange(/unicode-range:\s*([^;]+);/.exec(rule)?.[1], points)) continue;
      const urls = [...rule.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((u) => u[1]).filter((u) => !u.startsWith('data:'));
      for (const u of new Set(urls)) {
        const d = await toDataUrl(new URL(u, href).href);
        if (d) rule = rule.split(u).join(d);
      }
      out.push(rule);
    }
  }
  return out.join('\n');
}
