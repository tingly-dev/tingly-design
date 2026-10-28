import type { ProjectKind } from '@dc/core';
import { readPref, writePref } from './local';

/** The side panes a kind's editor can open in its right column: at most one at a time. */
export type PaneId = 'inspector' | 'sources' | 'code' | 'comments';

/**
 * Which pane a kind opens with, and which it has at all (the first one is the kind's main pane, the
 * one the `\` key and the layout switch work on). A kind without a pane has no column and no button.
 * The state is one value in the store (`pane`), remembered per kind in this browser: what a person
 * closed stays closed. The buttons are drawn by `TopBar` from `components/panes.tsx`.
 */
export const KIND_PANE_IDS: Record<ProjectKind, PaneId[]> = {
  design: ['inspector'],
  slides: ['inspector'],
  motion: ['inspector'],
  'design-system': [],
  dashboard: ['sources', 'code'],
  docs: ['comments'],
};

const key = (kind: ProjectKind) => `dc.pane.${kind}`;

/** The pane a project of this kind opens with: the one it was left with, else the kind's main pane. */
export function initialPane(kind: ProjectKind): PaneId | null {
  const ids = KIND_PANE_IDS[kind];
  const saved = readPref(key(kind));
  if (saved === 'none') return null;
  if (saved && (ids as string[]).includes(saved)) return saved as PaneId;
  // the inspector used to remember its own on / off
  if (kind === 'design' || kind === 'slides' || kind === 'motion') return readPref('dc.panelOpen') === '0' ? null : 'inspector';
  return ids[0] ?? null;
}

export function rememberPane(kind: ProjectKind, pane: PaneId | null): void {
  writePref(key(kind), pane ?? 'none');
}
