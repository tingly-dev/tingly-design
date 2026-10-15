import { useEffect, useRef, useState } from 'react';

/**
 * A note typed in a box under the stage (slides' speaker notes, motion's notes on a scene or the
 * whole piece). It saves as you type; text arriving from the file replaces the box unless the
 * person is in it. `current` reads what the file has right now, so a save that changes nothing is skipped.
 */
export function NoteBox({
  saved,
  current,
  onSave,
  className = 'snotes',
  placeholder,
  label,
}: {
  saved: string;
  current: () => string;
  onSave: (text: string) => void;
  className?: string;
  placeholder: string;
  label: string;
}) {
  const [text, setText] = useState(saved);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!focused.current) setText(saved);
  }, [saved]);
  // a click on the stage never blurs this box: the frame keeps focus where it is
  const save = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (v !== current()) onSave(v);
    }, 700);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <textarea
      className={className}
      value={text}
      placeholder={placeholder}
      aria-label={label}
      onFocus={() => (focused.current = true)}
      onChange={(e) => {
        setText(e.target.value);
        save(e.target.value);
      }}
      onKeyDown={(e) => e.stopPropagation()}
      onBlur={(e) => {
        focused.current = false;
        if (timer.current) {
          clearTimeout(timer.current);
          timer.current = null;
        }
        if (e.target.value !== current()) onSave(e.target.value);
      }}
    />
  );
}
