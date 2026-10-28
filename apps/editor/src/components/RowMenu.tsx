import { useRef, useState, type ReactNode } from 'react';
import { Menu } from './Menu';
import { More } from './icons';

/**
 * The ⋯ button at the end of a list row and the menu it opens: what can be done with this one
 * item. Rows of every kind (a document's tabs, and the lists that follow) use it, so the menu is
 * the shared `Menu` (arrow keys, Escape, closes on an outside click) and not one drawn per list.
 * The order of the entries is the same everywhere: add, duplicate, move, the rest, a rule, delete.
 */
export function RowMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const btn = useRef<HTMLButtonElement>(null);
  // the menu closes itself on a press outside it, the button included: remember it was open then, so the click that follows does not open it again
  const wasOpen = useRef(false);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const close = () => setAt(null);
  return (
    <>
      <button
        ref={btn}
        className="ib sm more"
        aria-haspopup="menu"
        aria-expanded={!!at}
        aria-label={label}
        title={label}
        onPointerDown={() => (wasOpen.current = !!at)}
        onClick={() => {
          if (wasOpen.current) return void (wasOpen.current = false);
          const r = btn.current!.getBoundingClientRect();
          setAt({ x: r.right, y: r.bottom + 4 });
        }}
      >
        <More />
      </button>
      {at && (
        <Menu x={at.x} y={at.y} align="right" label={label} onClose={close}>
          {children(close)}
        </Menu>
      )}
    </>
  );
}
