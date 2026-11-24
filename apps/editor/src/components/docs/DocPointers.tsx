import { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { pointerLabel, usePointers } from '../../pointers';

interface Placed {
  id: string;
  color: string;
  label: string;
  fading: boolean;
  box: { left: number; top: number; width: number; height: number };
}

/**
 * The live pointers on the open doc tab (`.design/live-pointers.md`): a mouse cursor in the participant's colour,
 * its name on a pill beside it, resting at the lower right corner of the top-level block it changed, which keeps
 * a faint frame in the same colour. Measured against the page every frame while any is showing,
 * so they follow the text as it reflows; they never take a click.
 */
export function DocPointers({ editor, file }: { editor: Editor; file: string }) {
  const all = usePointers((s) => s.pointers);
  const mine = useMemo(() => Object.values(all).filter((p) => p.target.file === file && p.target.block !== undefined), [all, file]);
  const [placed, setPlaced] = useState<Placed[]>([]);
  // a zero-height anchor at the top of the page's text: the pointers are placed from it and scroll with the text
  const anchor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mine.length) {
      setPlaced([]);
      return;
    }
    let raf = 0;
    let last = '';
    const measure = () => {
      raf = requestAnimationFrame(measure);
      const body = editor.isDestroyed ? null : (editor.view.dom as HTMLElement);
      if (!body || !anchor.current) return;
      const origin = anchor.current.getBoundingClientRect();
      const out: Placed[] = [];
      for (const p of mine) {
        const blocks = body.children;
        const el = blocks[Math.min(p.target.block!, blocks.length - 1)] as HTMLElement | undefined;
        if (!el) continue;
        const r = el.getBoundingClientRect();
        out.push({
          id: p.participant.id,
          color: p.color,
          label: pointerLabel(p.participant),
          fading: p.fading,
          box: { left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height },
        });
      }
      const key = JSON.stringify(out);
      if (key !== last) {
        last = key;
        setPlaced(out);
      }
    };
    measure();
    return () => cancelAnimationFrame(raf);
  }, [editor, mine]);

  return (
    <div className="docpointers" ref={anchor} aria-hidden="true">
      {placed.map((p) => (
        <div
          key={p.id}
          className="docpointer"
          data-dc-pointer={p.id}
          data-fading={p.fading ? '' : undefined}
          // a participant's colour is who it is, the same in light and dark: a value, not a theme token
          style={{ ['--pc' as string]: p.color, left: p.box.left - 6, top: p.box.top - 4, width: p.box.width + 12, height: p.box.height + 8 }}
        >
          <span className="docpointer-cursor">
            <svg viewBox="0 0 14 20" aria-hidden="true">
              <path d="M1 1v14l3.6-3.4L7.2 18l2.6-1.1L7.3 10.6H12z" />
            </svg>
            <span className="docpointer-tag">{p.label}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
