import { useMemo, useState } from 'react';
import { ShortcutLine } from '../Shortcuts';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  AUTO_START_MS,
  AUTO_STAGGER_MS,
  KEY_PROPS,
  MAX_SPEED,
  MIN_SPEED,
  MOTION_PRESETS,
  TRANSITION_KINDS,
  animDefaults,
  attr,
  attrsForFormat,
  checkScene,
  easingOf,
  easingTokenOf,
  formatNameOf,
  formatTime,
  getStyle,
  halfFrameMs,
  newTrack,
  primaryFormat,
  parseStyle,
  parseTime,
  rootElement,
  sceneIdOf,
  sceneVisibility,
  speedOf,
  sizeName,
  styleInFormat,
  trackValueAt,
  withKeyAt,
  type AnimSpec,
  type DcDoc,
  type DcElement,
  type KeyProp,
} from '@dc/core';
import { display, editElement, parsed, recordChange, toast, useStore } from '../../store';
import { addFormat, editMotion, setSpeed, motionOf, removeFormat, setFormatSize, setKeys, setTiming, timingOf } from './motion';
import { useLanes } from './ElementLanes';
import { ColorField, Field, Row, Select } from '../panel/fields';
import { SizePicker } from './SizePicker';
import { rememberSize, sameSize, type Size } from './motionSizes';
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
  const [speedKey, setSpeedKey] = useState(0);
  const [picked, setPicked] = useState<Size | null>(null);
  const { t } = useTranslation();
  const num = (v: string) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : NaN);
  const taken = !!picked && names.some((n) => sameSize(m.formats[n].size, picked));
  const add = (size: Size) => {
    const base = formatNameOf(size);
    const name = m.formats[base] ? sizeName(size) : base;
    const from = m.formats[primaryFormat(m)]?.size;
    if (addFormat(name, size)) {
      if (from) recordChange({ type: 'format', format: name, from, to: size });
      rememberSize(size, true);
      setAdding(false);
      setPicked(null);
      const view = useStore.getState().motionView;
      if (view) useStore.setState({ motionView: { ...view, format: name } });
    }
  };
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
      <Row label={t('motion.motionProps.speed')} title={t('motion.motionProps.speedHint', { min: MIN_SPEED, max: MAX_SPEED })}>
        <Field
          key={speedKey}
          value={String(speedOf(m.speed))}
          unit="×"
          step={0.25}
          label={t('motion.motionProps.speed')}
          onCommit={(v) => {
            // a refused value goes back to the one that stands
            if (v.trim() && !setSpeed(Number(v.trim().replace(/×$/, '')))) setSpeedKey((k) => k + 1);
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
                onClick={() => removeFormat(name)}
              >
                ×
              </button>
            ) : (
              <button className="ib" aria-disabled="true" aria-label={t('motion.motionProps.keepPrimary')} title={t('motion.motionProps.keepPrimary')} onClick={() => toast(t('motion.motionProps.keepPrimary'))}>
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      {adding ? (
        <div className="maddfmt">
          <SizePicker value={picked} onChange={setPicked} />
          <div className="maddfmt-actions">
            <button className="btn primary sm" disabled={!picked || taken} onClick={() => picked && add(picked)}>
              {picked ? t('motion.motionProps.addSize', { size: `${picked[0]}×${picked[1]}` }) : t('common.add')}
            </button>
            <button className="btn ghost sm" onClick={() => setAdding(false)}>
              {t('common.cancel')}
            </button>
            {taken && <span className="hint">{t('motion.motionProps.sizeTaken')}</span>}
          </div>
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
      <ShortcutLine kind="motion" />
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

const EASES = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'smooth', 'snap', 'spring'];

/** The value an element has for a keyframe prop before any track: its style, or the neutral default. */
function keyValueNow(raw: Record<string, string>, fmt: string, prop: KeyProp): number {
  if (prop === 'opacity') {
    const v = parseFloat(getStyle(styleInFormat(raw, fmt), 'opacity') ?? '');
    return Number.isFinite(v) ? v : 1;
  }
  if (prop === 'scale') {
    const v = parseFloat((getStyle(styleInFormat(raw, fmt), 'scale') ?? '').replace(/^([\d.]+).*/, '$1'));
    return Number.isFinite(v) ? v : 1;
  }
  return 0;
}

/**
 * The “Animation” section: the element's entrance and exit as plain numbers
 * (preset, length, @start, easing), and its keyframe tracks — the value at
 * the playhead, a ◇ to start a track there, × to drop one (`.design/
 * motion-editing.md` §3.5). Timing is always shared by every size.
 */
export function AnimRow({ file, el }: { file: string; el: DcElement }) {
  const view = useStore((s) => s.motionView);
  const m = useMotion();
  const { t } = useTranslation();
  const formats = Object.keys(m.formats);
  const fmt = view?.format ?? primaryFormat(m);
  const raw = Object.fromEntries(el.attrs.map((a) => [a.name, a.value]));
  const merged = attrsForFormat(raw, fmt, formats) ?? raw;
  const shown = timingOf(merged, null);
  const nameOf = (kind: 'in' | 'out') => (fmt !== formats[0] && raw[`data-${kind}-${fmt}`] !== undefined ? `data-${kind}-${fmt}` : `data-${kind}`);
  const at = view && !view.landed ? Math.max(0, view.at) : 0;
  const dur = parseTime(merged['data-duration']) ?? 4000;
  const tol = halfFrameMs(m.fps);
  const lane = useLanes(m, fmt, sceneIdOf(file)).find((l) => l.tid === el.tid);
  const put = (part: { inSpec?: AnimSpec | null; outSpec?: AnimSpec | null }) => setTiming(file, el.tid, { ...part, inName: nameOf('in'), outName: nameOf('out') });
  const secs = (ms: number) => String(+(ms / 1000).toFixed(2));
  const easingRow = (dir: 'in' | 'out', spec: AnimSpec) => (
    <Select
      narrow
      value={easingTokenOf(spec.easing)}
      options={[...EASES, ...(!EASES.includes(easingTokenOf(spec.easing)) ? [easingTokenOf(spec.easing)] : [])].map((e) => ({ value: e, label: e }))}
      onChange={(v) => {
        const css = easingOf(v);
        if (css) put(dir === 'in' ? { inSpec: { ...spec, easing: css } } : { outSpec: { ...spec, easing: css } });
      }}
      label={t('motion.anim.easing')}
    />
  );
  const lengthRow = (dir: 'in' | 'out', spec: AnimSpec) => (
    <Field
      value={String(spec.duration)}
      unit="ms"
      label={t('motion.anim.length')}
      onCommit={(v) => {
        const n = Math.round(Number(v));
        if (Number.isFinite(n) && n >= 50 && n <= 600_000) put(dir === 'in' ? { inSpec: { ...spec, duration: n } } : { outSpec: { ...spec, duration: n } });
      }}
    />
  );
  const startRow = (dir: 'in' | 'out', spec: AnimSpec) => {
    const auto = spec.start ?? (dir === 'in' ? (lane?.inStart ?? AUTO_START_MS) : (lane?.outStart ?? Math.max(0, dur - spec.duration)));
    return (
      <Field
        value={spec.start != null ? secs(spec.start) : ''}
        placeholder={secs(auto)}
        unit="s"
        label={t('motion.anim.start')}
        onCommit={(v) => {
          const n = Math.round(Number(v) * 1000);
          if (Number.isFinite(n) && n >= 0) put(dir === 'in' ? { inSpec: { ...spec, start: Math.min(n, dur) } } : { outSpec: { ...spec, start: Math.min(n, dur) } });
        }}
      />
    );
  };
  const presetRow = (dir: 'in' | 'out', spec: AnimSpec | null) => (
    <Select
      value={spec?.preset ?? ''}
      options={[{ value: '', label: t('motion.anim.none') }, ...MOTION_PRESETS.map((p) => ({ value: p, label: p }))]}
      onChange={(v) => {
        if (!v) return put(dir === 'in' ? { inSpec: null } : { outSpec: null });
        const d = animDefaults(v as AnimSpec['preset'], dir);
        const next: AnimSpec = { preset: v as AnimSpec['preset'], duration: d.duration, start: spec?.start ?? null, easing: d.easing };
        put(dir === 'in' ? { inSpec: next } : { outSpec: next });
      }}
      label={dir === 'in' ? t('motion.anim.enter') : t('motion.anim.leave')}
    />
  );
  return (
    <div className="sec manim">
      <h3>{t('motion.anim.heading')}</h3>
      <Row label={t('motion.anim.enter')}>{presetRow('in', shown.inSpec)}</Row>
      {shown.inSpec && (
        <>
          <Row label="">
            {lengthRow('in', shown.inSpec)}
            {easingRow('in', shown.inSpec)}
          </Row>
          <Row label={t('motion.anim.start')} title={shown.inSpec.start == null ? t('motion.anim.autoStart', { time: secs(lane?.inStart ?? AUTO_START_MS) }) : undefined}>
            {startRow('in', shown.inSpec)}
          </Row>
        </>
      )}
      <Row label={t('motion.anim.leave')}>
        {shown.outSpec ? (
          presetRow('out', shown.outSpec)
        ) : (
          <button className="btn outline sm" title={t('motion.anim.addLeaveHint')} onClick={() => put({ outSpec: { preset: 'fade', duration: 500, start: null, easing: 'ease-in' } })}>
            {t('motion.anim.addLeave')}
          </button>
        )}
      </Row>
      {shown.outSpec && (
        <>
          <Row label="">
            {lengthRow('out', shown.outSpec)}
            {easingRow('out', shown.outSpec)}
          </Row>
          <Row label={t('motion.anim.start')} title={shown.outSpec.start == null ? t('motion.anim.autoStart', { time: secs(lane?.outStart ?? Math.max(0, dur - shown.outSpec.duration)) }) : undefined}>
            {startRow('out', shown.outSpec)}
          </Row>
        </>
      )}
      {shown.tracks.map((tr) => (
        <Row
          key={tr.prop}
          label={
            <span className="mtrack">
              <i className="mdia" aria-hidden />
              {tr.prop}
            </span>
          }
          title={t('motion.anim.trackAt', { prop: tr.prop })}
        >
          <Field
            value={String(+trackValueAt(tr.keys, at).toFixed(2))}
            label={t('motion.anim.trackAt', { prop: tr.prop })}
            onCommit={(v) => {
              const n = Number(v);
              if (Number.isFinite(n)) setKeys(file, el.tid, withKeyAt(shown.tracks, tr.prop, at, n, tol));
            }}
          />
          <span className="hint">{t('motion.anim.frames', { count: tr.keys.length })}</span>
          <button className="ib" aria-label={t('motion.anim.trackDrop', { prop: tr.prop })} title={t('motion.anim.trackDrop', { prop: tr.prop })} onClick={() => setKeys(file, el.tid, shown.tracks.filter((x) => x.prop !== tr.prop))}>
            ×
          </button>
        </Row>
      ))}
      {KEY_PROPS.some((p) => !shown.tracks.some((x) => x.prop === p)) && (
        <Row label={t('motion.anim.keys')} title={t('motion.anim.trackAdd', { prop: KEY_PROPS.find((p) => !shown.tracks.some((x) => x.prop === p))! })}>
          <div className="maddtrack">
            {KEY_PROPS.filter((p) => !shown.tracks.some((x) => x.prop === p)).map((p) => (
              <button
                key={p}
                className="ib"
                aria-label={t('motion.anim.trackAdd', { prop: p })}
                title={t('motion.anim.trackAdd', { prop: p })}
                onClick={() => {
                  const v = keyValueNow(raw, fmt, p);
                  setKeys(file, el.tid, [...shown.tracks, newTrack(p, at, v, v)]);
                }}
              >
                ◇ {p}
              </button>
            ))}
          </div>
        </Row>
      )}
      <p className="hint" style={{ margin: 0 }}>
        {t('motion.anim.hint')}
      </p>
    </div>
  );
}
