import { useEffect, useMemo, useRef, useState } from 'react';
import { IconTable } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { t } from '../../i18n';
import { SLIDE_H, SLIDE_W, checkSlide, sectionsOf, slideFile, ICON_NAMES } from '@dc/core';
import { deckOf, display, editDeck, parsed, slideIds, toast, useDeck, useSlideIds, useStore } from '../../store';
import {
  INSERTS,
  addSection,
  addSlide,
  deleteSlide,
  duplicateSlide,
  goToSlide,
  insertOnSlide,
  isHidden,
  moveSlide,
  notesOf,
  removeSection,
  renameSection,
  setNotes,
  slideTitle,
  toggleHidden,
  uploadImage,
  slidesImport,
} from '../../slides';
import { NoteBox } from '../NoteBox';
import { SlideFrame } from './SlideFrame';
import { Menu, MenuItem } from '../Menu';
import { RightPanel } from '../panel/RightPanel';
import { PromptBar } from '../PromptBar';
import { ContextMenu, JournalPopover } from '../Overlays';
import { TopBar, ProjectTitle } from '../TopBar';
import { Caret, Panel, Picture, Presentation, Shapes, TextT } from '../icons';
import { slidesExportItems } from './exportDeck';
import { FileMenu } from '../FileMenu';
import { useDirectPdf } from '../../pdfExport';
import { useElementSize } from '../../hooks';

// ------------------------------------------------------------------ strip

const THUMB_W = 176;
const THUMB_K = THUMB_W / SLIDE_W;

function Thumb({ id, index }: { id: string; index: number }) {
  const current = useStore((s) => s.slide === id);
  const source = useStore((s) => display(s, slideFile(id)));
  const hidden = useMemo(() => (source ? isHidden(id) : false), [source, id]);
  const errors = useMemo(() => (source ? checkSlide(parsed(source), id).filter((i) => i.level === 'error').length : 0), [source, id]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  useEffect(() => {
    if (current) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [current]);
  return (
    <div
      ref={ref}
      className={`thumb ${current ? 'on' : ''} ${hidden ? 'skipped' : ''} ${over ? 'over' : ''}`}
      role="option"
      aria-selected={current}
      aria-label={t('slides.strip.thumb', { n: index + 1, title: slideTitle(source, id) })}
      data-slide={id}
      draggable
      onClick={() => goToSlide(id)}
      onContextMenu={(e) => {
        e.preventDefault();
        goToSlide(id);
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/x-slide', id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('text/x-slide')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const from = e.dataTransfer.getData('text/x-slide');
        if (from && from !== id) moveSlide(from, id);
      }}
    >
      <span className="num">{index + 1}</span>
      <div className="tframe">
        <SlideFrame id={id} scale={THUMB_K} use="thumb" />
        {hidden && <span className="tag">{t('slides.strip.skipped')}</span>}
        {errors > 0 && (
          <span className="tag err" title={t('slides.strip.errors', { count: errors })}>
            {errors}
          </span>
        )}
      </div>
      {menu && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} label={t('slides.strip.menu.label')}>
          <MenuItem label={t('slides.strip.menu.addAfter')} onSelect={() => (setMenu(null), addSlide(id))} />
          <MenuItem label={t('slides.strip.menu.duplicate')} onSelect={() => (setMenu(null), duplicateSlide(id))} />
          <MenuItem label={hidden ? t('slides.strip.menu.unskip') : t('slides.strip.menu.skip')} onSelect={() => (setMenu(null), toggleHidden(id))} />
          <MenuItem label={t('slides.strip.menu.startSection')} onSelect={() => (setMenu(null), addSection(id))} />
          <hr />
          <MenuItem label={t('slides.strip.menu.delete')} danger onSelect={() => (setMenu(null), void deleteSlide(id))} />
        </Menu>
      )}
    </div>
  );
}

function SectionHead({ k, description }: { k: string; description: string }) {
  const [editing, setEditing] = useState(false);
  const { t } = useTranslation();
  if (!k) return null;
  return (
    <div className="shead">
      {editing ? (
        <input
          autoFocus
          defaultValue={description}
          aria-label={t('slides.section.descriptionLabel')}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setEditing(false);
          }}
          onBlur={(e) => {
            setEditing(false);
            const v = e.currentTarget.value.trim();
            if (v && v !== description) renameSection(k, v);
          }}
        />
      ) : (
        <span className="d" title={t('slides.section.renameHint')} onDoubleClick={() => setEditing(true)}>
          {description || t('slides.section.unnamed')}
        </span>
      )}
      <button className="ib" aria-label={t('slides.section.remove')} title={t('slides.section.remove')} onClick={() => removeSection(k)}>
        ×
      </button>
    </div>
  );
}

function Strip() {
  const deck = useDeck();
  const ids = useSlideIds();
  const groups = useMemo(() => sectionsOf(deck, ids), [deck, ids]);
  const { t } = useTranslation();
  let n = 0;
  return (
    <aside className="strip" aria-label={t('slides.strip.label')}>
      <div className="slist" role="listbox" aria-label={t('slides.strip.list')}>
        {groups.map((g, gi) => (
          <div key={g.key || gi} className="sgroup">
            <SectionHead k={g.key} description={g.description} />
            {g.ids.map((id) => (
              <Thumb key={id} id={id} index={n++} />
            ))}
          </div>
        ))}
        <div
          className="sdrop"
          onDragOver={(e) => e.dataTransfer.types.includes('text/x-slide') && e.preventDefault()}
          onDrop={(e) => {
            const from = e.dataTransfer.getData('text/x-slide');
            if (from) moveSlide(from, null);
          }}
        />
      </div>
      <button className="btn outline addslide" onClick={() => addSlide()}>
        {t('slides.strip.addSlide')}
      </button>
    </aside>
  );
}

// ---------------------------------------------------------------- toolbar

const SHAPES = ['rect', 'rounded', 'ellipse', 'diamond', 'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'line'] as const;

function TopLeft() {
  const [menu, setMenu] = useState<null | 'shapes' | 'icons'>(null);
  const shapesBtn = useRef<HTMLButtonElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();
  const at = (b: HTMLElement | null) => {
    const r = b?.getBoundingClientRect();
    return { x: r?.left ?? 0, y: (r?.bottom ?? 0) + 8 };
  };
  return (
    <div className="bar left" role="toolbar" aria-label={t('slides.toolbar.insert')}>
      <button className="tb" aria-label={t('slides.toolbar.insertText')} title={t('slides.toolbar.insertText')} onClick={() => insertOnSlide(INSERTS.text, true)}>
        <TextT />
      </button>
      <button className="tb" aria-label={t('slides.toolbar.insertImage')} title={t('slides.toolbar.insertImage')} onClick={() => file.current?.click()}>
        <Picture />
      </button>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        hidden
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (f) void uploadImage(f);
        }}
      />
      <button className="tb" aria-label={t('slides.toolbar.insertTable')} title={t('slides.toolbar.insertTable')} onClick={() => insertOnSlide(INSERTS.table, false)}>
        <IconTable size={16} stroke={1.6} aria-hidden="true" />
      </button>
      <button ref={shapesBtn} className="tb" aria-haspopup="menu" aria-label={t('slides.toolbar.shapesMenu')} title={t('slides.toolbar.shapesMenu')} onClick={() => setMenu('shapes')}>
        <Shapes />
        <span className="caret">
          <Caret />
        </span>
      </button>
      {menu === 'shapes' && (
        <Menu {...at(shapesBtn.current)} onClose={() => setMenu(null)} label={t('slides.toolbar.shapes')}>
          {SHAPES.map((k) => (
            <MenuItem key={k} label={t(`slides.shape.${k}`)} onSelect={() => (setMenu(null), insertOnSlide(INSERTS.shape(k), true))} />
          ))}
          <hr />
          <MenuItem label={t('slides.toolbar.connector')} onSelect={() => (setMenu(null), insertOnSlide(INSERTS.connector, true))} />
          <MenuItem label={t('slides.toolbar.icon')} onSelect={() => setMenu('icons')} />
        </Menu>
      )}
      {menu === 'icons' && (
        <Menu {...at(shapesBtn.current)} onClose={() => setMenu(null)} label={t('slides.toolbar.icons')}>
          <div className="iconpick">
            {ICON_NAMES.map((n) => (
              <button key={n} className="tb" title={n} onClick={() => (setMenu(null), insertOnSlide(INSERTS.icon(n), true))}>
                {n}
              </button>
            ))}
          </div>
        </Menu>
      )}
    </div>
  );
}

/** The deck's top bar: its name, the save state, and Import / Export; the tools float over the stage. */
function SlidesTopBar() {
  const deck = useDeck();
  const direct = useDirectPdf();
  const panelOpen = useStore((s) => s.panelOpen);
  const [menu, setMenu] = useState<null | 'play'>(null);
  const playBtn = useRef<HTMLButtonElement>(null);
  const { t } = useTranslation();
  const at = (b: HTMLElement | null) => {
    const r = b?.getBoundingClientRect();
    return { x: r?.right ?? 0, y: (r?.bottom ?? 0) + 8, align: 'right' as const };
  };
  return (
    <TopBar
      title={
        <ProjectTitle
          value={deck.title}
          label={t('slides.toolbar.deckName')}
          hint={t('slides.toolbar.renameHint')}
          onRename={(v) => editDeck((d) => (d.title = v), t('slides.journal.title', { title: v }))}
        />
      }
    >
      <button ref={playBtn} className="tb" aria-haspopup="menu" aria-expanded={menu === 'play'} aria-label={t('slides.toolbar.present')} title={t('slides.toolbar.present')} onClick={() => setMenu('play')}>
        <Presentation />
        <span className="caret">
          <Caret />
        </span>
      </button>
      <FileMenu target={slidesImport} label={t('slides.toolbar.importLabel')} items={slidesExportItems(direct)} />
      <button className="tb" aria-pressed={panelOpen} aria-label={t('slides.toolbar.panel')} title={t('slides.toolbar.panelHint')} onClick={() => useStore.setState({ panelOpen: !panelOpen })}>
        <Panel />
      </button>
      {menu === 'play' && (
        <Menu {...at(playBtn.current)} onClose={() => setMenu(null)} label={t('slides.toolbar.present')}>
          <MenuItem label={t('slides.toolbar.presentFromStart')} onSelect={() => (setMenu(null), startPresent(0))} />
          <MenuItem label={t('slides.toolbar.presentFromCurrent')} onSelect={() => (setMenu(null), startPresent(null))} />
          <MenuItem label={t('slides.toolbar.presentWithNotes')} onSelect={() => (setMenu(null), startPresent(null, true))} />
        </Menu>
      )}
    </TopBar>
  );
}

// ------------------------------------------------------------------ stage

function useFit(ref: React.RefObject<HTMLElement | null>, padX: number, padY: number): number {
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

function Stage() {
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

// ---------------------------------------------------------------- present

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

function Present() {
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

// -------------------------------------------------------------------- app

export function SlidesApp() {
  const loaded = useStore((s) => s.loaded);
  const panelOpen = useStore((s) => s.panelOpen);
  const present = useStore((s) => !!s.present);
  const slide = useStore((s) => s.slide);
  const ids = useSlideIds();
  const { t } = useTranslation();

  // keep the stage on a slide that exists (another editor may delete it)
  useEffect(() => {
    if (!loaded) return;
    if (!slide || !ids.includes(slide)) goToSlide(ids[0] ?? null);
  }, [loaded, slide, ids]);

  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement && useStore.getState().present) stopPresent();
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useEffect(() => {
    const title = deckOf(useStore.getState()).title;
    if (title) document.title = t('slides.docTitle', { title });
  });

  return (
    <>
    {!present && <SlidesTopBar />}
    <div className="app slides" data-mode={present ? 'play' : 'edit'}>
      <Strip />
      <main className="stage">
        <TopLeft />
        <Stage />
        {loaded && !present && <PromptBar />}
        <JournalPopover />
      </main>
      {panelOpen && !present && <RightPanel />}
      <ContextMenu />
      {present && <Present />}
    </div>
    </>
  );
}
