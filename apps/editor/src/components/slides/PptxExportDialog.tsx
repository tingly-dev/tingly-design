import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { slideFile } from '@dc/core';
import { api } from '../../api';
import { SERVER } from '../../base';
import { download } from '../../local';
import { deckOf, display, slideIds, toast, useStore } from '../../store';
import { Dialog } from '../Dialog';
import { goToSlide, isHidden } from './slides';
import { t } from '../../i18n';
import { deckSnapshotToPptx, DeckPptxError, type DeckPptxProgress } from './pptxExport';
import type { PptxDomDiagnostic } from '@dc/export/pptx-dom';

type State = { status: 'running' | 'done' | 'failed' | 'cancelled'; progress?: DeckPptxProgress; error?: DeckPptxError; warnings?: { slide: string; diagnostic: PptxDomDiagnostic }[]; ids: string[] } | null;
let state: State = null;
let controller: AbortController | undefined;
const listeners = new Set<() => void>();
const update = (next: State) => { state = next; for (const listener of listeners) listener(); };
const diagnosticMessage = (d: PptxDomDiagnostic) => {
  if (d.feature === 'paint-effect') return t('slides.pptx.paint');
  if (d.feature === 'transform' || d.feature === 'transformed-root') return t('slides.pptx.transform');
  if (d.feature === 'x-embed') return t('slides.pptx.embed');
  if (['table', 'ul', 'ol', 'li'].includes(d.feature ?? '')) return t('slides.pptx.table');
  return t(d.code === 'asset' ? 'slides.pptx.asset' : d.code === 'budget' ? 'slides.pptx.budget' : d.code === 'not-ready' ? 'slides.pptx.notReady' : 'slides.pptx.unsupported');
};
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Also used by headless FileMenu jobs: resolving means the actual download finished. */
export async function exportDeckPptx(): Promise<void> {
  if (controller) throw new Error(t('slides.pptx.busy'));
  const s = useStore.getState();
  const deck = deckOf(s);
  const ids = slideIds(s);
  const snapshot = {
    title: deck.title, faces: structuredClone(deck.faces),
    slides: ids.filter(id => !isHidden(id)).map(id => ({ id, source: display(s, slideFile(id)) ?? '' })),
    base: s.project ? api.rawBase(s.project) : '', runtimeOrigin: SERVER,
  };
  const mine = new AbortController(); controller = mine;
  update({ status: 'running', ids });
  try {
    const result = await deckSnapshotToPptx(snapshot, { signal: mine.signal, progress: progress => update({ status: 'running', progress, ids }) });
    if (mine.signal.aborted) return;
    const name = deck.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'deck';
    download(`${name}.pptx`, new Blob([result.bytes as Uint8Array<ArrayBuffer>], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }));
    update({ status: 'done', ids, warnings: result.diagnostics });
  } catch (error) {
    if (mine.signal.aborted) { if (state) update({ status: 'cancelled', ids }); }
    else {
      update({ status: 'failed', ids, error: error instanceof DeckPptxError ? error : undefined });
      // Headless catches error toasts; the person keeps the actionable dialog.
      toast(t('slides.pptx.failed') + (error instanceof DeckPptxError ? ` ${error.slide}: ${error.message}` : ` ${t('slides.pptx.resource')}`), 'error');
    }
  } finally { if (controller === mine) controller = undefined; }
}

export function PptxExportDialog() {
  const value = useSyncExternalStore(subscribe, () => state);
  const { t } = useTranslation();
  if (!value) return null;
  const close = () => { controller?.abort(); update(null); };
  const location = value.error?.slide;
  return <Dialog label={t('slides.pptx.title')} className="pptx-export" onClose={close}>
    <div className="dialog-body" data-testid="pptx-export">
      {value.status === 'running' ? <p role="status">{value.progress ? t('slides.pptx.progress', { done: value.progress.done, total: value.progress.total, slide: value.progress.slide ?? '' }) : t('slides.pptx.preparing')}</p> : null}
      {value.status === 'done' ? <><p>{t('slides.pptx.done')}</p><p>{t('slides.pptx.metrics')}</p>
        {!!value.warnings?.length && <details><summary>{t('slides.pptx.warnings')}</summary><ul>{value.warnings.slice(0, 200).map(({ slide, diagnostic: d }, i) => <li key={i}>{t('slides.pptx.warning', { id: slide, message: t(d.code === 'shape-approximation' ? 'slides.pptx.shapeWarning' : 'slides.pptx.metrics') })}</li>)}</ul></details>}
      </> : null}
      {value.status === 'cancelled' ? <p>{t('slides.pptx.cancelled')}</p> : null}
      {value.status === 'failed' ? <div role="alert">
        <p>{t('slides.pptx.failed')}</p>
        {location ? <p>{t('slides.pptx.location', { n: value.ids.indexOf(location) + 1, id: location })}</p> : null}
        {value.error ? <ul>{value.error.diagnostics.filter(d => d.severity === 'error').slice(0, 50).map((d, i) => <li key={i}>
          <p>{diagnosticMessage(d)}</p>
          <small>{t('slides.pptx.problem', { code: d.code, feature: d.feature ?? '', path: d.path })}</small>
        </li>)}</ul> : <p>{t('slides.pptx.resource')}</p>}
      </div> : null}
    </div>
    <footer>
      {location ? <button className="btn outline" onClick={() => { goToSlide(location); close(); }}>{t('slides.pptx.go')}</button> : null}
      <button className="btn" onClick={close}>{t(value.status === 'running' ? 'slides.pptx.cancel' : 'slides.pptx.close')}</button>
    </footer>
  </Dialog>;
}
