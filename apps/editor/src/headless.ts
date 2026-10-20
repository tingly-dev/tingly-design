/**
 * The Import / Export menu, driven without a person: the command line opens the editor in the
 * machine's Chrome and asks this page for the same files the menu's items save, so a picture or a
 * PDF made from a terminal is the one the button makes (.design/cli.md §4). Each kind's `FileMenu`
 * offers its export list and, where the list depends on what is showing, a way to show one board,
 * slide, tab or view. While an item runs, files handed to the person and error toasts are caught
 * here instead of reaching the screen. The request bar offers its fast AI the same way, for
 * `tingly-design prompt --fast` (.design/cli.md §4).
 */

export interface HeadlessItem {
  id: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  run: () => void | Promise<void>;
}

export interface HeadlessFile {
  name: string;
  type: string;
  /** base64 */
  data: string;
}

type Items = HeadlessItem[] | (() => HeadlessItem[]);
/** Shows one board, slide, tab or view by its id or name; false when there is none by that name. */
export type Pick = (what: string) => boolean | Promise<boolean>;

let offered: { items: Items; pick?: Pick } | null = null;
let waiting: (() => void)[] = [];
/** The request bar's fast AI, where the kind has one: the file a request goes to when none is named. */
let prompting: { file: () => string | undefined } | null = null;
let catching: { files: Promise<HeadlessFile>[]; errors: string[] } | null = null;

/** Called by `FileMenu` on every render: the list as it is now. */
export function offerExports(items: Items, pick?: Pick): () => void {
  const mine = { items, pick };
  offered = mine;
  for (const fn of waiting.splice(0)) fn();
  return () => {
    if (offered === mine) offered = null;
  };
}

/** Called by `PromptBar`: fast AI can take a request here, about `file()` unless the caller names one. */
export function offerPrompt(file: () => string | undefined): () => void {
  const mine = { file };
  prompting = mine;
  for (const fn of waiting.splice(0)) fn();
  return () => {
    if (prompting === mine) prompting = null;
  };
}

/** True while an item runs headless: `download` hands the file here and does not click a link. */
export function catchFile(name: string, file: Blob | string): boolean {
  if (!catching) return false;
  catching.files.push(
    (async () => {
      // a data: or blob: URL the caller owns is read before it is revoked
      const blob = typeof file === 'string' ? await (await fetch(file)).blob() : file;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { name, type: blob.type, data: btoa(s) };
    })(),
  );
  return true;
}

/** True while an item runs headless: a toast shows nowhere, and an error toast becomes the run's error. */
export function headlessRun(text: string, kind: string): boolean {
  if (!catching) return false;
  if (kind === 'error') catching.errors.push(text);
  return true;
}

const settle = () => new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(ok, 50))));

async function until(ready: () => boolean, ms = 30_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!ready()) {
    if (Date.now() > deadline) return false;
    await new Promise<void>((ok) => {
      waiting.push(ok);
      setTimeout(ok, 500);
    });
  }
  return true;
}

async function current(): Promise<{ items: HeadlessItem[]; pick?: Pick }> {
  if (!(await until(() => !!offered))) throw new Error('no-menu');
  await settle();
  const o = offered!;
  return { items: typeof o.items === 'function' ? o.items() : o.items, pick: o.pick };
}

const api = {
  /** The menu's export items as they are now. */
  async exports() {
    return (await current()).items.map(({ id, label, hint, disabled }) => ({ id, label, hint, disabled: !!disabled }));
  },
  /** Show one board, slide, tab or view; false when the kind has no such thing or none by that name. */
  async pick(what: string): Promise<boolean> {
    const { pick } = await current();
    const ok = pick ? await pick(what) : false;
    await settle();
    return ok;
  },
  /** Run one item and return the files it saved and the errors it would have shown. */
  async run(id: string): Promise<{ files: HeadlessFile[]; errors: string[] }> {
    const item = (await current()).items.find((x) => x.id === id);
    if (!item) return { files: [], errors: [`no-item:${id}`] };
    if (item.disabled) return { files: [], errors: [`disabled:${id}`] };
    const mine = { files: [] as Promise<HeadlessFile>[], errors: [] as string[] };
    catching = mine;
    try {
      await item.run();
    } catch (e) {
      mine.errors.push((e as Error).message);
    } finally {
      catching = null;
    }
    return { files: await Promise.all(mine.files), errors: mine.errors };
  },
  /**
   * A request to fast AI, as typed in the request bar: the model's edits are applied and saved
   * like a person's. `delegated` when the model handed it to Claude Code (the run goes on in the
   * server). `no-fast` when this kind's bar has no fast AI, `no-file:<f>` when there is no such file.
   */
  async fast(prompt: string, file?: string): Promise<{ status: string; file?: string; note?: string; changed: boolean; lines: { code: string; ok: boolean; error?: string }[] }> {
    if (!(await until(() => !!prompting))) return { status: 'error', note: 'no-fast', changed: false, lines: [] };
    await settle();
    const { display, isSaving, useStore } = await import('./store');
    const { runFastEdit } = await import('./fastedit');
    const target = file || prompting!.file();
    if (!target || display(useStore.getState(), target) === undefined) return { status: 'error', note: `no-file:${target ?? ''}`, changed: false, lines: [] };
    await runFastEdit(target, null, prompt);
    const fast = useStore.getState().fast;
    // the edit is the file once it is saved, not once it is on the screen
    if (fast.changed) await until(() => !isSaving(useStore.getState()), 30_000);
    return { status: fast.status, file: target, note: fast.note, changed: !!fast.changed, lines: fast.lines.filter((l) => !l.divider).map(({ code, ok, error }) => ({ code, ok, ...(error ? { error } : {}) })) };
  },
};

(window as unknown as { tinglyDesign: typeof api }).tinglyDesign = api;
