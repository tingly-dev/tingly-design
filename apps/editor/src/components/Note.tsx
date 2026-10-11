import { memo, useState } from 'react';
import type { NoteEntry } from '@dc/core';
import { editCanvas, useStore } from '../store';

const SIZES: Record<string, number> = { s: 14, m: 18, l: 24, xl: 32, xxl: 44 };

export function noteFontSize(n: NoteEntry): number | undefined {
  if (typeof n.size === 'number') return n.size;
  if (typeof n.size === 'string') return SIZES[n.size];
  return undefined;
}

/** Stickies and canvas titles from canvas.json `notes`. Drag to move, double-click to retype. */
export const NoteView = memo(function NoteView({ id, note }: { id: string; note: NoteEntry }) {
  const selected = useStore((s) => s.selection?.kind === 'note' && s.selection.id === id);
  const zoom = useStore((s) => s.view.zoom);
  const mode = useStore((s) => s.mode);
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const [editing, setEditing] = useState(false);

  if (typeof note.x !== 'number' || typeof note.y !== 'number') return null;
  if (note.kind && note.kind !== 'title1') return null; // shapes drawn by people: not supported in this editor

  const title = note.kind === 'title1';
  const w = title ? undefined : note.w ?? 320;
  const fill = note.fill ?? note.color ?? 'orange';

  const onPointerDown = (e: React.PointerEvent) => {
    if (editing || e.button !== 0 || mode === 'play') return;
    e.stopPropagation();
    useStore.setState({ selection: { kind: 'note', id } });
    const sx = e.clientX;
    const sy = e.clientY;
    let last = { dx: 0, dy: 0 };
    document.querySelector('.app')?.classList.add('dragging');
    const move = (ev: PointerEvent) => {
      last = { dx: Math.round((ev.clientX - sx) / zoom / 8) * 8, dy: Math.round((ev.clientY - sy) / zoom / 8) * 8 };
      setDrag(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.querySelector('.app')?.classList.remove('dragging');
      setDrag(null);
      if (last.dx || last.dy)
        editCanvas((c) => {
          const n = c.notes[id];
          if (!n) return;
          n.x += last.dx;
          n.y += last.dy;
        }, `note ${id} moved`);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const commit = (text: string) => {
    setEditing(false);
    if (text !== note.text) editCanvas((c) => void (c.notes[id] && (c.notes[id].text = text)), `note ${id} text`);
  };

  return (
    <div
      className={`note ${title ? 'title1' : 'sticky'} ${selected ? 'selected' : ''}`}
      style={{
        left: note.x + (drag?.dx ?? 0),
        top: note.y + (drag?.dy ?? 0),
        width: title ? 'max-content' : w,
        maxWidth: title ? note.maxW ?? 1840 : undefined,
        maxHeight: title ? note.maxH : note.maxH ?? (w ?? 320) * (4 / 3),
        fontSize: noteFontSize(note),
        fontWeight: note.bold ? 700 : undefined,
        fontStyle: note.italic ? 'italic' : undefined,
        background: title ? undefined : `var(--note-${fill}, var(--note-orange))`,
        ['--ow' as string]: `${2 / zoom}px`,
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (mode === 'edit') setEditing(true);
      }}
    >
      {editing ? (
        <textarea
          autoFocus
          defaultValue={note.text}
          aria-label="便签内容"
          style={{ minHeight: title ? '1.2em' : 120 }}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(false);
            e.stopPropagation();
          }}
        />
      ) : (
        note.text
      )}
    </div>
  );
});
