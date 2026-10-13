/**
 * Files a page carries inline as data: urls (embedded images, fonts) become
 * project assets like any other file, so artboards stay small enough to read,
 * diff and hand to AI. Shared by the editor and the CLI.
 */

/** data: urls smaller than this stay inline (icons, 1px spacers) */
export const INLINE_DATA_MAX = 2048;

const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif',
  'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf', 'font/otf': 'otf', 'application/font-woff': 'woff',
};

export function extOf(type: string): string | undefined {
  return EXT[type.toLowerCase()];
}

/** A data: url's bytes and media type; null when it is not one or is malformed. */
export function decodeDataUrl(url: string): { type: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  try {
    if (m[3]) {
      const bin = atob(m[4].replace(/\s+/g, ''));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { type: m[1] || 'text/plain', bytes };
    }
    return { type: m[1] || 'text/plain', bytes: new TextEncoder().encode(decodeURIComponent(m[4])) };
  } catch {
    return null;
  }
}

/** The data: urls worth moving out into files: big enough, and of a type an asset can be. */
export function embeddedAssets(urls: string[]): { url: string; type: string; ext: string; bytes: Uint8Array }[] {
  const out = [];
  for (const url of urls) {
    if (!url.startsWith('data:') || url.length < INLINE_DATA_MAX) continue;
    const d = decodeDataUrl(url);
    const ext = d && extOf(d.type);
    if (d && ext) out.push({ url, type: d.type, ext, bytes: d.bytes });
  }
  return out;
}
