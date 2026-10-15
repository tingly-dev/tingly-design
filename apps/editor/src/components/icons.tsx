import type { ComponentType } from 'react';
import {
  IconAlignCenter,
  IconAlignJustified,
  IconAlignLeft,
  IconAlignRight,
  IconArrowBackUp,
  IconArrowDown,
  IconArrowForwardUp,
  IconArrowRight,
  IconArrowUp,
  IconArrowUpRight,
  IconArrowsMaximize,
  IconArrowsExchange,
  IconBan,
  IconBorderCorners,
  IconBorderOuter,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconColumns,
  IconComponents,
  IconDiamond,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconForms,
  IconFileImport,
  IconFileText,
  IconFileTypePdf,
  IconFrame,
  IconHandStop,
  IconHistory,
  IconMovie,
  IconLayoutAlignBottom,
  IconLayoutAlignCenter,
  IconLayoutAlignLeft,
  IconLayoutAlignMiddle,
  IconLayoutAlignRight,
  IconLayoutAlignTop,
  IconLayoutGrid,
  IconLayoutRows,
  IconLayoutSidebarRight,
  IconPictureInPicture,
  IconLine,
  IconLink,
  IconLock,
  IconLockOpen,
  IconMinus,
  IconNote,
  IconOval,
  IconPaperclip,
  IconPencil,
  IconPhoto,
  IconPlayerPauseFilled,
  IconPlayerPlay,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconPlus,
  IconPointer,
  IconRectangle,
  IconRepeat,
  IconShape,
  IconSparkles,
  IconSquare,
  IconTextWrap,
  IconTrash,
  IconTypography,
  IconVector,
  IconX,
  IconBook,
  IconSearch,
  IconEdit,
  IconTerminal2,
  IconListCheck,
  IconLoader2,
  IconMessageCircle,
  IconAlertCircle,
  IconCircleCheck,
  IconArrowBackUpDouble,
  IconCornerLeftUp,
  IconHome,
  IconStar,
  IconDots,
  IconRefresh,
  IconMoon,
  IconSun,
  IconCode,
  IconDatabase,
  IconTarget,
  IconLayoutColumns,
  IconMessage,
  IconChecklist,
  IconPresentation,
  IconBug,
  IconLanguage,
  IconExternalLink,
  IconAdjustmentsHorizontal,
  type IconProps,
} from '@tabler/icons-react';

/**
 * The editor's icons: Tabler, the set Tingly Box uses, at one stroke weight.
 * Call sites use these names, never Tabler directly, so the set can change in one place.
 */
const tabler =
  (I: ComponentType<IconProps>, size = 16) =>
  ({ size: s = size }: { size?: number } = {}) => <I size={s} stroke={1.6} aria-hidden="true" />;

export const Cursor = tabler(IconPointer);
export const Hand = tabler(IconHandStop);
export const TextT = tabler(IconTypography);
export const Frame = tabler(IconFrame);
export const Note = tabler(IconNote);
export const Pen = tabler(IconPencil);
export const Shapes = tabler(IconShape);
export const Rect = tabler(IconSquare);
export const Oval = tabler(IconOval);
export const LineI = tabler(IconLine);
export const ArrowI = tabler(IconArrowUpRight);
export const Play = tabler(IconPlayerPlay);
export const PlayFilled = tabler(IconPlayerPlayFilled, 14);
export const PauseFilled = tabler(IconPlayerPauseFilled, 14);
export const Panel = tabler(IconLayoutSidebarRight);
export const Chevron = ({ open = true }: { open?: boolean }) => (open ? <IconChevronDown size={12} stroke={2} aria-hidden="true" /> : <IconChevronRight size={12} stroke={2} aria-hidden="true" />);
// layer switches (hide, lock)
export const Eye = tabler(IconEye, 14);
export const EyeOff = tabler(IconEyeOff, 14);
export const Lock = tabler(IconLock, 14);
export const Unlock = tabler(IconLockOpen, 14);
export const Caret = () => <IconChevronDown size={12} stroke={2} aria-hidden="true" />;
export const History = tabler(IconHistory, 14);
export const DockRight = tabler(IconLayoutSidebarRight, 14);
export const Floating = tabler(IconPictureInPicture, 14);
export const Expand = tabler(IconArrowsMaximize, 14);
export const Download = tabler(IconDownload, 14);
export const Plus = tabler(IconPlus, 14);
export const Minus = tabler(IconMinus, 14);
export const Close = tabler(IconX, 14);
export const Home = tabler(IconHome);
export const Star = tabler(IconStar, 14);
export const More = tabler(IconDots);
export const Refresh = tabler(IconRefresh);
export const Moon = tabler(IconMoon);
export const Sun = tabler(IconSun);
export const CodeI = tabler(IconCode);
export const Database = tabler(IconDatabase);
export const Target = tabler(IconTarget);
export const LayoutCols = tabler(IconLayoutColumns);
export const Message = tabler(IconMessage);
export const Checklist = tabler(IconChecklist);
export const Presentation = tabler(IconPresentation);
export const Bug = tabler(IconBug, 14);
export const Language = tabler(IconLanguage, 15);
export const Sliders = tabler(IconAdjustmentsHorizontal, 15);
export const External = tabler(IconExternalLink, 12);
export const Check = tabler(IconCheck, 14);
export const Trash = tabler(IconTrash, 14);
export const Undo = tabler(IconArrowBackUp);
export const Redo = tabler(IconArrowForwardUp);
export const Send = tabler(IconArrowUp);
export const Stop = tabler(IconPlayerStopFilled);
export const Sparkle = tabler(IconSparkles);
export const Corners = tabler(IconBorderCorners, 14);
export const Sides = tabler(IconBorderOuter, 14);
export const Wrap = tabler(IconTextWrap, 14);
export const ArrowRight = tabler(IconArrowRight, 14);
export const ArrowDown = tabler(IconArrowDown, 14);

// alignment of an element inside its parent
export const AlignLeft = tabler(IconLayoutAlignLeft, 14);
export const AlignCenterH = tabler(IconLayoutAlignCenter, 14);
export const AlignRight = tabler(IconLayoutAlignRight, 14);
export const AlignTop = tabler(IconLayoutAlignTop, 14);
export const AlignMiddle = tabler(IconLayoutAlignMiddle, 14);
export const AlignBottom = tabler(IconLayoutAlignBottom, 14);
export const TextLeft = tabler(IconAlignLeft, 14);
export const TextCenter = tabler(IconAlignCenter, 14);
export const TextRight = tabler(IconAlignRight, 14);
export const TextJustify = tabler(IconAlignJustified, 14);
export const NoneI = tabler(IconBan, 14);
export const Picture = tabler(IconPhoto);
export const Clip = tabler(IconPaperclip);
export const FileText = tabler(IconFileText, 14);
export const ImportI = tabler(IconFileImport);
export const Transfer = tabler(IconArrowsExchange);
export const Film = tabler(IconMovie, 14);
export const FilePdf = tabler(IconFileTypePdf, 14);

// what an agent is doing (RunFeed)
export const StepRead = tabler(IconBook, 14);
export const StepSearch = tabler(IconSearch, 14);
export const StepEdit = tabler(IconEdit, 14);
export const StepRun = tabler(IconTerminal2, 14);
export const StepPlan = tabler(IconListCheck, 14);
export const StepSay = tabler(IconMessageCircle, 14);
export const Spinner = ({ size = 14 }: { size?: number }) => (
  <span className="spin" aria-hidden="true">
    <IconLoader2 size={size} stroke={1.8} />
  </span>
);
export const Done = tabler(IconCircleCheck, 16);
export const Failed = tabler(IconAlertCircle, 16);
export const UndoAll = tabler(IconArrowBackUpDouble, 14);
export const Reuse = tabler(IconCornerLeftUp, 14);

// layer roles
const ROLES: Record<string, ComponentType<IconProps>> = {
  Column: IconColumns,
  Row: IconLayoutRows,
  Grid: IconLayoutGrid,
  Group: IconLayoutGrid,
  Text: IconTypography,
  Image: IconPhoto,
  Vector: IconVector,
  Button: IconRectangle,
  Input: IconForms,
  Link: IconLink,
  'Repeating group': IconRepeat,
  Condition: IconDiamond,
  Component: IconComponents,
  Artboard: IconFrame,
  Note: IconNote,
  Title: IconTypography,
  Rectangle: IconSquare,
  Oval: IconOval,
  Line: IconLine,
  Arrow: IconArrowUpRight,
  Drawing: IconPencil,
};
export const RoleIcon = ({ role }: { role: string }) => {
  const I = ROLES[role] ?? IconShape;
  return <I size={14} stroke={1.6} aria-hidden="true" />;
};
