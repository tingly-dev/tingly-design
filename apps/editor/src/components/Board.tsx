import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { sandboxDoc, type BoardEntry, type FromRuntime, type ToRuntime } from '@dc/core';
import { display, editCanvas, editElement, focusBoard, useStore } from '../store';
import { handleWheel } from './Canvas';
import { handleKey } from '../shortcuts';

const EMPTY: Record<string, string> = {};
const SNAP = 8;
const snap = (v: number) => Math.round(v / SNAP) * SNAP;

/** One artboard: a sandboxed iframe running the runtime, a name strip, and a resize handle. */
export const BoardView = memo(function BoardView({ file, entry }: { file: string; entry: BoardEntry }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [drag, setDrag] = useState<{ dx: number; dy: number; dw: number; dh: number } | null>(null);
  const source = useStore((s) => display(s, file));
  const drafting = useStore((s) => s.drafts[file] !== undefined);
  const mode = useStore((s) => s.mode);
  const zoom = useStore((s) => s.view.zoom);
  const selected = useStore((s) => (s.selection?.kind === 'el' && s.selection.file === file ? s.selection.tid : null));
  const boardSelected = useStore((s) => s.selection?.kind === 'board' && s.selection.file === file);
  const error = useStore((s) => s.runtimeErrors[file]);
  const imports = useStore(
    useShallow((s) => {
      if (!source?.includes('<dc-import')) return EMPTY;
      const out: Record<string, string> = {};
      for (const f of Object.keys(s.files)) if (f.endsWith('.dc.html')) out[f] = display(s, f) ?? '';
      return out;
    }),
  );
  const srcdoc = useMemo(() => sandboxDoc(location.origin, 'runtime'), []);

  // messages from this frame
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const m = e.data as FromRuntime;
      if (!m || typeof m !== 'object' || !('dc' in m)) return;
      switch (m.dc) {
        case 'ready':
          setReady(true);
          break;
        case 'select':
          useStore.setState({ selection: m.tid === null ? { kind: 'board', file } : { kind: 'el', file, tid: m.tid } });
          break;
        case 'text':
          editElement(file, [{ kind: 'text', tid: m.tid, text: m.text }]);
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
          useStore.setState((s) => (s.runtimeErrors[file] === m.message ? {} : { runtimeErrors: { ...s.runtimeErrors, [file]: m.message } }));
          break;
        case 'navigate': {
          const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
          const href = m.href.split('#')[0];
          const target = href.startsWith('/') ? href.slice(1) : dir + href;
          focusBoard(target);
          break;
        }
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [file]);

  // keep the frame rendering the current source
  useEffect(() => {
    if (!ready || source === undefined || !frame.current?.contentWindow) return;
    const msg: ToRuntime = { dc: 'render', file, source, files: imports, props: {}, mode, selected };
    frame.current.contentWindow.postMessage(msg, '*');
  }, [ready, source, imports, mode, file, selected]);

  const startDrag = (e: React.PointerEvent, kind: 'move' | 'resize') => {
    if (e.button !== 0 || mode === 'play') return;
    e.preventDefault();
    e.stopPropagation();
    useStore.setState({ selection: { kind: 'board', file } });
    const z = useStore.getState().view.zoom;
    const sx = e.clientX;
    const sy = e.clientY;
    document.querySelector('.app')?.classList.add('dragging');
    let last = { dx: 0, dy: 0, dw: 0, dh: 0 };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / z;
      const dy = (ev.clientY - sy) / z;
      last = kind === 'move' ? { dx: snap(dx), dy: snap(dy), dw: 0, dh: 0 } : { dx: 0, dy: 0, dw: snap(dx), dh: snap(dy) };
      setDrag(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.querySelector('.app')?.classList.remove('dragging');
      setDrag(null);
      if (!last.dx && !last.dy && !last.dw && !last.dh) return;
      editCanvas((c) => {
        const b = c.boards[file];
        if (!b) return;
        b.x += last.dx;
        b.y += last.dy;
        b.w = Math.min(8000, Math.max(40, b.w + last.dw));
        b.h = Math.min(8000, Math.max(40, b.h + last.dh));
      }, kind === 'move' ? `artboard ${file} moved` : `artboard ${file} resized`);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const x = entry.x + (drag?.dx ?? 0);
  const y = entry.y + (drag?.dy ?? 0);
  const w = Math.max(40, entry.w + (drag?.dw ?? 0));
  const h = Math.max(40, entry.h + (drag?.dh ?? 0));
  const inv = 1 / zoom;

  return (
    <div
      className={`board ${boardSelected || selected !== null ? 'selected' : ''} ${drafting ? 'drafting' : ''}`}
      style={{ left: x, top: y, width: w, height: h, ['--ow' as string]: `${2 * inv}px` }}
      data-board={file}
    >
      <div
        className="strip"
        style={{ transform: `scale(${inv})`, width: w * zoom }}
        onPointerDown={(e) => startDrag(e, 'move')}
        onDoubleClick={() => focusBoard(file)}
        title="拖动移动画板，双击聚焦"
      >
        <span className="t">{entry.title || file}</span>
        <span className="f">{file}</span>
        {entry.is_interactive && <span className="badge">可交互</span>}
        {drafting && <span className="badge ai">AI 正在改</span>}
        {error && (
          <span className="badge err" title={error}>
            出错
          </span>
        )}
      </div>
      <div className="frame" style={{ borderRadius: entry.radius ?? 0 }}>
        <iframe
          ref={frame}
          title={entry.title || file}
          sandbox="allow-scripts allow-popups"
          srcDoc={srcdoc}
        />
      </div>
      {mode === 'edit' && (boardSelected || selected !== null) && (
        <div className="resize" style={{ transform: `scale(${inv})` }} onPointerDown={(e) => startDrag(e, 'resize')} title="拖动调整画板尺寸" />
      )}
    </div>
  );
});
