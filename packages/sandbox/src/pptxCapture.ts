/** Private serializable capture bridge. DOM never leaves the opaque-origin runtime. */
import { slidesDomToPptx, type PptxDomResult } from '@dc/export/pptx-dom';
import type { PptxAsset } from '@dc/export/pptx';

export interface PptxCaptureRequest {
  dcPptx: 'capture'; id: string; source: string; title: string;
  images: Record<string, PptxAsset>; timeoutMs: number;
}
export type PptxCaptureReply = { dcPptx: 'captured'; id: string; result: PptxDomResult };

/** Installed by the ordinary slide renderer, using its committed source as a fence. */
export function answerPptxCapture(mount: HTMLElement, committed: () => string): void {
  let active: AbortController | undefined;
  window.addEventListener('message', async (event) => {
    if (event.source !== window.parent || !event.data) return;
    if (event.data.dcPptx === 'cancel') { active?.abort(); return; }
    if (event.data.dcPptx !== 'capture') return;
    const m = event.data as PptxCaptureRequest;
    if (typeof m.id !== 'string' || m.id.length > 100 || typeof m.source !== 'string' || m.source.length > 150 * 1024 * 1024 || typeof m.title !== 'string' || !Number.isSafeInteger(m.timeoutMs) || m.timeoutMs < 1 || m.timeoutMs > 30000) return;
    active?.abort();
    const controller = new AbortController();
    active = controller;
    const timer = setTimeout(() => controller.abort(), m.timeoutMs);
    const signal = controller.signal;
    const pause = () => new Promise<void>((resolve, reject) => {
      const timer = setTimeout(done, 10);
      function done() { signal.removeEventListener('abort', aborted); resolve(); }
      function aborted() { clearTimeout(timer); reject(new Error('deadline')); }
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted();
    });
    let result: PptxDomResult;
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
      if (signal.aborted) throw new Error('deadline');
      result = await slidesDomToPptx([section], {
        title: m.title, widthIn: 13.333333, signal, paintOrder: 'tingly-slide-v1',
        limits: { timeoutMs: m.timeoutMs },
        resolveImage: async image => {
          const asset = m.images?.[image.getAttribute('src') ?? ''];
          if (!asset) throw new Error('asset');
          return asset;
        },
      });
    } catch (error) {
      result = { ok: false, diagnostics: [{ code: signal.aborted ? 'budget' : 'not-ready', slide: 0, path: 'root', feature: error instanceof Error ? error.message : 'capture', severity: 'error' }] };
    } finally { clearTimeout(timer); if (active === controller) active = undefined; }
    window.parent.postMessage({ dcPptx: 'captured', id: m.id, result } satisfies PptxCaptureReply, '*');
  });
}
