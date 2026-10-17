import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addBoard, addNote } from '../../actions';
import { onPage, setView, toCanvas, useCanvas, useStore, zoomAt } from '../../store';
import { BoardView } from './Board';
import { CanvasItem } from './Item';

/** Pan with a two-finger scroll or a drag on empty canvas; zoom with ctrl/⌘ + wheel or a pinch. */
export function handleWheel(dx: number, dy: number, ctrl: boolean, sx: number, sy: number): void {
  const { view } = useStore.getState();
  if (ctrl) zoomAt(Math.exp(-dy * 0.0025), sx, sy);
  else setView({ x: view.x - dx, y: view.y - dy });
}

type Draft =
  | { kind: 'box'; tool: 'frame' | 'rect' | 'oval'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'line'; tool: 'line' | 'arrow'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'pen'; pts: [number, number][] };

const CREATE = new Set(['frame', 'rect', 'oval', 'line', 'arrow', 'draw', 'note', 'text']);

export function Canvas() {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const canvas = useCanvas();
  const view = useStore((s) => s.view);
  const tool = useStore((s) => s.tool);
  const page = useStore((s) => s.page);
  const [panning, setPanning] = useState(false);
  const [space, setSpace] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => useStore.setState({ viewport: { w: el.clientWidth, h: el.clientHeight } }));
    ro.observe(el);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const k = e.deltaMode === 1 ? 16 : 1;
      handleWheel(e.deltaX * k, e.deltaY * k, e.ctrlKey || e.metaKey, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement).closest('input,textarea,[contenteditable]')) setSpace(true);
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpace(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return toCanvas(e.clientX - r.left, e.clientY - r.top);
  };

  const pan = (e: React.PointerEvent, clearOnClick: boolean) => {
    const start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    let moved = false;
    setPanning(true);
    document.querySelector('.app')?.classList.add('dragging');
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      setView({ x: start.vx + dx, y: start.vy + dy });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setPanning(false);
      document.querySelector('.app')?.classList.remove('dragging');
      if (!moved && clearOnClick) useStore.setState({ selection: null, editingNote: null });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const create = (e: React.PointerEvent) => {
    const p = local(e);
    if (tool === 'note') {
      const id = addNote({ x: Math.round(p.x), y: Math.round(p.y), w: 240, text: '' });
      useStore.setState({ editingNote: id });
      return;
    }
    if (tool === 'text') {
      const id = addNote({ kind: 'title1', x: Math.round(p.x), y: Math.round(p.y - 14), text: '', size: 24, bold: false, maxW: 800 });
      useStore.setState({ editingNote: id });
      return;
    }
    const first: Draft =
      tool === 'draw'
        ? { kind: 'pen', pts: [[p.x, p.y]] }
        : tool === 'line' || tool === 'arrow'
          ? { kind: 'line', tool, x0: p.x, y0: p.y, x1: p.x, y1: p.y }
          : { kind: 'box', tool: tool as 'frame' | 'rect' | 'oval', x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    let d = first;
    setDraft(d);
    const move = (ev: PointerEvent) => {
      const q = local(ev);
      if (d.kind === 'pen') d = { kind: 'pen', pts: [...d.pts, [q.x, q.y]] };
      else {
        let { x: x1, y: y1 } = q;
        if (ev.shiftKey && d.kind === 'box') {
          const s = Math.max(Math.abs(x1 - d.x0), Math.abs(y1 - d.y0));
          x1 = d.x0 + Math.sign(x1 - d.x0 || 1) * s;
          y1 = d.y0 + Math.sign(y1 - d.y0 || 1) * s;
        }
        d = { ...d, x1, y1 };
      }
      setDraft(d);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDraft(null);
      finish(d);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const finish = (d: Draft) => {
    const r = (v: number) => Math.round(v);
    if (d.kind === 'pen') {
      if (d.pts.length < 2) return;
      const xs = d.pts.map((p) => p[0]);
      const ys = d.pts.map((p) => p[1]);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      const w = Math.max(1, Math.max(...xs) - x);
      const h = Math.max(1, Math.max(...ys) - y);
      const path = d.pts.map((p, i) => `${i ? 'L' : 'M'}${(p[0] - x).toFixed(1)} ${(p[1] - y).toFixed(1)}`).join(' ');
      addNote({ kind: 'pen', x: r(x), y: r(y), w: r(w), h: r(h), d: path, css: { stroke: '#1d1d1b', 'stroke-width': '3' } });
      useStore.setState({ tool: 'draw' });
      return;
    }
    if (d.kind === 'line') {
      const tiny = Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 6;
      addNote({
        kind: d.tool,
        x: r(d.x0),
        y: r(d.y0),
        x2: r(tiny ? d.x0 + 160 : d.x1),
        y2: r(tiny ? d.y0 : d.y1),
        css: { stroke: '#1d1d1b', 'stroke-width': '2' },
      });
      return;
    }
    const tiny = Math.abs(d.x1 - d.x0) < 6 && Math.abs(d.y1 - d.y0) < 6;
    const def = d.tool === 'frame' ? [1200, 760] : d.tool === 'rect' ? [200, 120] : [120, 120];
    const x = tiny ? d.x0 : Math.min(d.x0, d.x1);
    const y = tiny ? d.y0 : Math.min(d.y0, d.y1);
    const w = tiny ? def[0] : Math.abs(d.x1 - d.x0);
    const h = tiny ? def[1] : Math.abs(d.y1 - d.y0);
    if (d.tool === 'frame') {
      addBoard({ x, y, w: Math.max(80, w), h: Math.max(80, h) });
      useStore.setState({ tool: 'select' });
      return;
    }
    addNote({
      kind: d.tool,
      x: r(x),
      y: r(y),
      w: r(w),
      h: r(h),
      css: d.tool === 'rect' ? { background: '#d8e4fc', 'border-radius': '6px' } : { background: '#d8e4fc' },
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || tool === 'hand' || space) {
      e.preventDefault();
      return pan(e, false);
    }
    if (e.button !== 0) return;
    if (CREATE.has(tool)) {
      e.preventDefault();
      return create(e);
    }
    const onEmpty = e.target === ref.current || (e.target as HTMLElement).classList.contains('layer');
    if (onEmpty) {
      e.preventDefault();
      pan(e, true);
    }
  };

  const z = view.zoom;
  const cls = ['canvas', tool === 'hand' || space ? 't-hand' : '', panning ? 'panning' : '', tool === 'text' ? 't-text' : '', CREATE.has(tool) && tool !== 'text' ? 't-create' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div ref={ref} className={cls} onPointerDown={onPointerDown} aria-label={t('canvas.surface.label')}>
      <div className="layer" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${z})` }}>
        {canvas.order
          .filter((f) => canvas.boards[f] && !canvas.boards[f].hidden && onPage(canvas, canvas.boards[f].page, page))
          .map((f) => (
            <BoardView key={f} file={f} entry={canvas.boards[f]} />
          ))}
        {Object.entries(canvas.notes)
          .filter(([, n]) => !n.hidden && onPage(canvas, n.page, page))
          .map(([id, n]) => (
            <CanvasItem key={id} id={id} note={n} />
          ))}
        {draft?.kind === 'box' && (
          <div
            className="rubber"
            style={{
              left: Math.min(draft.x0, draft.x1),
              top: Math.min(draft.y0, draft.y1),
              width: Math.abs(draft.x1 - draft.x0),
              height: Math.abs(draft.y1 - draft.y0),
              borderWidth: 1 / z,
              borderRadius: draft.tool === 'oval' ? '50%' : 0,
            }}
          />
        )}
        {(draft?.kind === 'line' || draft?.kind === 'pen') && (
          <svg style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }} width="1" height="1">
            {draft.kind === 'line' ? (
              <line x1={draft.x0} y1={draft.y0} x2={draft.x1} y2={draft.y1} style={{ stroke: 'var(--accent)' }} strokeWidth={2 / z} />
            ) : (
              <polyline points={draft.pts.map((p) => p.join(',')).join(' ')} fill="none" style={{ stroke: 'var(--ink)' }} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
        )}
      </div>
    </div>
  );
}
