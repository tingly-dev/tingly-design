import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** The last control focused outside menus and dialogs: where focus goes back when the dialog was opened from a menu item that is gone by then. */
let lastOutside: HTMLElement | null = null;
document.addEventListener('focusin', (e) => {
  const el = e.target as HTMLElement;
  if (!el.closest?.('[role=menu], [role=dialog]')) lastOutside = el;
});

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog: a backdrop, a box with its title and a close button, and
 * the keyboard every dialog owes: focus moves in on open (to an autofocused
 * field, else the first control), Tab stays inside, Esc or a click on the
 * backdrop closes, and focus goes back where it was on close.
 * With `onSubmit` the box is a form, so Enter in a field submits.
 */
export function Dialog({
  label,
  className,
  onClose,
  onSubmit,
  closable = true,
  children,
}: {
  /** the title, shown in the header and named to assistive tech */
  label: string;
  /** the dialog's own class, beside `ldialog` */
  className?: string;
  onClose: () => void;
  onSubmit?: () => void;
  /** false while work is under way that closing would cut short: Esc, the backdrop and × do nothing */
  closable?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const box = useRef<HTMLFormElement & HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const open = useRef(closable);
  open.current = closable;

  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    const el = box.current;
    if (el && !el.contains(document.activeElement)) {
      // the first control after the header's ×, so typing can start at once
      const all = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
      (all.find((n) => !n.closest('header')) ?? all[0] ?? el).focus();
    }
    const key = (e: KeyboardEvent) => {
      const el = box.current;
      if (!el) return;
      if (e.key === 'Escape') {
        // a menu open over the dialog takes its own Esc first
        if (document.querySelector('[role=menu]')) return;
        // the work behind the dialog does not hear it (a canvas would drop its selection)
        e.preventDefault();
        e.stopPropagation();
        if (open.current) close.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const all = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
      if (!all.length) return;
      const first = all[0];
      const last = all[all.length - 1];
      const at = document.activeElement;
      if (!el.contains(at)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && at === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      const to = back?.isConnected && back !== document.body ? back : lastOutside;
      if (to?.isConnected) to.focus();
    };
  }, []);

  const body = (
    <>
      <header>
        <h2>{label}</h2>
        <button type="button" className="tb" aria-label={t('common.close')} onClick={onClose} disabled={!closable}>
          ×
        </button>
      </header>
      {children}
    </>
  );
  const cls = `ldialog${className ? ` ${className}` : ''}`;
  return (
    <div className="lmodal" onMouseDown={(e) => e.target === e.currentTarget && closable && onClose()}>
      {onSubmit ? (
        <form
          ref={box}
          className={cls}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          {body}
        </form>
      ) : (
        <div ref={box} className={cls} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
          {body}
        </div>
      )}
    </div>
  );
}
