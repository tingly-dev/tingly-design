/**
 * Pictures of what a frame shows, taken by the frame itself.
 *
 * A picture of the page (`FrameRasterizer`, `rasterize`) goes through an SVG
 * foreignObject, which cannot draw an <iframe>, and a sandboxed frame cannot
 * be read from outside. So the page asks each frame for a picture of itself:
 *
 *   page → frame   { dcSnap: 'take', n }
 *   frame → page   { dcSnap: 'taken', n, url }   (a data: URL; no url when it could not)
 *
 * The frame draws its own DOM the same way the page does, draws its canvases
 * (a WebGL effect) straight in, and hands back JPEG when the picture is
 * opaque, PNG when it is not. The page then puts that picture where the frame
 * is (`FrameOptions.frames`). Nothing but pixels leaves the frame, and the
 * frame keeps its sandbox. See .design/export.md.
 */
import { FrameRasterizer } from './frames';

const TAKE = 'take';
const TAKEN = 'taken';

/**
 * Answer the page's requests for a picture of this frame. Call once, as the
 * frame starts; a page that never asks costs nothing.
 */
export function answerSnaps(): void {
  const w = window as unknown as { __dcSnap?: boolean };
  if (w.__dcSnap) return;
  w.__dcSnap = true;
  let dom: FrameRasterizer | null = null;
  let size = '';
  addEventListener('message', (e: MessageEvent) => {
    if (e.source !== parent || e.data?.dcSnap !== TAKE) return;
    const n = e.data.n;
    const reply = (url?: string) => parent.postMessage({ dcSnap: TAKEN, n, url }, '*');
    void (async () => {
      const width = Math.max(1, innerWidth);
      const height = Math.max(1, innerHeight);
      if (`${width}x${height}` !== size) {
        dom?.dispose();
        // canvases are drawn straight in below, not copied through a PNG
        dom = new FrameRasterizer({ width, height, fontEmbedCSS: fontFaces(), filter: (node) => node.nodeName !== 'CANVAS' });
        size = `${width}x${height}`;
      }
      const out = new OffscreenCanvas(width, height);
      const g = out.getContext('2d')!;
      const canvases = Array.from(document.querySelectorAll('canvas'));
      // a frame that is only a canvas (a shader effect) needs no copy of its DOM
      if (!onlyCanvases(canvases)) {
        const f = await dom!.begin(document.body ?? document.documentElement);
        await f.ready;
        f.draw(out);
      }
      for (const c of canvases) {
        const r = c.getBoundingClientRect();
        if (r.width && r.height) g.drawImage(c, r.left, r.top, r.width, r.height);
      }
      const blob = await out.convertToBlob(opaque(out) ? { type: 'image/jpeg', quality: 0.92 } : { type: 'image/png' });
      reply(await asDataUrl(blob));
    })().catch(() => reply());
  });
}

/**
 * Ask a frame for a picture of itself; null when it does not answer within
 * `timeout` (a frame without `answerSnaps`, or one that failed).
 */
export function snapFrame(frame: HTMLIFrameElement, timeout = 4000): Promise<string | null> {
  const win = frame.contentWindow;
  if (!win) return Promise.resolve(null);
  const n = ++asked;
  return new Promise((resolve) => {
    const done = (url: string | null) => {
      clearTimeout(timer);
      removeEventListener('message', onMsg);
      resolve(url);
    };
    const onMsg = (e: MessageEvent) => {
      if (e.source === win && e.data?.dcSnap === TAKEN && e.data.n === n) done(typeof e.data.url === 'string' && e.data.url.startsWith('data:image/') ? e.data.url : null);
    };
    const timer = setTimeout(() => done(null), timeout);
    addEventListener('message', onMsg);
    win.postMessage({ dcSnap: TAKE, n }, '*');
  });
}

/** Pictures of these frames, by frame; a frame that gave none is left out (it stays blank). */
export async function snapFrames(frames: HTMLIFrameElement[], timeout?: number): Promise<Map<Element, string>> {
  const urls = await Promise.all(frames.map((f) => snapFrame(f, timeout)));
  const out = new Map<Element, string>();
  frames.forEach((f, i) => urls[i] && out.set(f, urls[i]!));
  return out;
}

let asked = 0;

function onlyCanvases(canvases: HTMLCanvasElement[]): boolean {
  if (!canvases.length) return false;
  const body = document.body;
  return !!body && !body.innerText.trim() && !body.querySelector('img,svg,video,picture,input,textarea,button');
}

/** True when nothing in the picture lets what is behind it through (checked on a small copy). */
function opaque(c: OffscreenCanvas): boolean {
  const probe = new OffscreenCanvas(48, 27).getContext('2d', { willReadFrequently: true })!;
  probe.drawImage(c, 0, 0, 48, 27);
  const px = probe.getImageData(0, 0, 48, 27).data;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 255) return false;
  return true;
}

/** The frame's own @font-face rules, so its text keeps its faces in the copy (a face it loads from a data: URL comes along whole). */
function fontFaces(): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const r of Array.from(sheet.cssRules)) if (r instanceof CSSFontFaceRule) out.push(r.cssText);
    } catch {
      /* a sheet from elsewhere cannot be read */
    }
  }
  return out.join('\n');
}

function asDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
