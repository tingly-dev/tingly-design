import type { ReactNode } from 'react';

/**
 * A choice among a few options drawn as joined buttons; the one lit is the current value. Every
 * kind's panels, the request bar and the settings dialogs use this one, so the look, the pressed
 * state and the arrow keys are the same everywhere. `data` puts a `data-<name>` on each button
 * (a test or a style hooks onto it).
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  data,
}: {
  value: T | '';
  options: { value: T; label: ReactNode; title?: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  label: string;
  data?: string;
}) {
  return (
    <div
      className="seg"
      role="group"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        if (i < 0) return;
        items[(i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length].focus();
        e.preventDefault();
      }}
    >
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          aria-pressed={value === o.value}
          title={o.title}
          aria-label={o.title}
          disabled={o.disabled}
          {...(data ? { [`data-${data}`]: o.value } : {})}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
