import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AUTO_START_MS,
  AUTO_STAGGER_MS,
  attrsForFormat,
  halfFrameMs,
  layerTree,
  parseTime,
  sceneFile,
  withKeyTime,
  type AnimSpec,
  type DcElement,
  type KeyTrack,
  type Layer,
  type MotionJson,
} from '@dc/core';
import { display, parsed, useStore } from '../../store';
import { motionOf, setKeys, setTiming, timingOf, type ElementTiming } from './motion';

const LANE_H = 22;
const KEY_H = 18;

/** One animated element of the scene under the playhead: its bar, and its keyframe tracks. */
export interface Lane {
  tid: number;
  label: string;
  timing: ElementTiming;
  /** Scene-relative authored ms: where the bar runs and its segments sit. */
  from: number;
  to: number;
  inStart: number;
  inEnd: number;
  outStart: number;
  autoIn: boolean;
  autoOut: boolean;
}

function within(el: DcElement, root: DcElement): boolean {
  for (let p = el.parent; p; p = p.parent) if (p === root) return true;
  return false;
}

/** The animated elements of one scene, in source order, with their bars on the scene's clock. */
export function useLanes(motion: MotionJson, fmt: string, sceneId: string | null): Lane[] {
  const fid = sceneId ? sceneFile(sceneId) : '';
  const source = useStore((s) => (fid ? display(s, fid) : undefined));
  const formats = Object.keys(motion.formats);
  return useMemo(() => {
    if (!source || !fid) return [];
    const doc = parsed(source);
    const section = doc.elements.find((e) => e.tag === 'section' && !e.parent);
    if (!section) return [];
    const names = new Map<number, string>();
    const walk = (ls: Layer[]) => {
      for (const l of ls) {
        names.set(l.tid, l.label || l.role);
        walk(l.children);
      }
    };
    walk(layerTree(doc));
    const lanes: Lane[] = [];
    let auto = 0;
    const duration = parseTime(Object.fromEntries(section.attrs.map((a) => [a.name, a.value]))['data-duration']) ?? 4000;
    for (const el of doc.elements) {
      if (el !== section && !within(el, section)) continue;
      const raw = Object.fromEntries(el.attrs.map((a) => [a.name, a.value]));
      const merged = attrsForFormat(raw, fmt, formats);
      if (!merged) continue;
      const shown = timingOf(merged, null);
      if (!shown.inSpec && !shown.outSpec && !shown.tracks.length) continue;
      // write back to a format's own attribute only where the element already has one
      const pick = (kind: 'in' | 'out') => (fmt !== formats[0] && raw[`data-${kind}-${fmt}`] !== undefined ? `data-${kind}-${fmt}` : `data-${kind}`);
      let inStart = 0;
      let autoIn = false;
      if (shown.inSpec) {
        if (shown.inSpec.start == null) {
          inStart = AUTO_START_MS + AUTO_STAGGER_MS * auto++;
          autoIn = true;
        } else inStart = shown.inSpec.start;
      }
      const inEnd = shown.inSpec ? inStart + shown.inSpec.duration : 0;
      let outStart = duration;
      let autoOut = false;
      if (shown.outSpec) {
        if (shown.outSpec.start == null) {
          outStart = Math.max(0, duration - shown.outSpec.duration);
          autoOut = true;
        } else outStart = shown.outSpec.start;
      }
      lanes.push({
        tid: el.tid,
        label: names.get(el.tid) ?? el.tag,
        timing: { ...shown, inName: pick('in'), outName: pick('out') },
        from: inStart,
        to: shown.outSpec ? outStart + shown.outSpec.duration : duration,
        inStart,
        inEnd,
        outStart,
        autoIn,
        autoOut,
      });
    }
    return lanes;
  }, [source, fid, fmt, formats, motion.formats]);
}

/** A dragged time, snapped to the nearest candidate (the 0.1 s grid when none is near); Alt drags free. */
function snapMs(t: number, candidates: number[], tolMs: number, free: boolean): number {
  if (!Number.isFinite(t)) return 0;
  if (!free) {
    let best = NaN;
    for (const c of candidates) if (Math.abs(c - t) <= tolMs && (Number.isNaN(best) || Math.abs(c - t) < Math.abs(best - t))) best = c;
    if (!Number.isNaN(best)) return Math.max(0, best);
  }
  return Math.max(0, Math.round(t / 100) * 100);
}

const laneSecs = (ms: number) => `${(Math.round(ms) / 1000).toFixed(1)} s`;

export interface BarDraft {
  tid: number;
  inSpec: AnimSpec | null;
  outSpec: AnimSpec | null;
  autoIn: boolean;
  autoOut: boolean;
}

type DragKind = 'shift' | 'in-start' | 'in-dur' | 'out-start' | 'out-dur';

/**
 * One row per animated element under the scene blocks: the bar runs from the
 * entrance to the exit (`.design/motion-editing.md` §3.5). The middle slides
 * both starts, the head's edges move or stretch the entrance, the tail's the
 * exit. ▸ opens the element's keyframe tracks; a diamond drags along the axis.
 */
export function LaneRows(p: {
  motion: MotionJson;
  lanes: Lane[];
  file: string;
  sceneStart: number;
  sceneDur: number;
  axisMs: number;
  perMs: number;
  /** The playhead within the scene (authored ms). */
  playAt: number;
  open: number | null;
  setOpen: (tid: number | null) => void;
  draft: BarDraft | null;
  keyDraft: { tid: number; prop: string; index: number; t: number } | null;
  onDrag: (d: BarDraft | null) => void;
  onKeyDrag: (d: { tid: number; prop: string; index: number; t: number } | null) => void;
  axisRect: () => DOMRect | null;
  seekScene: (ms: number) => void;
}) {
  const { t } = useTranslation();
  const { lanes, file, sceneStart, sceneDur, axisMs, perMs, playAt, open, setOpen, draft, keyDraft, onDrag, onKeyDrag } = p;
  const sel = useStore((s) => s.selection);
  const [snapAt, setSnapAt] = useState<number | null>(null);
  const tol = halfFrameMs(p.motion.fps);
  const pct = (ms: number) => `${(ms / axisMs) * 100}%`;
  const select = (l: Lane) => {
    useStore.setState({ selection: { kind: 'el', file, tid: l.tid } });
    // picking what cannot be seen goes to the moment it has settled (§3.3)
    if (playAt < l.from || playAt > l.to) p.seekScene(Math.min(l.inEnd, l.to - 1));
  };
  const geomOf = (l: Lane) => {
    const d = draft && draft.tid === l.tid ? draft : null;
    const inSpec = d ? d.inSpec : l.timing.inSpec;
    const outSpec = d ? d.outSpec : l.timing.outSpec;
    const inStart = inSpec ? (inSpec.start ?? l.inStart) : 0;
    const inEnd = inSpec ? inStart + inSpec.duration : 0;
    const outStart = outSpec ? (outSpec.start ?? l.outStart) : sceneDur;
    const outEnd = outSpec ? outStart + outSpec.duration : sceneDur;
    return { inSpec, outSpec, inStart, inEnd, outStart, outEnd, autoIn: inSpec ? inSpec.start == null && (d ? d.autoIn : l.autoIn) : false, autoOut: outSpec ? outSpec.start == null && (d ? d.autoOut : l.autoOut) : false };
  };

  const dragBar = (e: React.PointerEvent, l: Lane, kind: DragKind) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = p.axisRect();
    if (!rect) return;
    const x0 = e.clientX;
    const at = (x: number) => (x - rect.left) / perMs - sceneStart;
    const t0 = at(x0);
    let free = e.altKey;
    const dIn: AnimSpec | null = l.timing.inSpec ? { ...l.timing.inSpec } : null;
    const dOut: AnimSpec | null = l.timing.outSpec ? { ...l.timing.outSpec } : null;
    let autoIn = l.autoIn;
    let autoOut = l.autoOut;
    // a drag writes an automatic start down as the real @time it stood for
    if (dIn && dIn.start == null && (kind === 'shift' || kind === 'in-start')) (dIn.start = l.inStart), (autoIn = false);
    if (dOut && dOut.start == null && (kind === 'shift' || kind === 'out-start')) (dOut.start = l.outStart), (autoOut = false);
    const anchor = kind === 'shift' ? (l.timing.inSpec ? l.inStart : l.outStart) : 0;
    const cands = () => [0, sceneDur, playAt, ...lanes.filter((x) => x !== l).flatMap((x) => [x.inStart, x.inEnd, x.outStart])];
    const move = (ev: PointerEvent) => {
      free = free || ev.altKey;
      const t = at(ev.clientX);
      if (kind === 'shift') {
        const to = snapMs(anchor + (t - t0), cands(), perMs * 7, free);
        const dt = to - anchor;
        if (dIn) dIn.start = Math.max(0, Math.round(l.inStart + dt));
        if (dOut) dOut.start = Math.max(0, Math.round(l.outStart + dt));
        setSnapAt(to);
      } else if (kind === 'in-start' && dIn) {
        const to = snapMs(t, cands(), perMs * 7, free);
        dIn.start = Math.min(Math.max(0, to), Math.max(0, sceneDur - dIn.duration));
        setSnapAt(dIn.start);
      } else if (kind === 'in-dur' && dIn) {
        dIn.duration = Math.min(Math.max(50, snapMs(t, cands(), perMs * 7, free) - (dIn.start ?? l.inStart)), sceneDur - (dIn.start ?? 0));
        setSnapAt((dIn.start ?? l.inStart) + dIn.duration);
      } else if (kind === 'out-start' && dOut) {
        const to = snapMs(t, cands(), perMs * 7, free);
        dOut.start = Math.min(Math.max(dIn ? l.inEnd : 0, to), Math.max(0, sceneDur - 50));
        setSnapAt(dOut.start);
      } else if (kind === 'out-dur' && dOut) {
        dOut.duration = Math.min(Math.max(50, snapMs(t, cands(), perMs * 7, free) - (dOut.start ?? l.outStart)), 600_000);
        setSnapAt((dOut.start ?? l.outStart) + dOut.duration);
      }
      onDrag({ tid: l.tid, inSpec: dIn, outSpec: dOut, autoIn, autoOut });
    };
    const end = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key, true);
      setSnapAt(null);
      onDrag(null);
      if (commit) {
        const changed = (a: AnimSpec | null, b: AnimSpec | null) => JSON.stringify(a) !== JSON.stringify(b);
        setTiming(file, l.tid, {
          ...(dIn && changed(dIn, l.timing.inSpec) ? { inSpec: dIn } : {}),
          ...(dOut && changed(dOut, l.timing.outSpec) ? { outSpec: dOut } : {}),
          inName: l.timing.inName,
          outName: l.timing.outName,
        });
      }
    };
    const up = () => end(true);
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      end(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key, true);
  };

  const dragKey = (e: React.PointerEvent, l: Lane, prop: string, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = p.axisRect();
    if (!rect) return;
    const track = l.timing.tracks.find((x) => x.prop === prop);
    if (!track) return;
    const at = (x: number) => (x - rect.left) / perMs - sceneStart;
    const latest = { current: at(e.clientX) };
    const move = (ev: PointerEvent) => {
      latest.current = at(ev.clientX);
      onKeyDrag({ tid: l.tid, prop, index, t: latest.current });
    };
    const end = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key, true);
      onKeyDrag(null);
      if (commit) setKeys(file, l.tid, withKeyTime(l.timing.tracks, prop as KeyTrack['prop'], index, latest.current));
    };
    const up = () => end(true);
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      end(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key, true);
  };

  return (
    <div className="mlanerows">
      {lanes.map((l) => {
        const g = geomOf(l);
        const on = sel?.kind === 'el' && sel.file === file && sel.tid === l.tid;
        const span = Math.max(1, g.outEnd - g.inStart);
        const keyTime = (tr: KeyTrack, i: number) => (keyDraft && keyDraft.tid === l.tid && keyDraft.prop === tr.prop && keyDraft.index === i ? keyDraft.t : tr.keys[i].t);
        return (
          <Fragment key={l.tid}>
            <div className={`mlane${on ? ' sel' : ''}${playAt < l.from || playAt > l.to ? ' off' : ''}`} style={{ height: LANE_H }}>
              <div
                className="mlanebar"
                role="button"
                tabIndex={0}
                aria-label={t('motion.stage.laneRow', { name: l.label, from: laneSecs(g.inStart), to: laneSecs(g.outEnd) })}
                title={t('motion.stage.laneHint')}
                style={{ left: pct(sceneStart + g.inStart), width: pct(g.outEnd - g.inStart) }}
                onClick={() => select(l)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), select(l))}
                onPointerDown={(e) => dragBar(e, l, 'shift')}
              >
                {g.inSpec && (
                  <span className={`mseg in${g.autoIn ? ' auto' : ''}`} style={{ width: `${((g.inEnd - g.inStart) / span) * 100}%` }}>
                    <i className="medge l" aria-hidden onPointerDown={(e) => dragBar(e, l, 'in-start')} />
                    <i className="medge r" aria-hidden onPointerDown={(e) => dragBar(e, l, 'in-dur')} />
                    <b>{g.inSpec.preset}</b>
                  </span>
                )}
                {g.outSpec && (
                  <span className={`mseg out${g.autoOut ? ' auto' : ''}`} style={{ width: `${((g.outEnd - g.outStart) / span) * 100}%` }}>
                    <i className="medge l" aria-hidden onPointerDown={(e) => dragBar(e, l, 'out-start')} />
                    <i className="medge r" aria-hidden onPointerDown={(e) => dragBar(e, l, 'out-dur')} />
                    <b>{g.outSpec.preset}</b>
                  </span>
                )}
                {g.autoIn && <i className="mauto" aria-hidden />}
              </div>
            </div>
            {open === l.tid &&
              l.timing.tracks.map((tr) => (
                <div className="mlane-keyrow" style={{ height: KEY_H }} key={tr.prop}>
                  {tr.keys.map((k, i) => (
                    <button
                      key={i}
                      role="slider"
                      className="mkey"
                      tabIndex={0}
                      aria-label={t('motion.stage.keyAt', { prop: tr.prop, time: laneSecs(keyTime(tr, i)) })}
                      aria-valuemin={0}
                      aria-valuemax={Math.round(sceneDur)}
                      aria-valuenow={Math.round(keyTime(tr, i))}
                      aria-valuetext={t('motion.stage.keyAt', { prop: tr.prop, time: laneSecs(keyTime(tr, i)) })}
                      title={t('motion.stage.keyAt', { prop: tr.prop, time: laneSecs(keyTime(tr, i)) })}
                      style={{ left: pct(sceneStart + keyTime(tr, i)) }}
                      onPointerDown={(e) => dragKey(e, l, tr.prop, i)}
                      onKeyDown={(e) => {
                        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                        e.preventDefault();
                        e.stopPropagation();
                        setKeys(file, l.tid, withKeyTime(l.timing.tracks, tr.prop, i, keyTime(tr, i) + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 100 : 10)));
                      }}
                    />
                  ))}
                </div>
              ))}
          </Fragment>
        );
      })}
      {snapAt !== null && <i className="msnapline" aria-hidden style={{ left: pct(sceneStart + snapAt), height: lanes.length * LANE_H }} />}
    </div>
  );
}

/** The labels that stand left of the rows, in the cover's column. */
export function LaneLabels(p: { lanes: Lane[]; open: number | null; setOpen: (tid: number | null) => void }) {
  const { t } = useTranslation();
  return (
    <>
      {p.lanes.map((l) => (
        <Fragment key={l.tid}>
          <div className="mlanelabel" style={{ height: LANE_H }} title={t('motion.stage.laneRow', { name: l.label, from: laneSecs(l.from), to: laneSecs(l.to) })}>
            {l.timing.tracks.length > 0 && (
              <button
                className="ib sm mchev"
                aria-expanded={p.open === l.tid}
                aria-label={t('motion.stage.laneTracks', { name: l.label })}
                title={t('motion.stage.laneTracks', { name: l.label })}
                onClick={() => p.setOpen(p.open === l.tid ? null : l.tid)}
              >
                <i />
              </button>
            )}
            <span className="mlanelabel-text">{l.label}</span>
          </div>
          {p.open === l.tid &&
            l.timing.tracks.map((tr) => (
              <div className="mlanekeylabel" style={{ height: KEY_H }} key={tr.prop}>
                {tr.prop}
              </div>
            ))}
        </Fragment>
      ))}
    </>
  );
}
