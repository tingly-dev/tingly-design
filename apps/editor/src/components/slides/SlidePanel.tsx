import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BUILDS, TRANSITIONS, attr, checkSlide, getStyle, googleFace, layerTree, rootElement, slideFile, type Layer } from '@dc/core';
import { display, editDeck, editElement, parsed, useDeck, useStore } from '../../store';
import { isHidden, setSectionAttr, slideTitle, toggleHidden } from '../../slides';
import { ColorField, Field, Row, Select } from '../panel/fields';
import { Chevron, RoleIcon } from '../icons';
import { DsInstall } from '../panel/DsInstall';

const ROLES = ['Slide', 'Column', 'Row', 'Grid', 'Text', 'Image', 'Vector', 'Link', 'Group', 'Embed', 'Shape', 'Icon', 'Connector', 'Table', 'Notes'] as const;
type KnownRole = (typeof ROLES)[number];
const isKnownRole = (r: string): r is KnownRole => (ROLES as readonly string[]).includes(r);

export function Rows({
  file,
  layers,
  depth,
  open,
  toggle,
  away,
}: {
  file: string;
  layers: Layer[];
  depth: number;
  open: Set<number>;
  toggle: (t: number) => void;
  /** motion: elements not on screen at the playhead, with when they are */
  away?: Map<number, string>;
}) {
  const sel = useStore((s) => (s.selection?.kind === 'el' && s.selection.file === file ? s.selection.tid : null));
  const scene = useStore((s) => s.kind === 'motion');
  const { t } = useTranslation();
  return (
    <>
      {layers.map((l) => (
        <div key={l.tid}>
          <div
            className={`lr${away?.has(l.tid) ? ' away' : ''}`}
            role="treeitem"
            aria-selected={sel === l.tid}
            aria-expanded={l.children.length ? open.has(l.tid) : undefined}
            data-key={`${file}#${l.tid}`}
            style={{ paddingLeft: 6 + depth * 14 }}
            onClick={() => useStore.setState({ selection: { kind: 'el', file, tid: l.tid } })}
            onMouseEnter={() => useStore.setState({ layerHover: { file, tid: l.tid } })}
            onMouseLeave={() => useStore.setState({ layerHover: null })}
          >
            {l.children.length ? (
              <button className="tw" aria-label={open.has(l.tid) ? t('slides.layers.collapse') : t('slides.layers.expand')} onClick={(e) => (e.stopPropagation(), toggle(l.tid))}>
                <Chevron open={open.has(l.tid)} />
              </button>
            ) : (
              <span className="tw" />
            )}
            <span className="ri">
              <RoleIcon role={l.role === 'Slide' ? 'Artboard' : l.role === 'Notes' ? 'Note' : l.role === 'Connector' ? 'Arrow' : l.role} />
            </span>
            <span className="rn">{scene && l.role === 'Slide' ? t('slides.role.Scene') : isKnownRole(l.role) ? t(`slides.role.${l.role}`) : l.role}</span>
            {l.label && <span className="rl">“{l.label}”</span>}
            {away?.has(l.tid) && <span className="rt">{away.get(l.tid)}</span>}
          </div>
          {open.has(l.tid) && l.children.length > 0 && <Rows file={file} layers={l.children} depth={depth + 1} open={open} toggle={toggle} away={away} />}
        </div>
      ))}
    </>
  );
}

/** The current slide's layers (the deck's other slides live in the strip). */
export function SlideLayers({ file: scene, away }: { file?: string; away?: Map<number, string> } = {}) {
  const slide = useStore((s) => s.slide);
  const id = scene ?? slide;
  const file = scene ?? (id ? slideFile(id) : '');
  const source = useStore((s) => (file ? display(s, file) : undefined));
  const sel = useStore((s) => s.selection);
  const layers = useMemo(() => (source ? layerTree(parsed(source)) : []), [source]);
  const [manual, setManual] = useState<Set<number>>(() => new Set());
  // everything above the selection is open
  const open = useMemo(() => {
    const o = new Set(manual);
    const doc = source ? parsed(source) : null;
    if (doc) {
      const root = rootElement(doc);
      if (root) o.add(root.tid);
      if (sel?.kind === 'el' && sel.file === file) for (let p = doc.elements[sel.tid]?.parent; p; p = p.parent) o.add(p.tid);
    }
    return o;
  }, [manual, source, sel, file]);
  const toggle = (tid: number) =>
    setManual((m) => {
      const n = new Set(m);
      if (open.has(tid)) n.delete(tid);
      else n.add(tid);
      return n;
    });
  const { t } = useTranslation();
  if (!id) return <div className="layers" />;
  return (
    <div className="layers" role="tree" aria-label={t('slides.layers.label')}>
      <Rows file={file} layers={layers} depth={0} open={open} toggle={toggle} away={away} />
    </div>
  );
}


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
