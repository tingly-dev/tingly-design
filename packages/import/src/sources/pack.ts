/**
 * Uploaded files → one self-contained page a browser can lay out offline.
 *
 * The page is laid out in a frame with no network, so the files it names
 * (stylesheets, images, fonts) have to travel inside it: stylesheets are
 * inlined as <style>, everything else becomes a data: url. `paths` remembers
 * which data: url was which file, so the generator can point at the copies
 * uploaded into the project instead.
 */

export interface InFile {
  /** path relative to the picked folder, with / separators */
  path: string;
  type: string;
  bytes: Uint8Array;
}

export interface Packed {
  html: string;
  /** data: url → the file's path among the uploads */
  paths: Map<string, string>;
  /** referenced but not among the uploads (left as written) */
  missing: string[];
  /** stylesheets on the web (other than Google Fonts): an offline layout cannot read them */
  remoteCss: string[];
}

const TEXT = new TextDecoder();

function dirOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i + 1);
}

/** Resolve `ref` against the directory `dir`, both relative to the picked folder. */
export function joinPath(dir: string, ref: string): string {
  const out: string[] = [];
  for (const seg of (dir + ref).split('/')) {
    if (seg === '..') out.pop();
    else if (seg !== '.' && seg !== '') out.push(seg);
  }
  return out.join('/');
}

function isExternal(ref: string): boolean {
  return /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref) || ref === '';
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function packPage(files: InFile[], entry: string): Packed {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const paths = new Map<string, string>();
  const dataUrls = new Map<string, string>();
  const missing = new Set<string>();
  const remoteCss: string[] = [];

  const dataUrl = (path: string): string | null => {
    const f = byPath.get(path);
    if (!f) return null;
    let u = dataUrls.get(path);
    if (!u) {
      u = `data:${f.type || 'application/octet-stream'};base64,${base64(f.bytes)}`;
      dataUrls.set(path, u);
      paths.set(u, path);
    }
    return u;
  };

  const ref = (raw: string, dir: string): string => {
    const clean = raw.trim().split(/[?#]/)[0];
    if (isExternal(raw.trim())) return raw;
    let p: string;
    try {
      p = joinPath(dir, decodeURI(clean));
    } catch {
      p = joinPath(dir, clean);
    }
    const u = dataUrl(p);
    if (!u) missing.add(p);
    return u ?? raw;
  };

  const css = (text: string, dir: string, depth = 0): string =>
    text
      .replace(/@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?\s*([^;]*);/g, (m, _q, href: string, media: string) => {
        if (isExternal(href) || depth > 4) return m;
        const p = joinPath(dir, href);
        const f = byPath.get(p);
        if (!f) {
          missing.add(p);
          return '';
        }
        const inner = css(TEXT.decode(f.bytes), dirOf(p), depth + 1);
        return media.trim() ? `@media ${media.trim()} {\n${inner}\n}` : inner;
      })
      .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (_m, q: string, u: string) => `url(${q}${ref(u, dir)}${q})`);

  const page = byPath.get(entry);
  if (!page) throw new Error(`${entry} is not among the files`);
  const dir = dirOf(entry);
  let html = TEXT.decode(page.bytes);

  // stylesheets: inline the ones that were uploaded, keep links to the web as they are
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/\brel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag)) return tag;
    const href = /\bhref\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2] ?? /\bhref\s*=\s*([^\s>]+)/i.exec(tag)?.[1];
    if (href && /^(https?:)?\/\//i.test(href) && !/fonts\.googleapis\.com/.test(href)) remoteCss.push(href);
    if (!href || isExternal(href)) return tag;
    const p = joinPath(dir, href);
    const f = byPath.get(p);
    if (!f) {
      missing.add(p);
      return tag;
    }
    const media = /\bmedia\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2];
    return `<style data-from="${p.replace(/"/g, '')}"${media ? ` media="${media}"` : ''}>\n${css(TEXT.decode(f.bytes), dirOf(p))}\n</style>`;
  });
  html = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, a: string, body: string, b: string) => a + css(body, dir) + b);
  html = html.replace(/\bstyle\s*=\s*(["'])(.*?)\1/gi, (_m, q: string, body: string) => `style=${q}${css(body, dir)}${q}`);
  html = html.replace(/\b(src|poster)\s*=\s*(["'])(.*?)\2/gi, (_m, k: string, q: string, u: string) => `${k}=${q}${ref(u, dir)}${q}`);
  html = html.replace(/\bsrcset\s*=\s*(["'])(.*?)\1/gi, '');
  // <image href> / <use href> in inline svg
  html = html.replace(/(<(?:image|use|feImage)\b[^>]*?\b(?:xlink:)?href\s*=\s*)(["'])(.*?)\2/gi, (_m, a: string, q: string, u: string) => `${a}${q}${ref(u, dir)}${q}`);
  return { html, paths, missing: [...missing], remoteCss };
}
