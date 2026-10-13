import { useEffect, useMemo, useRef, useState } from 'react';
import { MOTION_FILE, parseMotion, primaryFormat, sceneFile, speedOf } from '@dc/core';
import { display, isSaving, useStore } from '../../store';
import { AskClaude } from '../ds/DsApp';
import { JournalPopover } from '../Overlays';
import { replaceUrl } from '../../host';
import { BASE } from '../../base';
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

export function MotionApp() {
  const connected = useStore((s) => s.connected);
  const saving = useStore(isSaving);
  const journalOpen = useStore((s) => s.journalOpen);
  const { motionText, scenes } = useSources();
  const motion = useMemo(() => parseMotion(motionText), [motionText]);
  const playScenes = useMemo(() => Object.fromEntries(motion.order.filter((id) => id in scenes).map((id) => [id, scenes[id]])), [motion, scenes]);
  const formats = Object.keys(motion.formats);
  const [format, setFormat] = useState(() => {
    const f = new URLSearchParams(location.search).get('f');
    return f && f in motion.formats ? f : primaryFormat(motion);
  });
  const fmt = format in motion.formats ? format : primaryFormat(motion);
  const [speed, setSpeed] = useState<number | null>(null);
  const projectSpeed = speedOf(motion.speed);
  const rate = speed ?? projectSpeed;

  const coverScene = motion.cover && 'scene' in motion.cover && scenes[motion.cover.scene] !== undefined ? motion.cover.scene : null;
  const coverAt = motion.cover && 'at' in motion.cover ? motion.cover.at : null;
  const [showCover, setShowCover] = useState(true);
  const cover = coverScene && showCover;
  const coverScenes = useMemo(() => (coverScene ? { [coverScene]: scenes[coverScene] } : {}), [coverScene, scenes]);
  const coverMotion = useMemo(() => ({ ...motion, order: coverScene ? [coverScene] : [] }), [motion, coverScene]);

  const control = useRef<MotionControl | null>(null);
  const [info, setInfo] = useState<MotionInfo | null>(null);
  const [t, setT] = useState(0);
  const tRef = useRef(0);
  tRef.current = t;
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [stageRef, box] = useBox();
  const started = useRef(false);

  useEffect(() => {
    document.title = `${motion.title} · 动效`;
  }, [motion.title]);
  useEffect(() => {
    const u = new URL(location.href);
    if (fmt === primaryFormat(motion)) u.searchParams.delete('f');
    else u.searchParams.set('f', fmt);
    if (u.href !== location.href) replaceUrl(u);
  }, [fmt, motion]);

  const duration = info?.duration ?? 0;
  const play = () => {
    if (!info) return;
    started.current = true;
    setShowCover(false);
    const from = t >= duration - 1 ? 0 : t;
    control.current?.play(from);
    setPlaying(true);
  };
  const pause = () => {
    control.current?.pause();
    setPlaying(false);
  };
  const seek = (ms: number) => {
    started.current = true;
    setShowCover(false);
    control.current?.seek(ms);
    setPlaying(false);
    setT(ms);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) return;
      if (e.key === ' ') {
        e.preventDefault();
        (playing ? pause : play)();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey ? 1000 : 1000 / (info?.fps ?? 30);
        seek(Math.max(0, Math.min(duration, tRef.current + (e.key === 'ArrowLeft' ? -step : step))));
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  // a reload (a file changed, another format or speed) keeps the place, in authored time
  const authoredAt = info ? tRef.current * info.speed : 0;
  const at = !started.current && coverAt !== null ? coverAt / rate : started.current ? authoredAt / rate : 0;

  const windows = info?.scenes ?? [];
  const current = windows.findLast?.((w) => t * (info?.speed ?? 1) >= w.start) ?? windows[0];
  const errors = info?.issues.filter((i) => i.level === 'error').length ?? 0;

  return (
    <div className="app dash motion">
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
          <button className={`btn ghost${cover ? ' on' : ''}`} aria-pressed={!!cover} onClick={() => (cover ? setShowCover(false) : (pause(), setShowCover(true)))} title="封面：缩略图、视频第一帧和播放前显示的那一页">
            封面
          </button>
        )}
        <button className={`btn ghost${issuesOpen ? ' on' : ''}`} aria-pressed={issuesOpen} onClick={() => setIssuesOpen(!issuesOpen)} title="时间上的问题">
          检查{info?.issues.length ? <span className={`badge${errors ? '' : ' blue'}`}>{info.issues.length}</span> : null}
        </button>
        <button className="btn ghost" onClick={() => useStore.setState((s) => ({ journalOpen: !s.journalOpen }))}>
          记录
        </button>
      </header>
      <main className="mmain">
        <div ref={stageRef} className="mstage">
          {!motion.order.length && <div className="lhint">motion.json 的 order 里还没有场景。</div>}
          {box.w > 0 && motion.order.length > 0 && (
            <div className="mstack">
              <MotionFrame
                motion={motion}
                scenes={playScenes}
                format={fmt}
                speed={rate}
                at={at}
                box={box}
                title="动效"
                control={control}
                onLoaded={(i) => {
                  setInfo(i);
                  setError(null);
                  setPlaying(false);
                }}
                onTime={setT}
                onEnded={() => setPlaying(false)}
                onError={setError}
              />
              {cover && (
                <div className="mcover">
                  <MotionFrame motion={coverMotion} scenes={coverScenes} format={fmt} at="end" box={box} title="封面" />
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
        </div>
        <div className="mscenes" aria-label="场景">
          {windows.map((w) => (
            <button
              key={w.id}
              className={`mscene${current?.id === w.id ? ' on' : ''}`}
              style={{ flexGrow: w.duration }}
              onClick={() => seek(w.start / (info?.speed ?? 1) + 1)}
              title={`${w.id}：${secs(w.duration / (info?.speed ?? 1))} s${w.transition.kind !== 'cut' ? `，${w.transition.kind} 转场` : ''}`}
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
        <AskClaude
          file={current ? sceneFile(current.id) : MOTION_FILE}
          placeholder="交给 Claude Code：改一个场景、加一段动画、调整节奏、做一张封面…"
          context={() => (current ? `播放到 ${secs(tRef.current)} s，场景 ${current.id}，尺寸 ${fmt}。` : '')}
        />
      </main>
      {journalOpen && <JournalPopover />}
    </div>
  );
}
