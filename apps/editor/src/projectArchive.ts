import { download } from './local';
import { api } from './api';
import { t } from './i18n';
import { toast } from './store';
import type { ClaudeDesignNote } from '@dc/core';

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

/** What to know after a Claude Design package was saved or opened: one toast per note, after the result's own. */
function toastNotes(notes: ClaudeDesignNote[]): void {
  for (const n of notes) toast(t(`claudeDesign.note.${n.key}`, n.params));
}

/** Save the project as Claude's own format (the original type's files, for Claude Code to publish), and say what to do before publishing. */
export async function saveClaudeDesign(name: string): Promise<void> {
  const file = `${name}-claude-design.zip`;
  try {
    const { blob, notes } = await api.claudeDesign(name);
    download(file, blob);
    toast(t('common.transfer.saved', { name: file }));
    toastNotes(notes);
  } catch (e) {
    toast(t('common.transfer.archiveFailed', { message: (e as Error).message }), 'error');
  }
}

/** Ask for a .zip (ours, Claude Design's) or a Claude Docs .md and make a project of it; resolves to the new project's name, or null. */
export function chooseProjectArchive(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip,.md,text/markdown';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        const { name, systems, claudeDesign, notes } = await api.importArchive(file);
        const said = claudeDesign
          ? t('launcher.archive.importedClaude', { name, kind: t(`claudeDesign.kind.${claudeDesign}`) })
          : systems.length
            ? t('launcher.archive.importedWith', { name, systems: systems.join(', ') })
            : t('launcher.archive.imported', { name });
        toast(said);
        toastNotes(notes);
        resolve(name);
      } catch (e) {
        toast(t('launcher.archive.failed', { message: (e as Error).message }), 'error');
        resolve(null);
      }
    };
    input.click();
  });
}
