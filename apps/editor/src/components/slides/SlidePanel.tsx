import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BUILDS, deckSize, TRANSITIONS, attr, checkSlide, getStyle, googleFace, layerTree, rootElement, slideFile, type Layer } from '@dc/core';
import { display, editDeck, editElement, parsed, useDeck, useStore } from '../../store';
import { isHidden, resizeDeck, setSectionAttr, slideTitle, toggleHidden } from './slides';
import { ColorField, Field, Row, Select } from '../panel/fields';
import { Chevron, RoleIcon } from '../icons';
import { DsInstall } from '../panel/DsInstall';
import { SizeRows } from '../panel/SizeRows';

const ROLES = ['Slide', 'Column', 'Row', 'Grid', 'Text', 'Image', 'Vector', 'Link', 'Group', 'Embed', 'Artboard', 'Shape', 'Icon', 'Connector', 'Table', 'Notes'] as const;
type KnownRole = (typeof ROLES)[number];
const isKnownRole = (r: string): r is KnownRole => (ROLES as readonly string[]).includes(r);

/** A whole slide selected: its id, look, transition, skipping, and the subset check. */
export function SlideProps({ file }: { file: string }) {
  const id = file.replace(/^slides\/|\.html$/g, '');
  const source = useStore((s) => display(s, file));
  const doc = source ? parsed(source) : null;
  const root = doc ? rootElement(doc) : undefined;
  const issues = useMemo(() => (doc ? checkSlide(doc, id) : []), [doc, id]);
  const { t } = useTranslation();
  if (!root) return <div className="empty">{t('slides.slideProps.empty')}</div>;
  const style = attr(root, 'style') ?? '';
  const set = (prop: string, value: string | null) => editElement(file, [{ kind: 'style', tid: root.tid, prop, value }]);
  return (
    <div className="sec">
      <h3>{t('slides.slideProps.heading')}</h3>
      <Row label={t('slides.slideProps.title')}>
        <span className="hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {slideTitle(source, id)}
        </span>
      </Row>
      <Row label={t('slides.slideProps.id')}>
        <code className="hint">{id}</code>
      </Row>
      <Row label={t('slides.slideProps.background')}>
        <ColorField value={getStyle(style, 'background') ?? ''} onCommit={(v) => set('background', v || null)} label={t('slides.slideProps.background')} allowNone={false} />
      </Row>
      <Row label={t('slides.slideProps.textColor')}>
        <ColorField value={getStyle(style, 'color') ?? ''} onCommit={(v) => set('color', v || null)} label={t('slides.slideProps.textColor')} />
      </Row>
      <Row label={t('slides.slideProps.padding')}>
        <Field value={getStyle(style, 'padding') ?? ''} placeholder="128px" onCommit={(v) => set('padding', v.trim() || null)} label={t('slides.slideProps.padding')} numeric={false} />
      </Row>
      <Row label={t('slides.slideProps.transition')}>
        <Select
          value={attr(root, 'data-transition') ?? ''}
          options={[{ value: '', label: t('slides.transition.none') }, ...TRANSITIONS.map((x) => ({ value: x, label: t(`slides.transition.${x}`) }))]}
          onChange={(v) => setSectionAttr(id, 'data-transition', v || null)}
          label={t('slides.slideProps.transitionLabel')}
        />
      </Row>
      <Row label={t('slides.slideProps.present')}>
        <label className="chk">
          <input type="checkbox" checked={isHidden(id)} onChange={() => toggleHidden(id)} /> {t('slides.slideProps.skip')}
        </label>
      </Row>
      <h3>{t('slides.slideProps.check')}</h3>
      {issues.length ? (
        <ul className="issue-list">
          {issues.map((i, n) => (
            <li key={n} className={i.level} onClick={() => i.tid !== null && useStore.setState({ selection: { kind: 'el', file, tid: i.tid } })}>
              {i.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint" style={{ margin: 0 }}>
          {t('slides.slideProps.valid')}
        </p>
      )}
    </div>
  );
}

/** Builds on a pinned element (present mode only). */
export function BuildRow({ file, tid }: { file: string; tid: number }) {
  const source = useStore((s) => display(s, file));
  const { t } = useTranslation();
  const el = source ? parsed(source).elements[tid] : undefined;
  if (!el || !/position\s*:\s*absolute/.test(attr(el, 'style') ?? '')) return null;
  const cur = attr(el, 'data-build-in') ?? '';
  const effect = cur.split(/\s+/)[0] ?? '';
  const auto = /\bauto\b/.test(cur);
  const write = (eff: string, a: boolean) =>
    editElement(file, [{ kind: 'attr', tid, name: 'data-build-in', value: eff ? `${eff}${a ? ' auto' : ''}` : null }]);
  return (
    <div className="sec">
      <h3>{t('slides.build.heading')}</h3>
      <Row label={t('slides.build.effect')}>
        <Select
          value={effect}
          options={[{ value: '', label: t('slides.build.none') }, ...BUILDS.map((b) => ({ value: b, label: t(`slides.build.${b}`) }))]}
          onChange={(v) => write(v, auto)}
          label={t('slides.build.heading')}
        />
      </Row>
      {effect && (
        <Row label={t('slides.build.timing')}>
          <Select
            value={auto ? 'auto' : 'click'}
            options={[
              { value: 'click', label: t('slides.build.onClick') },
              { value: 'auto', label: t('slides.build.afterPrevious') },
            ]}
            onChange={(v) => write(effect, v === 'auto')}
            label={t('slides.build.timing')}
          />
        </Row>
      )}
    </div>
  );
}

/** Nothing selected: the deck itself — its name and typefaces. */
export function DeckProps() {
  const deck = useDeck();
  const [font, setFont] = useState('');
  const { t } = useTranslation();
  const faces = Object.entries(deck.faces);
  return (
    <div className="sec">
      <div className="empty" style={{ textAlign: 'center', padding: '8px 0 4px' }}>
        <div style={{ color: 'var(--ink)', fontWeight: 500 }}>{t('slides.deckProps.nothingSelected')}</div>
        {t('slides.deckProps.hint')}
      </div>
      <h3>{t('slides.deckProps.heading')}</h3>
      <Row label={t('slides.deckProps.name')}>
        <Field
          value={deck.title}
          numeric={false}
          label={t('slides.deckProps.nameLabel')}
          onCommit={(v) => v.trim() && editDeck((d) => (d.title = v.trim()), t('slides.journal.title', { title: v.trim() }))}
        />
      </Row>
      <SizeRows
        size={deckSize(deck)}
        onResize={resizeDeck}
      />
      <h3>{t('slides.deckProps.fonts')}</h3>
      {faces.length ? (
        faces.map(([k, f]) => (
          <div key={k} className="face">
            <span className="fname" style={{ fontFamily: `'${f.family}', sans-serif` }}>
              {f.family}
            </span>
            <button className="btn outline" onClick={() => editDeck((d) => void delete d.faces[k], t('slides.journal.typefaceRemoved', { family: f.family }))}>
              {t('common.remove')}
            </button>
          </div>
        ))
      ) : (
        <p className="hint" style={{ margin: 0 }}>
          {t('slides.deckProps.noFonts')}
        </p>
      )}
      <form
        className="faceadd"
        onSubmit={(e) => {
          e.preventDefault();
          const f = font.trim();
          if (!f) return;
          if (Object.keys(deck.faces).length >= 4) return;
          const [key, face] = googleFace(f);
          editDeck((d) => (d.faces[key] = face), t('slides.journal.typefaceAdded', { family: f }));
          setFont('');
        }}
      >
        <input
          className="input"
          placeholder={t('slides.deckProps.fontPlaceholder')}
          value={font}
          onChange={(e) => setFont(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label={t('slides.deckProps.addFont')}
        />
        <button className="btn outline" type="submit" disabled={faces.length >= 4}>
          {t('common.add')}
        </button>
      </form>
      <p className="hint" style={{ margin: 0 }}>
        {t('slides.deckProps.fontsHint')}
      </p>
      <DsInstall />
      <h3>{t('slides.deckProps.shortcuts')}</h3>
      <p className="hint" style={{ margin: 0 }}>
        {t('slides.deckProps.shortcutList')}
      </p>
    </div>
  );
}
