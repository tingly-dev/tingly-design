import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { dragSideWidth, keepSideWidth, resetSideWidth, SIDES, sideWidth, type SideId } from '../sideWidth';

/**
 * The edge of a side column that the person drags to make it wider or narrower (arrow keys do the
 * same, a double click gives the column its own width back). It is placed where the column ends
 * by its width variable (panel.css), against the `.app` that holds the column, so a column that
 * scrolls does not carry it away or cut it off: `edge="end"` for a column on the left, `"start"`
 * for one on the right.
 */
export function SideResizer({ id, edge, name }: { id: SideId; edge: 'start' | 'end'; name: string }) {
  const { t } = useTranslation();
  const drag = useRef<{ x: number; w: number } | null>(null);
  const sign = edge === 'end' ? 1 : -1;
  const width = () => sideWidth(id);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: width() };
    document.body.classList.add('resizing-side');
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) dragSideWidth(id, drag.current.w + sign * (e.clientX - drag.current.x));
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    keepSideWidth(id, drag.current.w + sign * (e.clientX - drag.current.x));
    drag.current = null;
    document.body.classList.remove('resizing-side');
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 16;
    const grow = (edge === 'end') === (e.key === 'ArrowRight');
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const w = dragSideWidth(id, width() + (grow ? step : -step));
    keepSideWidth(id, w);
  };

  return (
    <div
      className={`side-resizer ${edge}`}
      data-side={id}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('common.resizeSide', { name })}
      aria-valuemin={SIDES[id].min}
      aria-valuemax={SIDES[id].max}
      aria-valuenow={sideWidth(id)}
      title={t('common.resizeSideHint')}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      onDoubleClick={() => resetSideWidth(id)}
    />
  );
}
