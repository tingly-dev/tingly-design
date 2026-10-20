import { strToU8, zipSync, type Zippable } from 'fflate';
import { DOC_INDEX, docToMarkdown, tabFile } from '@dc/core';
import { api } from '../../api';
import { download } from '../../local';
import { t } from '../../i18n';
import { display, toast, useStore } from '../../store';

/**
 * Saves the doc (or one tab) as Markdown that stands on its own (.design/docs-markdown.md): a
 * plain `.md` when the text has no local pictures, otherwise a `.zip` holding the `.md` and the
 * pictures at the paths the text points at.
 */
export async function saveDocMarkdown(name: string, only?: string): Promise<void> {
  const s = useStore.getState();
  const { markdown, images } = docToMarkdown(display(s, DOC_INDEX), (id) => display(s, tabFile(id)), only);
  if (!images.length) return download(`${name}.md`, markdown, 'text/markdown');

  const zip: Zippable = { [`${name}.md`]: strToU8(markdown) };
  let missing = 0;
  await Promise.all(
    images.map(async (path) => {
      try {
        const r = await fetch(api.rawBase(s.project!) + path.split('/').map(encodeURIComponent).join('/'));
        if (!r.ok) throw new Error(String(r.status));
        zip[path] = [new Uint8Array(await r.arrayBuffer()), { level: 0 }];
      } catch {
        missing++;
      }
    }),
  );
  download(`${name}.zip`, new Blob([zipSync(zip) as BlobPart], { type: 'application/zip' }), 'application/zip');
  if (missing) toast(t('docs.export.missing', { count: missing }), 'error');
}
