import { DASH_PAGE, slideIdOf, type ProjectKind } from '@dc/core';
import { focusBoard } from './components/canvas/view';
import { hasTab, openTab } from './components/docs/docs';
import { motionLocator } from './components/motion/motion';
import { useDash } from './components/dash/dash';
import { canvasOf, slideIds, useStore } from './store';

/**
 * How a file that a run changed is shown in each kind's editor: the board on the canvas, the slide,
 * the tab, the scene under the playhead, the data source or the code. `true` when it was shown;
 * `null` for the design system, which lists files but has no single view that shows one (its file
 * chips are plain text). The request bar, the run
 * feed and the transcript all go through here, so a kind does not hand each of them its own
 * "open this file" function. A new kind fails to compile until it has an entry.
 */
export const LOCATE: Record<ProjectKind, ((file: string) => boolean) | null> = {
  design: (file) => {
    if (!canvasOf(useStore.getState()).boards[file]) return false;
    focusBoard(file);
    return true;
  },
  slides: (file) => {
    const slide = slideIdOf(file);
    if (!slide || !slideIds(useStore.getState()).includes(slide)) return false;
    useStore.setState({ slide });
    return true;
  },
  'design-system': null,
  dashboard: (file) => {
    const id = /^datasets\/(.+)\.json$/.exec(file)?.[1];
    if (id) useDash.setState({ open: id, side: 'sources' });
    else if (file === DASH_PAGE) useDash.setState({ side: 'code' });
    else return false;
    return true;
  },
  docs: (file) => {
    const id = /^tabs\/(.+)\.md$/.exec(file)?.[1];
    if (!id || !hasTab(id)) return false;
    openTab(id);
    return true;
  },
  motion: (file) => motionLocator.current?.(file) ?? false,
};

/** Show a changed file in the open project's editor, whatever its kind; undefined when its kind has no way to. */
export function locator(kind: ProjectKind | null): ((file: string) => void) | undefined {
  const f = kind && LOCATE[kind];
  return f ? (file) => void f(file) : undefined;
}
