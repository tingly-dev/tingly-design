import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MOTION_FILE, formatTime, motionTimeline, parseMotion, parseTime, primaryFormat, sceneFile, sceneTiming, snapSceneMs, speedOf, DEFAULT_SCENE_MS } from '@dc/core';
import { api } from '../../api';
import { addCover, motionImport, removeCover, setSceneDuration } from '../../motion';
import { ImportHere } from '../ImportHere';
import { display, isSaving, useStore } from '../../store';
import { ContextMenu, JournalPopover } from '../Overlays';
import { RightPanel } from '../panel/RightPanel';
import { PromptBar } from '../PromptBar';
import { Panel, PauseFilled, PlayFilled } from '../icons';
import { replaceUrl } from '../../host';
import { BASE } from '../../base';
import { motionKeys } from '../../shortcuts';
import { SlideFrame } from '../slides/SlideFrame';
import { MotionFrame, type MotionControl, type MotionInfo } from './MotionFrame';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

const secs = (ms: number) => (ms / 1000).toFixed(1);

/** The motion.json text and every scene file it names, as one key that changes when any of them does. */
function useSources(): { motionText: string; scenes: Record<string, string> } {
  const key = useStore((s) => {
    const text = display(s, MOTION_FILE) ?? '';
    const m = parseMotion(text);
    const ids = [...m.order, ...(m.cover && 'scene' in m.cover ? [m.cover.scene] : [])];
    return JSON.stringify([text, ids.map((id) => [id, display(s, sceneFile(id)) ?? null])]);
  });
  return useMemo(() => {
    const [motionText, pairs] = JSON.parse(key) as [string, [string, string | null][]];
    const scenes: Record<string, string> = {};
    for (const [id, src] of pairs) if (src !== null) scenes[id] = src;
    return { motionText, scenes };
  }, [key]);
}

/** A value that follows `v` once it has stopped changing for `ms`. */
function useSettled<T>(v: T, ms: number): T {
  const [out, setOut] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setOut(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return out;
}

function useBox(): [React.RefObject<HTMLDivElement | null>, { w: number; h: number }] {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box];
}

/**
 * A motion piece: one screen for watching and editing. While it plays, the
 * player draws the whole timeline; paused, the stage is the scene under the
 * playhead, stopped at that time and editable like a slide.
 */
export function MotionApp() {
  const connected = useStore((s) => s.connected);
  const saving = useStore(isSaving);
  const journalOpen = useStore((s) => s.journalOpen);
  const panelOpen = useStore((s) => s.panelOpen);
  const { t } = useTranslation();
  const project = useStore((s) => s.project);
  const base = project ? api.rawBase(project) : '';
  const { motionText, scenes } = useSources();
  const motion = useMemo(() => parseMotion(motionText), [motionText]);
  const playScenes = useMemo(() => Object.fromEntries(motion.order.filter((id) => id in scenes).map((id) => [id, scenes[id]])), [motion, scenes]);
  const formats = Object.keys(motion.formats);
  const primary = primaryFormat(motion);
  const [format, setFormat] = useState(() => {
    const f = new URLSearchParams(location.search).get('f');
    return f && f in motion.formats ? f : primary;
  });
  const viewFormat = useStore((s) => s.motionView?.format);
  const fmt = format in motion.formats ? format : primary;
  const [speed, setSpeed] = useState<number | null>(null);
  const projectSpeed = speedOf(motion.speed);
  const rate = speed ?? projectSpeed;

  // the timeline, from the files themselves: the stage needs it before (and without) the player
  // a clip's right edge being dragged: its new length shows at once, on the axis as it was when the drag began
  const [drag, setDrag] = useState<{ id: string; ms: number; total: number } | null>(null);
  const timeline = useMemo(
    () =>
      motionTimeline(
        motion.order
          .filter((id) => id in scenes)
          .map((id) => {
            const timing = sceneTiming(scenes[id]);
            return { id, ...timing, duration: drag?.id === id ? formatTime(drag.ms) : timing.duration };
          }),
      ),
    [motion, scenes, drag],
  );
  const duration = timeline.duration / rate;
  const axisMs = drag ? Math.max(drag.total, timeline.duration) : timeline.duration;
  const axis = axisMs / rate;

  // the cover is a scene before 0 s; with none, the video's first frame stands for it
  const coverScene = motion.cover && 'scene' in motion.cover && scenes[motion.cover.scene] !== undefined ? motion.cover.scene : null;
  const [onCover, setOnCover] = useState(true);
  const cover = !!coverScene && onCover;

  const control = useRef<MotionControl | null>(null);
  const [info, setInfo] = useState<MotionInfo | null>(null);
  const [time, setTime] = useState(0);
  const tRef = useRef(time);
  tRef.current = time;
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [stageRef, box] = useBox();

  // the player reloads in the background once edits settle, so typing never waits on it
  const player = useSettled(useMemo(() => ({ motion, scenes: playScenes }), [motion, playScenes]), 600);

  // the scene under the playhead; in a transition, the one coming in
  const authored = time * rate;
  const current = timeline.scenes.findLast((w) => authored >= w.start) ?? timeline.scenes[0];
  const stageId = cover ? coverScene! : current?.id;
  const stageAt = cover
    ? (parseTime(sceneTiming(scenes[coverScene!] ?? '').duration) ?? DEFAULT_SCENE_MS)
    : current
      ? Math.max(0, Math.min(current.duration, authored - current.start))
      : 0;
  // while playing, the stage keeps what it showed when paused (it is hidden, and re-rendering it every frame would cost)
  // on a scene's first moment the stage draws the scene landed, as a page: at 0 s most of it hasn't come in yet
  const stageLanded = !cover && !!current && stageAt < 0.5;
  const held = useRef({ id: stageId, at: stageAt, landed: stageLanded });
  if (!playing) held.current = { id: stageId, at: stageAt, landed: stageLanded };
  const stage = held.current;

  useEffect(() => {
    document.title = t('motion.docTitle', { title: motion.title });
  }, [motion.title, t]);
  useEffect(() => {
    const u = new URL(location.href);
    if (fmt === primary) u.searchParams.delete('f');
    else u.searchParams.set('f', fmt);
    if (u.href !== location.href) replaceUrl(u);
  }, [fmt, primary]);
  // a format picked elsewhere (the panel added one)
  useEffect(() => {
    if (viewFormat && viewFormat !== format && viewFormat in motion.formats) setFormat(viewFormat);
  }, [viewFormat]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    useStore.setState({ motionView: { format: fmt, primary, scene: stage.id ?? null, at: stage.at, landed: stage.landed } });
  }, [fmt, primary, stage.id, stage.at, stage.landed]);
  useEffect(() => () => useStore.setState({ motionView: null }), []);
  // a selection belongs to the scene it was made in
  useEffect(() => {
    const sel = useStore.getState().selection;
    if (sel && (sel.kind === 'el' || sel.kind === 'board') && stage.id && sel.file !== sceneFile(stage.id)) useStore.setState({ selection: null });
  }, [stage.id]);


  const play = () => {
    if (!info) return;
    setOnCover(false);
    useStore.setState({ menu: null });
    const from = time >= duration - 1 ? 0 : time;
    control.current?.play(from);
    setPlaying(true);
  };
  const pause = () => {
    control.current?.pause();
    setPlaying(false);
  };
  const seek = (ms: number) => {
    setOnCover(false);
    control.current?.seek(ms);
    setPlaying(false);
    setTime(Math.max(0, Math.min(duration, ms)));
  };

  // space plays; arrows step a frame (a second with Shift)
  const keys = useRef({ play, pause, seek, playing, fps: motion.fps, duration });
  keys.current = { play, pause, seek, playing, fps: motion.fps, duration };
  useEffect(() => {
    motionKeys.handle = (key, meta, shift) => {
      const k = keys.current;
      if (meta) return false;
      if (key === ' ') {
        (k.playing ? k.pause : k.play)();
        return true;
      }
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        const step = shift ? 1000 : 1000 / (k.fps || 30);
        k.seek(tRef.current + (key === 'ArrowLeft' ? -step : step));
        return true;
      }
      return false;
    };
    return () => {
      motionKeys.handle = null;
    };
  }, []);

  // a player reload (a file changed, another format or speed) keeps the place, in authored time
  const playerAt = tRef.current;

  // ruler: a labelled tick at least ~64 px apart, four minor ticks between labels
  const [lanesRef, lanes] = useBox();
  const labelStep = [1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000].find((st) => (st / Math.max(1, axis)) * lanes.w >= 64) ?? 600_000;
  const tickStep = labelStep / (labelStep === 2000 || labelStep === 120_000 ? 4 : 5);
  const ticks = useMemo(() => (lanes.w > 0 ? Array.from({ length: Math.floor(axis / tickStep) + 1 }, (_, i) => i * tickStep) : []), [axis, tickStep, lanes.w]);

  // a clip's right edge: drag to set the scene's length in 0.1 s steps, written once on release; Esc cancels, arrows nudge
  const dragEdge = (e: React.PointerEvent, id: string, d0: number) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const total = timeline.duration;
    const perMs = lanes.w / Math.max(1, total);
    let last = d0;
    const move = (ev: PointerEvent) => {
      last = snapSceneMs(d0 + (ev.clientX - x0) / perMs);
      setDrag({ id, ms: last, total });
    };
    const end = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key, true);
      setDrag(null);
      if (commit && last !== d0) setSceneDuration(id, last);
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
  const commitLength = (text: string) => {
    const v = Number(text.trim().replace(/s$/, ''));
    if (current && Number.isFinite(v) && v > 0) setSceneDuration(current.id, snapSceneMs(v * 1000 * rate, 1));
  };

  const errors = info?.issues.filter((i) => i.level === 'error').length ?? 0;
  const [W, H] = motion.formats[fmt]?.size ?? [1920, 1080];
  const scale = Math.max(0.01, Math.min(box.w / W, box.h / H));

  return (
    <div className={`app dash motion${panelOpen ? ' with-panel' : ''}`}>
      <header className="dashbar">
        <a className="btn ghost back" href={BASE} title={t('motion.bar.allProjects')}>
          ←
        </a>
        <span className="dashtitle">{motion.title}</span>
        <span className={`dot ${connected ? 'on' : 'off'}`} title={connected ? (saving ? t('motion.bar.saving') : t('motion.bar.connected')) : t('motion.bar.offline')} />
        <div className="grow" />
        {formats.length > 1 && (
          <div className="mseg" role="radiogroup" aria-label={t('motion.bar.formats')}>
            {formats.map((f) => (
              <button key={f} role="radio" aria-checked={f === fmt} className={f === fmt ? 'on' : ''} onClick={() => setFormat(f)} title={`${f} ${motion.formats[f].size.join('×')}`}>
                {f} <span className="faint">{motion.formats[f].size.join('×')}</span>
              </button>
            ))}
          </div>
        )}
        <label className="mspeed" title={t('motion.bar.speedHint')}>
          {t('motion.bar.speed')}
          <select value={String(rate)} onChange={(e) => setSpeed(Number(e.target.value) === projectSpeed ? null : Number(e.target.value))}>
            {[...new Set([...SPEEDS, projectSpeed])]
              .sort((a, b) => a - b)
              .map((v) => (
                <option key={v} value={String(v)}>
                  {v === projectSpeed ? t('motion.bar.speedOptionProject', { speed: v }) : `${v}×`}
                </option>
              ))}
          </select>
        </label>
        <ImportHere target={motionImport} label={t('motion.bar.importLabel')} />
        <button className={`btn ghost${issuesOpen ? ' on' : ''}`} aria-pressed={issuesOpen} onClick={() => setIssuesOpen(!issuesOpen)} title={t('motion.bar.issuesHint')}>
          {t('motion.bar.issues')}{info?.issues.length ? <span className={`badge${errors ? '' : ' blue'}`}>{info.issues.length}</span> : null}
        </button>
        <button className="btn ghost" onClick={() => useStore.setState((s) => ({ journalOpen: !s.journalOpen }))}>
          {t('motion.bar.journal')}
        </button>
        <button className="tb" aria-pressed={panelOpen} aria-label={t('motion.bar.panel')} title={t('motion.bar.panelHint')} onClick={() => useStore.setState({ panelOpen: !panelOpen })}>
          <Panel />
        </button>
      </header>
      <main className="mmain">
        <div ref={stageRef} className="mstage" onPointerDown={(e) => e.target === e.currentTarget && useStore.setState({ selection: null })}>
          {!motion.order.length && <div className="lhint">{t('motion.stage.noScenes')}</div>}
          {box.w > 0 && motion.order.length > 0 && (
            <div className="mstack" onPointerDown={(e) => e.target === e.currentTarget && useStore.setState({ selection: null })}>
              <div className={`mlayer${playing ? ' on' : ''}`} aria-hidden={!playing}>
                <MotionFrame
                  motion={player.motion}
                  scenes={player.scenes}
                  format={fmt}
                  speed={rate}
                  at={playerAt}
                  base={base}
                  box={box}
                  title={t('motion.stage.playerTitle')}
                  control={control}
                  onLoaded={(i) => {
                    setInfo(i);
                    setError(null);
                    setPlaying(false);
                  }}
                  onTime={(v) => keys.current.playing && setTime(v)}
                  onEnded={() => setPlaying(false)}
                  onError={setError}
                />
              </div>
              {/* the player is a frame, so clicks on it never reach here: a clear layer pauses instead */}
              {playing && <button className="mcatch" aria-label={t('motion.stage.pauseLabel')} title={t('motion.stage.pauseHint')} onClick={pause} />}
              {stage.id && scenes[stage.id] !== undefined && (
                <div className={`mlayer medit${playing ? '' : ' on'}`} aria-hidden={playing}>
                  <SlideFrame
                    id={stage.id}
                    scale={scale}
                    use="stage"
                    scene={{ file: sceneFile(stage.id), faces: motion.faces, info: { format: fmt, formats, size: [W, H], t: stage.at, landed: stage.landed } }}
                  />
                </div>
              )}
            </div>
          )}
          {error && <div className="dashhint">{error}</div>}
        </div>
        <div className="mtimeline">
          <div className="mbar">
            <button className="mplay" onClick={playing ? pause : play} disabled={!info} aria-label={playing ? t('motion.stage.pause') : t('motion.stage.play')}>
              {playing ? <PauseFilled /> : <PlayFilled />}
            </button>
            <span className="mtime">
              <b>{secs(time)}</b> / {secs(duration)} s
            </span>
            {!cover && current && (
              <label className="mdur" title={t('motion.stage.sceneLengthHint')}>
                {t('motion.stage.sceneLength')}
                <input
                  key={`${current.id}:${current.duration}:${rate}`}
                  className="input"
                  defaultValue={+(current.duration / rate / 1000).toFixed(2)}
                  inputMode="decimal"
                  aria-label={t('motion.stage.sceneLength')}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') {
                      (e.target as HTMLInputElement).value = String(+(current.duration / rate / 1000).toFixed(2));
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  onBlur={(e) => commitLength(e.target.value)}
                />
                s
              </label>
            )}
            <span className="mwhere" title={cover ? t('motion.stage.whereCover') : stageLanded ? t('motion.stage.whereLanded') : t('motion.stage.whereHint')}>
              {cover
                ? t('motion.stage.whereCover')
                : current
                  ? stageLanded
                    ? t('motion.stage.whereLandedValue', { scene: current.id, time: secs(stageAt) })
                    : `${current.id} · ${secs(stageAt)} s`
                  : ''}
            </span>
          </div>
          <div className="mlanes">
            <div className="mcoverslot">
              <div className="mcoverhead">{t('motion.stage.coverAxis')}</div>
              <div className="mcovertrack">
                {coverScene ? (
                  <>
                    <button
                      className={`mcoverclip${cover ? ' on' : ''}`}
                      aria-pressed={cover}
                      onClick={() => (pause(), setOnCover(true))}
                      title={t('motion.stage.coverHint')}
                    >
                      <span className="mname">{t('motion.stage.cover')}</span>
                      <span className="mlen">{coverScene}</span>
                    </button>
                    <button className="mcoverx" aria-label={t('motion.stage.coverRemove')} title={t('motion.stage.coverRemoveHint')} onClick={removeCover}>
                      ×
                    </button>
                  </>
                ) : (
                  <button
                    className="mcoverclip add"
                    onClick={() => {
                      pause();
                      addCover();
                      setOnCover(true);
                    }}
                    title={t('motion.stage.coverAddHint')}
                  >
                    {t('motion.stage.coverAdd')}
                  </button>
                )}
              </div>
            </div>
            <div className="maxis" ref={lanesRef}>
              <div className="mruler">
                {ticks.map((ms) => (
                  <i key={ms} className={ms % labelStep === 0 ? 'major' : undefined} style={{ left: `${(ms / axis) * 100}%` }}>
                    {ms % labelStep === 0 && <span>{ms / 1000}s</span>}
                  </i>
                ))}
                <input className="mscrub" type="range" min={0} max={Math.max(1, Math.round(duration))} step={1} value={Math.round(time)} onChange={(e) => seek(Number(e.target.value))} aria-label={t('motion.stage.time')} />
              </div>
              <div className="mscenes" aria-label={t('motion.stage.scenes')}>
                {timeline.scenes.map((w, i) => {
                  // a scene's clip runs to where the next one takes over, so clips and playhead share one axis
                  const end = timeline.scenes[i + 1]?.start ?? timeline.duration;
                  const hint = w.transition.kind !== 'cut'
                    ? t('motion.stage.sceneJumpTransition', { scene: w.id, time: secs(w.duration / rate), transition: w.transition.kind })
                    : t('motion.stage.sceneJump', { scene: w.id, time: secs(w.duration / rate) });
                  return (
                    <Fragment key={w.id}>
                      <button
                        className={`mscene${!cover && current?.id === w.id ? ' on' : ''}${w.transition.kind !== 'cut' ? ' blend' : ''}`}
                        style={{ left: `${(w.start / axisMs) * 100}%`, width: `${((end - w.start) / axisMs) * 100}%` }}
                        onClick={() => seek(w.start / rate)}
                        onDoubleClick={() => seek(Math.max(w.start, end - 1000 / (motion.fps || 30)) / rate)}
                        title={hint}
                      >
                        <span className="mname">{w.id}</span>
                        <span className="mlen">{secs(w.duration / rate)}s</span>
                      </button>
                      <span
                        className="mgrip"
                        role="separator"
                        aria-orientation="vertical"
                        tabIndex={0}
                        aria-label={t('motion.stage.sceneEdge', { scene: w.id })}
                        title={t('motion.stage.sceneEdge', { scene: w.id })}
                        style={{ left: `${(end / axisMs) * 100}%` }}
                        onPointerDown={(e) => dragEdge(e, w.id, w.duration)}
                        onKeyDown={(e) => {
                          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                          e.preventDefault();
                          e.stopPropagation();
                          setSceneDuration(w.id, snapSceneMs(w.duration + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1000 : 100)));
                        }}
                      />
                    </Fragment>
                  );
                })}
              </div>
              {!cover && axis > 0 && <div className="mhead" style={{ left: `${(time / axis) * 100}%` }} />}
            </div>
          </div>
        </div>
        {issuesOpen && (
          <div className="missues">
            {info?.issues.length ? (
              <ul>
                {info.issues.map((i, n) => (
                  <li key={n} className={i.level}>
                    <b>{i.scene}</b> {i.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p>{t('motion.stage.noIssues')}</p>
            )}
          </div>
        )}
        <div className="mprompt">
          <PromptBar
            onOpen={(f) => {
              const w = timeline.scenes.find((x) => sceneFile(x.id) === f);
              if (w) seek(w.start / rate);
            }}
          />
        </div>
      </main>
      {panelOpen && <RightPanel />}
      <ContextMenu />
      {journalOpen && <JournalPopover />}
    </div>
  );
}
