import { useEffect, useRef, useState } from 'react';
import { useCanvas, useStore, setView, zoomAt } from '../store';
import { BoardView } from './Board';
import { NoteView } from './Note';

/** Pan with a two-finger scroll or a drag on empty canvas; zoom with ctrl/⌘ + wheel or a pinch. */
export function handleWheel(dx: number, dy: number, ctrl: boolean, sx: number, sy: number): void {
  const { view } = useStore.getState();
  if (ctrl) zoomAt(Math.exp(-dy * 0.0025), sx, sy);
  else setView({ x: view.x - dx, y: view.y - dy });
}

export function Canvas() {
  const ref = useRef<HTMLDivElement>(null);
  const canvas = useCanvas();
  const view = useStore((s) => s.view);
  const tool = useStore((s) => s.tool);
  const [panning, setPanning] = useState(false);
  const [space, setSpace] = useState(false);

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
      if (e.code === 'Space' && !(e.target as HTMLElement).closest('input,textarea,[contenteditable="true"]')) setSpace(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpace(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    const onEmpty = e.target === ref.current || (e.target as HTMLElement).classList.contains('layer');
    if (!onEmpty && tool !== 'hand' && !space && e.button !== 1) return;
    e.preventDefault();
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
      if (!moved && onEmpty) useStore.setState({ selection: null });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const grid = 24 * view.zoom;
  const dotted = view.zoom > 0.18;
  return (
    <div
      ref={ref}
      className={`canvas ${tool === 'hand' || space ? 'hand' : ''} ${panning ? 'panning' : ''}`}
      onPointerDown={onPointerDown}
      style={{
        backgroundImage: dotted ? `radial-gradient(circle, var(--dot) ${Math.max(0.8, view.zoom)}px, transparent ${Math.max(0.8, view.zoom) + 0.5}px)` : 'none',
        backgroundSize: `${grid}px ${grid}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
      aria-label="画布"
    >
      <div className="layer" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        {Object.entries(canvas.notes).map(([id, n]) => (
          <NoteView key={id} id={id} note={n} />
        ))}
        {canvas.order.map((f) => (
          <BoardView key={f} file={f} entry={canvas.boards[f]} />
        ))}
      </div>
    </div>
  );
}
