import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  TRANSITION_KINDS,
  attr,
  checkScene,
  formatTime,
  getStyle,
  parseStyle,
  parseTime,
  rootElement,
  sceneIdOf,
  sceneVisibility,
  type DcDoc,
  type DcElement,
} from '@dc/core';
import { display, editElement, parsed, useStore } from '../../store';
import { FORMAT_PRESETS, addFormat, editMotion, motionOf, overridesOf, removeFormat, setFormatSize } from './motion';
import { ColorField, Field, Row, Select } from '../panel/fields';
import { ElementLayers } from '../panel/LayerTree';


function useMotion() {
  const text = useStore((s) => display(s, 'motion.json'));
  return useMemo(() => motionOf(useStore.getState()), [text]); // eslint-disable-line react-hooks/exhaustive-deps
}

const sizeLabel = (size: [number, number]) => `${size[0]}×${size[1]}`;

/**
 * Elements of a scene that are off screen at a time, with when they are on
 * (an element is off while any of its ancestors is).
 */
/** What is off screen at `at` ms into the scene; `null` is the landed first moment, where only other formats' elements are away. */
export function awayAt(doc: DcDoc, format: string, formats: string[], at: number | null, t: TFunction): Map<number, string> {
  const { windows } = sceneVisibility(doc, format, formats);
  const out = new Map<number, string>();
  for (const el of doc.elements) {
    let from = 0;
    let to = Infinity;
    let known = false;
    for (let p: DcElement | null = el; p; p = p.parent) {
      const w = windows.get(p.tid);
      if (!w) continue;
      known = true;
      from = Math.max(from, w.from);
      to = Math.min(to, w.to);
    }
    if (!known) {
      // not drawn in this format at all
      if (attr(el, 'data-only') !== undefined || el.parent) out.set(el.tid, t('motion.away.notInFormat', { format }));
      continue;
    }
    if (at === null) continue;
    if (at < from) out.set(el.tid, t('motion.away.entersAt', { time: formatTime(Math.round(from)) }));
    else if (at > to) out.set(el.tid, t('motion.away.leftAt', { time: formatTime(Math.round(to)) }));
  }
  return out;
}

/** Where a style change lands, and what this format already sets on its own. */
export function FormatNote({ file, el }: { file: string; el: DcElement }) {
  const view = useStore((s) => s.motionView);
  const m = useMotion();
  const { t } = useTranslation();
  if (!view) return null;
  const formats = Object.keys(m.formats);
  if (formats.length < 2) return null;
  const own = view.format !== view.primary;
  const name = `data-${view.format}`;
  const over = parseStyle(attr(el, name) ?? '').filter((d) => d.prop);
  const drop = (prop: string | null) => {
    const left = prop === null ? [] : over.filter((d) => d.prop !== prop);
    editElement(file, [{ kind: 'attr', tid: el.tid, name, value: left.length ? left.map((d) => `${d.prop}:${d.value}`).join(';') : null }]);
  };
  return (
    <div className="sec mfmt">
      <div className="mfmt-where">
        {t('motion.formatNote.writesTo')}
        <b>{own ? t('motion.formatNote.onlyFormat', { format: view.format, size: sizeLabel(m.formats[view.format].size) }) : t('motion.formatNote.allFormats')}</b>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        {own
          ? t('motion.formatNote.ownHint')
          : t('motion.formatNote.sharedHint', { formats: formats.filter((f) => f !== view.primary).join(t('motion.formatNote.listSeparator')) })}
      </p>
      {own && over.length > 0 && (
        <div className="mover">
          <span className="hint">{t('motion.formatNote.overrides')}</span>
          {over.map((d) => (
            <button key={d.prop} className="chip" title={t('motion.formatNote.overrideHint', { prop: d.prop, value: d.value })} onClick={() => drop(d.prop)}>
              {d.prop} ×
            </button>
          ))}
          <button className="btn ghost" onClick={() => drop(null)}>
            {t('motion.formatNote.dropAll')}
          </button>
        </div>
      )}
    </div>
  );
}

/** The scene itself selected: its look, length, how it leaves, and its checks. */
export function SceneProps({ file }: { file: string }) {
  const id = sceneIdOf(file) ?? '';
  const source = useStore((s) => display(s, file));
  const doc = source ? parsed(source) : null;
  const root = doc ? rootElement(doc) : undefined;
  const issues = useMemo(() => (doc ? checkScene(doc, id).filter((i) => i.level !== 'note') : []), [doc, id]);
  const { t } = useTranslation();
  if (!root) return <div className="empty">{t('motion.sceneProps.empty')}</div>;
  const style = attr(root, 'style') ?? '';
  const set = (prop: string, value: string | null) => editElement(file, [{ kind: 'style', tid: root.tid, prop, value }]);
  const setAttr = (name: string, value: string | null) => editElement(file, [{ kind: 'attr', tid: root.tid, name, value }]);
  const tr = (attr(root, 'data-transition') ?? '').trim().split(/\s+/);
  const trKind = tr[0] || 'cut';
  const trMs = tr[1] ?? '';
  return (
    <div className="sec">
      <h3>{t('motion.sceneProps.heading')}</h3>
      <Row label={t('motion.sceneProps.id')}>
        <code className="hint">{id}</code>
      </Row>
      <Row label={t('motion.sceneProps.duration')} title={t('motion.sceneProps.durationHint')}>
        <Field
          value={attr(root, 'data-duration') ?? ''}
          placeholder="4s"
          numeric={false}
          label={t('motion.sceneProps.durationLabel')}
          onCommit={(v) => {
            const d = v.trim();
            if (!d) return setAttr('data-duration', null);
            const ms = parseTime(/^\d+(\.\d+)?$/.test(d) ? `${d}s` : d);
            if (ms !== null && ms > 0) setAttr('data-duration', formatTime(ms));
          }}
        />
      </Row>
      <Row label={t('motion.sceneProps.leaving')}>
        <Select
          value={trKind}
          options={TRANSITION_KINDS.map((k) => ({ value: k, label: t(`motion.transition.${k}`) }))}
          onChange={(v) => setAttr('data-transition', v === 'cut' ? null : `${v}${trMs ? ' ' + trMs : ''}`)}
          label={t('motion.sceneProps.transition')}
        />
      </Row>
      {trKind !== 'cut' && (
        <Row label={t('motion.sceneProps.transitionDuration')}>
          <Field
            value={trMs}
            placeholder="500ms"
            numeric={false}
            label={t('motion.sceneProps.transitionDuration')}
            onCommit={(v) => {
              const ms = parseTime(/^\d+$/.test(v.trim()) ? `${v.trim()}ms` : v.trim());
              setAttr('data-transition', ms ? `${trKind} ${formatTime(ms)}` : trKind);
            }}
          />
        </Row>
      )}
      <Row label={t('motion.sceneProps.background')}>
        <ColorField value={getStyle(style, 'background') ?? ''} onCommit={(v) => set('background', v || null)} label={t('motion.sceneProps.background')} allowNone={false} />
      </Row>
      <Row label={t('motion.sceneProps.textColor')}>
        <ColorField value={getStyle(style, 'color') ?? ''} onCommit={(v) => set('color', v || null)} label={t('motion.sceneProps.textColor')} />
      </Row>
      <h3>{t('motion.sceneProps.check')}</h3>
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
          {t('motion.sceneProps.valid')}
        </p>
      )}
    </div>
  );
}

/** Nothing selected: the piece itself, with its sizes set by hand. */
export function MotionProps() {
  const m = useMotion();
  const names = Object.keys(m.formats);
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState({ name: '', w: '', h: '' });
  const { t } = useTranslation();
  const num = (v: string) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : NaN);
  const add = (name: string, size: [number, number]) => {
    if (addFormat(name, size)) {
      setAdding(false);
      setCustom({ name: '', w: '', h: '' });
      const view = useStore.getState().motionView;
      if (view) useStore.setState({ motionView: { ...view, format: name } });
    }
  };
  const free = FORMAT_PRESETS.filter((p) => !m.formats[p.name]);
  return (
    <div className="sec">
      <div className="empty" style={{ textAlign: 'center', padding: '8px 0 4px' }}>
        <div style={{ color: 'var(--ink)', fontWeight: 500 }}>{t('motion.motionProps.nothingSelected')}</div>
        {t('motion.motionProps.hint')}
      </div>
      <h3>{t('motion.motionProps.heading')}</h3>
      <Row label={t('motion.motionProps.name')}>
        <Field
          value={m.title}
          numeric={false}
          label={t('motion.motionProps.nameLabel')}
          onCommit={(v) => v.trim() && editMotion((r) => (r.title = v.trim()), t('motion.journal.title', { title: v.trim() }))}
        />
      </Row>
      <Row label={t('motion.motionProps.fps')}>
        <Field
          value={String(m.fps)}
          unit="fps"
          label={t('motion.motionProps.fps')}
          onCommit={(v) => {
            const n = num(v);
            if (n >= 1 && n <= 120) editMotion((r) => (r.fps = n), t('motion.journal.fps', { fps: n }));
          }}
        />
      </Row>
      <h3>{t('motion.motionProps.formats')}</h3>
      <div className="mformats">
        {names.map((name, i) => (
          <div key={name} className="mformat">
            <span className="mfname">
              {name}
              {i === 0 && <span className="faint">{t('motion.motionProps.primary')}</span>}
            </span>
            <Field value={String(m.formats[name].size[0])} pre="W" label={t('motion.motionProps.width', { name })} onCommit={(v) => num(v) > 0 && setFormatSize(name, [num(v), m.formats[name].size[1]])} />
            <Field value={String(m.formats[name].size[1])} pre="H" label={t('motion.motionProps.height', { name })} onCommit={(v) => num(v) > 0 && setFormatSize(name, [m.formats[name].size[0], num(v)])} />
            {i > 0 ? (
              <button
                className="ib"
                aria-label={t('motion.motionProps.removeLabel', { name })}
                title={t('motion.motionProps.removeHint')}
                onClick={() => {
                  const n = overridesOf(name);
                  if (confirm(n ? t('motion.motionProps.confirmRemoveOverrides', { name, count: n }) : t('motion.motionProps.confirmRemove', { name }))) removeFormat(name);
                }}
              >
                ×
              </button>
            ) : (
              <span className="ib" />
            )}
          </div>
        ))}
      </div>
      {adding ? (
        <div className="maddfmt">
          {free.map((p) => (
            <button key={p.name} className="btn outline" title={t(`motion.presetFor.${p.name}`)} onClick={() => add(p.name, p.size)}>
              {t(`motion.preset.${p.name}`)} <span className="faint">{sizeLabel(p.size)}</span>
            </button>
          ))}
          <form
            className="mcustom"
            onSubmit={(e) => {
              e.preventDefault();
              const w = num(custom.w);
              const h = num(custom.h);
              if (w > 0 && h > 0) add(custom.name.trim() || `s${w}x${h}`.replace(/[^a-z0-9]/g, '').slice(0, 16), [w, h]);
            }}
          >
            <input className="input" placeholder={t('motion.motionProps.newName')} value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} onKeyDown={(e) => e.stopPropagation()} aria-label={t('motion.motionProps.newNameLabel')} />
            <input className="input" placeholder={t('motion.motionProps.newWidth')} value={custom.w} onChange={(e) => setCustom({ ...custom, w: e.target.value })} onKeyDown={(e) => e.stopPropagation()} aria-label={t('motion.motionProps.newWidthLabel')} />
            <input className="input" placeholder={t('motion.motionProps.newHeight')} value={custom.h} onChange={(e) => setCustom({ ...custom, h: e.target.value })} onKeyDown={(e) => e.stopPropagation()} aria-label={t('motion.motionProps.newHeightLabel')} />
            <button className="btn outline" type="submit">
              {t('common.add')}
            </button>
          </form>
        </div>
      ) : (
        <button className="btn outline" onClick={() => setAdding(true)}>
          {t('motion.motionProps.addFormat')}
        </button>
      )}
      <p className="hint" style={{ margin: 0 }}>
        {t('motion.motionProps.formatsHint')}
      </p>
      <h3>{t('motion.motionProps.shortcuts')}</h3>
      <p className="hint" style={{ margin: 0 }}>
        {t('motion.motionProps.shortcutList')}
      </p>
    </div>
  );
}

/** The scene under the playhead: its layers, the ones off screen right now faded with when they show. */
export function MotionLayers() {
  const view = useStore((s) => s.motionView);
  const file = view?.scene ? `scenes/${view.scene}.html` : '';
  const source = useStore((s) => (file ? display(s, file) : undefined));
  const m = useMotion();
  const { t } = useTranslation();
  const away = useMemo(
    () => (source && view ? awayAt(parsed(source), view.format, Object.keys(m.formats), view.landed ? null : view.at, t) : new Map<number, string>()),
    [source, view, m, t],
  );
  if (!file) return <div className="layers" />;
  return <ElementLayers file={file} away={away} />;
}
