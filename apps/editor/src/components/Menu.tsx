import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Info } from './icons';

/**
 * A popover menu at a screen point; closes on outside click or Escape. It is drawn on the body, not
 * where it is used: a caller inside a transformed ancestor (the request bar is centred with a
 * transform) would otherwise make that ancestor the menu's containing block and put it off screen.
 */
export function Menu({
  x,
  y,
  onClose,
  children,
  label,
  align = 'left',
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
  label: string;
  align?: 'left' | 'right';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let nx = align === 'right' ? x - r.width : x;
    let ny = y;
    if (nx + r.width > innerWidth - 8) nx = innerWidth - 8 - r.width;
    if (ny + r.height > innerHeight - 8) ny = Math.max(8, innerHeight - 8 - r.height);
    setPos({ x: Math.max(8, nx), y: ny });
    (el.querySelector('button:not(:disabled), input') as HTMLElement | null)?.focus();
  }, [x, y, align]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('.mi:not(:disabled)') ?? []);
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
        next?.focus();
        e.preventDefault();
      }
    };
    const blur = () => onClose();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', blur);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className="menu" role="menu" aria-label={label} style={{ left: pos.x, top: pos.y }}>
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({
  label,
  keys,
  icon,
  onSelect,
  disabled,
  danger,
  checked,
  hint,
}: {
  label: string;
  /** the detail, shown on hover (and to screen readers) beside a small info mark; the label alone says what it is */
  hint?: string;
  keys?: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
}) {
  return (
    <button
      className={`mi${danger ? ' danger' : ''}`}
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
    >
      {(icon || checked !== undefined) && <span className="ic">{checked ? <Check /> : icon}</span>}
      {label}
      {keys && <span className="k">{keys}</span>}
      {hint && (
        <>
          <span className="mi-info" aria-hidden="true">
            <Info />
          </span>
          <span className="mh" role="tooltip">
            {hint}
          </span>
        </>
      )}
    </button>
  );
}
