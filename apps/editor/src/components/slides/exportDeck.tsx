import { SLIDE_BASE_CSS, SLIDE_H, SLIDE_W, applyHumanOps, drawSlideArt, faceMarkup, paintLayer, parseDc, slideFile, EMBED_CSP, type HumanOp } from '@dc/core';
import { inertDocument } from '../../store';
import { api } from '../../api';
import { deckOf, display, slideIds, toast, useStore } from '../../store';
import { isHidden, notesOf, slideTitle } from '../../slides';
import { t } from '../../i18n';
import { fileStem, htmlToPng, saveImage } from '../../imageExport';
import { pdfHint, printWindow, savePdf } from '../../pdfExport';
import type { ExportItem } from '../FileMenu';
import { FileText, FilePdf, Picture } from '../icons';

/**
 * Downloads: one self-contained HTML file that plays the deck (images inlined,
 * embeds running in sandboxed frames), the same page laid out one slide per
 * page for the browser's Save as PDF, and the speaker notes as text.
 */

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function dataUrl(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const b = await r.blob();
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(b);
    });
  } catch {
    return null;
  }
}

/** A slide's markup for a standalone page: relative images inlined, embeds as sandboxed srcdoc frames. */
async function standalone(source: string, base: string): Promise<string> {
  // the subset's paint order, written out as z-index
  const ops: HumanOp[] = [];
  for (const el of parseDc(source).elements) {
    const z = paintLayer(el);
    if (z !== undefined) ops.push({ kind: 'style', tid: el.tid, prop: 'z-index', value: String(z) });
  }
  let out = ops.length ? applyHumanOps(source, ops, inertDocument()).source : source;
  // images beside the deck
  const srcs = [...new Set([...out.matchAll(/<img\b[^>]*?\bsrc="([^"]+)"/g)].map((m) => m[1]))];
  for (const src of srcs) {
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) continue;
    const d = await dataUrl(base + src.replace(/^\.?\//, ''));
    if (d) out = out.split(`src="${src}"`).join(`src="${d}"`);
  }
  // <x-embed style="…">inner</x-embed> → a sandboxed frame running the same markup
  out = out.replace(/<x-embed\b([^>]*)>([\s\S]*?)<\/x-embed>/g, (_m, attrs: string, inner: string) => {
    const doc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${EMBED_CSP}"><style>html,body{margin:0;background:transparent}</style>${inner}`;
    return `<x-embed${attrs}><iframe sandbox="allow-scripts" srcdoc="${esc(doc)}" style="display:block;width:100%;height:100%;border:0;background:transparent"></iframe></x-embed>`;
  });
  return drawSlideArt(out);
}

const PLAYER = `
(function(){
  var slides=[].slice.call(document.querySelectorAll('.deck>.dc-slide-host'));
  var i=Math.max(0,Math.min(slides.length-1,(parseInt(location.hash.slice(1),10)||1)-1));
  function fit(){var k=Math.min(innerWidth/${SLIDE_W},innerHeight/${SLIDE_H});document.documentElement.style.setProperty('--k',k)}
  function show(n){i=Math.max(0,Math.min(slides.length-1,n));slides.forEach(function(s,j){s.style.display=j===i?'':'none'});history.replaceState(null,'','#'+(i+1))}
  addEventListener('resize',fit);fit();show(i);
  addEventListener('keydown',function(e){if(/^(ArrowRight|ArrowDown|PageDown| )$/.test(e.key)){e.preventDefault();show(i+1)}else if(/^(ArrowLeft|ArrowUp|PageUp)$/.test(e.key)){e.preventDefault();show(i-1)}else if(e.key==='Home')show(0);else if(e.key==='End')show(slides.length-1);else if(e.key==='f')document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen()});
  addEventListener('click',function(e){if(!e.target.closest('a'))show(i+(e.clientX<innerWidth/4?-1:1))});
})();`;



/** `player` plays the deck; `print` lays it out one slide per page and prints itself; `pdf` is the same layout without the script, for the server's Chrome. */
async function buildHtml(mode: 'player' | 'print' | 'pdf'): Promise<string> {
  const print = mode !== 'player';
  const s = useStore.getState();
  const deck = deckOf(s);
  const base = s.project ? api.rawBase(s.project) : '';
  const ids = slideIds(s).filter((id) => !isHidden(id));
  const parts: string[] = [];
  for (const id of ids) {
    const src = display(s, slideFile(id));
    if (src) parts.push(`<div class="dc-slide-host">${await standalone(src, base)}</div>`);
  }
  const page = print
    ? `@page{size:${SLIDE_W}px ${SLIDE_H}px;margin:0}html,body{margin:0;background:#fff}.deck>.dc-slide-host{break-after:page}`
    : `html,body{margin:0;height:100%;background:#111;overflow:hidden}.deck{position:absolute;left:50%;top:50%;width:${SLIDE_W}px;height:${SLIDE_H}px;transform:translate(-50%,-50%) scale(var(--k,1))}`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(deck.title)}</title>
${faceMarkup(deck)}
<style>${SLIDE_BASE_CSS}${page}</style>
</head>
<body>
<div class="deck">
${parts.join('\n')}
</div>
${mode === 'print' ? '<script>addEventListener("load",function(){setTimeout(function(){print()},800)})</script>' : mode === 'player' ? `<script>${PLAYER}</script>` : ''}
</body>
</html>
`;
}

export async function exportDeck(kind: 'pdf' | 'html' | 'notes'): Promise<void> {
  const s = useStore.getState();
  const deck = deckOf(s);
  const name = (deck.title || 'deck').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'deck';
  try {
    if (kind === 'notes') {
      const text = slideIds(s)
        .map((id, i) => {
          const src = display(s, slideFile(id));
          return `${i + 1}. ${slideTitle(src, id)}\n${notesOf(src) || t('slides.export.noNotes')}\n`;
        })
        .join('\n');
      return download(t('slides.export.notesFile', { name }), new Blob([text], { type: 'text/plain;charset=utf-8' }));
    }
    if (kind === 'html') return download(`${name}.html`, new Blob([await buildHtml('player')], { type: 'text/html' }));
    // Chrome on the machine prints it and the file is saved; with none, the browser's print window opens and the person picks Save as PDF
    await savePdf(`${name}.pdf`, {
      html: await buildHtml('pdf'),
      paper: 'page',
      print: async () => {
        if (printWindow(await buildHtml('print'))) toast(t('slides.export.savePdf'));
      },
    });
  } catch (e) {
    toast((e as Error).message, 'error');
  }
}

/** One slide drawn on its own page, at the slide's size. Embeds are separate frames and come out empty. */
async function slidePng(id: string, scale: number): Promise<Blob> {
  const s = useStore.getState();
  const deck = deckOf(s);
  const src = display(s, slideFile(id));
  if (!src) throw new Error(id);
  const base = s.project ? api.rawBase(s.project) : '';
  const html = `<!doctype html><html><head><meta charset="utf-8">${faceMarkup(deck)}<style>${SLIDE_BASE_CSS}html,body{margin:0;background:#fff}</style></head><body><div class="dc-slide-host">${await standalone(src, base)}</div></body></html>`;
  return htmlToPng(html, { width: SLIDE_W, height: SLIDE_H, scale });
}

/** The slide at `id` (null: the first; true: every shown slide) as PNG files. */
export async function exportSlideImages(which: string | null | true): Promise<void> {
  const s = useStore.getState();
  const stem = fileStem(deckOf(s).title, 'deck');
  const ids = which === true ? slideIds(s).filter((id) => !isHidden(id)) : [which ?? slideIds(s)[0]];
  for (const [i, id] of ids.entries()) {
    const n = which === true ? i + 1 : slideIds(s).indexOf(id) + 1;
    if (!(await saveImage(t('common.image.fileSlide', { name: stem, n }), () => slidePng(id, 1)))) return;
  }
  if (ids.length > 1) toast(t('slides.export.imagesDone', { total: ids.length }));
}

/** What the menu offers for a deck, in the order people ask for it: the one-file PDF first. */
export function slidesExportItems(direct: boolean | null): ExportItem[] {
  return [
    { id: 'pdf', label: t('common.transfer.label.pdf'), hint: pdfHint(t('common.transfer.hint.slidesPdf'), direct), icon: <FilePdf />, run: () => exportDeck('pdf') },
    { id: 'png', label: t('common.transfer.label.png'), hint: t('common.transfer.hint.slideOne'), icon: <Picture />, run: () => exportSlideImages(useStore.getState().slide) },
    { id: 'pngs', label: t('common.transfer.label.pngs'), hint: t('common.transfer.hint.slidesEvery'), icon: <Picture />, run: () => exportSlideImages(true) },
    { id: 'html', label: t('common.transfer.label.html'), hint: t('common.transfer.hint.slidesHtml'), icon: <FileText />, rule: true, run: () => exportDeck('html') },
    { id: 'notes', label: t('common.transfer.label.notes'), hint: t('common.transfer.hint.slidesNotes'), icon: <FileText />, run: () => exportDeck('notes') },
  ];
}
