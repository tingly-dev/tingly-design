import { SideResizer } from '../SideResizer';
import { InlineRename } from '../InlineRename';
import { ListColumn } from '../ChatPanel';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { deckSize, checkSlide, sectionsOf, slideFile } from '@dc/core';
import { deckOf, display, parsed, useDeck, useSlideIds, useStore } from '../../store';
import { addSection, addSlide, deleteSlide, duplicateSlide, goToSlide, isHidden, moveSlide, removeSection, renameSection, shiftSlide, slideTitle, toggleHidden } from './slides';
import { SlideFrame } from './SlideFrame';
import { ItemMenuItems } from '../ItemMenu';
import { Menu, MenuItem } from '../Menu';

const THUMB_W = 176;

function Thumb({ id, index, last }: { id: string; index: number; last: boolean }) {
  const width = useStore((s) => deckSize(deckOf(s))[0]);
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
        <SlideFrame id={id} scale={THUMB_W / width} use="thumb" />
        {hidden && <span className="tag">{t('slides.strip.skipped')}</span>}
        {errors > 0 && (
          <span className="tag err" title={t('slides.strip.errors', { count: errors })}>
            {errors}
          </span>
        )}
      </div>
      {menu && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} label={t('slides.strip.menu.label')}>
          <ItemMenuItems
            close={() => setMenu(null)}
            onAdd={() => addSlide(id)}
            onDuplicate={() => duplicateSlide(id)}
            onEarlier={index > 0 ? () => shiftSlide(id, -1) : null}
            onLater={last ? null : () => shiftSlide(id, 1)}
            extra={
              <>
                <MenuItem label={hidden ? t('slides.strip.menu.unskip') : t('slides.strip.menu.skip')} onSelect={() => (setMenu(null), toggleHidden(id))} />
                <MenuItem label={t('slides.strip.menu.startSection')} onSelect={() => (setMenu(null), addSection(id))} />
              </>
            }
            onDelete={() => void deleteSlide(id)}
          />
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
        <InlineRename value={description} label={t('slides.section.descriptionLabel')} onCommit={(v) => renameSection(k, v)} onDone={() => setEditing(false)} />
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

export function Strip() {
  const deck = useDeck();
  const ids = useSlideIds();
  const groups = useMemo(() => sectionsOf(deck, ids), [deck, ids]);
  const { t } = useTranslation();
  let n = 0;
  return (
    <ListColumn label={t('slides.strip.tab')} className="slides">
      <aside className="strip" aria-label={t('slides.strip.label')}>
        <SideResizer id="strip" edge="end" name={t('slides.strip.label')} />
        <div className="slist" role="listbox" aria-label={t('slides.strip.list')}>
          {groups.map((g, gi) => (
            <div key={g.key || gi} className="sgroup">
              <SectionHead k={g.key} description={g.description} />
              {g.ids.map((id) => (
                <Thumb key={id} id={id} index={n++} last={n === ids.length} />
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
    </ListColumn>
  );
}
