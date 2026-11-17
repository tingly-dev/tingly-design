import type { ProjectKind } from '@dc/core';
import { readPref, writePref } from './local';
import { SIDES, sideWidth, type SideId } from './sideWidth';

/** The side panes a kind's editor can open in its right column: at most one at a time. */
export type PaneId = 'inspector' | 'review' | 'files' | 'sources' | 'code' | 'comments';

/**
 * Which panes a kind has at all. The state is one value in the store (`pane`), remembered per kind
 * in this browser: what a person closed stays closed. The buttons are drawn by `TopBar` from
 * `components/panes.tsx`. The conversation is not one of these: it has its own column on the left
 * (`chatOpen`), independent of the right column (.design/chat-panel.md).
 * `files` is canvas only on purpose (.design/files-pane.md): the list, preview and copy are
 * kind-neutral, "put on canvas" is the canvas step.
 */
export const KIND_PANE_IDS: Record<ProjectKind, PaneId[]> = {
  design: ['inspector', 'review', 'files'],
  slides: ['inspector', 'review'],
  motion: ['inspector', 'review'],
  'design-system': [],
  dashboard: ['sources', 'code'],
  docs: ['comments'],
};

/**
 * The pane a kind opens with when nothing was chosen: the one a project of this kind shows in its
 * right column. A design system has none.
 */
export const MAIN_PANE: Record<ProjectKind, PaneId | null> = {
  design: 'inspector',
  slides: 'inspector',
  motion: 'inspector',
  'design-system': null,
  dashboard: 'sources',
  docs: 'comments',
};

/**
 * What the work needs at least before the conversation column is too cramped to open: the kind's
 * own left list + its right pane (when open) + the conversation's minimum 280 + this. Below it the
 * Conversation button is disabled with an explanation instead of moving the column or covering the
 * work. A person who finds a kind too tight changes its number here; these are estimates, not law.
 */
export const MIN_WORK: Record<ProjectKind, number> = {
  design: 480,
  slides: 420,
  motion: 480,
  'design-system': 480,
  dashboard: 440,
  docs: 420,
};

/** The kind's own list on the left edge, which the conversation column pushes to the right. */
const LEFT_COLUMN: Record<ProjectKind, SideId | null> = {
  design: null,
  slides: 'strip',
  motion: null,
  'design-system': 'dsnav',
  dashboard: null,
  docs: 'doctabs',
};

/** The kind's right column, when a pane is open there. */
const RIGHT_COLUMN: Record<ProjectKind, SideId | null> = {
  design: 'inspector',
  slides: 'inspector',
  motion: 'inspector',
  'design-system': null,
  dashboard: 'dashside',
  docs: 'docrail',
};

/** The width the kind's own left list takes, which the conversation pushes to the right. */
function chatLeftWidth(kind: ProjectKind): number {
  const left = LEFT_COLUMN[kind];
  return left ? sideWidth(left) : 0;
}

/** The width the conversation must leave beside it: the kind's list and its open right pane. */
export function chatRestWidth(kind: ProjectKind, pane: PaneId | null): number {
  const right = RIGHT_COLUMN[kind];
  return chatLeftWidth(kind) + (pane && right ? sideWidth(right) : 0);
}

/** The narrowest window in which the conversation column can open beside this kind's columns and work. */
function chatNeed(kind: ProjectKind, pane: PaneId | null): number {
  return SIDES.chat.min + chatRestWidth(kind, pane) + MIN_WORK[kind];
}

/** Whether the window is wide enough to open the conversation column now. It only gates opening. */
export function chatFits(kind: ProjectKind, pane: PaneId | null, width = window.innerWidth): boolean {
  return width >= chatNeed(kind, pane);
}

const paneKey = (kind: ProjectKind) => `dc.pane.${kind}`;

/** A right pane stopped being the conversation when the conversation moved to its own left column. */
function takeOldPane(kind: ProjectKind): boolean {
  if (readPref(paneKey(kind)) !== 'chat') return false;
  writePref(paneKey(kind), '');
  writePref('dc.chat', '1');
  return true;
}

/** The pane a project of this kind opens with: the one it was left with, else the kind's main pane. */
export function initialPane(kind: ProjectKind): PaneId | null {
  takeOldPane(kind);
  const ids = KIND_PANE_IDS[kind];
  const saved = readPref(paneKey(kind));
  if (saved === 'none') return null;
  if (saved && (ids as string[]).includes(saved)) return saved as PaneId;
  // the inspector used to remember its own on / off
  if (kind === 'design' || kind === 'slides' || kind === 'motion') return readPref('dc.panelOpen') === '0' ? null : 'inspector';
  return MAIN_PANE[kind];
}

export function rememberPane(kind: ProjectKind, pane: PaneId | null): void {
  // a review is a mode (clicks leave remarks instead of selecting): a project never opens in it, whatever was open before
  writePref(paneKey(kind), pane === 'review' ? 'inspector' : (pane ?? 'none'));
}

/** The old “position: left” setting (and the older right-edge dock) opens the conversation column once. */
function takeOldLeft(): void {
  const mode = readPref('dc.barMode');
  if (mode !== 'left' && mode !== 'auto') return;
  writePref('dc.barMode', '');
  writePref('dc.chat', '1');
}

/**
 * Whether a project opens with the conversation column on the left. It is one setting for every kind
 * (the same conversation); a window too narrow to hold it opens without it.
 */
export function initialChatOpen(kind: ProjectKind, pane: PaneId | null): boolean {
  takeOldLeft();
  if (readPref('dc.chat') !== '1') return false;
  return chatFits(kind, pane);
}

/** Keep whether the conversation column is open; one setting for every kind. */
export function rememberChat(open: boolean): void {
  writePref('dc.chat', open ? '1' : '0');
}