import { strToU8, zipSync, type Zippable } from 'fflate';
import { DOC_INDEX, docToMarkdown, keptName, tabFile } from '@dc/core';
import { api } from '../../api';
import { download } from '../../local';
import { t } from '../../i18n';
import { display, toast, useStore } from '../../store';

/** The doc (or one tab) as the Markdown that stands on its own, and the local pictures it points at. */
export function docMarkdown(only?: string): { markdown: string; images: string[] } {
  const s = useStore.getState();
  return docToMarkdown(display(s, DOC_INDEX), (id) => display(s, tabFile(id)), only);
}

/** The bytes of each picture (a path as the Markdown writes it, relative to the project), in the paths' order; null for one that cannot be read. */
export async function fetchPictures(paths: string[]): Promise<(Uint8Array | null)[]> {
  const project = useStore.getState().project!;
  return Promise.all(
    paths.map(async (path) => {
      try {
        const r = await fetch(api.rawBase(project) + path.split('/').map(encodeURIComponent).join('/'));
        if (!r.ok) throw new Error(String(r.status));
        return new Uint8Array(await r.arrayBuffer());
      } catch {
        return null;
      }
    }),
  );
}

/**
 * Saves the doc (or one tab) as Markdown that stands on its own (.design/docs-markdown.md): a
 * plain `.md` when the text has no local pictures, otherwise a `.zip` holding the `.md` and the
 * pictures at the paths the text points at.
 */
export async function saveDocMarkdown(name: string, only?: string): Promise<void> {
  const { markdown, images } = docMarkdown(only);
  if (!images.length) return download(`${name}.md`, markdown, 'text/markdown');

  // inside the zip the file name has to be one the import keeps (.design/import-into-project.md), or it comes back without its original
  const entry = keptName(name, 'doc');
  const zip: Zippable = { [`${entry}.md`]: strToU8(markdown) };
  const got = await fetchPictures(images);
  // in the text's order, so the same doc makes the same zip
  images.forEach((path, i) => {
    const data = got[i];
    if (data) zip[path] = [data, { level: 0 }];
  });
  const missing = got.filter((d) => !d).length;
  download(`${name}.zip`, new Blob([zipSync(zip) as BlobPart], { type: 'application/zip' }), 'application/zip');
  if (missing) toast(t('docs.export.missing', { count: missing }), 'error');
}

/** Puts the tab's Markdown on the clipboard; a browser that refuses gets the file instead, said in a toast. */
export async function copyDocMarkdown(name: string, only: string): Promise<void> {
  const { markdown } = docMarkdown(only);
  try {
    await navigator.clipboard.writeText(markdown);
    toast(t('docs.export.copied'));
  } catch {
    download(`${name}.md`, markdown, 'text/markdown');
    toast(t('docs.export.copyFallback'));
  }
}
