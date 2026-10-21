/** Private serializable capture bridge. DOM never leaves the opaque-origin runtime. */
import { slidesDomToPptx, type PptxDomResult, type PptxRaster } from '@dc/export/pptx-dom';
import type { PptxAsset } from '@dc/export/pptx';
import { FrameRasterizer } from '@dc/export/frames';
import { snapFrames } from '@dc/export/snap';

export interface PptxCaptureRequest {
  dcPptx: 'capture'; id: string; source: string; title: string;
  images: Record<string, PptxAsset>; timeoutMs: number; widthIn: number;
}
export type PptxCaptureReply = { dcPptx: 'captured'; id: string; result: PptxDomResult };

/** Output pixels per CSS pixel of an element's picture: sharp on a projector, bounded in size. */
const SCALE = 2;
/** CSS pixels around an element's boxes where its shadow or pseudo-elements may still paint. */
const BLEED = 160;
const ISOLATE = `[data-dc-pptx-iso]{visibility:hidden!important}
[data-dc-pptx-iso][data-dc-pptx-target],[data-dc-pptx-iso] [data-dc-pptx-target]{visibility:visible!important}
[data-dc-pptx-target=self]>*{visibility:hidden!important}
[data-dc-pptx-target=self]{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;text-decoration-color:transparent!important}`;

/** A picture of one element as painted in place: everything else on the slide is hidden
 * (visibility keeps the layout), the slide is drawn the way image export draws it, and the
 * picture is cropped to what the element actually painted, shadows included. Embedded
 * frames hand over pictures of themselves. */
async function rasterizeElement(section: HTMLElement, el: Element, mode: 'subtree' | 'self', rasterizer: FrameRasterizer, signal: AbortSignal): Promise<PptxRaster | null> {
  const width = section.offsetWidth, height = section.offsetHeight;
  let frames = new Map<Element, string>();
  if (mode === 'subtree') {
    const all = Array.from(el.querySelectorAll('iframe')).concat(el.tagName === 'IFRAME' ? [el as HTMLIFrameElement] : []);
    frames = await snapFrames(all, 4000);
    // a frame that is still starting has not drawn yet: ask those again once
    const late = all.filter(f => !frames.has(f));
    if (late.length && !signal.aborted) {
      await new Promise(r => setTimeout(r, 500));
      for (const [f, url] of await snapFrames(late, 4000)) frames.set(f, url);
    }
  }
  if (signal.aborted) throw new Error('budget');
  // Where it can have painted: its boxes and text, plus room for a shadow. Only that much is scanned.
  const page = section.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = [el.getBoundingClientRect(), range.getBoundingClientRect(), ...Array.from(el.querySelectorAll('*')).map(c => c.getBoundingClientRect())].filter(r => r.width || r.height);
  range.detach();
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v * SCALE)));
  const area = {
    left: clamp(Math.min(...rects.map(r => r.left)) - page.left - BLEED, width * SCALE), top: clamp(Math.min(...rects.map(r => r.top)) - page.top - BLEED, height * SCALE),
    right: clamp(Math.max(...rects.map(r => r.right)) - page.left + BLEED, width * SCALE), bottom: clamp(Math.max(...rects.map(r => r.bottom)) - page.top + BLEED, height * SCALE),
  };
  if (!rects.length || area.right <= area.left || area.bottom <= area.top) return null;
  const style = document.createElement('style');
  style.textContent = ISOLATE;
  document.head.appendChild(style);
  section.setAttribute('data-dc-pptx-iso', '');
  el.setAttribute('data-dc-pptx-target', mode);
  let canvas: HTMLCanvasElement;
  try {
    const frame = await rasterizer.begin(section, frames);
    await frame.ready;
    canvas = document.createElement('canvas');
    canvas.width = width * SCALE; canvas.height = height * SCALE;
    frame.draw(canvas);
  } finally {
    el.removeAttribute('data-dc-pptx-target');
    section.removeAttribute('data-dc-pptx-iso');
    style.remove();
  }
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  const aw = area.right - area.left, ah = area.bottom - area.top;
  const { data } = g.getImageData(area.left, area.top, aw, ah);
  let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
  for (let y = 0; y < ah; y++) {
    const row = y * aw * 4;
    for (let x = 0; x < aw; x++) {
      if (data[row + x * 4 + 3] === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      bottom = y;
    }
  }
  if (right < 0) return null;
  left += area.left; right += area.left; top += area.top; bottom += area.top;
  const w = right - left + 1, h = bottom - top + 1;
  const crop = document.createElement('canvas');
  crop.width = w; crop.height = h;
  crop.getContext('2d')!.drawImage(canvas, left, top, w, h, 0, 0, w, h);
  const blob = await new Promise<Blob | null>(resolve => crop.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('rasterization');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { asset: { bytes, mime: 'image/png', widthPx: w, heightPx: h }, x: left / SCALE, y: top / SCALE, width: w / SCALE, height: h / SCALE };
}

/** Installed by the ordinary slide renderer, using its committed source as a fence. */
export function answerPptxCapture(mount: HTMLElement, committed: () => string): void {
  let active: AbortController | undefined;
  window.addEventListener('message', async (event) => {
    if (event.source !== window.parent || !event.data) return;
    if (event.data.dcPptx === 'cancel') { active?.abort(); return; }
    if (event.data.dcPptx !== 'capture') return;
    const m = event.data as PptxCaptureRequest;
    if (typeof m.id !== 'string' || m.id.length > 100 || typeof m.source !== 'string' || m.source.length > 150 * 1024 * 1024 || typeof m.title !== 'string' || !Number.isSafeInteger(m.timeoutMs) || m.timeoutMs < 1 || m.timeoutMs > 30000 || !(m.widthIn >= 1 && m.widthIn <= 56)) return;
    active?.abort();
    const controller = new AbortController();
    active = controller;
    const timer = setTimeout(() => controller.abort(), m.timeoutMs);
    const signal = controller.signal;
    const pause = (ms = 10) => new Promise<void>((resolve, reject) => {
      const timer = setTimeout(done, ms);
      function done() { signal.removeEventListener('abort', aborted); resolve(); }
      function aborted() { clearTimeout(timer); reject(new Error('deadline')); }
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted();
    });
    let result: PptxDomResult;
    let rasterizer: FrameRasterizer | undefined;
    try {
      while (committed() !== m.source) await pause();
      const section = mount.querySelector<HTMLElement>('.dc-slide-host > section');
      if (!section) throw new Error('section');
      // Force style/font discovery before waiting; ready alone may resolve before layout.
      section.getBoundingClientRect();
      while (document.fonts.status !== 'loaded') await pause();
      if (Array.from(document.fonts).some(face => face.status === 'error')) throw new Error('font');
      const images = Array.from(section.querySelectorAll('img')).filter(image => image.getClientRects().length && getComputedStyle(image).visibility === 'visible');
      while (images.some(image => !image.complete)) await pause();
      if (images.some(image => !image.naturalWidth)) throw new Error('image');
      // embeds run their own pages: give them a moment to draw before a picture is asked of them
      if (section.querySelector('iframe')) await pause(600);
      if (signal.aborted) throw new Error('deadline');
      const fonts = Array.from(document.querySelectorAll('style')).map(s => s.textContent ?? '').filter(css => css.includes('@font-face')).join('\n');
      rasterizer = new FrameRasterizer({ width: section.offsetWidth, height: section.offsetHeight, fontEmbedCSS: fonts });
      const drawer = rasterizer;
      result = await slidesDomToPptx([section], {
        title: m.title, widthIn: m.widthIn, signal,
        limits: { timeoutMs: m.timeoutMs },
        resolveImage: async image => {
          const asset = m.images?.[image.getAttribute('src') ?? ''];
          // a picture PowerPoint cannot hold as it is (SVG, WebP, GIF) is drawn instead
          if (!asset) throw new Error('image-format');
          return asset;
        },
        rasterizeElement: (el, context) => rasterizeElement(section, el, context.mode, drawer, signal),
      });
    } catch (error) {
      result = { ok: false, diagnostics: [{ code: signal.aborted ? 'budget' : 'not-ready', slide: 0, path: 'root', feature: error instanceof Error ? error.message : 'capture', severity: 'error' }] };
    } finally { clearTimeout(timer); rasterizer?.dispose(); if (active === controller) active = undefined; }
    window.parent.postMessage({ dcPptx: 'captured', id: m.id, result } satisfies PptxCaptureReply, '*');
  });
}
