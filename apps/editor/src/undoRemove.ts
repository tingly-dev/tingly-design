import { api } from './api';
import { t } from './i18n';
import { toast, useStore } from './store';

/**
 * Taking an item out of a work (a slide, a scene, a tab, an artboard) is not asked about: it is
 * done, and the toast that says so carries Undo for a few seconds. The text of what was removed is
 * kept here in memory (`files`), so Undo writes the files back and the kind puts the item back in
 * its index. Only what cannot be brought back (a design system's binary assets) is confirmed first.
 */
export function offerUndo(name: string, restore: () => void | Promise<void>): void {
  const project = useStore.getState().project;
  toast(t('common.item.removed', { name }), 'info', {
    label: t('common.undo'),
    run: () => {
      // another project was opened since: what was removed here is not put into that one
      if (useStore.getState().project !== project) return;
      Promise.resolve()
        .then(restore)
        .catch(() => toast(t('common.item.restoreFailed', { name }), 'error'));
    },
  });
}

/** Write removed files back as new files (their old versions are gone); throws when a file has appeared at the same path since. */
export async function putFiles(files: Record<string, string>): Promise<void> {
  const project = useStore.getState().project;
  if (!project) return;
  for (const [file, content] of Object.entries(files)) {
    const r = await api.put(project, file, { content, baseVersion: null, actor: 'undo', summary: 'restored' });
    if ('conflict' in r) throw new Error(`${file} exists`);
  }
}
