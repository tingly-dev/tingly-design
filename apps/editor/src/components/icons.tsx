import type { ReactNode } from 'react';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const Cursor = () => (
  <Icon>
    <path d="M5 3l14 7-6 2-2 6z" />
  </Icon>
);
export const Hand = () => (
  <Icon>
    <path d="M8 13V5.5a1.5 1.5 0 013 0V11m0-1V4.5a1.5 1.5 0 013 0V11m0-4.5a1.5 1.5 0 013 0V14a7 7 0 01-7 7h-1a6 6 0 01-5-2.7L3.3 14.5a1.5 1.5 0 012.5-1.7L8 15" />
  </Icon>
);
export const Play = () => (
  <Icon>
    <path d="M7 4.5v15l12-7.5z" />
  </Icon>
);
export const Board = () => (
  <Icon>
    <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
    <path d="M3.5 9h17" />
  </Icon>
);
export const Note = () => (
  <Icon>
    <path d="M5 4h14v10l-6 6H5z" />
    <path d="M13 20v-6h6" />
  </Icon>
);
export const Undo = () => (
  <Icon>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h11a5 5 0 010 10h-3" />
  </Icon>
);
export const Redo = () => (
  <Icon>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H9a5 5 0 000 10h3" />
  </Icon>
);
export const Fit = () => (
  <Icon>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Icon>
);
export const Minus = () => (
  <Icon>
    <path d="M5 12h14" />
  </Icon>
);
export const Plus = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const Commit = () => (
  <Icon>
    <circle cx="12" cy="12" r="3.5" />
    <path d="M3 12h5.5M15.5 12H21" />
  </Icon>
);
export const Trash = () => (
  <Icon>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </Icon>
);
export const Copy = () => (
  <Icon>
    <rect x="8" y="8" width="12" height="12" rx="1.5" />
    <path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" />
  </Icon>
);
export const Up = () => (
  <Icon>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);
export const Down = () => (
  <Icon>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Icon>
);
export const Send = () => (
  <Icon>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);
export const Stop = () => (
  <Icon>
    <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />
  </Icon>
);
