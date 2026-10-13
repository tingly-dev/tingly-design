import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import {
  DS_INDEX,
  DS_TOKENS,
  compileTokensCss,
  editTokensJson,
  parseDsIndex,
  resolveTokens,
  stringifyDsIndex,
  type DsIndex,
  type DsTokens,
} from '@dc/core';
import { api } from './api';
import { display, edit, toast, useStore } from './store';
import { SERVER } from './base';
import { filesOf, type ImportTarget } from './components/ImportHere';

/**
 * Design-system helpers: tokens as the page reads them, edits of tokens.json
 * and the index as ordinary queued edits (so conflicts replay and undo works),
 * the project's binary assets, and the markup a component preview runs in.
 */

const get = useStore.getState;

let tokensCache: { text: string | undefined; t: DsTokens } = { text: undefined, t: resolveTokens('') };
export function tokensOf(text: string | undefined): DsTokens {
  if (text !== tokensCache.text) tokensCache = { text, t: resolveTokens(text ?? '') };
  return tokensCache.t;
}

export function useTokens(): DsTokens {
  return useStore((s) => tokensOf(display(s, DS_TOKENS)));
}

let indexCache: { text: string | undefined; d: DsIndex } = { text: undefined, d: parseDsIndex(undefined) };
export function useDsIndex(): DsIndex {
  return useStore((s) => {
    const text = display(s, DS_INDEX);
    if (text !== indexCache.text) indexCache = { text, d: parseDsIndex(text) };
    return indexCache.d;
  });
}

/** Change tokens.json as data; the server rebuilds tokens.css from it. */
export function editTokens(fn: (json: Record<string, unknown>) => void, summary: string): boolean {
  return edit(DS_TOKENS, (src) => editTokensJson(src, fn), { actor: 'human', summary });
}

export function editDsIndex(fn: (d: DsIndex) => void, summary: string): boolean {
  return edit(
    DS_INDEX,
    (src) => {
      const d = structuredClone(parseDsIndex(src));
      fn(d);
      d.lastChange = { by: 'tingly-design', at: new Date().toISOString(), via: 'page', note: summary.slice(0, 280) };
      return stringifyDsIndex(d);
    },
    { actor: 'human', summary },
  );
}

/** The list a token family keeps (creating it when absent). */
export function familyList(json: Record<string, unknown>, key: string): Record<string, unknown>[] {
  if (key === 'color') {
    const c = (json.color ??= { themes: [{ id: 'light', name: 'Light' }], tokens: [] }) as { tokens?: unknown };
    if (!Array.isArray(c.tokens)) c.tokens = [];
    return c.tokens as Record<string, unknown>[];
  }
  const f = (json[key] ??= { tokens: [] }) as { tokens?: unknown };
  if (!Array.isArray(f.tokens)) f.tokens = [];
  return f.tokens as Record<string, unknown>[];
}

export function textFile(path: string): string | undefined {
  return display(get(), path);
}

// ------------------------------------------------------------------ assets

export interface AssetFile {
  path: string;
  size: number;
}

let assetsVersion = 0;
const assetListeners = new Set<() => void>();
/** Something added or removed images or fonts (an upload here, or the server said so). */
export function assetsChanged(): void {
  assetsVersion++;
  assetListeners.forEach((f) => f());
}

export function useAssets(): AssetFile[] {
  const project = useStore((s) => s.project);
  const [list, setList] = useState<AssetFile[]>([]);
  const [v, setV] = useState(assetsVersion);
  useEffect(() => {
    const f = () => setV(assetsVersion);
    assetListeners.add(f);
    return () => void assetListeners.delete(f);
  }, []);
  useEffect(() => {
    if (!project) return;
    api.assets(project).then(setList, (e) => toast(e.message, 'error'));
  }, [project, v]);
  return list;
}

export async function uploadTo(dir: string, files: FileList | File[]): Promise<string[]> {
  const project = get().project;
  if (!project) return [];
  const out: string[] = [];
  for (const f of Array.from(files)) {
    try {
      out.push((await api.upload(project, f, dir)).path);
    } catch (e) {
      toast(`${f.name}：${(e as Error).message}`, 'error');
    }
  }
  assetsChanged();
  return out;
}

export function rawUrl(path: string): string {
  const project = get().project ?? '';
  return api.rawBase(project) + path.split('/').map(encodeURIComponent).join('/');
}

export const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
export const FONT_RE = /\.(woff2?|ttf|otf)$/i;

// ---------------------------------------------------------------- markdown

/** Markdown written by people: rendered, then sanitized (no scripts, handlers or frames). */
export function markdown(md: string): string {
  const html = marked.parse(md, { async: false, gfm: true }) as string;
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input'] });
}

// ----------------------------------------------------------------- preview

const escapeScript = (s: string) => s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const escapeStyle = (s: string) => s.replace(/<\/style/gi, '<\\/style');

/**
 * A component preview as the original frames it: tokens.css, bundle.css, the
 * libraries and bundle.js loaded first, `data-theme` on <html>, relative
 * paths resolving from the component's folder. It runs in a sandboxed frame
 * with no network beyond the pinned script CDNs and Google Fonts.
 */
export function previewDoc(opts: {
  html: string;
  comp: string;
  theme: string;
  tokens: DsTokens;
  title: string;
  bundleJs?: string;
  bundleCss?: string;
  libraries: { name: string; version: string; file?: string }[];
  libFiles: Record<string, string>;
  frameId: string;
}): string {
  const project = get().project ?? '';
  const raw = api.rawBase(project);
  const origin = SERVER;
  const css = compileTokensCss(opts.tokens, { title: opts.title, fontBase: raw });
  const libs = opts.libraries
    .map((l) => {
      const local = l.file ? opts.libFiles[l.file] : opts.libFiles[`components/lib/${l.name}.production.min.js`];
      if (local !== undefined) return `<script>${escapeScript(local)}</script>`;
      if ((l.name === 'react' || l.name === 'react-dom') && /^18/.test(l.version))
        return `<script src="https://cdn.jsdelivr.net/npm/${l.name}@18.3.1/umd/${l.name}.production.min.js"></script>`;
      return '';
    })
    .join('');
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com",
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    `font-src https://fonts.gstatic.com ${origin}/api/ data:`,
    `img-src ${origin}/api/ data: blob:`,
    `media-src ${origin}/api/ data: blob:`,
  ].join('; ');
  // the frame tells the page its height, so a card grows to fit
  const size = `<script>(function(){var last=0;function send(){var h=Math.ceil(document.documentElement.scrollHeight);if(h!==last){last=h;parent.postMessage({dsPreview:${JSON.stringify(opts.frameId)},height:h},'*')}}addEventListener('load',send);new ResizeObserver(send).observe(document.documentElement);setInterval(send,500)})()</script>`;
  const prelude =
    `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<base href="${raw}components/${encodeURIComponent(opts.comp)}/">` +
    `<style>${escapeStyle(css)}</style>` +
    `<style>html,body{margin:0}body{padding:16px;background:var(--surface, #fff);color:var(--ink, inherit)}</style>` +
    (opts.bundleCss ? `<style>${escapeStyle(opts.bundleCss)}</style>` : '') +
    libs +
    (opts.bundleJs ? `<script>${escapeScript(opts.bundleJs)}</script>` : '') +
    size;
  let body = opts.html.replace(/^\s*<!--\s*@dsCard[^]*?-->/, '').replace(/<!doctype[^>]*>/i, '');
  body = body.replace(/<html\b[^>]*>/i, '').replace(/<\/html>/i, '');
  if (/<head\b[^>]*>/i.test(body)) body = body.replace(/<head\b[^>]*>/i, (m) => m + prelude);
  else body = `<head>${prelude}</head>` + body;
  return `<!doctype html><html data-theme="${opts.theme}">${body}</html>`;
}

// --------------------------------------------------------------- consumers

export interface Installed {
  record: { title: string; namespace: string; artifact: string; version: string | null; copiedAt: string };
  tokens: DsTokens;
}

let installedCache: { key: string; list: Installed[] } = { key: '', list: [] };
/** The design systems installed into this canvas or deck, with their copied tokens. */
const NONE: Installed[] = [];
export function installedOf(s: ReturnType<typeof get>): Installed[] {
  if (s.kind !== 'design' && s.kind !== 'slides') return NONE;
  const indexText = display(s, s.kind === 'slides' ? 'deck.json' : 'canvas.json');
  let records: Installed['record'][] = [];
  try {
    const raw = indexText ? JSON.parse(indexText).designSystems : [];
    records = Array.isArray(raw) ? raw.filter((r) => r && typeof r.namespace === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(r.namespace)) : [];
  } catch {
    records = [];
  }
  const texts = records.map((r) => display(s, `ds/${r.namespace}/tokens.json`) ?? '');
  if (!records.length) return NONE;
  const key = JSON.stringify(records) + '\0' + texts.join('\0');
  if (key !== installedCache.key) {
    installedCache = { key, list: records.map((record, i) => ({ record, tokens: resolveTokens(texts[i]) })) };
  }
  return installedCache.list;
}

export function useInstalled(): Installed[] {
  return useStore((s) => installedOf(s));
}

/** Font files into fonts/, each registered in tokens.json with a family and weight read from its name. */
export async function addFonts(files: FileList | File[]): Promise<string[]> {
  const paths = await uploadTo('fonts', files);
  if (paths.length)
    editTokens((json) => {
      const ty = (json.type ??= { fonts: [], families: {}, groups: [] }) as { fonts?: unknown[] };
      ty.fonts ??= [];
      for (const p of paths) {
        const stem = p.replace(/^fonts\//, '').replace(/\.[^.]+$/, '');
        const family = stem.replace(/[-_](regular|bold|medium|light|semibold|black|italic|\d+)$/i, '').replace(/[-_]+/g, ' ');
        const weight = /bold/i.test(stem) ? '700' : /semibold/i.test(stem) ? '600' : /medium/i.test(stem) ? '500' : /light/i.test(stem) ? '300' : '400';
        ty.fonts.push({ family, file: p, weight });
      }
    }, 'fonts added');
  return paths;
}

/**
 * What a design system takes: font files become its fonts (registered in
 * tokens.json, as the 字体 view's upload does), pictures and SVGs its assets
 * (assets/Other, as the 素材 view's drop zone does). These are the system's
 * own files, not material kept for reference, so they go where the system
 * keeps them rather than to uploads/.
 */
export const dsImport: ImportTarget = {
  accepts: ['font', 'image', 'drawing'],
  what: '字体文件加进字体（写进 tokens.json），图片和 SVG 加进素材的"Other"分组。',
  run: async (picked) => {
    const asFile = (f: { path: string; type: string; bytes: Uint8Array }) => new File([f.bytes as Uint8Array<ArrayBuffer>], f.path.split('/').pop()!, { type: f.type });
    const fonts = await addFonts(filesOf(picked, 'font').map(asFile));
    const pics = await uploadTo('assets/Other', filesOf(picked, 'image', 'drawing').map(asFile));
    return [fonts.length ? `${fonts.length} 个字体` : '', pics.length ? `${pics.length} 个素材` : ''].filter(Boolean).join('、').replace(/^/, '已加入 ') + '。';
  },
};
