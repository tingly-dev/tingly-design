import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import { elementSource, roleOf, rootElement, sandboxDoc, type BoardEntry, type FromRuntime, type ToRuntime } from '@dc/core';
import { display, editElement, focusBoard, parsed, toast, useStore } from '../store';
import { insertHtml, updateBoard } from '../actions';
import { handleWheel } from './Canvas';
import { handleKey } from '../shortcuts';
import { Download, Expand } from './icons';
import { Menu, MenuItem } from './Menu';
import { SERVER } from '../base';
import { api } from '../api';
import { t as tr } from '../i18n';

const EMPTY: Record<string, string> = {};
const SNAP = 8;
const snap = (v: number) => Math.round(v / SNAP) * SNAP;

/** Live artboard frames, so the panel, menus and export can talk to them. */
export const frames = new Map<string, HTMLIFrameElement>();
const exports = new Map<string, (r: { dataUrl?: string; error?: string }) => void>();

export function post(file: string, msg: ToRuntime): void {
  frames.get(file)?.contentWindow?.postMessage(msg, '*');
}

export function exportPng(file: string, scale = 2): Promise<string> {
  const id = Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => (exports.delete(id), reject(new Error(tr('canvas.export.timeout')))), 20000);
    exports.set(id, (r) => {
      clearTimeout(timer);
      if (r.dataUrl) resolve(r.dataUrl);
      else reject(new Error(r.error ?? tr('canvas.export.failed')));
    });
    post(file, { dc: 'export', id, scale });
  });
}

function download(name: string, href: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
}

export async function exportBoard(file: string, kind: 'png1' | 'png2' | 'source') {
  const stem = file.replace(/\.dc\.html$/, '');
  if (kind === 'source') {
    const src = display(useStore.getState(), file) ?? '';
    const url = URL.createObjectURL(new Blob([src], { type: 'text/html' }));
    download(file, url);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return;
  }
  try {
    download(`${stem}${kind === 'png2' ? '@2x' : ''}.png`, await exportPng(file, kind === 'png2' ? 2 : 1));
  } catch (e) {
    toast((e as Error).message, 'error');
  }
}

/** After a move the element's tid changes; find it again by its own source text. */
function follow(file: string, slice: string | null, fallback: number): number {
  const src = display(useStore.getState(), file);
  if (!src || !slice) return fallback;
  const doc = parsed(src);
  return doc.elements.find((e) => src.slice(e.range.start, e.range.end) === slice)?.tid ?? fallback;
}

type Corner = 'nw' | 'ne' | 'sw' | 'se';

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
  const srcdoc = useMemo(() => sandboxDoc(SERVER, 'runtime'), []);

  useEffect(() => {
    const el = frame.current;
    if (el) frames.set(file, el);
    return () => {
      if (frames.get(file) === el) frames.delete(file);
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
          setReady(true);
          break;
        case 'select': {
          if (s.tool === 'text') {
            textTool(m.tid);
            break;
          }
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
        case 'text':
          editElement(file, [{ kind: 'text', tid: m.tid, text: m.text }]);
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
    post(file, { dc: 'render', file, source, files: imports, props: {}, mode, selected, base: project ? api.rawBase(project) : undefined });
    if (pendingEdit.current !== null) {
      post(file, { dc: 'edit', tid: pendingEdit.current });
      pendingEdit.current = null;
    }
  }, [ready, source, imports, mode, file, selected, project]);

  useEffect(() => {
    if (ready) post(file, { dc: 'hover', tid: hover });
  }, [ready, hover, file]);

  const startDrag = (e: React.PointerEvent, kind: 'move' | Corner) => {
    if (e.button !== 0 || mode === 'play') return;
    e.preventDefault();
    e.stopPropagation();
    useStore.setState({ selection: { kind: 'board', file }, editingNote: null });
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
      className={`board ${boardSelected ? 'selected' : ''} ${drafting ? 'drafting' : ''}`}
      style={{ left: x, top: y, width: w, height: h, ['--ow' as string]: `${1.5 * inv}px` }}
      data-board={file}
    >
      <div className="strip" style={{ transform: `scale(${inv})`, width: w * zoom }}>
        {renaming ? (
          <input
            autoFocus
            defaultValue={entry.title ?? ''}
            aria-label={t('canvas.board.nameLabel')}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
            onBlur={(e) => {
              setRenaming(false);
              if (e.currentTarget.value !== (entry.title ?? '')) updateBoard(file, { title: e.currentTarget.value.trim() || undefined }, 'renamed');
            }}
          />
        ) : (
          <span
            className="t"
            title={t('canvas.board.stripHint', { title, file })}
            onPointerDown={(e) => startDrag(e, 'move')}
            onDoubleClick={() => mode === 'edit' && setRenaming(true)}
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
        <button className="sb" aria-label={t('canvas.board.fullscreenLabel', { title })} title={t('canvas.board.fullscreen')} onClick={() => useStore.setState({ focused: file })}>
          <Expand />
        </button>
        <button
          className="sb"
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
