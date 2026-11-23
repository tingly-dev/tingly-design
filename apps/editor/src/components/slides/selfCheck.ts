// While Claude Code works on the open deck, look at what it drew: each slide it changed is laid out as the
// Export menu draws it, the layout probe of `check --snapshots` runs in that page, a picture is kept in
// `renders/look/`, and the findings go to `.runs.json`, where the delegated run reads them (SLIDES_SYSTEM).
// See .design/slides-self-check.md.
import { LOOK_DIR, layoutProbe, slideFile, slideHeadingDrift, slidePlaceholders, type DeckFinding, type LayoutFinding, type SlideHeading } from '@dc/core';
import { api } from '../../api';
import { display, slideIds, useStore } from '../../store';
import { isHidden } from './slides';
import { slidePng } from './exportDeck';

/** How long the files must stay still before the deck is looked at: Claude writes a slide in a few edits. */
const SETTLE = 1500;
/** The pictures are for reading, not printing: half the slide's size. */
const SCALE = 0.5;

/** One slide as the self-check saw it: its warnings (rule ids as `check` gives them) and where its picture is. */
export interface SlideLook {
  id: string;
  file: string;
  picture?: string;
  problems: LayoutFinding[];
}

/** What `.runs.json` holds for a deck. */
export interface SlidesRuns {
  at: string;
  kind: 'slides';
  slides: SlideLook[];
  deck: DeckFinding[];
}

const looked = new Map<string, { source: string; look: SlideLook; heading?: SlideHeading }>();
let timer = 0;
let busy = false;
let again = false;
let run: string | null = null;

/** A Claude Code run on this project is under way. */
const working = () => useStore.getState().delegates.some((d) => d.state === 'start' || d.state === 'progress');

/** Draw one slide, run the probe in its page and keep its picture. */
async function lookAt(project: string, id: string, source: string): Promise<void> {
  let found: LayoutFinding[] = [];
  const png = await slidePng(id, SCALE, (win) => {
    try {
      found = ((win as Window & { eval(code: string): unknown }).eval(layoutProbe(true, false, true)) as LayoutFinding[]) ?? [];
    } catch {
      found = [];
    }
  });
  const picture = await api
    .putSlidePicture(project, id, png)
    .then((r) => r.path)
    .catch(() => undefined);
  const file = slideFile(id);
  const head = found.find((f) => f.rule === 'heading');
  looked.set(id, {
    source,
    look: { id, file, ...(picture ? { picture } : {}), problems: found.filter((f) => f.rule !== 'heading') },
    ...(head ? { heading: { file, tag: head.tag ?? '', size: head.size ?? 0, top: head.top ?? 0, left: head.left ?? 0, height: head.height ?? 0, text: head.text ?? '' } } : {}),
  });
}

/** Look at every slide that changed since it was last looked at, then write the report. */
async function check(): Promise<void> {
  if (busy) return void (again = true);
  busy = true;
  try {
    const s = useStore.getState();
    const project = s.project;
    if (!project || s.kind !== 'slides') return;
    const ids = slideIds(s).filter((id) => !isHidden(id));
    for (const id of [...looked.keys()]) if (!ids.includes(id)) looked.delete(id);
    let changed = false;
    for (const id of ids) {
      const source = display(useStore.getState(), slideFile(id));
      if (source === undefined || looked.get(id)?.source === source) continue;
      await lookAt(project, id, source).catch(() => looked.delete(id));
      changed = true;
    }
    if (!changed) return;
    const entries = ids.flatMap((id) => looked.get(id) ?? []);
    const deck = [
      ...ids.flatMap((id) => slidePlaceholders(slideFile(id), looked.get(id)?.source)),
      ...slideHeadingDrift(entries.flatMap((e) => e.heading ?? [])),
    ];
    const report: SlidesRuns = { at: new Date().toISOString(), kind: 'slides', slides: entries.map((e) => e.look), deck };
    await api.writeRuns(project, report).catch(() => {});
  } finally {
    busy = false;
    if (again) {
      again = false;
      schedule();
    }
  }
}

function schedule(): void {
  clearTimeout(timer);
  timer = window.setTimeout(() => void check(), SETTLE);
}

/**
 * Watch the open deck while Claude Code works on it (and once more as a run ends). A new run looks at every
 * slide first, so the deck-level comparison has all the headings; after that only the slides that change.
 * Returns the stop function for the deck's app to call when it closes.
 */
export function watchSlides(): () => void {
  const stop = useStore.subscribe((s, prev) => {
    if (s.kind !== 'slides') return;
    const now = s.delegates.find((d) => d.state === 'start' || d.state === 'progress')?.id ?? null;
    if (now && now !== run) {
      run = now;
      looked.clear();
    }
    const ended = !now && prev.delegates.some((d) => d.state === 'start' || d.state === 'progress');
    if ((working() && s.files !== prev.files) || (now && !prev.delegates.some((d) => d.id === now)) || ended) schedule();
  });
  return () => {
    stop();
    clearTimeout(timer);
    looked.clear();
    run = null;
  };
}
