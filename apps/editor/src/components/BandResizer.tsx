import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { BANDS, bandHeight, dragBandHeight, keepBandHeight, resetBandHeight, type BandId } from '../bandHeight';

/**
 * The bottom edge of a band the person drags to make it taller or shorter (arrow keys do the
 * same, a double click gives the band its own height back). The band that holds it is
 * `position: relative`; the edge sits on its bottom line.
 */
export function BandResizer({ id, name }: { id: BandId; name: string }) {
  const { t } = useTranslation();
  const drag = useRef<{ y: number; h: number } | null>(null);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, h: bandHeight(id) };
    document.body.classList.add('resizing-band');
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) dragBandHeight(id, drag.current.h + (e.clientY - drag.current.y));
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    keepBandHeight(id, drag.current.h + (e.clientY - drag.current.y));
    drag.current = null;
    document.body.classList.remove('resizing-band');
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? 48 : 16;
    keepBandHeight(id, dragBandHeight(id, bandHeight(id) + (e.key === 'ArrowDown' ? step : -step)));
  };

  return (
    <div
      className="band-resizer"
      role="separator"
      aria-orientation="horizontal"
      aria-label={t('common.resizeBand', { name })}
      aria-valuemin={BANDS[id].min}
      aria-valuemax={BANDS[id].max}
      aria-valuenow={bandHeight(id)}
      title={t('common.resizeBandHint')}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      onDoubleClick={() => resetBandHeight(id)}
    />
  );
}
