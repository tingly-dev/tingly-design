import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { InlineRename } from '../InlineRename';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import { elementSource, roleOf, rootElement, sandboxDoc, retypeKind, setPropDefault, tweakTextBinding, type BoardEntry, type FromRuntime, type ToRuntime } from '@dc/core';
import { canvasOf, display, edit, editElement, parsed, retypeText, toast, useStore } from '../../store';
import { focusBoard, onPage } from './view';
import { insertHtml, updateBoard } from '../../actions';
import { handleWheel } from './Canvas';
import { handleKey, leaveField } from '../../shortcuts';
import { CopyPicture, Download, Expand, FileText, Picture } from '../icons';
import type { ExportItem } from '../FileMenu';
import { Menu, MenuItem } from '../Menu';
import { SERVER } from '../../base';
import { api } from '../../api';
import { t as tr, htmlLang } from '../../i18n';
import { downloadUrl } from '../../local';
import { copyImage, dataUrlBlob } from '../../imageExport';

const EMPTY: Record<string, string> = {};
const SNAP = 8;
const snap = (v: number) => Math.round(v / SNAP) * SNAP;

/** Live artboard frames, so the panel, menus and export can talk to them. */
export const frames = new Map<string, HTMLIFrameElement>();
/** Frames whose runtime has said it is ready, so a picture asked of them gets an answer. */
const readyFrames = new Set<string>();
const exports = new Map<string, (r: { dataUrl?: string; error?: string }) => void>();

export function post(file: string, msg: ToRuntime): void {
  frames.get(file)?.contentWindow?.postMessage(msg, '*');
}

export function exportPng(file: string, scale = 2, tid?: number): Promise<string> {
  const id = Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => (exports.delete(id), reject(new Error(tr('canvas.export.timeout')))), 20000);
    exports.set(id, (r) => {
      clearTimeout(timer);
      if (r.dataUrl) resolve(r.dataUrl);
      else reject(new Error(r.error ?? tr('canvas.export.failed')));
    });
    post(file, { dc: 'export', id, scale, tid });
  });
}

/**
 * Put a picture of an artboard, or of one element in it, on the clipboard. The clipboard item takes a
 * promise so the write starts inside the click (Safari drops it otherwise); when the browser refuses an
 * image on the clipboard the picture is downloaded instead and the toast says so.
 */
export async function copyPng(file: string, tid?: number): Promise<void> {
  const stem = file.replace(/\.dc\.html$/, '');
  await copyImage(`${stem}${tid === undefined ? '' : `-${tid}`}@2x.png`, async () => dataUrlBlob(await exportPng(file, 2, tid)));
}

export async function exportBoard(file: string, kind: 'png1' | 'png2' | 'source') {
  const stem = file.replace(/\.dc\.html$/, '');
  if (kind === 'source') {
    const src = display(useStore.getState(), file) ?? '';
    const url = URL.createObjectURL(new Blob([src], { type: 'text/html' }));
    downloadUrl(file, url);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return;
  }
  try {
    downloadUrl(`${stem}${kind === 'png2' ? '@2x' : ''}.png`, await exportPng(file, kind === 'png2' ? 2 : 1));
  } catch (e) {
    toast((e as Error).message, 'error');
  }
}

/**
 * What the shared menu offers for a canvas: the selected artboard (or the only one on the page) as
 * a PNG at both sizes and as its source file, and every artboard on the page as PNG files.
 */
export function canvasExportItems(): ExportItem[] {
  const s = useStore.getState();
  const c = canvasOf(s);
  const onThisPage = c.order.filter((f) => c.boards[f] && onPage(c, c.boards[f].page, s.page) && !c.boards[f].hidden);
  const sel = s.selection;
  const one = sel && (sel.kind === 'board' || sel.kind === 'el') && c.boards[sel.file] ? sel.file : onThisPage.length === 1 ? onThisPage[0] : null;
  const items: ExportItem[] = [];
  if (one) {
    items.push(
      { id: 'png', label: tr('common.transfer.label.png'), hint: tr('common.transfer.hint.boardOne'), icon: <Picture />, run: () => exportBoard(one, 'png1') },
      { id: 'png2', label: tr('common.transfer.label.pngRetina'), hint: tr('common.transfer.hint.boardOne'), icon: <Picture />, run: () => exportBoard(one, 'png2') },
      { id: 'copy-png', label: tr('common.transfer.label.copyPng'), hint: tr('common.transfer.hint.boardOne'), icon: <CopyPicture />, run: () => copyPng(one) },
    );
  }
  if (onThisPage.length > 1) {
    items.push({
      id: 'pngs',
      label: tr('common.transfer.label.pngs'),
      hint: tr('common.transfer.hint.boardEvery'),
      icon: <Picture />,
      run: async () => {
        for (const f of onThisPage) await exportBoard(f, 'png1');
      },
    });
  }
  if (one) items.push({ id: 'source', label: tr('common.transfer.label.source'), hint: tr('common.transfer.hint.boardSource'), icon: <FileText />, rule: true, run: () => exportBoard(one, 'source') });
  return items;
}

/**
 * Shows one artboard, by its file (`hero.dc.html`, `hero`) or its title, and waits until it can draw
 * itself: `tingly-design export <canvas> --board` and the pictures of `check --snapshots` (headless.ts).
 */
export async function pickBoard(what: string): Promise<boolean> {
  const c = canvasOf(useStore.getState());
  const want = what.trim().toLowerCase();
  const file = c.order.find((f) => c.boards[f] && (f.toLowerCase() === want || f.replace(/\.dc\.html$/, '').toLowerCase() === want)) ?? c.order.find((f) => c.boards[f]?.title?.trim().toLowerCase() === want);
  // a hidden board is not drawn, so there is no picture of it to take
  if (!file || c.boards[file].hidden) return false;
  focusBoard(file);
  useStore.setState({ selection: { kind: 'board', file } });
  for (const until = Date.now() + 20_000; !readyFrames.has(file) && Date.now() < until; ) await new Promise((ok) => setTimeout(ok, 50));
  return true;
}

/** After a move the element's tid changes; find it again by its own source text. */
function follow(file: string, slice: string | null, fallback: number): number {
  const src = display(useStore.getState(), file);
  if (!src || !slice) return fallback;
  const doc = parsed(src);
  return doc.elements.find((e) => src.slice(e.range.start, e.range.end) === slice)?.tid ?? fallback;
}

type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Edge = 'n' | 'e' | 's' | 'w';

export const BoardView = memo(function BoardView({ file, entry }: { file: string; entry: BoardEntry }) {
  const { t } = useTranslation();
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [drag, setDrag] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [exportMenu, setExportMenu] = useState<{ x: number; y: number } | null>(null);
  const pendingEdit = useRef<number | null>(null);
  const source = useStore((s) => display(s, file));
  const drafting = useStore((s) => s.drafts[file] !== undefined);
  const claudeOn = useStore((s) => s.delegates.some((d) => (d.state === 'start' || d.state === 'progress') && d.files.includes(file)));
  const mode = useStore((s) => s.mode);
  const project = useStore((s) => s.project);
  const assetRev = useStore((s) => s.assetRev);
  const zoom = useStore((s) => s.view.zoom);
  const selected = useStore((s) => (s.selection?.kind === 'el' && s.selection.file === file ? s.selection.tid : null));
  const boardSelected = useStore((s) => s.selection?.kind === 'board' && s.selection.file === file);
  const hover = useStore((s) => (s.layerHover?.file === file ? s.layerHover.tid : null));
  const error = useStore((s) => s.runtimeErrors[file]);
  const imports = useStore(
    useShallow((s) => {
      if (!source?.includes('<dc-import')) return EMPTY;
      const out: Record<string, string> = {};
      for (const f of Object.keys(s.files)) if (f.endsWith('.dc.html')) out[f] = display(s, f) ?? '';
      return out;
    }),
  );
  const srcdoc = useMemo(() => sandboxDoc(SERVER, 'runtime', htmlLang()), []);

  useEffect(() => {
    const el = frame.current;
    if (el) frames.set(file, el);
    return () => {
      if (frames.get(file) === el) frames.delete(file), readyFrames.delete(file);
    };
  }, [file]);

  // messages from this frame
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const m = e.data as FromRuntime;
      if (!m || typeof m !== 'object' || !('dc' in m)) return;
      const s = useStore.getState();
      switch (m.dc) {
        case 'ready':
          readyFrames.add(file);
          setReady(true);
          break;
        case 'select': {
          if (s.tool === 'text') {
            textTool(m.tid);
            break;
          }
          leaveField();
          useStore.setState({ selection: m.tid === null ? { kind: 'board', file } : { kind: 'el', file, tid: m.tid }, menu: null, editingNote: null });
          break;
        }
        case 'inspect':
          if (!m.info || (s.selection?.kind === 'el' && s.selection.file === file)) useStore.setState({ inspect: m.info });
          break;
        case 'counts':
          useStore.setState((st) => ({ counts: { ...st.counts, [file]: m.counts } }));
          break;
        case 'contextmenu': {
          const r = frame.current.getBoundingClientRect();
          const z = useStore.getState().view.zoom;
          useStore.setState({ menu: { x: r.left + m.x * z, y: r.top + m.y * z } });
          break;
        }
        case 'text': {
          // text that shows a text tweak (`{{heading}}`) is retyped by changing the tweak
          const src = display(s, file);
          const doc = src ? parsed(src) : null;
          const el = doc?.elements.find((e) => e.tid === m.tid);
          const prop = doc && el ? tweakTextBinding(doc, el) : null;
          if (!prop && m.from !== undefined && doc && el && retypeKind(doc, el) === 'mixed') retypeText(file, m.tid, m.from, m.text, m.item ?? null);
          else if (prop) edit(file, (cur) => setPropDefault(cur, prop, m.text).source, { actor: 'human', summary: `tweak ${prop} → ${JSON.stringify(m.text)}` });
          else editElement(file, [{ kind: 'text', tid: m.tid, text: m.text }]);
          break;
        }
        case 'noedit':
          toast(t(`canvas.text.noedit.${m.why}`));
          break;
        case 'move': {
          const src = display(s, file);
          const slice = src ? elementSource(parsed(src), m.tid) : null;
          if (editElement(file, [{ kind: 'moveTo', tid: m.tid, target: m.target, where: m.where }]))
            useStore.setState({ selection: { kind: 'el', file, tid: follow(file, slice, m.tid) } });
          break;
        }
        case 'resize':
          editElement(file, [{ kind: 'styles', tid: m.tid, set: m.set }]);
          break;
        case 'dragout': {
          const ops = [{ kind: 'styles' as const, tid: m.tid, set: m.set }];
          if (m.parentTid !== null && Object.keys(m.parentSet).length) ops.push({ kind: 'styles', tid: m.parentTid, set: m.parentSet });
          editElement(file, ops);
          break;
        }
        case 'exported':
          exports.get(m.id)?.(m);
          exports.delete(m.id);
          break;
        case 'wheel': {
          const r = frame.current.getBoundingClientRect();
          const canvasRect = document.querySelector('.canvas')!.getBoundingClientRect();
          const z = useStore.getState().view.zoom;
          handleWheel(m.dx, m.dy, m.ctrl, r.left - canvasRect.left + m.x * z, r.top - canvasRect.top + m.y * z);
          break;
        }
        case 'key':
          handleKey(m.key, m.meta, m.shift, m.alt);
          break;
        case 'error':
          useStore.setState((st) => (st.runtimeErrors[file] === m.message ? {} : { runtimeErrors: { ...st.runtimeErrors, [file]: m.message } }));
          break;
        case 'navigate': {
          const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
          const href = m.href.split('#')[0];
          const target = href.startsWith('/') ? href.slice(1) : dir + href;
          if (useStore.getState().focused) useStore.setState({ focused: target });
          else focusBoard(target);
          break;
        }
      }
    };
    const textTool = (tid: number | null) => {
      const src = display(useStore.getState(), file);
      if (!src) return;
      const doc = parsed(src);
      const el = tid === null ? rootElement(doc) : doc.elements[tid];
      if (!el) return;
      const container = ['Group', 'Row', 'Column', 'Grid'].includes(roleOf(el)) && el.tag !== 'sc-for';
      const html = `<p style="margin:0;font-size:16px;line-height:1.5">${tr('canvas.text.placeholder')}</p>`;
      const newTid = insertHtml(file, el.tid, container ? 'last' : 'after', html);
      if (newTid !== null) {
        useStore.setState({ selection: { kind: 'el', file, tid: newTid }, tool: 'select' });
        pendingEdit.current = newTid;
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [file]);

  // keep the frame rendering the current source
  useEffect(() => {
    if (!ready || source === undefined) return;
    post(file, { dc: 'render', file, source, files: imports, props: {}, mode, selected, base: project ? api.frameBase(project, assetRev) : undefined });
    if (pendingEdit.current !== null) {
      post(file, { dc: 'edit', tid: pendingEdit.current });
      pendingEdit.current = null;
    }
  }, [ready, source, imports, mode, file, selected, project, assetRev]);

  useEffect(() => {
    if (ready) post(file, { dc: 'hover', tid: hover });
  }, [ready, hover, file]);

  const startDrag = (e: React.PointerEvent, kind: 'move' | Corner | Edge) => {
    if (e.button !== 0 || mode === 'play') return;
    e.preventDefault();
    e.stopPropagation();
    useStore.setState({ selection: { kind: 'board', file }, editingNote: null });
    if (entry.locked) return;
    const z = useStore.getState().view.zoom;
    const sx = e.clientX;
    const sy = e.clientY;
    document.querySelector('.app')?.classList.add('dragging');
    let last = { x: 0, y: 0, w: 0, h: 0 };
    const move = (ev: PointerEvent) => {
      const dx = snap((ev.clientX - sx) / z);
      const dy = snap((ev.clientY - sy) / z);
      if (kind === 'move') last = { x: dx, y: dy, w: 0, h: 0 };
      else {
        last = { x: 0, y: 0, w: 0, h: 0 };
        if (kind.includes('e')) last.w = dx;
        if (kind.includes('s')) last.h = dy;
        if (kind.includes('w')) {
          last.x = dx;
          last.w = -dx;
        }
        if (kind.includes('n')) {
          last.y = dy;
          last.h = -dy;
        }
      }
      setDrag(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.querySelector('.app')?.classList.remove('dragging');
      setDrag(null);
      if (!last.x && !last.y && !last.w && !last.h) return;
      updateBoard(
        file,
        {
          x: entry.x + last.x,
          y: entry.y + last.y,
          w: Math.min(8000, Math.max(40, entry.w + last.w)),
          h: Math.min(8000, Math.max(40, entry.h + last.h)),
        },
        kind === 'move' ? 'moved' : 'resized',
      );
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const x = entry.x + (drag?.x ?? 0);
  const y = entry.y + (drag?.y ?? 0);
  const w = Math.max(40, entry.w + (drag?.w ?? 0));
  const h = Math.max(40, entry.h + (drag?.h ?? 0));
  const inv = 1 / zoom;
  const title = entry.title || file.replace(/\.dc\.html$/, '');

  return (
    <div
      className={`board ${boardSelected ? 'selected' : ''} ${drafting ? 'drafting' : ''} ${entry.locked && mode === 'edit' ? 'locked' : ''}`}
      style={{ left: x, top: y, width: w, height: h, ['--ow' as string]: `${1.5 * inv}px` }}
      data-board={file}
    >
      <div className="strip" style={{ transform: `scale(${inv})`, width: w * zoom }}>
        {renaming ? (
          <InlineRename allowEmpty value={entry.title ?? ''} label={t('canvas.board.nameLabel')} onCommit={(v) => updateBoard(file, { title: v || undefined }, 'renamed')} onDone={() => setRenaming(false)} />
        ) : (
          <span
            className="t"
            title={t('canvas.board.stripHint', { title, file })}
            onPointerDown={(e) => startDrag(e, 'move')}
            onDoubleClick={() => mode === 'edit' && !entry.locked && setRenaming(true)}
          >
            {title}
          </span>
        )}
        {drafting ? <span className="badge ai">{t('canvas.board.fastAiEditing')}</span> : claudeOn && <span className="badge claude">{t('canvas.board.claudeEditing')}</span>}
        {error && (
          <span className="badge err" title={error}>
            {t('canvas.board.error')}
          </span>
        )}
        <button className="ib sm sb" aria-label={t('canvas.board.fullscreenLabel', { title })} title={t('canvas.board.fullscreen')} onClick={() => useStore.setState({ focused: file })}>
          <Expand />
        </button>
        <button
          className="ib sm sb"
          aria-label={t('canvas.export.boardLabel', { title })}
          title={t('canvas.export.title')}
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setExportMenu({ x: r.right, y: r.bottom + 6 });
          }}
        >
          <Download />
        </button>
      </div>
      <div className="frame" style={{ borderRadius: entry.radius ?? 0 }}>
        <iframe ref={frame} title={title} sandbox="allow-scripts allow-popups" srcDoc={srcdoc} />
      </div>
      {boardSelected && <div className="outline" />}
      {boardSelected &&
        mode === 'edit' &&
        !entry.locked &&
        (['nw', 'ne', 'sw', 'se'] as Corner[]).map((c) => (
          <div
            key={c}
            className="handle"
            style={{
              left: c.includes('w') ? -4 * inv : undefined,
              right: c.includes('e') ? -4 * inv : undefined,
              top: c.includes('n') ? -4 * inv : undefined,
              bottom: c.includes('s') ? -4 * inv : undefined,
              width: 8 * inv,
              height: 8 * inv,
              borderWidth: 1.5 * inv,
              cursor: c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize',
            }}
            onPointerDown={(e) => startDrag(e, c)}
          />
        ))}
      {boardSelected &&
        mode === 'edit' &&
        !entry.locked &&
        (['n', 'e', 's', 'w'] as Edge[]).map((s) => (
          <div
            key={s}
            className={`edge ${s}`}
            style={{ ['--hit' as string]: `${8 * inv}px`, cursor: s === 'n' || s === 's' ? 'ns-resize' : 'ew-resize' }}
            onPointerDown={(e) => startDrag(e, s)}
          />
        ))}
      {drag && (drag.w !== 0 || drag.h !== 0) && (
        <span className="size-tip" style={{ transform: `scale(${inv})` }}>
          {Math.round(w)} × {Math.round(h)}
        </span>
      )}
      {exportMenu && (
        <Menu x={exportMenu.x} y={exportMenu.y} align="right" label={t('canvas.export.title')} onClose={() => setExportMenu(null)}>
          <MenuItem label="PNG" onSelect={() => (setExportMenu(null), void exportBoard(file, 'png1'))} />
          <MenuItem label="PNG @2x" onSelect={() => (setExportMenu(null), void exportBoard(file, 'png2'))} />
          <hr />
          <MenuItem label={t('canvas.export.source')} onSelect={() => (setExportMenu(null), void exportBoard(file, 'source'))} />
        </Menu>
      )}
    </div>
  );
});
