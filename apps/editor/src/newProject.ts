import { DASH_DATA_MAX, datasetFile, parseDataFile, type DatasetJson } from '@dc/core';
import { api } from './api';
import { t } from './i18n';

/** What a person can choose while creating a project, all of it skippable. The server writes the starter; this adds what was picked. */
export interface NewOptions {
  /** the folder of a design system to install (canvas, slides) */
  designSystem?: string;
  /** a table to start a dashboard from (CSV, TSV or JSON) */
  dataFile?: File;
}

const FORMATS = { csv: 'csv', tsv: 'tsv', json: 'json' } as const;

export const dataFormatOf = (name: string): 'csv' | 'tsv' | 'json' | null => FORMATS[name.slice(name.lastIndexOf('.') + 1).toLowerCase() as keyof typeof FORMATS] ?? null;

/** Read a data file before anything is created: the table's row count, or why it cannot be used. */
export async function checkDataFile(file: File): Promise<{ rows: number } | { error: string }> {
  const format = dataFormatOf(file.name);
  const bad = { error: t('launcher.new.dataBad', { name: file.name }) };
  if (!format || file.size > DASH_DATA_MAX) return bad;
  try {
    const { table } = parseDataFile(await file.text(), format);
    return table ? { rows: table.rows.length } : bad;
  } catch {
    return bad;
  }
}

/** Apply the options to a project that exists. Each step reports its own failure and the rest still run. */
export async function applyNewOptions(project: string, opts: NewOptions): Promise<string[]> {
  const failed: string[] = [];
  if (opts.designSystem) {
    try {
      await api.installDs(project, opts.designSystem);
    } catch (e) {
      failed.push(t('launcher.new.failed', { what: t('launcher.new.ds'), error: (e as Error).message }));
    }
  }
  if (opts.dataFile) {
    try {
      const name = opts.dataFile.name;
      const format = dataFormatOf(name)!;
      const stem = name.replace(/\.[^.]+$/, '');
      const id = stem.normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 36).replace(/-+$/, '') || 'data';
      const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
      const up = await api.upload(project, new File([opts.dataFile], `${id}.${ext}`, { type: opts.dataFile.type }), 'data');
      const rows = (await checkDataFile(opts.dataFile)) as { rows: number };
      const dataset: DatasetJson = {
        title: stem,
        description: t('dash.import.description', { name, count: rows.rows }),
        source: { kind: 'file', url: up.path, name, format },
        updated: { at: new Date().toISOString(), by: t('dash.actor.editor') },
      };
      const r = await api.put(project, datasetFile(id), { content: JSON.stringify(dataset, null, 2) + '\n', baseVersion: null, actor: 'human', summary: `dataset ${id} from ${name}` });
      if ('conflict' in r) throw new Error(t('launcher.new.dataConflict'));
    } catch (e) {
      failed.push(t('launcher.new.failed', { what: t('launcher.new.dataFile'), error: (e as Error).message }));
    }
  }
  return failed;
}
