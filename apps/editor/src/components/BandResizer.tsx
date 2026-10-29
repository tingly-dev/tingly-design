import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { BANDS, bandHeight, dragBandHeight, keepBandHeight, resetBandHeight, type BandId } from '../bandHeight';

/**
 * The bottom edge of a band the person drags to make it taller or shorter (arrow keys do the
 * same, a double click gives the band its own height back). The band that holds it is
 * `position: relative`; the edge sits on its bottom line.
 */
export function BandResizer({ id, name }: { id: BandId; name: string }) {
  const { t } = useTranslation();
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const [height, setHeight] = useState(() => bandHeight(id));
  // a drag cut short by the band closing must not leave the page in its dragging state
  useEffect(() => () => document.body.classList.remove('resizing-band'), []);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, h: height, moved: false };
    document.body.classList.add('resizing-band');
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current.moved = true;
    setHeight(dragBandHeight(id, drag.current.h + (e.clientY - drag.current.y)));
  };
  const end = (keep: boolean, e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    document.body.classList.remove('resizing-band');
    // a click without a move, or a cancelled drag, keeps (or gives back) the height it began with
    if (keep && d.moved) keepBandHeight(id, d.h + (e.clientY - d.y));
    else setHeight(dragBandHeight(id, d.h));
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? 48 : 16;
    const h = dragBandHeight(id, height + (e.key === 'ArrowDown' ? step : -step));
    keepBandHeight(id, h);
    setHeight(h);
  };

  return (
    <div
      className="band-resizer"
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
      onKeyDown={key}
      onDoubleClick={() => {
        resetBandHeight(id);
        setHeight(BANDS[id].def);
      }}
    />
  );
}
