import { download } from './local';
import { api } from './api';
import { t } from './i18n';
import { toast } from './store';
import { checkDataFile, applyNewOptions } from './newProject';
import { freeName, slugOf } from './projectName';
import { showPptxResult } from './components/ProjectImportResult';
import type { ClaudeDesignNote, PptxDiagnostic } from '@dc/core';

/** Saving and opening whole projects; the launcher's picker and drop share importProjectFile. */
export async function saveProjectArchive(name: string, full: boolean): Promise<void> {
  const file = full ? `${name}.zip` : `${name}-files.zip`;
  try {
    download(file, await api.archive(name, full));
    toast(t('common.transfer.saved', { name: file }));
  } catch (e) {
    toast(t('common.transfer.archiveFailed', { message: (e as Error).message }), 'error');
  }
}

function toastNotes(notes: ClaudeDesignNote[]): void {
  for (const n of notes) toast(t(`claudeDesign.note.${n.key}`, n.params));
}

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

/** Used for choosing the project import path on drop; the server detects PPTX from bytes too. */
export async function isProjectImportFile(file: File): Promise<boolean> {
  if (/\.(zip|pptx|md|markdown|csv|tsv)$/i.test(file.name)) return true;
  const magic = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return magic[0] === 0x50 && magic[1] === 0x4b && magic[2] === 3 && magic[3] === 4;
}

/** A table becomes a new dashboard: the file goes to data/ and its dataset is made, as in the New dialog's data file option. */
async function importTableFile(file: File): Promise<string | null> {
  const r = await checkDataFile(file);
  if ('error' in r) {
    toast(r.error, 'error');
    return null;
  }
  const stem = file.name.replace(/\.[^.]+$/, '');
  try {
    const taken = new Set((await api.projects()).map(p => p.name));
    const { name } = await api.createProject(freeName(slugOf(stem) || 'dashboard', taken), stem, 'dashboard');
    const failed = await applyNewOptions(name, { dataFile: file });
    for (const m of failed) toast(m, 'error');
    if (!failed.length) toast(t('launcher.archive.importedTable', { name }));
    return name;
  } catch (e) {
    toast(t('launcher.archive.failed', { message: (e as Error).message }), 'error');
    return null;
  }
}

const isTable = (name: string) => /\.(csv|tsv)$/i.test(name);

export async function importProjectFile(file: File): Promise<string | null> {
  if (isTable(file.name)) return importTableFile(file);
  try {
    const { name, systems, claudeDesign, notes, pptx } = await api.importArchive(file);
    if (pptx) {
      await showPptxResult({ name, ...pptx });
      return name;
    }
    const said = claudeDesign
      ? t('launcher.archive.importedClaude', { name, kind: t(`claudeDesign.kind.${claudeDesign}`) })
      : systems.length ? t('launcher.archive.importedWith', { name, systems: systems.join(', ') }) : t('launcher.archive.imported', { name });
    toast(said);
    toastNotes(notes);
    return name;
  } catch (e) {
    const error = e as Error & { body?: { diagnostics?: PptxDiagnostic[] } };
    if (error.body?.diagnostics) await showPptxResult({ message: error.message, diagnostics: error.body.diagnostics });
    else toast(t('launcher.archive.failed', { message: error.message }), 'error');
    return null;
  }
}

export type ProjectImportFormat = 'pptx' | 'markdown' | 'zip' | 'table';

const importAccept: Record<ProjectImportFormat, string> = {
  pptx: '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation',
  markdown: '.md,.markdown,text/markdown',
  zip: '.zip,application/zip',
  table: '.csv,.tsv,text/csv',
};

/** The chosen action scopes the picker only; file detection and conversion stay shared with drop. */
export function chooseProjectArchive(format: ProjectImportFormat): Promise<string | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = importAccept[format];
    input.oncancel = () => resolve(null);
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      void importProjectFile(file).then(resolve);
    };
    input.click();
  });
}
