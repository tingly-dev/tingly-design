import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { boardFilesFor, deckSize, slideFile } from '@dc/core';
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
  if (d.feature === 'transformed-root' || d.feature === 'ancestor-effect' || d.feature === 'page-size') return t('slides.pptx.transform');
  if (d.feature === 'rasterization') return t('slides.pptx.rasterization');
  return t(d.code === 'asset' ? 'slides.pptx.asset' : d.code === 'budget' ? 'slides.pptx.budget' : d.code === 'not-ready' ? 'slides.pptx.notReady' : 'slides.pptx.unsupported');
};
/** What an element drawn as a picture was, in the person's words. */
const pictureKind = (feature = ''): 'embed' | 'graphic' | 'image' | 'text' | 'other' | 'effect' =>
  /^(x-embed|iframe|video|audio|object|embed)$/.test(feature) ? 'embed'
    : /^(svg|canvas|x-icon|x-connector|math|shape:)/.test(feature) ? 'graphic'
      : /^image-/.test(feature) ? 'image'
        : /^text-/.test(feature) ? 'text'
          : /^(input|textarea|select|button|meter|progress|picture)$/.test(feature) ? 'other' : 'effect';
/** The text effects left out to keep text editable, by the feature the capture names. */
const LEFT: Record<string, 'textShadow' | 'smallCaps' | 'wordSpacing' | 'decorationStyle' | 'outside'> = { 'text-shadow': 'textShadow', 'small-caps': 'smallCaps', 'word-spacing': 'wordSpacing', 'decoration-style': 'decorationStyle', 'outside-slide': 'outside' };
/** What a successful export changed, one line per slide in deck order: how many elements of each kind became pictures, and which text effects were left out. */
function notes(warnings: { slide: string; diagnostic: PptxDomDiagnostic }[] = [], ids: string[]): { slide: string; n: number; parts: string[] }[] {
  const bySlide = new Map<string, { kinds: Map<ReturnType<typeof pictureKind>, number>; left: Set<string>; rounded: boolean }>();
  for (const { slide, diagnostic: d } of warnings) {
    if (!['rasterized', 'approximated', 'shape-approximation'].includes(d.code)) continue;
    const entry = bySlide.get(slide) ?? { kinds: new Map(), left: new Set(), rounded: false };
    bySlide.set(slide, entry);
    if (d.code === 'rasterized') entry.kinds.set(pictureKind(d.feature), (entry.kinds.get(pictureKind(d.feature)) ?? 0) + 1);
    else if (d.code === 'approximated') entry.left.add(d.feature ?? '');
    else entry.rounded = true;
  }
  return [...bySlide].map(([slide, e]) => ({
    slide, n: ids.indexOf(slide) + 1,
    parts: [...[...e.kinds].map(([kind, count]) => t(`slides.pptx.as.${kind}`, { count })), ...(e.left.size ? [t('slides.pptx.approximated', { feature: [...e.left].map(f => t(`slides.pptx.left.${LEFT[f] ?? 'other'}`)).join(t('slides.pptx.list')) })] : []), ...(e.rounded ? [t('slides.pptx.shapeWarning')] : [])],
  })).sort((a, b) => a.n - b.n);
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** The visible slides a `--slide` range names: comma-separated positions (1-based, over the visible
 * deck) and `a-b` spans, or slide ids, as in `2`, `1-4`, `cover` or `1,3-4`. Throws what the person should read. */
export function slidesForRange(range: string, visible: string[]): string[] {
  const picked: string[] = [];
  const take = (id: string) => { if (!picked.includes(id)) picked.push(id); };
  const bad = (atom: string): never => { throw new Error(t('slides.pptx.range', { range: atom })); };
  for (const atom of range.split(',')) {
    const part = atom.trim();
    const span = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (span) {
      const from = Number(span[1]), to = Number(span[2]);
      if (from < 1 || to < from || to > visible.length) bad(part);
      for (let n = from; n <= to; n++) take(visible[n - 1]);
    } else if (/^\d+$/.test(part)) {
      const n = Number(part);
      if (n < 1 || n > visible.length) bad(part);
      take(visible[n - 1]);
    } else if (visible.includes(part)) take(part);
    else bad(part);
  }
  return picked;
}

/** Also used by headless FileMenu jobs: resolving means the actual download finished. */
export async function exportDeckPptx(range?: string): Promise<void> {
  if (controller) throw new Error(t('slides.pptx.busy'));
  const s = useStore.getState();
  const deck = deckOf(s);
  const visible = slideIds(s).filter(id => !isHidden(id));
  // a range names slides of the visible deck; the strip numbers and jump links stay deck-wide
  const ids = slideIds(s);
  const chosen = range ? slidesForRange(range, visible) : visible;
  const snapshot = {
    title: deck.title, faces: structuredClone(deck.faces), size: deckSize(deck),
    slides: chosen.map(id => ({ id, source: display(s, slideFile(id)) ?? '' })),
    boards: boardFilesFor(chosen.map(id => display(s, slideFile(id))), p => display(s, p)),
    base: s.project ? api.rawBase(s.project) : '', runtimeOrigin: SERVER,
  };
  const mine = new AbortController(); controller = mine;
  update({ status: 'running', ids });
  try {
    const result = await deckSnapshotToPptx(snapshot, { signal: mine.signal, progress: progress => update({ status: 'running', progress, ids }) });
    if (mine.signal.aborted) return;
    const name = deck.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'deck';
    // a range export says which slides it holds, so two of them do not overwrite each other
    const file = range ? `${name}-${range.replace(/[\\/:*?"<>|\s]+/g, '')}.pptx` : `${name}.pptx`;
    download(file, new Blob([result.bytes as Uint8Array<ArrayBuffer>], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }));
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
  const pictures = value.warnings?.filter(w => w.diagnostic.code === 'rasterized').length ?? 0;
  const changed = notes(value.warnings, value.ids);
  return <Dialog label={t('slides.pptx.title')} className="pptx-export" onClose={close}>
    <div className="dialog-body" data-testid="pptx-export">
      {value.status === 'running' ? <p role="status">{value.progress ? t('slides.pptx.progress', { done: value.progress.done, total: value.progress.total, slide: value.progress.slide ?? '' }) : t('slides.pptx.preparing')}</p> : null}
      {value.status === 'done' ? <><p>{t('slides.pptx.done')}</p>
        {pictures ? <p>{t('slides.pptx.pictures', { count: pictures })}</p> : null}
        <p>{t('slides.pptx.metrics')}</p>
        {!!changed.length && <details><summary>{t('slides.pptx.warnings')}</summary><ul className="pptx-notes">{changed.map(({ slide, n, parts }) => <li key={slide}>
          <button className="btn ghost sm" title={t('slides.pptx.go')} onClick={() => { goToSlide(slide); close(); }}>{t('slides.pptx.location', { n, id: slide })}</button>
          <span>{parts.join(t('slides.pptx.and'))}</span>
        </li>)}</ul></details>}
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
