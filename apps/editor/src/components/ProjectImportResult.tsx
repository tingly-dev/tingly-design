import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import { PPTX_NOTES, pptxNote, type PptxDiagnostic, type PptxNote, type PptxReport } from '@dc/core';
import { Dialog } from './Dialog';
import { at } from '../base';
import { download } from '../local';
import { toast } from '../store';

type Result = { name?: string; message?: string; diagnostics: PptxDiagnostic[]; report?: string; source?: string; slides?: PptxReport['slides']; finish: (open: boolean) => void };
const useResult = create<{ result: Result | null }>(() => ({ result: null }));

export function showPptxResult(result: Omit<Result, 'finish'>): Promise<boolean> {
  return new Promise(resolve => useResult.setState({ result: { ...result, finish: open => { useResult.setState({ result: null }); resolve(open); } } }));
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
  // One line per kind of note, naming the slides (and objects) it applies to, errors first.
  // Slides are numbered as in the PowerPoint file (the id keeps that number), so a left-out slide does not shift the rest.
  const number = (id?: string) => Number(id?.match(/-(\d+)$/)?.[1]) || undefined;
  const pageOf = (d: PptxDiagnostic) => number(d.slide ?? result.slides?.find(s => s.part === d.part)?.id);
  type Page = { whole: boolean; objects: Set<string> };
  const groups = new Map<PptxNote, { error: boolean; pages: Map<number, Page>; parts: Set<string> }>();
  for (const d of result.diagnostics) {
    const key = pptxNote(d);
    const g = groups.get(key) ?? { error: false, pages: new Map(), parts: new Set() };
    g.error ||= d.level === 'error';
    const page = pageOf(d);
    if (page) { const p = g.pages.get(page) ?? { whole: false, objects: new Set() }; if (d.object) p.objects.add(d.object); else p.whole = true; g.pages.set(page, p); }
    else if (d.part) g.parts.add(d.part);
    groups.set(key, g);
  }
  const order = [...groups].sort(([a, x], [b, y]) => Number(y.error) - Number(x.error) || PPTX_NOTES.indexOf(a as never) - PPTX_NOTES.indexOf(b as never));
  // "Slides 1–3, 5", "Every slide", or "Slide 4: object 3"
  const kept = (result.slides ?? []).map(s => number(s.id));
  const where = (g: { pages: Map<number, Page> }) => {
    const plain = [...g.pages].filter(([, p]) => p.whole).map(([p]) => p).sort((a, b) => a - b);
    const ranges: string[] = [];
    for (let i = 0; i < plain.length;) {
      let j = i; while (j + 1 < plain.length && plain[j + 1] === plain[j] + 1) j++;
      ranges.push(j > i ? `${plain[i]}–${plain[j]}` : String(plain[i])); i = j + 1;
    }
    const parts = kept.length > 1 && kept.every(n => n && plain.includes(n)) ? [t('launcher.pptx.everySlide')]
      : plain.length ? [plain.length === 1 ? t('launcher.pptx.page', { page: plain[0] }) : t('launcher.pptx.pages', { pages: ranges.join(t('launcher.pptx.sep')) })] : [];
    for (const [page, { objects }] of [...g.pages].filter(([, p]) => p.objects.size).sort(([a], [b]) => a - b)) parts.push(t('launcher.pptx.pageObjects', { page, objects: [...objects].join(t('launcher.pptx.sep')) }));
    return parts.join(t('launcher.pptx.groupSep'));
  };
  return <Dialog label={t(result.name ? 'launcher.pptx.ready' : 'launcher.pptx.failed')} className="pptx-import-result" onClose={() => result.finish(!!result.name)}>
    <div className="pptx-import-body">
      <p tabIndex={0}>{result.name ? t('launcher.pptx.summary', { name: result.name, count: result.slides?.length ?? 0 }) : result.message}</p>
      <p>{t(result.name ? 'launcher.pptx.review' : 'launcher.pptx.noProject')}</p>
      <ul className="pptx-import-notes">{order.map(([key, g]) => <li key={key}>
        <p>{t(`launcher.pptx.reason.${key}`)}</p>
        {g.pages.size ? <strong>{where(g)}</strong> : <strong>{t('launcher.pptx.package')}</strong>}
        {[...g.parts].map(part => <code key={part}>{part}</code>)}
      </li>)}</ul>
      {result.name && result.report && result.source && <div className="pptx-import-files">
        <button className="btn outline" onClick={() => void save(result.source!)}>{t('launcher.pptx.original')}</button>
        <button className="btn outline" onClick={() => void save(result.report!)}>{t('launcher.pptx.report')}</button>
      </div>}
    </div>
    <footer><button className="btn primary" onClick={() => result.finish(!!result.name)}>{t(result.name ? 'launcher.pptx.open' : 'launcher.pptx.close')}</button></footer>
  </Dialog>;
}
