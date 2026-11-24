import { useMemo } from 'react';
import { create } from 'zustand';
import { INDEX_FILE, attr, linkedPagesOf, parseDc, type DcElement, type LinkCheck, type LinkMode, type LinkedPage, type LinkSource, type SourcePage } from '@dc/core';
import { api } from './api';
import { at } from './base';
import { t } from './i18n';
import { display, editElement, recordChange, toast, useStore } from './store';

/**
 * Linked pages in the open project (.design/cross-kind-embedding.md): the records its index keeps, how
 * each stands against its original (asked once when the project opens or the records change, never
 * polled), and the actions on one: update, unlink, take back. What is drawn is always the copy; this
 * only says whether the original has moved on.
 */

/** The records of the open project, from its index. */
export function recordsOf(text: string | undefined): LinkedPage[] {
  try {
    return linkedPagesOf(text ? JSON.parse(text) : undefined);
  } catch {
    return [];
  }
}

export function useLinkedRecords(): LinkedPage[] {
  const text = useStore((s) => (s.kind ? display(s, INDEX_FILE[s.kind]) : undefined));
  return useMemo(() => recordsOf(text), [text]);
}

/** The record of one copy (by its path), now. */
export function linkedRecord(path: string): LinkedPage | undefined {
  const s = useStore.getState();
  return s.kind ? recordsOf(display(s, INDEX_FILE[s.kind])).find((r) => r.path === path) : undefined;
}

interface LinkStatus {
  /** what `link-check` said last, by the copy's path */
  states: Record<string, LinkCheck>;
  /** the paths being updated now */
  updating: string[];
  checking: boolean;
}

export const useLinks = create<LinkStatus>(() => ({ states: {}, updating: [], checking: false }));

let checkSeq = 0;

/** Ask the server where each linked page stands. A newer ask wins; one for a project that is no longer open is dropped. */
export async function checkLinks(): Promise<void> {
  const project = useStore.getState().project;
  if (!project) return;
  const seq = ++checkSeq;
  if (!linkedRecordsNow().length) {
    useLinks.setState({ states: {}, checking: false });
    return;
  }
  useLinks.setState({ checking: true });
  try {
    const { links } = await api.linkCheck(project);
    if (seq !== checkSeq || useStore.getState().project !== project) return;
    useLinks.setState({ states: Object.fromEntries(links.map((l) => [l.path, l])), checking: false });
  } catch {
    if (seq === checkSeq) useLinks.setState({ checking: false });
  }
}

function linkedRecordsNow(): LinkedPage[] {
  const s = useStore.getState();
  return s.kind ? recordsOf(display(s, INDEX_FILE[s.kind])) : [];
}

/** How many copies have an original that changed. */
export const useChangedCount = (): number => useLinks((l) => Object.values(l.states).filter((x) => x.state === 'changed').length);

const wording = (path: string) => {
  const c = useLinks.getState().states[path];
  const r = linkedRecord(path);
  return { title: c?.page ?? r?.page ?? path, project: c?.title ?? c?.project ?? r?.from.replace(/^projects\//, '') ?? '' };
};

const busy = (path: string, on: boolean) => useLinks.setState((l) => ({ updating: on ? [...l.updating, path] : l.updating.filter((p) => p !== path) }));

/** Copy the original again. The toast that says so takes it back. */
export async function updateLinkedPage(path: string, quiet = false): Promise<boolean> {
  const project = useStore.getState().project;
  if (!project) return false;
  busy(path, true);
  try {
    const r = await api.linkRefresh(project, path);
    const w = wording(path);
    if (r.changed) recordChange({ type: 'link', action: 'updated', path, page: w.title, project: w.project }, false);
    if (!quiet)
      toast(r.changed ? t('linked.toast.updated', w) : t('linked.toast.unchanged', w), 'info', r.changed ? { label: t('common.undo'), run: () => void undoLinked(project, path) } : undefined);
    return true;
  } catch (e) {
    toast((e as Error).message, 'error');
    return false;
  } finally {
    busy(path, false);
    void checkLinks();
  }
}

/** Update every copy whose original changed, one at a time (each starts a browser to draw it). */
export async function updateAllLinked(): Promise<void> {
  const changed = Object.values(useLinks.getState().states).filter((x) => x.state === 'changed');
  let done = 0;
  let last = '';
  for (const c of changed) {
    busy(c.path, true);
    try {
      const project = useStore.getState().project;
      if (!project) return;
      await api.linkRefresh(project, c.path);
      done++;
    } catch (e) {
      last = (e as Error).message;
    } finally {
      busy(c.path, false);
    }
  }
  toast(done === changed.length ? t('linked.all.updated', { count: done }) : t('linked.all.partial', { done, count: changed.length, message: last }), done === changed.length ? 'info' : 'error');
  void checkLinks();
}

async function undoLinked(project: string, path: string): Promise<void> {
  // another project was opened since: what was updated there is not taken back from here
  if (useStore.getState().project !== project) return;
  try {
    await api.linkUndo(project, path);
    toast(t('linked.toast.undone'));
  } catch (e) {
    toast((e as Error).message, 'error');
  }
  void checkLinks();
}

/** Let go of the original; the copy stays as an ordinary picture. The toast brings the link back. */
export async function unlinkLinkedPage(path: string): Promise<void> {
  const project = useStore.getState().project;
  if (!project) return;
  const w = wording(path);
  try {
    await api.linkUnlink(project, path);
    recordChange({ type: 'link', action: 'unlinked', path, page: w.title, project: w.project }, false);
    toast(t('linked.toast.unlinked', w), 'info', {
      label: t('common.undo'),
      run: () => {
        if (useStore.getState().project !== project) return;
        void api.linkUndo(project, path).then(
          () => (toast(t('linked.toast.relinked', w)), checkLinks()),
          (e: Error) => toast(e.message, 'error'),
        );
      },
    });
  } catch (e) {
    toast((e as Error).message, 'error');
  } finally {
    void checkLinks();
  }
}

/** The address of the original, to open in a new tab. */
export const originalUrl = (rec: Pick<LinkedPage, 'from'>) => `${at('')}?p=${encodeURIComponent(rec.from.replace(/^projects\//, ''))}`;

/** What a pick in the picker became on this project's disk, for the kind to put on its page. */
export interface PlacedPage {
  /** the copy in this project: the live copy, or the picture when only that is kept */
  path: string;
  mode: LinkMode;
  /** the kind of project it came from */
  from: LinkedPage['kind'];
  /** the picture kept beside a live copy (it may still be being drawn) */
  poster?: string;
  /** the page's title in its project, and that project's title */
  title: string;
  project: string;
  /** a picture's pixel size, or a live page's own size */
  size: [number, number];
  /** a live artboard that moves with time */
  moving?: boolean;
}

/** Make the copy a pick asks for: live where the page can run in this kind of project, else a picture. */
export async function linkPick(source: LinkSource, page: SourcePage & { moving?: boolean }): Promise<PlacedPage> {
  const project = useStore.getState().project;
  if (!project) throw new Error('no project');
  const mode = source.modes[0];
  const r = await api.linkPage(project, source.name, page.page, mode);
  recordChange({ type: 'link', action: 'added', path: r.record.path, page: page.title, project: source.title }, false);
  toast(t('linked.toast.added', { title: page.title, project: source.title }));
  return { path: r.record.path, mode, from: source.kind, ...(r.record.poster ? { poster: r.record.poster } : {}), title: r.title || page.title, project: source.title, size: r.size ?? [1280, 720], moving: page.moving };
}

/** The attributes of an element that go with it when it changes form (its place in time, its builds), as markup. */
function carried(el: DcElement): string {
  return el.attrs
    .filter((a) => !['src', 'alt', 'style', 'data-props', 'data-poster', 'data-seek'].includes(a.name))
    .map((a) => ` ${a.name}="${a.value.replace(/"/g, '&quot;')}"`)
    .join('');
}

/**
 * Show a linked page as the live element or as the picture kept beside it, in place: the element is replaced
 * by the other form with the same box, in the same layer (one undo step). Nothing is copied or drawn again,
 * except the picture itself the first time, when it was not there yet. The record does not change: it keeps both.
 */
export async function showLinkedAs(file: string, el: DcElement, rec: LinkedPage, to: LinkMode): Promise<void> {
  const project = useStore.getState().project;
  const kind = useStore.getState().kind;
  if (!project || !rec.poster) return;
  const style = (attr(el, 'style') ?? '').replace(/;?\s*object-fit:[^;]*/g, '');
  const w = wording(rec.path);
  let html: string;
  if (to === 'image') {
    let r;
    try {
      r = await api.linkPoster(project, rec.path);
    } catch (e) {
      toast((e as Error).message, 'error');
      return;
    }
    // a picture of a whole page keeps its own shape: a dashboard is taller or wider than the box it ran in
    const box = /(?:^|;)\s*width:\s*([\d.]+)px[^]*?(?:^|;)\s*height:\s*([\d.]+)px/.exec(style);
    let st = style;
    if (r.size && box && rec.kind !== 'design') {
      const width = Number(box[1]);
      st = st.replace(/(^|;)(\s*)height:\s*[\d.]+px/, `$1$2height:${Math.round((width * r.size[1]) / r.size[0])}px`);
    }
    html = `<img src="${r.poster}" alt="${t('linked.alt', { title: w.title, project: w.project }).replace(/"/g, '&quot;')}"${carried(el)} style="${st};object-fit:cover">`;
  } else {
    html = `<x-embed src="${rec.path}"${kind === 'motion' ? ' data-seek' : ` data-poster="${rec.poster}"`}${carried(el)} style="${style}"></x-embed>`;
  }
  const ok = editElement(file, [{ kind: 'insert', target: el.tid, where: 'after', html }, { kind: 'remove', tid: el.tid }]);
  if (!ok) return;
  // the new form takes the place of the old one: select it
  const src = display(useStore.getState(), file);
  const now = src ? parseDc(src).elements.find((e) => e.path.join('.') === el.path.join('.')) : undefined;
  if (now) useStore.setState({ selection: { kind: 'el', file, tid: now.tid } });
}

// What is linked changes only when the project opens or a record is added or dropped: ask then, a moment after the change settles.
let timer: ReturnType<typeof setTimeout> | undefined;
let seen = '';
useStore.subscribe((s) => {
  const sig = (s.project ?? '') + '|' + (s.kind && s.loaded ? recordsOf(display(s, INDEX_FILE[s.kind])).map((r) => `${r.path}@${r.at ?? ''}`).join(',') : '');
  if (sig === seen) return;
  seen = sig;
  clearTimeout(timer);
  timer = setTimeout(() => void checkLinks(), 400);
});
