/**
 * The Import / Export menu, driven without a person: the command line opens the editor in the
 * machine's Chrome and asks this page for the same files the menu's items save, so a picture or a
 * PDF made from a terminal is the one the button makes (.design/cli.md §4). Each kind's `FileMenu`
 * offers its export list and, where the list depends on what is showing, a way to show one board,
 * slide, tab or view. While an item runs, files handed to the person and error toasts are caught
 * here instead of reaching the screen.
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

async function current(): Promise<{ items: HeadlessItem[]; pick?: Pick }> {
  const deadline = Date.now() + 30_000;
  while (!offered) {
    if (Date.now() > deadline) throw new Error('no-menu');
    await new Promise<void>((ok) => {
      waiting.push(ok);
      setTimeout(ok, 500);
    });
  }
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
};

(window as unknown as { tinglyDesign: typeof api }).tinglyDesign = api;
