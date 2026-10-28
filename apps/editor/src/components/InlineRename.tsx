import { useRef } from 'react';

/**
 * The text box that replaces a name while it is being renamed in place: a project, a section, a
 * document tab, a board, a page. Enter or leaving the box commits, Escape puts the old name back,
 * and the keys never reach the shortcuts behind it. `onCommit` hears only a changed name (trimmed;
 * an empty one only with `allowEmpty`, for a name that may be cleared); `onDone` always follows, so
 * the caller leaves its renaming state in one place.
 */
export function InlineRename({
  value,
  label,
  onCommit,
  onDone,
  className,
  allowEmpty = false,
}: {
  value: string;
  label: string;
  onCommit: (name: string) => void;
  onDone: () => void;
  className?: string;
  allowEmpty?: boolean;
}) {
  const cancelled = useRef(false);
  return (
    <input
      className={className}
      autoFocus
      defaultValue={value}
      aria-label={label}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          cancelled.current = true;
          onDone();
        }
      }}
      onBlur={(e) => {
        onDone();
        if (cancelled.current) return;
        const v = e.currentTarget.value.trim();
        if (v !== value && (v || allowEmpty)) onCommit(v);
      }}
    />
  );
}
