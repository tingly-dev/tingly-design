import type { ProjectKind } from '@dc/core';
import { readPref, writePref } from './local';
import { SIDES, sideWidth, type SideId } from './sideWidth';

/**
 * The side panes a kind's editor can open in its right column: at most one at a time. `chat` is the
 * conversation pane every kind has (.design/chat-panel.md); the rest belong to their kinds.
 */
export type PaneId = 'chat' | 'inspector' | 'review' | 'files' | 'sources' | 'code' | 'comments';

/**
 * Which panes a kind has at all. The state is one value in the store (`pane`), remembered per kind
 * in this browser: what a person closed stays closed. The buttons are drawn by `TopBar` from
 * `components/panes.tsx`.
 * `files` is canvas only on purpose (.design/files-pane.md): the list, preview and copy are
 * kind-neutral, "put on canvas" is the canvas step.
 */
export const KIND_PANE_IDS: Record<ProjectKind, PaneId[]> = {
  design: ['chat', 'inspector', 'review', 'files'],
  slides: ['chat', 'inspector', 'review'],
  motion: ['chat', 'inspector', 'review'],
  'design-system': ['chat'],
  dashboard: ['chat', 'sources', 'code'],
  docs: ['chat', 'comments'],
};

/**
 * The pane a kind opens with when nothing was chosen: the one a project of this kind shows beside
 * the work. A design system has none (its right column appears only for the conversation).
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
 * What the work beside the pane needs at least before the conversation is too cramped to pin: the
 * kind's own left list + the conversation's minimum 280 + this. Below it the Conversation button is
 * disabled rather than moving the bar over the work (`.design/chat-pane.md` §3.3). A user who finds
 * a kind too tight changes its number here; they are estimates, not a hard rule.
 */
export const MIN_WORK: Record<ProjectKind, number> = {
  design: 780,
  slides: 620,
  motion: 780,
  'design-system': 600,
  dashboard: 720,
  docs: 560,
};

/** The kind's own list on the left edge, whose width the pane must fit beside. */
const LEFT_COLUMN: Record<ProjectKind, SideId | null> = {
  design: null,
  slides: 'strip',
  motion: null,
  'design-system': 'dsnav',
  dashboard: null,
  docs: 'doctabs',
};

/** The width of the kind's own list on the left edge, which the conversation pane must fit beside. */
export function chatLeftWidth(kind: ProjectKind): number {
  const left = LEFT_COLUMN[kind];
  return left ? sideWidth(left) : 0;
}

/** The narrowest window in which the conversation can be pinned beside this kind's work. */
export function chatNeed(kind: ProjectKind): number {
  return chatLeftWidth(kind) + SIDES.chat.min + MIN_WORK[kind];
}

/** Whether the window is wide enough to pin the conversation beside this kind's work. */
export function chatFits(kind: ProjectKind, width = window.innerWidth): boolean {
  return width >= chatNeed(kind);
}

const key = (kind: ProjectKind) => `dc.pane.${kind}`;

/** The old left-column setting, read once: a person who had chosen it lands in the conversation pane. */
function takeOldLeft(): boolean {
  const mode = readPref('dc.barMode');
  if (mode !== 'left' && mode !== 'auto') return false;
  writePref('dc.barMode', '');
  return true;
}

/** The pane a project of this kind opens with: the one it was left with, else the kind's main pane. */
export function initialPane(kind: ProjectKind): PaneId | null {
  const ids = KIND_PANE_IDS[kind];
  // the left column is no longer a place; choosing it once opens the conversation beside the work
  if (takeOldLeft()) return ids.includes('chat') && chatFits(kind) ? 'chat' : MAIN_PANE[kind];
  const saved = readPref(key(kind));
  if (saved === 'none') return null;
  if (saved && (ids as string[]).includes(saved)) {
    // a window too narrow for the pane opens without it; what was remembered is kept for a wider one
    if (saved === 'chat' && !chatFits(kind)) return null;
    return saved as PaneId;
  }
  // the inspector used to remember its own on / off
  if (kind === 'design' || kind === 'slides' || kind === 'motion') return readPref('dc.panelOpen') === '0' ? null : 'inspector';
  return MAIN_PANE[kind];
}

export function rememberPane(kind: ProjectKind, pane: PaneId | null): void {
  // a review is a mode (clicks leave remarks instead of selecting): a project never opens in it, whatever was open before
  writePref(key(kind), pane === 'review' ? 'inspector' : (pane ?? 'none'));
}