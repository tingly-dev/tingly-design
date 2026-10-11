import type { ReactNode } from 'react';

/** 16px stroke icons, drawn on a 20-unit grid. */
function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const Cursor = () => (
  <Icon>
    <path d="M5 3.5l10 5.3-4.3 1.2-1.9 4.4z" />
  </Icon>
);
export const Hand = () => (
  <Icon>
    <path d="M7 10.5V5a1.2 1.2 0 012.4 0v4.5M9.4 9V3.8a1.2 1.2 0 012.4 0V9m0-.5V5a1.2 1.2 0 012.4 0v6.2a5.3 5.3 0 01-5.3 5.3h-.6a4.6 4.6 0 01-3.8-2l-2-3a1.2 1.2 0 012-1.3L7 12" />
  </Icon>
);
export const TextT = () => (
  <Icon>
    <path d="M4.5 5V4h11v1M10 4v12M8 16h4" />
  </Icon>
);
export const Frame = () => (
  <Icon>
    <path d="M6 3v14M14 3v14M3 6h14M3 14h14" />
  </Icon>
);
export const Note = () => (
  <Icon>
    <path d="M4 4h12v8l-4 4H4z" />
    <path d="M12 16v-4h4" />
  </Icon>
);
export const Pen = () => (
  <Icon>
    <path d="M13.5 3.5l3 3L7 16l-3.5.5L4 13z" />
  </Icon>
);
export const Shapes = () => (
  <Icon>
    <rect x="3" y="3" width="8" height="8" rx="1" />
    <circle cx="13" cy="13" r="4" />
  </Icon>
);
export const Rect = () => (
  <Icon>
    <rect x="3.5" y="4.5" width="13" height="11" rx="1" />
  </Icon>
);
export const Oval = () => (
  <Icon>
    <ellipse cx="10" cy="10" rx="6.5" ry="5.5" />
  </Icon>
);
export const LineI = () => (
  <Icon>
    <path d="M4 16L16 4" />
  </Icon>
);
export const ArrowI = () => (
  <Icon>
    <path d="M4 16L16 4M9 4h7v7" />
  </Icon>
);
export const Play = () => (
  <Icon>
    <path d="M6.5 4.5v11l9-5.5z" />
  </Icon>
);
export const Panel = () => (
  <Icon>
    <rect x="3" y="4" width="14" height="12" rx="1.5" />
    <path d="M12 4v12" />
  </Icon>
);
export const Chevron = ({ open = true }: { open?: boolean }) => (
  <Icon size={12}>
    <path d={open ? 'M5 8l5 5 5-5' : 'M8 5l5 5-5 5'} />
  </Icon>
);
export const Caret = () => (
  <Icon size={12}>
    <path d="M6 8l4 4 4-4" />
  </Icon>
);
export const Expand = () => (
  <Icon size={14}>
    <path d="M11.5 3.5h5v5M8.5 16.5h-5v-5M16.5 3.5l-5.5 5.5M3.5 16.5L9 11" />
  </Icon>
);
export const Download = () => (
  <Icon size={14}>
    <path d="M10 3.5v9M6 9l4 4 4-4M4 16.5h12" />
  </Icon>
);
export const Plus = () => (
  <Icon size={14}>
    <path d="M10 4v12M4 10h12" />
  </Icon>
);
export const Minus = () => (
  <Icon size={14}>
    <path d="M4 10h12" />
  </Icon>
);
export const Close = () => (
  <Icon size={14}>
    <path d="M5 5l10 10M15 5L5 15" />
  </Icon>
);
export const Check = () => (
  <Icon size={14}>
    <path d="M4 10.5l4 4 8-9" />
  </Icon>
);
export const Trash = () => (
  <Icon size={14}>
    <path d="M4 6h12M8 6V4h4v2M5.5 6l.8 10h7.4l.8-10" />
  </Icon>
);
export const Undo = () => (
  <Icon>
    <path d="M7.5 12L4 8.5 7.5 5" />
    <path d="M4 8.5h8a4 4 0 010 8H9.5" />
  </Icon>
);
export const Redo = () => (
  <Icon>
    <path d="M12.5 12L16 8.5 12.5 5" />
    <path d="M16 8.5H8a4 4 0 000 8h2.5" />
  </Icon>
);
export const Send = () => (
  <Icon>
    <path d="M10 16V4M5 9l5-5 5 5" />
  </Icon>
);
export const Stop = () => (
  <Icon>
    <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" />
  </Icon>
);
export const Sparkle = () => (
  <Icon>
    <path d="M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6z" />
  </Icon>
);
export const Corners = () => (
  <Icon size={14}>
    <path d="M3.5 8V4.5a1 1 0 011-1H8M12 3.5h3.5a1 1 0 011 1V8M16.5 12v3.5a1 1 0 01-1 1H12M8 16.5H4.5a1 1 0 01-1-1V12" />
  </Icon>
);
export const Sides = () => (
  <Icon size={14}>
    <rect x="5.5" y="5.5" width="9" height="9" rx="1" />
    <path d="M10 2.5v1M10 16.5v1M2.5 10h1M16.5 10h1" />
  </Icon>
);
export const Wrap = () => (
  <Icon size={14}>
    <path d="M3.5 6h10a3 3 0 010 6H8M10 9.5L7.5 12 10 14.5" />
  </Icon>
);
export const ArrowRight = () => (
  <Icon size={14}>
    <path d="M3.5 10h13M12 5.5l4.5 4.5-4.5 4.5" />
  </Icon>
);
export const ArrowDown = () => (
  <Icon size={14}>
    <path d="M10 3.5v13M5.5 12l4.5 4.5 4.5-4.5" />
  </Icon>
);

// alignment of an element inside its parent
export const AlignLeft = () => (
  <Icon size={14}>
    <path d="M3.5 3v14M6.5 7h8M6.5 13h5" />
  </Icon>
);
export const AlignCenterH = () => (
  <Icon size={14}>
    <path d="M10 3v14M5.5 7h9M7 13h6" />
  </Icon>
);
export const AlignRight = () => (
  <Icon size={14}>
    <path d="M16.5 3v14M5.5 7h8M8.5 13h5" />
  </Icon>
);
export const AlignTop = () => (
  <Icon size={14}>
    <path d="M3 3.5h14M7 6.5v8M13 6.5v5" />
  </Icon>
);
export const AlignMiddle = () => (
  <Icon size={14}>
    <path d="M3 10h14M7 5.5v9M13 7v6" />
  </Icon>
);
export const AlignBottom = () => (
  <Icon size={14}>
    <path d="M3 16.5h14M7 5.5v8M13 8.5v5" />
  </Icon>
);
export const TextLeft = () => (
  <Icon size={14}>
    <path d="M4 5h12M4 9h8M4 13h12M4 17h7" />
  </Icon>
);
export const TextCenter = () => (
  <Icon size={14}>
    <path d="M4 5h12M6 9h8M4 13h12M6.5 17h7" />
  </Icon>
);
export const TextRight = () => (
  <Icon size={14}>
    <path d="M4 5h12M8 9h8M4 13h12M9 17h7" />
  </Icon>
);
export const TextJustify = () => (
  <Icon size={14}>
    <path d="M4 5h12M4 9h12M4 13h12M4 17h12" />
  </Icon>
);
export const NoneI = () => (
  <Icon size={14}>
    <circle cx="10" cy="10" r="6" />
    <path d="M5.8 14.2l8.4-8.4" />
  </Icon>
);

export const ImageI = () => (
  <Icon>
    <rect x="3" y="4" width="14" height="12" rx="1.5" />
    <circle cx="7.5" cy="8" r="1.3" />
    <path d="M3.5 14.5l4-4 3 3 2-2 4 4" />
  </Icon>
);
export const TableI = () => (
  <Icon>
    <rect x="3" y="4" width="14" height="12" rx="1.5" />
    <path d="M3 8h14M3 12h14M8 8v8" />
  </Icon>
);
export const Star = () => (
  <Icon>
    <path d="M10 3l2.1 4.4 4.8.6-3.5 3.3.9 4.7L10 13.7 5.7 16l.9-4.7L3.1 8l4.8-.6z" />
  </Icon>
);
export const GridI = () => (
  <Icon>
    <rect x="3" y="3.5" width="6" height="5" rx="1" />
    <rect x="11" y="3.5" width="6" height="5" rx="1" />
    <rect x="3" y="11.5" width="6" height="5" rx="1" />
    <rect x="11" y="11.5" width="6" height="5" rx="1" />
  </Icon>
);
export const SlideI = () => (
  <Icon>
    <rect x="2.5" y="5" width="15" height="10" rx="1.5" />
  </Icon>
);
export const NotesI = () => (
  <Icon>
    <rect x="3" y="3.5" width="14" height="13" rx="1.5" />
    <path d="M3 11.5h14M6 14h6" />
  </Icon>
);
export const RailI = () => (
  <Icon>
    <rect x="3" y="3.5" width="14" height="13" rx="1.5" />
    <path d="M7.5 3.5v13" />
  </Icon>
);
export const Present = () => (
  <Icon>
    <rect x="2.5" y="3.5" width="15" height="10" rx="1.5" />
    <path d="M8.5 6.5l3.5 2-3.5 2zM10 13.5v3M7 16.5h6" />
  </Icon>
);
export const Upload = () => (
  <Icon>
    <path d="M10 13V3.5M6.5 7L10 3.5 13.5 7M4 12.5v3a1 1 0 001 1h10a1 1 0 001-1v-3" />
  </Icon>
);

// layer roles
export const RoleIcon = ({ role }: { role: string }) => {
  switch (role) {
    case 'Column':
      return (
        <Icon size={13}>
          <path d="M5 4v12M10 4v12M15 4v12" />
        </Icon>
      );
    case 'Row':
      return (
        <Icon size={13}>
          <path d="M4 5h12M4 10h12M4 15h12" />
        </Icon>
      );
    case 'Grid':
    case 'Group':
      return (
        <Icon size={13}>
          <path d="M7 3.5v13M13 3.5v13M3.5 7h13M3.5 13h13" />
        </Icon>
      );
    case 'Text':
      return <TextT />;
    case 'Image':
      return (
        <Icon size={13}>
          <rect x="3.5" y="4.5" width="13" height="11" rx="1" />
          <path d="M4 14l4-4 3 3 2-2 3 3" />
        </Icon>
      );
    case 'Vector':
      return <Pen />;
    case 'Button':
      return (
        <Icon size={13}>
          <rect x="3" y="6" width="14" height="8" rx="3" />
        </Icon>
      );
    case 'Input':
      return (
        <Icon size={13}>
          <rect x="3" y="6" width="14" height="8" rx="1.5" />
          <path d="M6 8.5v3" />
        </Icon>
      );
    case 'Link':
      return (
        <Icon size={13}>
          <path d="M8.5 11.5l3-3M7 9L5.5 10.5a2.5 2.5 0 003.5 3.5L10.5 12.5M13 11l1.5-1.5A2.5 2.5 0 0011 6L9.5 7.5" />
        </Icon>
      );
    case 'Repeating group':
      return (
        <Icon size={13}>
          <path d="M4 5h12M4 10h12M4 15h12" strokeDasharray="2 2" />
        </Icon>
      );
    case 'Condition':
      return (
        <Icon size={13}>
          <path d="M10 3l7 7-7 7-7-7z" />
        </Icon>
      );
    case 'Component':
      return (
        <Icon size={13}>
          <path d="M10 2.5l3 3-3 3-3-3zM10 11.5l3 3-3 3-3-3zM5.5 7l3 3-3 3-3-3zM14.5 7l3 3-3 3-3-3z" />
        </Icon>
      );
    case 'Artboard':
      return <Frame />;
    case 'Slide':
      return <SlideI />;
    case 'Shape':
      return <Shapes />;
    case 'Icon':
      return <Star />;
    case 'Connector':
      return <ArrowI />;
    case 'Table':
      return <TableI />;
    case 'Embed':
      return (
        <Icon size={13}>
          <path d="M7 6l-4 4 4 4M13 6l4 4-4 4" />
        </Icon>
      );
    case 'Note':
      return <Note />;
    case 'Title':
      return <TextT />;
    case 'Rectangle':
      return <Rect />;
    case 'Oval':
      return <Oval />;
    case 'Line':
      return <LineI />;
    case 'Arrow':
      return <ArrowI />;
    case 'Drawing':
      return <Pen />;
    default:
      return <Shapes />;
  }
};
