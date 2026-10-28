import type { ProjectKind } from '@dc/core';
import { pickBoard } from './components/canvas/Board';
import { showTab } from './components/docs/docs';
import { DS_VIEW_IDS, useDsView, type DsViewId } from './components/ds/ds';
import { pickSlide } from './components/slides/exportDeck';
import type { Pick as ShowView } from './headless';


/**
 * The one way to say "show this part of the work": a canvas's artboard, a deck's slide (by id or
 * number), a doc's tab, a design system's page. The command line's `--board` / `--slide` / `--tab` /
 * `--view`, the pictures of `check --snapshots` and the Export menu's `pick` all go through it, so a
 * kind does not hand its own function to every menu. A dashboard has one page and a motion piece is
 * its own timeline: they have nothing to show, which is `null`, not an omission.
 */
export const SHOW_VIEW: Record<ProjectKind, ShowView | null> = {
  design: (what) => pickBoard(what),
  slides: (what) => pickSlide(what),
  docs: (what) => showTab(what),
  'design-system': (what) => (DS_VIEW_IDS.includes(what as DsViewId) ? (useDsView.setState({ view: what as DsViewId }), true) : false),
  dashboard: null,
  motion: null,
};
