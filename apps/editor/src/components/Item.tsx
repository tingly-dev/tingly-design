import { memo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { NOTE_SIZES, isShape, noteBox, type NoteEntry } from '@dc/core';
import { editCanvas, useStore } from '../store';
import { updateNote } from '../actions';
import { api } from '../api';

export const TEXT_COLORS: Record<string, string> = {
  default: '#2a2924',
  gray: '#5f5e59',
  red: '#b42318',
  orange: '#b54708',
  green: '#1f7a43',
  teal: '#0e7c7b',
  blue: '#1f55c4',
  purple: '#6d4fd8',
  pink: '#b4236c',
};

/** The default near-black of pens, lines and titles reads as the theme's ink, so it stays visible on a dark canvas. */
const INKS = new Set(['#1d1d1b', '#2a2924', '#000', '#000000', 'black']);
export const inkOf = (c: string | undefined) => (!c || INKS.has(c.trim().toLowerCase()) ? 'var(--ink)' : c);

export function sizeOf(n: NoteEntry): number {
  if (typeof n.size === 'number') return n.size;
  if (typeof n.size === 'string' && n.size in NOTE_SIZES) return NOTE_SIZES[n.size as keyof typeof NOTE_SIZES];
  return n.kind === 'title1' ? 72 : 14;
}

function shapeStyle(n: NoteEntry): CSSProperties {
  const css: Record<string, string> = { ...(n.css ?? {}) };
  delete css.stroke;
  delete css['stroke-width'];
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(css)) out[k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  const t = [n.rotate ? `rotate(${n.rotate}deg)` : '', n.flipX ? 'scaleX(-1)' : '', n.flipY ? 'scaleY(-1)' : ''].filter(Boolean).join(' ');
  if (t) out.transform = t;
  return out as CSSProperties;
}

function ArrowSvg({ n }: { n: NoteEntry }) {
  const x2 = n.x2 ?? n.x;
  const y2 = n.y2 ?? n.y;
  const pad = 12;
  const minX = Math.min(n.x, x2) - pad;
  const minY = Math.min(n.y, y2) - pad;
  const w = Math.abs(x2 - n.x) + pad * 2;
  const h = Math.abs(y2 - n.y) + pad * 2;
  const stroke = inkOf(n.css?.stroke);
  const sw = Number(n.css?.['stroke-width'] ?? 2);
  const end = n.kind === 'arrow' ? (n.headEnd ?? 'filled') : 'none';
  const start = n.headStart ?? 'none';
  const head = (id: string, kind: string) =>
    kind === 'none' ? null : (
      <marker id={id} orient="auto-start-reverse" markerWidth="10" markerHeight="10" refX="8" refY="5" markerUnits="userSpaceOnUse" overflow="visible">
        {kind === 'open' ? <path d="M1 1 L8 5 L1 9" fill="none" style={{ stroke }} strokeWidth={sw} /> : <path d="M0 0 L10 5 L0 10 Z" style={{ fill: stroke }} />}
      </marker>
    );
  const key = `${n.x}-${n.y}-${x2}-${y2}`.replace(/\./g, '_');
  return (
    <svg width={w} height={h} style={{ position: 'absolute', left: minX - n.x, top: minY - n.y }} aria-hidden="true">
      <defs>
        {head(`hs-${key}`, start)}
        {head(`he-${key}`, end)}
      </defs>
      <line
        x1={n.x - minX}
        y1={n.y - minY}
        x2={x2 - minX}
        y2={y2 - minY}
        style={{ stroke }}
        strokeWidth={sw}
        strokeLinecap="round"
        markerStart={start === 'none' ? undefined : `url(#hs-${key})`}
        markerEnd={end === 'none' ? undefined : `url(#he-${key})`}
      />
      {/* a wide invisible stroke so the line is easy to grab */}
      <line x1={n.x - minX} y1={n.y - minY} x2={x2 - minX} y2={y2 - minY} stroke="transparent" strokeWidth={14} style={{ pointerEvents: 'stroke' }} />
    </svg>
  );
}

type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'e' | 'p1' | 'p2';

/** A note, title or shape from canvas.json `notes`. */
export const CanvasItem = memo(function CanvasItem({ id, note }: { id: string; note: NoteEntry }) {
  const { t } = useTranslation();
  const selected = useStore((s) => s.selection?.kind === 'note' && s.selection.id === id);
  const editing = useStore((s) => s.editingNote === id);
  const zoom = useStore((s) => s.view.zoom);
  const mode = useStore((s) => s.mode);
  const tool = useStore((s) => s.tool);
  const project = useStore((s) => s.project);
  const [live, setLive] = useState<NoteEntry | null>(null);

  if (typeof note.x !== 'number' || typeof note.y !== 'number') return null;
  const n = live ?? note;
  const line = n.kind === 'line' || n.kind === 'arrow';
  const shape = isShape(n);
  const title = n.kind === 'title1';
  const inv = 1 / zoom;

  /** Move or resize with the pointer; commits one edit on release. */
  const drag = (e: React.PointerEvent, handle: Handle | 'move') => {
    if (e.button !== 0 || mode === 'play' || tool !== 'select') return;
    e.stopPropagation();
    e.preventDefault();
    useStore.setState({ selection: { kind: 'note', id } });
    if (editing || note.locked) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const base = structuredClone(note);
    let cur: NoteEntry = base;
    let moved = false;
    document.querySelector('.app')?.classList.add('dragging');
    const move = (ev: PointerEvent) => {
      const dx = Math.round((ev.clientX - sx) / zoom);
      const dy = Math.round((ev.clientY - sy) / zoom);
      if (!moved && Math.abs(dx) + Math.abs(dy) < 2) return;
      moved = true;
      const c = structuredClone(base);
      if (handle === 'move') {
        c.x += dx;
        c.y += dy;
        if (c.x2 !== undefined) c.x2 += dx;
        if (c.y2 !== undefined) c.y2 += dy;
      } else if (handle === 'p1') {
        c.x += dx;
        c.y += dy;
      } else if (handle === 'p2') {
        c.x2 = (c.x2 ?? c.x) + dx;
        c.y2 = (c.y2 ?? c.y) + dy;
      } else if (handle === 'e') {
        c.w = Math.max(80, (c.w ?? 240) + dx);
      } else {
        const b = noteBox(base);
        let { x, y, w, h } = b;
        if (handle.includes('e')) w = Math.max(8, b.w + dx);
        if (handle.includes('s')) h = Math.max(8, b.h + dy);
        if (handle.includes('w')) {
          w = Math.max(8, b.w - dx);
          x = b.x + b.w - w;
        }
        if (handle.includes('n')) {
          h = Math.max(8, b.h - dy);
          y = b.y + b.h - h;
        }
        if (ev.shiftKey && shape) {
          const k = Math.max(w / b.w, h / b.h);
          w = Math.round(b.w * k);
          h = Math.round(b.h * k);
        }
        Object.assign(c, { x, y, w, h });
      }
      cur = c;
      setLive(c);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.querySelector('.app')?.classList.remove('dragging');
      setLive(null);
      if (!moved) return;
      editCanvas((cv) => {
        if (cv.notes[id]) cv.notes[id] = { ...cv.notes[id], ...pick(cur) };
      }, `${id} ${handle === 'move' ? 'moved' : 'resized'}`);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const commitText = (text: string) => {
    useStore.setState({ editingNote: null });
    if (!text.trim() && !note.text?.trim()) {
      editCanvas((c) => void delete c.notes[id], `${id} removed (empty)`, false);
      useStore.setState({ selection: null });
      return;
    }
    if (text !== note.text) updateNote(id, { text }, 'text');
  };

  const handles: Handle[] = line ? ['p1', 'p2'] : shape ? ['nw', 'ne', 'sw', 'se'] : title ? [] : ['e'];
  const handleAt = (h: Handle): CSSProperties => {
    const s = 8 * inv;
    if (h === 'p1' || h === 'p2') {
      const px = h === 'p1' ? n.x : (n.x2 ?? n.x);
      const py = h === 'p1' ? n.y : (n.y2 ?? n.y);
      return { left: px - n.x - s / 2, top: py - n.y - s / 2, width: s, height: s, borderWidth: 1.5 * inv, borderRadius: '50%', cursor: 'move' };
    }
    if (h === 'e') return { right: -s / 2 - 3 * inv, top: `calc(50% - ${s}px)`, width: s, height: s * 2, borderWidth: 1.5 * inv, cursor: 'ew-resize' };
    return {
      left: h.includes('w') ? -s / 2 : undefined,
      right: h.includes('e') ? -s / 2 : undefined,
      top: h.includes('n') ? -s / 2 : undefined,
      bottom: h.includes('s') ? -s / 2 : undefined,
      width: s,
      height: s,
      borderWidth: 1.5 * inv,
      cursor: h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize',
    };
  };

  const size = sizeOf(n);
  let body: React.ReactNode;
  let style: CSSProperties = { left: n.x, top: n.y };
  let cls = 'item';
  if (line) {
    body = <ArrowSvg n={n} />;
    style = { ...style, width: 0, height: 0 };
  } else if (n.kind === 'pen') {
    style = { ...style, width: n.w, height: n.h, ...shapeStyle(n) };
    body = (
      <svg width={n.w} height={n.h} viewBox={`0 0 ${n.w} ${n.h}`} aria-hidden="true">
        <path d={n.d} fill="none" style={{ stroke: inkOf(n.css?.stroke) }} strokeWidth={Number(n.css?.['stroke-width'] ?? 3)} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  } else if (n.kind === 'image') {
    style = { ...style, width: n.w, height: n.h, ...shapeStyle(n) };
    body = <img src={n.src && project && !/^(https?:|data:|blob:|\/)/i.test(n.src) ? api.rawBase(project) + n.src : n.src} alt={n.alt ?? ''} style={{ width: '100%', height: '100%', objectFit: (n.css?.['object-fit'] as CSSProperties['objectFit']) ?? 'cover', display: 'block' }} draggable={false} />;
  } else if (shape) {
    style = { ...style, width: n.w, height: n.h, ...shapeStyle(n), ...(n.kind === 'oval' ? { borderRadius: '50%' } : {}) };
  } else if (title) {
    cls += ' title1';
    style = {
      ...style,
      width: 'max-content',
      maxWidth: n.maxW ?? 1840,
      fontSize: size,
      fontWeight: n.bold === false ? 400 : 700,
      fontStyle: n.italic ? 'italic' : undefined,
      color: !n.color || n.color === 'default' ? 'var(--ink)' : TEXT_COLORS[n.color],
      minWidth: editing ? 120 : undefined,
    };
    body = editing ? (
      <textarea autoFocus defaultValue={n.text} aria-label={t('canvas.note.titleLabel')} rows={Math.max(1, (n.text ?? '').split('\n').length)} onBlur={(e) => commitText(e.currentTarget.value)} onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) e.currentTarget.blur();
      }} style={{ width: Math.max(160, (n.text?.length ?? 4) * size * 0.95) }} />
    ) : (
      n.text || <span style={{ opacity: 0.35 }}>{t('canvas.text.placeholder')}</span>
    );
  } else {
    cls += ' note';
    const w = n.w ?? 240;
    style = {
      ...style,
      width: w,
      maxHeight: n.maxH ?? Math.round(w * (4 / 3)),
      minHeight: 40,
      fontSize: size,
      fontWeight: n.bold ? 700 : undefined,
      fontStyle: n.italic ? 'italic' : undefined,
      color: TEXT_COLORS[n.color ?? 'default'],
      background: `var(--note-${n.fill ?? 'default'}, var(--note-default))`,
    };
    body = editing ? (
      <textarea autoFocus defaultValue={n.text} aria-label={t('canvas.note.contentLabel')} style={{ minHeight: Math.max(24, size * 1.45 * 3) }} onBlur={(e) => commitText(e.currentTarget.value)} onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') e.currentTarget.blur();
      }} />
    ) : (
      n.text
    );
  }

  return (
    <div
      className={cls}
      style={{ ...style, ['--ow' as string]: `${1.5 * inv}px`, cursor: tool === 'select' && mode === 'edit' ? 'default' : undefined }}
      data-item={id}
      onPointerDown={(e) => drag(e, 'move')}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (mode === 'edit' && !shape && !line && !note.locked) useStore.setState({ editingNote: id, selection: { kind: 'note', id } });
      }}
    >
      {body}
      {selected && !line && <div className="sel" style={n.kind === 'oval' ? { borderRadius: '50%' } : undefined} />}
      {selected && !editing && !note.locked && mode === 'edit' &&
        handles.map((h) => <div key={h} className="handle" style={handleAt(h)} onPointerDown={(e) => drag(e, h)} />)}
      {selected && line && (
        <svg style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }} width="1" height="1">
          <line x1={0} y1={0} x2={(n.x2 ?? n.x) - n.x} y2={(n.y2 ?? n.y) - n.y} style={{ stroke: 'var(--accent)' }} strokeWidth={1.5 * inv} />
        </svg>
      )}
    </div>
  );
});

function pick(n: NoteEntry): Partial<NoteEntry> {
  const out: Partial<NoteEntry> = { x: n.x, y: n.y };
  for (const k of ['x2', 'y2', 'w', 'h'] as const) if (n[k] !== undefined) out[k] = n[k];
  return out;
}
