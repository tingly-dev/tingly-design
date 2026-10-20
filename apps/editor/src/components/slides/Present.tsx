import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { t } from '../../i18n';
import { slideFile } from '@dc/core';
import { display, parsed, slideIds, toast, useStore } from '../../store';
import { isHidden, notesOf } from './slides';
import { SlideFrame } from './SlideFrame';
import { useFit } from './Stage';

export function startPresent(from: number | null, notes = false): void {
  const s = useStore.getState();
  const ids = slideIds(s).filter((id) => !isHidden(id));
  if (!ids.length) return toast(t('slides.present.nothing'));
  const i = from ?? Math.max(0, ids.indexOf(s.slide ?? ''));
  useStore.setState({ present: { index: i, step: 0, total: 0, leaving: null, notes }, mode: 'play', selection: null, menu: null });
  document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
}

export function stopPresent(): void {
  useStore.setState({ present: null, mode: 'edit' });
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

/** Next build, else next slide. Returns false at the end. */
export function presentStep(dir: 1 | -1): void {
  const s = useStore.getState();
  const p = s.present;
  if (!p) return;
  const ids = slideIds(s).filter((id) => !isHidden(id));
  if (dir > 0 && p.step < buildCount(ids[p.index])) return useStore.setState({ present: { ...p, step: p.step + 1 } });
  const next = p.index + dir;
  if (next < 0) return;
  if (next >= ids.length) return stopPresent();
  useStore.setState({ present: { ...p, index: next, step: 0, total: 0, leaving: { index: p.index, dir } } });
}

/** Click steps a slide's builds take: every build that is not `auto` (known from the source, before its frame loads). */
function buildCount(id: string | undefined): number {
  const src = id ? display(useStore.getState(), slideFile(id)) : undefined;
  if (!src) return 0;
  return parsed(src).elements.filter((e) => {
    const b = e.attrs.find((a) => a.name === 'data-build-in')?.value;
    return b !== undefined && !/\bauto\b/.test(b);
  }).length;
}

function transitionOf(id: string | undefined): string {
  if (!id) return 'none';
  const src = display(useStore.getState(), slideFile(id));
  const root = src ? parsed(src).elements[0] : undefined;
  return root?.attrs.find((a) => a.name === 'data-transition')?.value ?? 'none';
}

export function Present() {
  const p = useStore((s) => s.present)!;
  const ids = useStore((s) => slideIds(s)).filter((id) => !isHidden(id));
  const box = useRef<HTMLDivElement>(null);
  const k = useFit(box, 0, 0);
  const id = ids[p.index];
  const leaving = p.leaving ? ids[p.leaving.index] : undefined;
  // the slide being left decides how it leaves
  const tr = p.leaving ? transitionOf(p.leaving.dir > 0 ? leaving : id) : 'none';
  useEffect(() => {
    if (!p.leaving) return;
    const timer = setTimeout(() => useStore.setState((s) => (s.present ? { present: { ...s.present, leaving: null } } : {})), 650);
    return () => clearTimeout(timer);
  }, [p.leaving]);
  const source = useStore((s) => (id ? display(s, slideFile(id)) : undefined));
  const { t } = useTranslation();
  return (
    <div className={`present ${p.notes ? 'withnotes' : ''}`} role="dialog" aria-label={t('slides.present.label')}>
      <div className="pstage" ref={box}>
        {leaving && p.leaving && (
          <div key={'out' + leaving} className={`pslide out t-${tr} d${p.leaving.dir > 0 ? 'f' : 'b'}`}>
            <SlideFrame id={leaving} scale={k} use="present" step={99} />
          </div>
        )}
        {id && (
          <div key={id} className={`pslide in ${p.leaving ? `t-${tr} d${p.leaving.dir > 0 ? 'f' : 'b'}` : ''}`}>
            <SlideFrame
              id={id}
              scale={k}
              use="present"
              step={p.step}
              onSteps={(total) => useStore.setState((s) => (s.present && s.present.total !== total ? { present: { ...s.present, total } } : {}))}
            />
          </div>
        )}
      </div>
      {p.notes && (
        <aside className="pnotes" aria-label={t('slides.present.notes')}>
          <div className="pn-h">{t('slides.present.notesHead', { n: p.index + 1, total: ids.length })}</div>
          <div className="pn-b">{notesOf(source) || t('slides.present.noNotes')}</div>
        </aside>
      )}
      <div className="pbar">
        <button className="tb" onClick={() => presentStep(-1)} aria-label={t('slides.present.previous')}>
          ‹
        </button>
        <span>
          {p.index + 1} / {ids.length}
        </span>
        <button className="tb" onClick={() => presentStep(1)} aria-label={t('slides.present.next')}>
          ›
        </button>
        <button className="tb" onClick={() => useStore.setState({ present: { ...p, notes: !p.notes } })} aria-pressed={p.notes}>
          {t('slides.present.toggleNotes')}
        </button>
        <button className="tb" onClick={stopPresent}>
          {t('slides.present.exit')}
        </button>
      </div>
    </div>
  );
}
