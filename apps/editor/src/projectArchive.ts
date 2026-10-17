import { download } from './local';
import { api } from './api';
import { t } from './i18n';
import { toast } from './store';

/**
 * Saving a whole project as one .zip, and opening one again, from wherever the editor offers
 * it (every kind's Import / Export menu, the launcher). See .design/project-archive.md.
 */

/** Save the project's .zip; `full` keeps its change log and the design systems it installed. */
export async function saveProjectArchive(name: string, full: boolean): Promise<void> {
  const file = full ? `${name}.zip` : `${name}-files.zip`;
  try {
    download(file, await api.archive(name, full));
    toast(t('common.transfer.saved', { name: file }));
  } catch (e) {
    toast(t('common.transfer.archiveFailed', { message: (e as Error).message }), 'error');
  }
}

/** Ask for a .zip and make a project of it; resolves to the new project's name, or null. */
export function chooseProjectArchive(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        const { name, systems } = await api.importArchive(file);
        toast(systems.length ? t('launcher.archive.importedWith', { name, systems: systems.join(', ') }) : t('launcher.archive.imported', { name }));
        resolve(name);
      } catch (e) {
        toast(t('launcher.archive.failed', { message: (e as Error).message }), 'error');
        resolve(null);
      }
    };
    input.click();
  });
}
