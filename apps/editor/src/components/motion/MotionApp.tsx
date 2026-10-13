import { useEffect, useMemo, useRef, useState } from 'react';
import { MOTION_FILE, motionTimeline, parseMotion, parseTime, primaryFormat, sceneFile, sceneTiming, sceneVisibility, speedOf, DEFAULT_SCENE_MS } from '@dc/core';
import { display, isSaving, parsed, useStore } from '../../store';
import { ContextMenu, JournalPopover } from '../Overlays';
import { RightPanel } from '../panel/RightPanel';
import { PromptBar } from '../PromptBar';
import { Panel } from '../icons';
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
  const timeline = useMemo(() => motionTimeline(motion.order.filter((id) => id in scenes).map((id) => ({ id, ...sceneTiming(scenes[id]) }))), [motion, scenes]);
  const duration = timeline.duration / rate;

  const coverScene = motion.cover && 'scene' in motion.cover && scenes[motion.cover.scene] !== undefined ? motion.cover.scene : null;
  const coverAt = motion.cover && 'at' in motion.cover ? motion.cover.at : null;
  const [showCover, setShowCover] = useState(true);
  const cover = !!coverScene && showCover;

  const control = useRef<MotionControl | null>(null);
  const [info, setInfo] = useState<MotionInfo | null>(null);
  const [t, setT] = useState(() => (coverAt !== null ? coverAt / rate : 0));
  const tRef = useRef(t);
  tRef.current = t;
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [stageRef, box] = useBox();

  // the player reloads in the background once edits settle, so typing never waits on it
  const player = useSettled(useMemo(() => ({ motion, scenes: playScenes }), [motion, playScenes]), 600);

  // the scene under the playhead; in a transition, the one coming in
  const authored = t * rate;
  const current = timeline.scenes.findLast((w) => authored >= w.start) ?? timeline.scenes[0];
  const stageId = cover ? coverScene! : current?.id;
  const stageAt = cover
    ? (parseTime(sceneTiming(scenes[coverScene!] ?? '').duration) ?? DEFAULT_SCENE_MS)
    : current
      ? Math.max(0, Math.min(current.duration, authored - current.start))
      : 0;
  // while playing, the stage keeps what it showed when paused (it is hidden, and re-rendering it every frame would cost)
  const held = useRef({ id: stageId, at: stageAt });
  if (!playing) held.current = { id: stageId, at: stageAt };
  const stage = held.current;

  useEffect(() => {
    document.title = `${motion.title} · 动效`;
  }, [motion.title]);
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
    useStore.setState({ motionView: { format: fmt, primary, scene: stage.id ?? null, at: stage.at } });
  }, [fmt, primary, stage.id, stage.at]);
  useEffect(() => () => useStore.setState({ motionView: null }), []);
  // a selection belongs to the scene it was made in
  useEffect(() => {
    const sel = useStore.getState().selection;
    if (sel && (sel.kind === 'el' || sel.kind === 'board') && stage.id && sel.file !== sceneFile(stage.id)) useStore.setState({ selection: null });
  }, [stage.id]);

  /** Where clicking a scene lands: everything in it has arrived, nothing has left. */
  const settledAt = (id: string) => (scenes[id] ? sceneVisibility(parsed(scenes[id]), fmt, formats).settled : 0);

  const play = () => {
    if (!info) return;
    setShowCover(false);
    useStore.setState({ menu: null });
    const from = t >= duration - 1 ? 0 : t;
    control.current?.play(from);
    setPlaying(true);
  };
  const pause = () => {
    control.current?.pause();
    setPlaying(false);
  };
  const seek = (ms: number) => {
    setShowCover(false);
    control.current?.seek(ms);
    setPlaying(false);
    setT(Math.max(0, Math.min(duration, ms)));
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
  const playerAt = !info && coverAt !== null ? coverAt / rate : tRef.current;

  const errors = info?.issues.filter((i) => i.level === 'error').length ?? 0;
  const [W, H] = motion.formats[fmt]?.size ?? [1920, 1080];
  const scale = Math.max(0.01, Math.min(box.w / W, box.h / H));

  return (
    <div className={`app dash motion${panelOpen ? ' with-panel' : ''}`}>
      <header className="dashbar">
        <a className="btn ghost back" href={BASE} title="所有项目">
          ←
        </a>
        <span className="dashtitle">{motion.title}</span>
        <span className={`dot ${connected ? 'on' : 'off'}`} title={connected ? (saving ? '保存中…' : '已连接') : '连不上服务端'} />
        <div className="grow" />
        {formats.length > 1 && (
          <div className="mseg" role="radiogroup" aria-label="尺寸">
            {formats.map((f) => (
              <button key={f} role="radio" aria-checked={f === fmt} className={f === fmt ? 'on' : ''} onClick={() => setFormat(f)} title={`${f} ${motion.formats[f].size.join('×')}`}>
                {f} <span className="faint">{motion.formats[f].size.join('×')}</span>
              </button>
            ))}
          </div>
        )}
        <label className="mspeed" title="播放速度。项目的默认速度写在 motion.json 的 speed 里">
          速度
          <select value={String(rate)} onChange={(e) => setSpeed(Number(e.target.value) === projectSpeed ? null : Number(e.target.value))}>
            {[...new Set([...SPEEDS, projectSpeed])]
              .sort((a, b) => a - b)
              .map((v) => (
                <option key={v} value={String(v)}>
                  {v}×{v === projectSpeed ? '（项目）' : ''}
                </option>
              ))}
          </select>
        </label>
        {coverScene && (
          <button
            className={`btn ghost${cover ? ' on' : ''}`}
            aria-pressed={cover}
            onClick={() => (cover ? setShowCover(false) : (pause(), setShowCover(true)))}
            title="封面：缩略图、视频第一帧和播放前显示的那一页。打开时可以直接改它"
          >
            封面
          </button>
        )}
        <button className={`btn ghost${issuesOpen ? ' on' : ''}`} aria-pressed={issuesOpen} onClick={() => setIssuesOpen(!issuesOpen)} title="时间上的问题">
          检查{info?.issues.length ? <span className={`badge${errors ? '' : ' blue'}`}>{info.issues.length}</span> : null}
        </button>
        <button className="btn ghost" onClick={() => useStore.setState((s) => ({ journalOpen: !s.journalOpen }))}>
          记录
        </button>
        <button className="tb" aria-pressed={panelOpen} aria-label="属性面板" title="属性面板（⌘\）" onClick={() => useStore.setState({ panelOpen: !panelOpen })}>
          <Panel />
        </button>
      </header>
      <main className="mmain">
        <div ref={stageRef} className="mstage" onPointerDown={(e) => e.target === e.currentTarget && useStore.setState({ selection: null })}>
          {!motion.order.length && <div className="lhint">motion.json 的 order 里还没有场景。</div>}
          {box.w > 0 && motion.order.length > 0 && (
            <div className="mstack" onPointerDown={(e) => e.target === e.currentTarget && useStore.setState({ selection: null })}>
              <div className={`mlayer${playing ? ' on' : ''}`} aria-hidden={!playing}>
                <MotionFrame
                  motion={player.motion}
                  scenes={player.scenes}
                  format={fmt}
                  speed={rate}
                  at={playerAt}
                  box={box}
                  title="动效"
                  control={control}
                  onLoaded={(i) => {
                    setInfo(i);
                    setError(null);
                    setPlaying(false);
                  }}
                  onTime={(v) => keys.current.playing && setT(v)}
                  onEnded={() => setPlaying(false)}
                  onError={setError}
                />
              </div>
              {/* the player is a frame, so clicks on it never reach here: a clear layer pauses instead */}
              {playing && <button className="mcatch" aria-label="暂停并回到编辑" title="点一下暂停，回到编辑" onClick={pause} />}
              {stage.id && scenes[stage.id] !== undefined && (
                <div className={`mlayer medit${playing ? '' : ' on'}`} aria-hidden={playing}>
                  <SlideFrame
                    id={stage.id}
                    scale={scale}
                    use="stage"
                    scene={{ file: sceneFile(stage.id), faces: motion.faces, info: { format: fmt, formats, size: [W, H], t: stage.at } }}
                  />
                </div>
              )}
            </div>
          )}
          {error && <div className="dashhint">{error}</div>}
        </div>
        <div className="mcontrols">
          <button className="btn mplay" onClick={playing ? pause : play} disabled={!info} aria-label={playing ? '暂停' : '播放'}>
            {playing ? '❚❚' : '▶'}
          </button>
          <span className="mtime">
            {secs(t)} / {secs(duration)} s
          </span>
          <input className="mscrub" type="range" min={0} max={Math.max(1, Math.round(duration))} step={1} value={Math.round(t)} onChange={(e) => seek(Number(e.target.value))} aria-label="时间" />
          <span className="mwhere" title={cover ? '封面' : '播放头所在的场景和场景里的时间'}>
            {cover ? '封面' : current ? `${current.id} · ${secs(stageAt)} s` : ''}
          </span>
        </div>
        <div className="mscenes" aria-label="场景">
          {timeline.scenes.map((w) => (
            <button
              key={w.id}
              className={`mscene${!cover && current?.id === w.id ? ' on' : ''}`}
              style={{ flexGrow: w.duration }}
              onClick={() => seek((w.start + settledAt(w.id)) / rate)}
              title={`${w.id}：${secs(w.duration / rate)} s${w.transition.kind !== 'cut' ? `，${w.transition.kind} 转场` : ''}`}
            >
              {w.id}
            </button>
          ))}
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
              <p>没有发现问题。</p>
            )}
          </div>
        )}
        <div className="mprompt">
          <PromptBar />
        </div>
      </main>
      {panelOpen && <RightPanel />}
      <ContextMenu />
      {journalOpen && <JournalPopover />}
    </div>
  );
}
