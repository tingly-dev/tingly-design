import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Menu, MenuItem } from './Menu';
import { More } from './icons';
import { t as tNow } from '../i18n';

/**
 * The small bar at the corner of an active self-contained block (a table, a drawn fence,
 * a dashboard widget later): its export actions, right where the block is, so the top bar
 * stays out of the way. It extends the other entry points (the Import/Export menu, the
 * context menu) with the same words, it does not replace them. The anti-clutter rules live
 * in .design/block-corner-bar.md: only while the block is active, at most `maxVisible`
 * icons, the rest in a "⋯" menu.
 */

export interface CornerItem {
  id: string;
  /** the action, in words — also the icon's tooltip and its name for a screen reader */
  label: string;
  icon?: ReactNode;
  run: () => void;
}

const GAP = 6;
const EDGE = 8;

export function CornerBar({ anchor, items, label, maxVisible = 3 }: {
  /** the block the bar belongs to; the bar follows it through scrolls and resizes, and goes away with it */
  anchor: HTMLElement | null;
  items: CornerItem[];
  /** what this group of buttons is, for a screen reader */
  label: string;
  maxVisible?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [, tick] = useState(0);
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const at = (b: HTMLElement) => {
    const r = b.getBoundingClientRect();
    setOpen({ x: r.right, y: r.bottom + 4 });
  };

  // any scroll anywhere, a window resize, or the block itself changing size move the bar
  useLayoutEffect(() => {
    if (!anchor) return;
    const f = () => tick((n) => n + 1);
    window.addEventListener('scroll', f, true);
    window.addEventListener('resize', f);
    const ro = new ResizeObserver(f);
    ro.observe(anchor);
    return () => {
      window.removeEventListener('scroll', f, true);
      window.removeEventListener('resize', f);
      ro.disconnect();
    };
  }, [anchor]);
  // one measured frame after mount, so the first position knows the bar's own size
  useEffect(() => {
    tick((n) => n + 1);
  }, [items.length]);

  if (!anchor || !anchor.isConnected || !items.length) return null;
  const r = anchor.getBoundingClientRect();
  const w = ref.current?.offsetWidth ?? 0;
  const h = ref.current?.offsetHeight ?? 0;
  const right = Math.max(EDGE, Math.min(r.right, innerWidth - EDGE));
  const left = Math.max(EDGE, Math.min(right - w, innerWidth - EDGE - w));
  let top = r.top - GAP - h;
  if (top < EDGE) top = r.bottom + GAP;
  const visible = items.length > maxVisible ? items.slice(0, maxVisible - 1) : items;
  const overflow = items.length > maxVisible ? items.slice(maxVisible - 1) : [];
  const act = (it: CornerItem) => () => {
    setOpen(null);
    it.run();
  };
  return createPortal(
    <>
      <div ref={ref} className="cbar" role="toolbar" aria-label={label} style={{ left, top }}>
        {visible.map((it) => (
          <button
            key={it.id}
            className="ib sm"
            aria-label={it.label}
            title={it.label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={it.run}
          >
            {it.icon}
          </button>
        ))}
        {overflow.length > 0 && (
          <button
            className="ib sm"
            aria-label={tNow('common.more')}
            aria-haspopup="menu"
            aria-expanded={!!open}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => (open ? setOpen(null) : at(e.currentTarget))}
          >
            <More />
          </button>
        )}
      </div>
      {open && (
        <Menu x={open.x} y={open.y} label={label} align="right" onClose={() => setOpen(null)}>
          {overflow.map((it) => (
            <MenuItem key={it.id} label={it.label} icon={it.icon} onSelect={act(it)} />
          ))}
        </Menu>
      )}
    </>,
    document.body,
  );
}
