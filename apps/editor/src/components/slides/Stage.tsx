import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SLIDE_H, SLIDE_W, checkSlide, slideFile } from '@dc/core';
import { display, parsed, useStore } from '../../store';
import { notesOf, setNotes } from './slides';
import { NoteBox } from '../NoteBox';
import { SlideFrame } from './SlideFrame';
import { useElementSize } from '../../hooks';

export function useFit(ref: React.RefObject<HTMLElement | null>, padX: number, padY: number): number {
  const [, { w, h }] = useElementSize(ref);
  if (!w || !h) return 0.4;
  return Math.max(0.1, Math.min((w - padX * 2) / SLIDE_W, (h - padY * 2) / SLIDE_H));
}

function Notes({ id }: { id: string }) {
  const source = useStore((s) => display(s, slideFile(id)));
  const { t } = useTranslation();
  return (
    <NoteBox
      saved={notesOf(source)}
      current={() => notesOf(display(useStore.getState(), slideFile(id)))}
      onSave={(v) => setNotes(id, v)}
      placeholder={t('slides.stage.notesPlaceholder')}
      label={t('slides.stage.notesLabel')}
    />
  );
}

function Issues({ id }: { id: string }) {
  const source = useStore((s) => display(s, slideFile(id)));
  const issues = useMemo(() => (source ? checkSlide(parsed(source), id).filter((i) => i.level !== 'note') : []), [source, id]);
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  if (!issues.length) return null;
  const errors = issues.filter((i) => i.level === 'error').length;
  return (
    <div className={`issues ${errors ? 'err' : ''}`}>
      <button className="ibtn" onClick={() => setOpen(!open)} aria-expanded={open}>
        {errors ? t('slides.stage.errors', { count: errors }) : t('slides.stage.hints', { count: issues.length })}
      </button>
      {open && (
        <ul>
          {issues.map((i, n) => (
            <li
              key={n}
              className={i.level}
              onClick={() => i.tid !== null && useStore.setState({ selection: { kind: 'el', file: slideFile(id), tid: i.tid } })}
            >
              {i.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Stage() {
  const id = useStore((s) => s.slide);
  const area = useRef<HTMLDivElement>(null);
  const k = useFit(area, 40, 40);
  const error = useStore((s) => (id ? s.runtimeErrors[slideFile(id)] : null));
  const { t } = useTranslation();
  return (
    <div className="sarea" ref={area} onPointerDown={(e) => e.target === e.currentTarget && useStore.setState({ selection: null })}>
      {id ? (
        <div className="scol">
          <div className="shead2">
            <Issues id={id} />
            {error && (
              <span className="badge err" title={error}>
                {t('slides.stage.error')}
              </span>
            )}
          </div>
          <SlideFrame id={id} scale={k} use="stage" />
          <Notes key={id} id={id} />
        </div>
      ) : (
        <div className="empty">{t('slides.stage.empty')}</div>
      )}
    </div>
  );
}
