import { applyHumanOps, parseDc, parseStyle, sandboxDoc, type DcElement, type DeckJson, type HumanOp } from '@dc/core';
import type { PptxAsset, PptxDeck } from '@dc/export/pptx';
import type { PptxDomDiagnostic, PptxDomResult } from '@dc/export/pptx-dom';

/** `boards`: the artboards the slides embed (`<x-embed src="uploads/…">`), by path, as the slide frames get them. */
export interface DeckSnapshot { title: string; faces: DeckJson['faces']; size: [number, number]; slides: { id: string; source: string }[]; boards?: Record<string, string>; base: string; runtimeOrigin: string }
export interface DeckPptxProgress { done: number; total: number; slide?: string }
export class DeckPptxError extends Error {
  constructor(public slide: string, public diagnostics: PptxDomDiagnostic[]) { super(diagnostics.map(d => `${d.code}: ${d.feature ?? ''} (${d.path})`).join('\n')); }
}
const MAX_BYTES = 100 * 1024 * 1024;
/** 1920 CSS pixels make PowerPoint's 13.333in widescreen page; other deck sizes keep that density. */
const PX_PER_IN = 144;
/** Pictures the capture draws (and so turns into PNG) because PowerPoint cannot hold them as they are. */
const DRAWN: Record<string, string> = { svg: 'image/svg+xml', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };
const localPath = (s: string) => /^[A-Za-z0-9_./-]+$/.test(s) && !s.startsWith('/') && !s.split('/').includes('..');
const hidden = (el: DcElement): boolean => {
  for (let node: DcElement | null = el; node; node = node.parent) {
    if (node.tag === 'aside' || node.attrs.some(a => a.name === 'data-hide')) return true;
    if (parseStyle(node.attrs.find(a => a.name === 'style')?.value ?? '').some(d => d.prop === 'display' && d.value.trim() === 'none')) return true;
  }
  return false;
};
const dataUrl = (bytes: Uint8Array, mime: string) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
};

/** Freeze resource bytes before rendering ANY page. No project URL survives into capture.
 * Reads ordinary runtime DOM exclusively through its bounded opaque-origin bridge. */
export async function deckSnapshotToPptx(snapshot: DeckSnapshot, options: { signal?: AbortSignal; progress?: (p: DeckPptxProgress) => void } = {}): Promise<{ bytes: Uint8Array; diagnostics: { slide: string; diagnostic: PptxDomDiagnostic }[] }> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  // every slide may draw a few of its elements as pictures: the deadline grows with the deck
  const timer = setTimeout(abort, Math.min(600000, 60000 + 15000 * snapshot.slides.length));
  const [width, height] = snapshot.size;
  const widthIn = width / PX_PER_IN;
  const signal = controller.signal;
  let frame: HTMLIFrameElement | undefined;
  let bytesRead = 0;
  const cleanups: (() => void)[] = [];
  const check = () => { if (signal.aborted) throw new DOMException('Aborted', 'AbortError'); };
  const bounded = async <T>(promise: Promise<T>): Promise<T> => {
    check();
    let aborted: (() => void) | undefined;
    try {
      return await Promise.race([promise, new Promise<never>((_, reject) => {
        aborted = () => reject(new DOMException('Aborted', 'AbortError'));
        signal.addEventListener('abort', aborted, { once: true });
      })]);
    } finally { if (aborted) signal.removeEventListener('abort', aborted); }
  };
  const get = async (url: string): Promise<{ bytes: Uint8Array; type: string }> => {
    check();
    const response = await fetch(url, { signal, redirect: 'error' });
    if (!response.ok || !response.body) throw new Error('resource');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length; bytesRead += value.length;
        if (size > 32 * 1024 * 1024 || bytesRead > MAX_BYTES) throw new Error('resource-budget');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(size);
    let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return { bytes, type: response.headers.get('content-type')?.split(';')[0] ?? '' };
  };
  const fail = (slide: string, feature: string): never => { throw new DeckPptxError(slide, [{ code: 'asset', path: 'root', slide: 0, feature, severity: 'error' }]); };
  try {
    if (!snapshot.slides.length || snapshot.slides.length > 200 || !(widthIn >= 1 && widthIn <= 56 && height / PX_PER_IN >= 1 && height / PX_PER_IN <= 56) || snapshot.slides.reduce((n, s) => n + s.source.length, 0) > 2000000) fail('', 'deck-budget');
    // Fonts are frozen too. Unlike image-export's best-effort helper, no failed
    // stylesheet or font download is silently replaced by a fallback.
    let head = '';
    for (const face of Object.values(snapshot.faces)) {
      const family = face.family.replace(/["\\<>]/g, '');
      if (face.src) {
        if (!localPath(face.src)) fail('', 'font-path');
        const f = await get(snapshot.base + face.src);
        head += `<style>@font-face{font-family:"${family}";src:url("${dataUrl(f.bytes, 'font/woff2')}")}</style>`;
      } else if (face.href) {
        if (!/^https:\/\/fonts\.googleapis\.com\/css2\?/.test(face.href)) fail('', 'font-address');
        let css = new TextDecoder().decode((await get(face.href)).bytes);
        for (const match of Array.from(css.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g))) {
          if (!/^https:\/\/fonts\.gstatic\.com\//.test(match[1])) fail('', 'font-address');
          const f = await get(match[1]);
          css = css.split(match[0]).join(`url("${dataUrl(f.bytes, 'font/woff2')}")`);
        }
        if (!css.includes('@font-face') || /url\((?!"data:)/.test(css) || /@import/i.test(css)) fail('', 'font-stylesheet');
        head += `<style>${css.replace(/<\//g, '<\\/')}</style>`;
      }
      if (head.length > 48 * 1024 * 1024) fail('', 'font-budget');
    }
    const images: Record<string, PptxAsset> = {};
    const loaded = new Map<string, string>();
    const slides: { id: string; source: string; images: Record<string, PptxAsset> }[] = [];
    for (const slide of snapshot.slides) {
      const pageImages: Record<string, PptxAsset> = {};
      const ops: HumanOp[] = [];
      for (const el of parseDc(slide.source).elements) {
        if (el.tag !== 'img') continue;
        if (hidden(el)) { ops.push({ kind: 'attr', tid: el.tid, name: 'src', value: null }); continue; }
        const src = el.attrs.find(a => a.name === 'src')?.value ?? '';
        if (!localPath(src)) fail(slide.id, 'local-images-only');
        let url = loaded.get(src);
        if (!url) {
          const file = await get(snapshot.base + src).catch(() => { check(); return fail(slide.id, `image:${src}`); });
          const png = file.bytes[0] === 137 && file.bytes[1] === 80;
          const jpeg = file.bytes[0] === 255 && file.bytes[1] === 216;
          if (!png && !jpeg) {
            // handed to the capture as it is, without an asset: it draws the picture instead
            const drawn = DRAWN[src.split('.').pop()?.toLowerCase() ?? ''];
            if (!drawn) fail(slide.id, `image-type:${src}`);
            url = dataUrl(file.bytes, drawn);
            loaded.set(src, url);
            // an SVG keeps its vectors: the capture adds the picture of it readers without SVG show
            if (drawn === 'image/svg+xml') images[url] = { bytes: file.bytes.slice(), mime: 'image/svg+xml', widthPx: 1, heightPx: 1 };
            ops.push({ kind: 'attr', tid: el.tid, name: 'src', value: url });
            continue;
          }
          const mime = png ? 'image/png' : 'image/jpeg';
          // Enforce declared dimensions before asking a decoder to allocate pixels.
          const view = new DataView(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength);
          let dimensions: [number, number] | undefined;
          if (png && file.bytes.length >= 24) dimensions = [view.getUint32(16), view.getUint32(20)];
          else if (jpeg) {
            let p = 2;
            while (p + 4 <= file.bytes.length) {
              if (file.bytes[p++] !== 255) break;
              while (file.bytes[p] === 255) p++;
              const marker = file.bytes[p++];
              if (marker === 217 || marker === 218 || p + 2 > file.bytes.length) break;
              const length = view.getUint16(p);
              if (length < 2 || p + length > file.bytes.length) break;
              if ([192, 193, 194].includes(marker) && length >= 8) { dimensions = [view.getUint16(p + 5), view.getUint16(p + 3)]; break; }
              p += length;
            }
          }
          if (!dimensions || dimensions.some(n => !n) || dimensions[0] * dimensions[1] > 40000000) fail(slide.id, 'image-pixels');
          const bitmap = await bounded(createImageBitmap(new Blob([file.bytes as Uint8Array<ArrayBuffer>], { type: mime })).then(bitmap => { if (signal.aborted) { bitmap.close(); check(); } return bitmap; }));
          try {
            if (bitmap.width * bitmap.height > 40000000) fail(slide.id, 'image-pixels');
            url = dataUrl(file.bytes, mime);
            images[url] = { bytes: file.bytes, mime, widthPx: bitmap.width, heightPx: bitmap.height };
          } finally { bitmap.close(); }
          loaded.set(src, url);
        }
        if (images[url]) pageImages[url] = images[url];
        ops.push({ kind: 'attr', tid: el.tid, name: 'src', value: url });
      }
      slides.push({ id: slide.id, images: pageImages, source: ops.length ? applyHumanOps(slide.source, ops, document.implementation.createHTMLDocument('')).source : slide.source });
    }
    check();
    frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.dataset.pptxCapture = '';
    frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
    // In the viewport (tiny and transparent), not off screen: Chrome stops animation frames in
    // frames out of view, and an embed that never draws hands over a blank picture.
    frame.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;border:0;pointer-events:none;opacity:0;transform:scale(.01);transform-origin:0 0;z-index:-1`;
    const waitMessage = <T>(accept: (data: any) => T | undefined, timeoutMs = 30000): Promise<T> => new Promise((resolve, reject) => {
      check();
      const timeout = setTimeout(() => finish(new Error('capture-deadline')), timeoutMs);
      const onAbort = () => finish(new DOMException('Aborted', 'AbortError'));
      const onMessage = (e: MessageEvent) => { if (e.source === frame?.contentWindow) { const value = accept(e.data); if (value !== undefined) finish(undefined, value); } };
      const cleanup = () => { clearTimeout(timeout); signal.removeEventListener('abort', onAbort); window.removeEventListener('message', onMessage); };
      const finish = (error?: Error, value?: T) => { cleanup(); if (error) reject(error); else resolve(value!); };
      cleanups.push(cleanup); signal.addEventListener('abort', onAbort, { once: true }); window.addEventListener('message', onMessage);
    });
    const ready = waitMessage(data => data?.dc === 'ready' ? true : undefined);
    frame.srcdoc = sandboxDoc(snapshot.runtimeOrigin, 'runtime');
    document.body.appendChild(frame);
    await ready;
    const deck: PptxDeck = { title: snapshot.title, widthPx: width, heightPx: height, widthIn, slides: [], assets: {} };
    const diagnostics: { slide: string; diagnostic: PptxDomDiagnostic }[] = [];
    for (const [index, slide] of slides.entries()) {
      check(); options.progress?.({ done: index, total: slides.length, slide: slide.id });
      const id = `pptx-${index}`;
      const pending = waitMessage<PptxDomResult>(data => data?.dcPptx === 'captured' && data.id === id ? data.result : undefined, 35000);
      frame.contentWindow!.postMessage({ dc: 'render', file: `slides/${slide.id}.html`, source: slide.source, files: snapshot.boards ?? {}, props: {}, mode: 'edit', selected: null, slide: { head, base: '', still: false, size: [width, height] } }, '*');
      frame.contentWindow!.postMessage({ dcPptx: 'capture', id, source: slide.source, title: snapshot.title, images: slide.images, timeoutMs: 30000, widthIn }, '*');
      const result = await pending.catch(error => {
        check();
        throw new DeckPptxError(slide.id, [{ code: 'budget', slide: index, path: 'root', feature: error instanceof Error ? error.message : 'capture-deadline', severity: 'error' }]);
      });
      if (!result || !Array.isArray(result.diagnostics) || result.diagnostics.length > 10000) fail(slide.id, 'capture-protocol');
      if (!result.ok) throw new DeckPptxError(slide.id, result.diagnostics);
      if (result.deck.widthPx !== width || result.deck.heightPx !== height || result.deck.slides.length !== 1) fail(slide.id, 'capture-page');
      const page = result.deck.slides[0];
      const names = new Map<string, string>();
      for (const [key, asset] of Object.entries(result.deck.assets ?? {})) {
        const name = `slide-${index}-${key}`; names.set(key, name); deck.assets![name] = asset;
      }
      for (const object of page.objects) if (object.type === 'image') object.asset = names.get(object.asset) ?? '';
      deck.slides.push(page);
      diagnostics.push(...result.diagnostics.map(diagnostic => ({ slide: slide.id, diagnostic })));
    }
    check(); options.progress?.({ done: slides.length, total: slides.length });
    const { writePptx } = await bounded(import('@dc/export/pptx'));
    const bytes = await bounded(writePptx(deck));
    check();
    return { bytes, diagnostics };
  } finally {
    clearTimeout(timer); controller.abort(); options.signal?.removeEventListener('abort', abort);
    for (const cleanup of cleanups) cleanup();
    frame?.contentWindow?.postMessage({ dcPptx: 'cancel' }, '*'); frame?.remove();
  }
}
