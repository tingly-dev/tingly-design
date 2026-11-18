import { useMemo } from 'react';
import { create } from 'zustand';
import { INDEX_FILE, linkedPagesOf, type LinkCheck, type LinkedPage, type LinkSource, type SourcePage } from '@dc/core';
import { api } from './api';
import { at } from './base';
import { t } from './i18n';
import { display, recordChange, toast, useStore } from './store';

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
  /** the copy's path in this project */
  path: string;
  mode: 'live' | 'image';
  /** the page's title in its project, and that project's title */
  title: string;
  project: string;
  /** a picture's pixel size, or a live artboard's own size */
  size: [number, number];
  /** a live artboard that moves with time */
  moving?: boolean;
}

/** Make the copy a pick asks for: an artboard shown live is copied as before, anything else is drawn as a picture. */
export async function linkPick(source: LinkSource, page: SourcePage & { moving?: boolean }): Promise<PlacedPage> {
  const project = useStore.getState().project;
  if (!project) throw new Error('no project');
  if (source.modes[0] === 'live') {
    const r = await api.importBoard(project, source.name, page.page);
    recordChange({ type: 'link', action: 'added', path: r.record.path, page: page.title, project: source.title }, false);
    toast(t('linked.toast.added', { title: page.title, project: source.title }));
    return { path: r.record.path, mode: 'live', title: page.title, project: source.title, size: r.size, moving: page.moving };
  }
  const r = await api.linkPage(project, source.name, page.page);
  recordChange({ type: 'link', action: 'added', path: r.record.path, page: page.title, project: source.title }, false);
  toast(t('linked.toast.added', { title: page.title, project: source.title }));
  return { path: r.record.path, mode: 'image', title: r.title || page.title, project: source.title, size: r.size ?? [1280, 720] };
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
