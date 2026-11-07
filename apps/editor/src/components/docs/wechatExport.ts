import { figureKey, markdownToWechat, wechatFigures, type DocLook, type WechatOptions, type WechatPicture, type WechatResult } from '@dc/core';
import { download } from '../../local';
import { t } from '../../i18n';
import { toast } from '../../store';
import { nodeToPng } from '../../imageExport';
import { docArticle, fetchPictures } from './markdownExport';
import { drawDiagram, drawMath } from './richCode';

/**
 * A doc (or one tab) as what the WeChat Official Account editor keeps on paste (.design/wechat-export.md):
 * core writes the HTML, this side supplies what the browser alone can make: the pictures cut down to a
 * size the editor accepts, and the diagrams and formulas drawn into pictures.
 */

/** the widest a picture is kept: the editor's column is under 700 px, a phone screen draws it at 2 to 3x */
const MAX_WIDTH = 1080;
/** a picture over this is saved again as a JPEG; the platform's own limit for the pictures of an article is about 1 MB */
const BIG = 1_000_000;

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

function dataUri(bytes: Uint8Array, mime: string): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(s)}`;
}

function blobUri(blob: Blob): Promise<string> {
  return new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(r.error);
    r.readAsDataURL(blob);
  });
}

async function load(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await new Promise((ok, no) => ((img.onload = ok), (img.onerror = () => no(new Error('picture')))));
  return img;
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob | null>((ok) => c.toBlob(ok, type, q));

/** The picture, no wider than the column wants and, when it is heavy, as a JPEG. An animated GIF is passed through as it is. */
export async function wechatPicture(bytes: Uint8Array, path: string): Promise<WechatPicture | null> {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1].toLowerCase() ?? 'png';
  const mime = MIME[ext] ?? 'image/png';
  // an SVG goes in as a data: address: from a blob: one a drawing that holds a foreignObject (a Mermaid label) taints the canvas
  const url = ext === 'svg' ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new TextDecoder().decode(bytes))}` : URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  try {
    const img = await load(url);
    // an SVG with only a viewBox has no size of its own to the browser
    const text = ext === 'svg' ? new TextDecoder().decode(bytes.subarray(0, 4096)) : '';
    const box = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
    const w = img.naturalWidth || Number(box?.[1]) || 800;
    const h = img.naturalHeight || Number(box?.[2]) || 600;
    if (ext === 'gif' && bytes.length <= 9_000_000) return { src: dataUri(bytes, mime), width: w, height: h };
    const scale = ext === 'svg' ? 2 : Math.min(1, MAX_WIDTH / w);
    if (scale === 1 && ext !== 'svg' && bytes.length <= BIG) return { src: dataUri(bytes, mime), width: w, height: h };
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    let out = await toBlob(canvas, ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png', 0.85);
    // a heavy PNG (a photograph or a screenshot) is smaller as a JPEG
    if (out && out.size > BIG && ext !== 'svg') out = (await toBlob(canvas, 'image/jpeg', 0.85)) ?? out;
    if (!out) return null;
    return { src: await blobUri(out), width: ext === 'svg' ? w : canvas.width, height: ext === 'svg' ? h : canvas.height };
  } catch {
    return null;
  } finally {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  }
}

/** An SVG element drawn to a PNG at twice its size, on white. */
async function svgPicture(svg: SVGSVGElement): Promise<WechatPicture | null> {
  if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const bytes = new TextEncoder().encode(new XMLSerializer().serializeToString(svg));
  return wechatPicture(bytes, 'figure.svg');
}

/** A formula or a diagram as a picture on white, whatever the editor's theme is. */
async function figurePicture(kind: 'diagram' | 'math', source: string): Promise<WechatPicture | null> {
  const into = document.createElement('div');
  if (kind === 'diagram') {
    await drawDiagram(into, source, true);
    const svg = into.querySelector('svg');
    return svg ? svgPicture(svg as unknown as SVGSVGElement) : null;
  }
  await drawMath(into, source);
  Object.assign(into.style, { position: 'fixed', left: '-100000px', top: '0', display: 'inline-block', background: '#fff', color: '#111', padding: '8px 16px', fontSize: '18px' });
  document.body.appendChild(into);
  try {
    const { width, height } = into.getBoundingClientRect();
    // the picture copies the node's own position: put it back in its place or it draws a page of nothing
    const blob = await nodeToPng(into, { scale: 2, backgroundColor: '#fff', style: { position: 'static', left: '0', top: '0' } });
    return { src: await blobUri(blob), width: Math.ceil(width), height: Math.ceil(height) };
  } finally {
    into.remove();
  }
}

/** What the browser had to make once (the pictures, the drawn blocks); the look is applied on top, as often as it is changed. */
export interface WechatPrepared {
  markdown: string;
  options: WechatOptions;
}

/** The pictures and drawings of the doc (or one tab), ready for `renderWechat`. */
export async function prepareWechat(only?: string): Promise<WechatPrepared> {
  const { markdown, images } = docArticle(only);
  const got = await fetchPictures(images);
  const pictures: NonNullable<WechatOptions['images']> = new Map();
  const figures: NonNullable<WechatOptions['figures']> = new Map();
  await Promise.all([
    ...images.map(async (path, i) => {
      const data = got[i];
      const done = data ? await wechatPicture(data, path) : null;
      if (done) pictures.set(path, done);
    }),
    ...wechatFigures(markdown).map(async (f) => {
      try {
        const done = await figurePicture(f.kind, f.source);
        if (done) figures.set(figureKey(f.lang, f.source), done);
      } catch {
        // left out, and said in the issue list
      }
    }),
  ]);
  return { markdown, options: { images: pictures, figures } };
}

/** The article in the look the doc wears: what the editor shows is what is pasted. */
export function renderWechat(prepared: WechatPrepared, look: DocLook): WechatResult {
  return markdownToWechat(prepared.markdown, { ...prepared.options, look }, t('docs.wechat.references'));
}

/** The page that holds the article: open it in a browser, select all, copy, paste. It is also what the preview shows. */
export function wechatPage(html: string, title: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title.replace(/[<&]/g, '')}</title></head><body style="margin:0;padding:16px 0;background:#ffffff;">${html}</body></html>`;
}

/**
 * Puts the article on the clipboard as rich text (`text/html` and its plain twin). A page that may not
 * write it gets the staged-selection copy, and one that cannot do that either gets the page as a file,
 * said in a toast. Returns whether it reached the clipboard.
 */
export async function copyWechat(doc: WechatResult, name: string): Promise<boolean> {
  try {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') throw new Error('no rich clipboard');
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([doc.html], { type: 'text/html' }), 'text/plain': new Blob([doc.text], { type: 'text/plain' }) })]);
    toast(t('docs.wechat.copied'));
    return true;
  } catch {
    const stage = document.createElement('div');
    stage.innerHTML = doc.html;
    Object.assign(stage.style, { position: 'fixed', left: '-100000px', top: '0', opacity: '0' });
    document.body.appendChild(stage);
    try {
      const range = document.createRange();
      range.selectNodeContents(stage);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      if (document.execCommand('copy')) {
        toast(t('docs.wechat.copied'));
        return true;
      }
    } catch {
      // fall through to the file
    } finally {
      window.getSelection()?.removeAllRanges();
      stage.remove();
    }
    download(`${name}.html`, wechatPage(doc.html, name), 'text/html');
    toast(t('docs.wechat.copyFallback'));
    return false;
  }
}

export function saveWechat(doc: WechatResult, name: string): void {
  download(`${name}.html`, wechatPage(doc.html, name), 'text/html');
}
