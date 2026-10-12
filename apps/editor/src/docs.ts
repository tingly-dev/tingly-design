import { useMemo } from 'react';
import { create } from 'zustand';
import {
  DOC_COMMENTS,
  DOC_INDEX,
  mergeBlocks,
  newDocTab,
  parseComments,
  parseDoc,
  rebaseBlocks,
  stringifyComments,
  stringifyDoc,
  tabFile,
  tabOrder,
  uniqueTabId,
  type DocComments,
  type DocJson,
  type DocThread,
} from '@dc/core';
import { deleteFile, display, edit, enqueueResult, toast, useStore } from './store';

/** A doc in the editor: which tab is open, the comment rail, and writing tabs back block by block. */
interface DocsState {
  tab: string | null;
  rail: boolean;
  /** the thread lit in the rail and in the text */
  thread: string | null;
  /** a comment being written on a selection */
  draft: { quote: string; prefix: string; suffix: string } | null;
  settings: boolean;
  showResolved: boolean;
}

export const useDocs = create<DocsState>(() => ({
  tab: null,
  rail: true,
  thread: null,
  draft: null,
  settings: false,
  showResolved: false,
}));

export function useDocIndex(): DocJson {
  const text = useStore((s) => display(s, DOC_INDEX));
  return useMemo(() => parseDoc(text), [text]);
}

export function useComments(): DocComments {
  const text = useStore((s) => display(s, DOC_COMMENTS));
  return useMemo(() => parseComments(text), [text]);
}

export function currentTab(): string | null {
  const s = useStore.getState();
  const d = parseDoc(display(s, DOC_INDEX));
  const want = useDocs.getState().tab;
  const order = tabOrder(d);
  return want && order.some((t) => t.id === want) ? want : (order[0]?.id ?? null);
}

export function useCurrentTab(): string | null {
  const d = useDocIndex();
  const want = useDocs((s) => s.tab);
  const order = tabOrder(d);
  return want && order.some((t) => t.id === want) ? want : (order[0]?.id ?? null);
}

export function openTab(id: string): void {
  useDocs.setState({ tab: id, thread: null, draft: null });
  const url = new URL(location.href);
  url.searchParams.set('t', id);
  history.replaceState(null, '', url);
}

export function editDoc(mutate: (d: DocJson) => void, summary: string): void {
  edit(
    DOC_INDEX,
    (src) => {
      const d = parseDoc(src);
      mutate(d);
      return stringifyDoc(d);
    },
    { actor: 'human', summary },
  );
}

export function editComments(mutate: (c: DocComments) => void, summary: string): void {
  edit(
    DOC_COMMENTS,
    (src) => {
      const c = parseComments(src);
      mutate(c);
      return stringifyComments(c);
    },
    { actor: 'human', summary, undoable: false },
  );
}

// ------------------------------------------------------------------ tabs

export function addTab(title: string, parent?: string): string {
  const d = parseDoc(display(useStore.getState(), DOC_INDEX));
  const id = uniqueTabId(d, /^[\x20-\x7e]+$/.test(title) ? title : 'tab');
  edit(tabFile(id), () => newDocTab(title), { actor: 'human', summary: `tab ${id} added`, undoable: false });
  editDoc((x) => {
    const tab = parent ? { id, title, parent } : { id, title };
    if (parent) {
      // after the parent's last subtab
      let at = x.tabs.findIndex((t) => t.id === parent);
      while (at + 1 < x.tabs.length && x.tabs[at + 1].parent === parent) at++;
      x.tabs.splice(at + 1, 0, tab);
    } else x.tabs.push(tab);
  }, `tab ${title} added`);
  openTab(id);
  return id;
}

export function renameTab(id: string, title: string): void {
  editDoc((d) => {
    const t = d.tabs.find((x) => x.id === id);
    if (t) t.title = title;
  }, `tab ${id} renamed`);
}

export async function deleteTab(id: string): Promise<void> {
  const d = parseDoc(display(useStore.getState(), DOC_INDEX));
  if (d.tabs.filter((t) => !t.parent).length <= 1 && !d.tabs.find((t) => t.id === id)?.parent) return void toast('一个文档至少要有一个标签页。', 'error');
  const gone = [id, ...d.tabs.filter((t) => t.parent === id).map((t) => t.id)];
  editDoc((x) => {
    x.tabs = x.tabs.filter((t) => !gone.includes(t.id));
  }, `tab ${id} removed`);
  if (gone.includes(currentTab() ?? '')) useDocs.setState({ tab: null });
  for (const t of gone) await deleteFile(tabFile(t));
}

/** Move a tab one place up or down among its siblings (its subtabs go with it). */
export function moveTab(id: string, dir: -1 | 1): void {
  editDoc((d) => {
    const t = d.tabs.find((x) => x.id === id);
    if (!t) return;
    const siblings = d.tabs.filter((x) => (x.parent ?? null) === (t.parent ?? null));
    const at = siblings.indexOf(t);
    const other = siblings[at + dir];
    if (!other) return;
    const group = (x: typeof t) => [x, ...d.tabs.filter((c) => c.parent === x.id)];
    const a = group(t);
    const b = group(other);
    const rest = d.tabs.filter((x) => !a.includes(x) && !b.includes(x));
    const anchor = d.tabs.indexOf(dir < 0 ? other : t);
    const before = d.tabs.slice(0, anchor).filter((x) => rest.includes(x));
    const after = rest.filter((x) => !before.includes(x));
    d.tabs = [...before, ...(dir < 0 ? [...a, ...b] : [...b, ...a]), ...after];
  }, `tab ${id} moved`);
}

// --------------------------------------------------------- writing a tab

/**
 * The editor's Markdown for a tab, saved: blocks that mean what the file
 * already says keep their own text; a save that meets someone else's newer
 * version is replayed onto it block by block.
 */
export function saveTab(id: string, markdown: string, actor: 'human' | 'fast-edit' = 'human', summary?: string): string {
  const file = tabFile(id);
  const cur = display(useStore.getState(), file) ?? '';
  const next = mergeBlocks(cur, markdown);
  if (next === cur) return cur;
  enqueueResult(file, cur, next, (base) => rebaseBlocks(cur, next, base), { actor, summary: summary ?? `${file} edited`, undoable: false });
  return next;
}

// --------------------------------------------------------------- comments

export function addThread(tab: string, anchor: { quote: string; prefix: string; suffix: string }, text: string): string {
  const id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  editComments((c) => {
    c.threads.push({ id, tab, ...anchor, comments: [{ id: id + '-1', author: author(), text, at: new Date().toISOString() }] });
  }, 'comment added');
  useDocs.setState({ thread: id, draft: null, rail: true });
  return id;
}

export function reply(thread: string, text: string): void {
  editComments((c) => {
    const t = c.threads.find((x) => x.id === thread);
    t?.comments.push({ id: thread + '-' + (t.comments.length + 1) + Math.random().toString(36).slice(2, 4), author: author(), text, at: new Date().toISOString() });
  }, 'comment replied');
}

export function setResolved(thread: string, resolved: boolean): void {
  editComments((c) => {
    const t = c.threads.find((x) => x.id === thread);
    if (!t) return;
    if (resolved) t.resolved = true;
    else delete t.resolved;
  }, resolved ? 'comment resolved' : 'comment reopened');
}

export function deleteThread(thread: string): void {
  editComments((c) => {
    c.threads = c.threads.filter((t) => t.id !== thread);
  }, 'comment deleted');
}

export function author(): string {
  try {
    return localStorage.getItem('dc.author') || '我';
  } catch {
    return '我';
  }
}

export function threadsOf(c: DocComments, tab: string | null, resolved: boolean): DocThread[] {
  return c.threads.filter((t) => t.tab === tab && (resolved || !t.resolved));
}
