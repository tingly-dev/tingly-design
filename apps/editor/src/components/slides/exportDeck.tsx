import { deckToMarkdown, SLIDE_BASE_CSS, deckSize, sceneBaseCss, applyHumanOps, boardFilesFor, boardFrameDoc, boardSize, isBoardEmbedPath, timeSpec, drawSlideArt, faceMarkup, paintLayer, parseDc, textBoxIndent, slideFile, EMBED_CSP, fxMarkup, FX_STILL_MS, type HumanOp } from '@dc/core';
import { inertDocument } from '../../store';
import { api } from '../../api';
import { deckOf, display, slideIds, toast, useStore } from '../../store';
import { goToSlide, isHidden, notesOf, slideTitle } from './slides';
import { t } from '../../i18n';
import { fileStem, htmlToPng, saveImage } from '../../imageExport';
import { SERVER } from '../../base';
import { pdfHint, printWindow, savePdf } from '../../pdfExport';
import type { ExportItem } from '../FileMenu';
import { FileText, FilePdf, Picture } from '../icons';
import { download } from '../../local';
import { exportDeckPptx } from './PptxExportDialog';

/**
 * Downloads: one self-contained HTML file that plays the deck (images inlined,
 * embeds running in sandboxed frames), the same page laid out one slide per
 * page for the browser's Save as PDF, and the speaker notes as text.
 */

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

/** A slide's markup for a standalone page: relative images inlined, embeds as sandboxed srcdoc frames; built-in effects run on their own clock when `live`, else stand still. */
async function standalone(source: string, base: string, live = false): Promise<string> {
  // the subset's paint order, written out as z-index, and text boxes' list indent
  const ops: HumanOp[] = [];
  for (const el of parseDc(source).elements) {
    const z = paintLayer(el);
    if (z !== undefined) ops.push({ kind: 'style', tid: el.tid, prop: 'z-index', value: String(z) });
    const indent = textBoxIndent(el);
    if (indent !== undefined) ops.push({ kind: 'style', tid: el.tid, prop: '--dc-indent', value: `${indent}px` });
  }
  let out = ops.length ? applyHumanOps(source, ops, inertDocument()).source : source;
  // images beside the deck
  const srcs = [...new Set([...out.matchAll(/<img\b[^>]*?\bsrc="([^"]+)"/g)].map((m) => m[1]))];
  for (const src of srcs) {
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) continue;
    const d = await dataUrl(base + src.replace(/^\.?\//, ''));
    if (d) out = out.split(`src="${src}"`).join(`src="${d}"`);
  }
  // <x-embed src="uploads/…/X.dc.html"> → an empty frame the page's board script fills in (BOARDS)
  out = out.replace(/<x-embed\b([^>]*?)\bsrc="([^"]+)"([^>]*)>[\s\S]*?<\/x-embed>/g, (m, a: string, src: string, b: string) =>
    isBoardEmbedPath(src) ? `<x-embed${a}data-board="${src}"${b}></x-embed>` : m,
  );
  // <x-embed style="…">inner</x-embed> → a sandboxed frame running the same markup
  out = out.replace(/<x-embed\b(?![^>]*\bdata-board=)([^>]*)>([\s\S]*?)<\/x-embed>/g, (_m, attrs: string, inner: string) => {
    // a built-in effect (data-fx) is handed the preset's page
    const fx = /\bdata-fx="([^"]*)"/.exec(attrs);
    if (fx && !inner.trim()) inner = fxMarkup(fx[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'), live ? { live: true } : { at: FX_STILL_MS }) ?? '';
    const doc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${EMBED_CSP}"><style>html,body{margin:0;background:transparent}</style>${inner}`;
    return `<x-embed${attrs}><iframe sandbox="allow-scripts" srcdoc="${esc(doc)}" style="display:block;width:100%;height:100%;border:0;background:transparent"></iframe></x-embed>`;
  });
  return drawSlideArt(out);
}

const player = (W: number, H: number) => `
(function(){
  var slides=[].slice.call(document.querySelectorAll('.deck>.dc-slide-host'));
  var i=Math.max(0,Math.min(slides.length-1,(parseInt(location.hash.slice(1),10)||1)-1));
  function fit(){var k=Math.min(innerWidth/${W},innerHeight/${H});document.documentElement.style.setProperty('--k',k)}
  function show(n){i=Math.max(0,Math.min(slides.length-1,n));slides.forEach(function(s,j){s.style.display=j===i?'':'none'});history.replaceState(null,'','#'+(i+1))}
  addEventListener('resize',fit);fit();show(i);
  addEventListener('keydown',function(e){if(/^(ArrowRight|ArrowDown|PageDown| )$/.test(e.key)){e.preventDefault();show(i+1)}else if(/^(ArrowLeft|ArrowUp|PageUp)$/.test(e.key)){e.preventDefault();show(i-1)}else if(e.key==='Home')show(0);else if(e.key==='End')show(slides.length-1);else if(e.key==='f')document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen()});
  addEventListener('click',function(e){if(!e.target.closest('a'))show(i+(e.clientX<innerWidth/4?-1:1))});
})();`;



/**
 * Artboards imported from a canvas, run in the exported page: the artboard
 * runtime is written into the page once (#dc-boards), and each embed gets a
 * frame running it, sized to cover the embed. A moving artboard loops from
 * when its slide shows; printing, it stands at its still.
 */
const BOARDS = `
(function(){
  var el=document.getElementById('dc-boards');if(!el)return;
  var d=JSON.parse(el.textContent),live=!document.documentElement.hasAttribute('data-print');
  [].forEach.call(document.querySelectorAll('x-embed[data-board]'),function(x){
    var src=x.getAttribute('data-board'),b=d.boards[src];if(!b)return;
    var w=parseFloat(x.style.width)||b.size[0],h=parseFloat(x.style.height)||b.size[1];
    var k=Math.max(w/b.size[0],h/b.size[1]);
    var f=document.createElement('iframe');f.setAttribute('sandbox','allow-scripts');f.setAttribute('tabindex','-1');
    f.style.cssText='position:absolute;left:0;top:0;border:0;background:transparent;transform-origin:0 0;width:'+b.size[0]+'px;height:'+b.size[1]+'px;transform:translate('+(w-b.size[0]*k)/2+'px,'+(h-b.size[1]*k)/2+'px) scale('+k+')';
    x.style.overflow='hidden';
    var props={};try{props=JSON.parse(x.getAttribute('data-props')||'{}')}catch(e){}
    addEventListener('message',function(e){
      if(e.source!==f.contentWindow||!e.data||e.data.dc!=='ready')return;
      f.contentWindow.postMessage({dc:'render',file:src,source:d.files[src],files:d.files,props:props,mode:'play',selected:null},'*');
      if(!live||!b.moving)return;
      var host=x.closest('.dc-slide-host'),t0=null;
      (function tick(now){var on=!host||host.style.display!=='none';if(on&&t0===null)t0=now;if(!on)t0=null;if(on)f.contentWindow.postMessage({dcMotion:'seek',t:now-t0,n:-1},'*');requestAnimationFrame(tick)})(performance.now());
    });
    f.srcdoc=d.doc;x.appendChild(f);
  });
})();`;

/** The data BOARDS runs on, as a script element; empty when no slide embeds an artboard. */
async function boardData(sources: string[]): Promise<string> {
  const s = useStore.getState();
  const files = boardFilesFor(sources, (p) => display(s, p));
  const embedded = Object.keys(files).filter((f) => sources.some((src) => src.includes(`src="${f}"`)));
  if (!embedded.length) return '';
  const runtime = await fetch(`${SERVER}/sandbox/runtime.js`).then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.statusText))));
  const boards = Object.fromEntries(
    embedded.map((f) => {
      const props = parseDc(files[f]).props;
      return [f, { size: boardSize(props) ?? [1280, 720], moving: !!timeSpec(props) }];
    }),
  );
  const json = JSON.stringify({ doc: boardFrameDoc({ inline: runtime }), files, boards }).replace(/</g, '\\u003c');
  return `<script type="application/json" id="dc-boards">${json}</script>`;
}

/** `player` plays the deck; `print` lays it out one slide per page and prints itself; `pdf` is the same layout without the script, for the server's Chrome. */
async function buildHtml(mode: 'player' | 'print' | 'pdf'): Promise<string> {
  const print = mode !== 'player';
  const s = useStore.getState();
  const deck = deckOf(s);
  const [W, H] = deckSize(deck);
  const base = s.project ? api.rawBase(s.project) : '';
  const ids = slideIds(s).filter((id) => !isHidden(id));
  const parts: string[] = [];
  const sources: string[] = [];
  for (const id of ids) {
    const src = display(s, slideFile(id));
    if (src) {
      sources.push(src);
      parts.push(`<div class="dc-slide-host">${await standalone(src, base, !print)}</div>`);
    }
  }
  const boards = await boardData(sources);
  const page = print
    ? `@page{size:${W}px ${H}px;margin:0}html,body{margin:0;background:#fff}.deck>.dc-slide-host{break-after:page}`
    : `html,body{margin:0;height:100%;background:#111;overflow:hidden}.deck{position:absolute;left:50%;top:50%;width:${W}px;height:${H}px;transform:translate(-50%,-50%) scale(var(--k,1))}`;
  return `<!doctype html>
<html${print ? ' data-print' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(deck.title)}</title>
${faceMarkup(deck)}
<style>${sceneBaseCss(W, H, SLIDE_BASE_CSS)}${page}</style>
</head>
<body>
<div class="deck">
${parts.join('\n')}
</div>
${boards ? `${boards}\n<script>${BOARDS}</script>` : ''}
${mode === 'print' ? '<script>addEventListener("load",function(){setTimeout(function(){print()},800)})</script>' : mode === 'player' ? `<script>${player(W, H)}</script>` : ''}
</body>
</html>
`;
}

export async function exportDeck(kind: 'pdf' | 'html' | 'md' | 'notes'): Promise<void> {
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
    if (kind === 'md') {
      const slides = slideIds(s).flatMap((id) => {
        const source = display(s, slideFile(id));
        return source ? [{ id, source }] : [];
      });
      return download(`${name}.md`, new Blob([deckToMarkdown(deck, slides, { notesLabel: t('slides.export.mdNotes') })], { type: 'text/markdown;charset=utf-8' }));
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
  const [W, H] = deckSize(deck);
  const src = display(s, slideFile(id));
  if (!src) throw new Error(id);
  const base = s.project ? api.rawBase(s.project) : '';
  const html = `<!doctype html><html><head><meta charset="utf-8">${faceMarkup(deck)}<style>${sceneBaseCss(W, H, SLIDE_BASE_CSS)}html,body{margin:0;background:#fff}</style></head><body><div class="dc-slide-host">${await standalone(src, base)}</div></body></html>`;
  return htmlToPng(html, { width: W, height: H, scale });
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

/** Shows one slide, by its id or its number in the deck (headless.ts). */
export function pickSlide(what: string): boolean {
  const ids = slideIds(useStore.getState());
  const id = ids.includes(what) ? what : /^\d+$/.test(what) ? ids[Number(what) - 1] : undefined;
  if (!id) return false;
  goToSlide(id);
  return true;
}

/** What the menu offers for a deck, in the order people ask for it: the one-file PDF first. */
export function slidesExportItems(direct: boolean | null): ExportItem[] {
  return [
    { id: 'pdf', label: t('common.transfer.label.pdf'), hint: pdfHint(t('common.transfer.hint.slidesPdf'), direct), icon: <FilePdf />, run: () => exportDeck('pdf') },
    { id: 'pptx', label: t('slides.pptx.label'), hint: t('slides.pptx.hint'), icon: <FileText />, run: exportDeckPptx },
    { id: 'png', label: t('common.transfer.label.png'), hint: t('common.transfer.hint.slideOne'), icon: <Picture />, run: () => exportSlideImages(useStore.getState().slide) },
    { id: 'pngs', label: t('common.transfer.label.pngs'), hint: t('common.transfer.hint.slidesEvery'), icon: <Picture />, run: () => exportSlideImages(true) },
    { id: 'html', label: t('common.transfer.label.html'), hint: t('common.transfer.hint.slidesHtml'), icon: <FileText />, rule: true, run: () => exportDeck('html') },
    { id: 'md', label: t('common.transfer.label.markdown'), hint: t('common.transfer.hint.slidesMarkdown'), icon: <FileText />, run: () => exportDeck('md') },
    { id: 'notes', label: t('common.transfer.label.notes'), hint: t('common.transfer.hint.slidesNotes'), icon: <FileText />, run: () => exportDeck('notes') },
  ];
}
