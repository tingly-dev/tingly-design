import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import type { PptxDiagnostic, PptxReport } from '@dc/core';
import { Dialog } from './Dialog';
import { at } from '../base';
import { download } from '../local';
import { toast } from '../store';

type Result = { name?: string; message?: string; diagnostics: PptxDiagnostic[]; report?: string; source?: string; slides?: PptxReport['slides']; finish: (open: boolean) => void };
const useResult = create<{ result: Result | null }>(() => ({ result: null }));

export function showPptxResult(result: Omit<Result, 'finish'>): Promise<boolean> {
  return new Promise(resolve => useResult.setState({ result: { ...result, finish: open => { useResult.setState({ result: null }); resolve(open); } } }));
}

const reasons = ['limit_exceeded', 'unsupported_element', 'unsupported_text_style', 'unsupported_geometry', 'unsupported_image_style', 'unsupported_style', 'unsupported_color', 'unsupported_hidden_object', 'notes_too_long', 'page_contained', 'text_layout_approximate', 'kerning_approximate', 'geometry_approximate', 'background_defaulted'] as const;
type Reason = typeof reasons[number] | 'unsafe' | 'unsupported' | 'invalid';
export function pptxReason(code: string): Reason {
  return reasons.includes(code as typeof reasons[number]) ? code as typeof reasons[number] : /forbidden|unsafe|external|duplicate/.test(code) ? 'unsafe' : code.startsWith('unsupported_') ? 'unsupported' : 'invalid';
}

/** Persistent result, shared by the launcher's picker and drop path. Nothing is silently lost. */
export function ProjectImportResultHost() {
  const { t } = useTranslation();
  const result = useResult(s => s.result);
  if (!result) return null;
  const raw = (path: string) => at(`api/projects/${encodeURIComponent(result.name!)}/raw/${path.split('/').map(encodeURIComponent).join('/')}`);
  const save = async (path: string) => {
    try {
      const response = await fetch(raw(path));
      if (!response.ok) throw new Error(response.statusText);
      download(path.split('/').pop()!, await response.blob());
    } catch (e) {
      toast(t('common.transfer.archiveFailed', { message: (e as Error).message }), 'error');
    }
  };
  // Repeated layout approximations on the same slide/object are one readable note, not toast spam.
  const unique = result.diagnostics.filter((d, i, all) => all.findIndex(x => x.code === d.code && x.slide === d.slide && x.part === d.part && x.object === d.object) === i);
  return <Dialog label={t(result.name ? 'launcher.pptx.ready' : 'launcher.pptx.failed')} className="pptx-import-result" onClose={() => result.finish(!!result.name)}>
    <div className="pptx-import-body">
      <p tabIndex={0}>{result.name ? t('launcher.pptx.summary', { name: result.name, count: result.slides?.length ?? 0 }) : result.message}</p>
      <p>{t(result.name ? 'launcher.pptx.review' : 'launcher.pptx.noProject')}</p>
      <ul className="pptx-import-notes">{unique.map((d, i) => {
        const index = result.slides?.findIndex(s => s.id === d.slide || s.part === d.part);
        const page = index !== undefined && index >= 0 ? index + 1 : d.part?.match(/\/slide(\d+)\.xml$/)?.[1];
        return <li key={i}>
          <strong>{page ? t('launcher.pptx.page', { page }) : t('launcher.pptx.package')}</strong>
          {d.object && <span> · {t('launcher.pptx.object', { object: d.object })}</span>}
          <p>{t(`launcher.pptx.reason.${pptxReason(d.code)}`)}</p>
          {d.part && <code>{d.part}</code>}
        </li>;
      })}</ul>
      {result.name && result.report && result.source && <div className="pptx-import-files">
        <button className="btn outline" onClick={() => void save(result.source!)}>{t('launcher.pptx.original')}</button>
        <button className="btn outline" onClick={() => void save(result.report!)}>{t('launcher.pptx.report')}</button>
      </div>}
    </div>
    <footer><button className="btn primary" onClick={() => result.finish(!!result.name)}>{t(result.name ? 'launcher.pptx.open' : 'launcher.pptx.close')}</button></footer>
  </Dialog>;
}
