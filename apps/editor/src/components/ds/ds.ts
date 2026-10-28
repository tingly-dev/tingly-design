import { useEffect, useState } from 'react';
import { create } from 'zustand';
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
import { api } from '../../api';
import { display, edit, recordChange, toast, useStore } from '../../store';
import { SERVER } from '../../base';
import { filesOf, type ImportTarget } from '../ImportHere';
import { t } from '../../i18n';
import { framePreview, type PreviewDocOptions } from './previewDoc';

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
  const done = edit(DS_TOKENS, (src) => editTokensJson(src, fn), { actor: 'human', summary });
  // nothing to follow the tokens yet in a system without components: Claude is told, but nothing is offered
  if (done) recordChange({ type: 'tokens', edits: [summary] }, Object.keys(useStore.getState().files).some((f) => /^components\/[^/]+\.html$/.test(f)));
  return done;
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
      toast(t('ds.import.uploadFailed', { name: f.name, error: (e as Error).message }), 'error');
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
export const FONT_RE = /\.(woff2?|ttf|otf|ttc)$/i;

// ---------------------------------------------------------------- markdown

/** Markdown written by people: rendered, then sanitized (no scripts, handlers or frames). */
export function markdown(md: string): string {
  const html = marked.parse(md, { async: false, gfm: true }) as string;
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input'] });
}

// ----------------------------------------------------------------- preview

/** A component preview of the open system (see `framePreview`). */
export function previewDoc(opts: Omit<PreviewDocOptions, 'raw'>): string {
  return framePreview({ ...opts, raw: api.rawBase(get().project ?? '') });
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
export type TypeJson = { fonts?: unknown[]; families?: Record<string, string>; groups?: { name: string; family?: string; styles: unknown[] }[] };

/** tokens.json's type section, created with every list it holds if it is missing. */
export function typeOf(json: Record<string, unknown>): TypeJson {
  const ty = (json.type ??= { fonts: [], families: {}, groups: [] }) as TypeJson;
  ty.fonts ??= [];
  ty.families ??= {};
  ty.groups ??= [];
  return ty;
}

export async function addFonts(files: FileList | File[]): Promise<string[]> {
  const paths = await uploadTo('fonts', files);
  if (paths.length)
    editTokens((json) => {
      const ty = typeOf(json);
      for (const p of paths) {
        const stem = p.replace(/^fonts\//, '').replace(/\.[^.]+$/, '');
        const family = stem.replace(/[-_](regular|bold|medium|light|semibold|black|italic|\d+)$/i, '').replace(/[-_]+/g, ' ');
        const weight = /bold/i.test(stem) ? '700' : /semibold/i.test(stem) ? '600' : /medium/i.test(stem) ? '500' : /light/i.test(stem) ? '300' : '400';
        ty.fonts!.push({ family, file: p, weight });
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
  get what() {
    return t('ds.import.what');
  },
  run: async (picked) => {
    const asFile = (f: { path: string; type: string; bytes: Uint8Array }) => new File([f.bytes as Uint8Array<ArrayBuffer>], f.path.split('/').pop()!, { type: f.type });
    const fonts = await addFonts(filesOf(picked, 'font').map(asFile));
    const pics = await uploadTo('assets/Other', filesOf(picked, 'image', 'drawing').map(asFile));
    if (!fonts.length && !pics.length) throw new Error(t('ds.import.noneAdded'));
    const f = fonts.length ? t('ds.import.fonts', { count: fonts.length }) : '';
    const a = pics.length ? t('ds.import.assets', { count: pics.length }) : '';
    return f && a ? t('ds.import.addedBoth', { fonts: f, assets: a }) : t('ds.import.addedOne', { what: f || a });
  },
};

export const DS_VIEW_IDS = ['overview', 'colors', 'type', 'space', 'components', 'assets', 'issues'] as const;
export type DsViewId = (typeof DS_VIEW_IDS)[number];

/** Which page of the design system is showing (`?v=` in the address); the nav and `showView` both set it. */
export const useDsView = create<{ view: DsViewId }>(() => ({ view: dsViewFromUrl() }));

/** The page the address names, or the overview; read again each time a design system opens. */
export function dsViewFromUrl(): DsViewId {
  const v = new URLSearchParams(location.search).get('v');
  return (DS_VIEW_IDS as readonly string[]).includes(v ?? '') ? (v as DsViewId) : 'overview';
}
