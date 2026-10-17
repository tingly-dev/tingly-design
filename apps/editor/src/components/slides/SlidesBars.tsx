import { useRef, useState } from 'react';
import { IconTable } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { ICON_NAMES } from '@dc/core';
import { editDeck, useDeck } from '../../store';
import { INSERTS, insertOnSlide, uploadImage, slidesImport } from './slides';
import { Menu, MenuItem } from '../Menu';
import { TopBar, ProjectTitle } from '../TopBar';
import { Caret, Picture, Presentation, Shapes, TextT } from '../icons';
import { pickSlide, slidesExportItems } from './exportDeck';
import { FileMenu } from '../FileMenu';
import { useDirectPdf } from '../../pdfExport';
import { startPresent } from './Present';

const SHAPES = ['rect', 'rounded', 'ellipse', 'diamond', 'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'line'] as const;

export function TopLeft() {
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
export function SlidesTopBar() {
  const deck = useDeck();
  const direct = useDirectPdf();
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
      panel={{ label: t('slides.toolbar.panel'), hint: t('slides.toolbar.panelHint') }}
    >
      <button ref={playBtn} className="tb" aria-haspopup="menu" aria-expanded={menu === 'play'} aria-label={t('slides.toolbar.present')} title={t('slides.toolbar.present')} onClick={() => setMenu('play')}>
        <Presentation />
        <span className="caret">
          <Caret />
        </span>
      </button>
      <FileMenu target={slidesImport} label={t('slides.toolbar.importLabel')} items={slidesExportItems(direct)} pick={pickSlide} />
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
