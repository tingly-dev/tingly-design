import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { BANDS, bandHeight, bandHeightSet, dragBandHeight, keepBandHeight, resetBandHeight, restoreBandHeight, type BandId } from '../bandHeight';

const DRAG_SLOP = 3;

/**
 * The bottom edge of a band the person drags to make it taller or shorter (arrow keys do the
 * same, a double click gives the band its own height back). The band that holds it is
 * `position: relative`; the edge sits on its bottom line, or, for a band that grows upward
 * (`edge="top"`, the request bar over the work), on its top line, where dragging up makes it taller.
 * `measure` tells the height it has now while the person has set none (a band that sizes to its content).
 */
export function BandResizer({
  id,
  name,
  edge = 'bottom',
  measure,
  onReset,
}: {
  id: BandId;
  name: string;
  edge?: 'top' | 'bottom';
  measure?: () => number;
  onReset?: () => void;
}) {
  const sign = edge === 'top' ? -1 : 1;
  const current = () => (!bandHeightSet(id) && measure ? measure() : bandHeight(id));
  const { t } = useTranslation();
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const [height, setHeight] = useState(() => bandHeight(id));
  // a drag cut short by the band closing must not leave the page dragging or the band painted unsaved
  useEffect(
    () => () => {
      if (!drag.current) return;
      document.body.classList.remove('resizing-band');
      restoreBandHeight(id);
    },
    [id],
  );

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const h = current();
    setHeight(h);
    drag.current = { y: e.clientY, h, moved: false };
    document.body.classList.add('resizing-band');
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    // a few px of jitter in a click is not a drag
    if (!drag.current.moved && Math.abs(e.clientY - drag.current.y) < DRAG_SLOP) return;
    drag.current.moved = true;
    setHeight(dragBandHeight(id, drag.current.h + sign * (e.clientY - drag.current.y)));
  };
  const end = (keep: boolean, e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    document.body.classList.remove('resizing-band');
    // a click without a move, or a cancelled drag, keeps (or gives back) the height it began with
    if (keep && d.moved) {
      // what is saved is what is shown: paint the final height, not only the last move's
      const h = dragBandHeight(id, d.h + sign * (e.clientY - d.y));
      keepBandHeight(id, h);
      setHeight(h);
    } else setHeight(restoreBandHeight(id));
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? 48 : 16;
    const h = dragBandHeight(id, current() + sign * (e.key === 'ArrowDown' ? step : -step));
    keepBandHeight(id, h);
    setHeight(h);
  };

  return (
    <div
      className={`band-resizer${edge === 'top' ? ' top' : ''}`}
      role="separator"
      aria-orientation="horizontal"
      aria-label={t('common.resizeBand', { name })}
      aria-valuemin={BANDS[id].min}
      aria-valuemax={BANDS[id].max}
      aria-valuenow={height}
      title={t('common.resizeBandHint')}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={(e) => end(true, e)}
      onPointerCancel={(e) => end(false, e)}
      onLostPointerCapture={(e) => end(false, e)}
      onKeyDown={key}
      onDoubleClick={() => {
        resetBandHeight(id);
        setHeight(BANDS[id].def);
        onReset?.();
        // a band that sizes to its content has its real height once the page has laid it out again
        if (measure) requestAnimationFrame(() => setHeight(measure()));
      }}
    />
  );
}
