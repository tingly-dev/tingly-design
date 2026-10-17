import { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { snapSceneMs, type MotionJson, type motionTimeline } from '@dc/core';
import { addCover, removeCover, setSceneDuration } from './motion';
import { notesOf } from '../slides/slides';
import { PauseFilled, PlayFilled } from '../icons';
import { useElementSize } from '../../hooks';

export const secs = (ms: number) => (ms / 1000).toFixed(1);

type Line = ReturnType<typeof motionTimeline>;
type Clip = Line['scenes'][number];

/**
 * The bar under the stage: play, the time, the scene's length, where the
 * playhead is; then the cover slot, the ruler and one clip per scene, whose
 * right edge drags (or arrows) to set the scene's length.
 */
export function Timeline(p: {
  motion: MotionJson;
  scenes: Record<string, string>;
  timeline: Line;
  /** the axis in authored ms (it holds still while a clip is dragged) and in played ms */
  axisMs: number;
  axis: number;
  rate: number;
  time: number;
  duration: number;
  ready: boolean;
  playing: boolean;
  cover: boolean;
  coverScene: string | null;
  current: Clip | undefined;
  stageAt: number;
  stageLanded: boolean;
  play: () => void;
  pause: () => void;
  seek: (ms: number) => void;
  showCover: () => void;
  onDrag: (d: { id: string; ms: number; total: number } | null) => void;
}) {
  const { t } = useTranslation();
  const { motion, scenes, timeline, axisMs, axis, rate, time, duration, playing, cover, coverScene, current, stageAt, stageLanded, play, pause, seek } = p;

  // ruler: a labelled tick at least ~64 px apart, four minor ticks between labels
  const [lanesRef, lanes] = useElementSize<HTMLDivElement>();
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
      p.onDrag({ id, ms: last, total });
    };
    const end = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key, true);
      p.onDrag(null);
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

  return (
    <div className="mtimeline">
      <div className="mbar">
        <button className="mplay" onClick={playing ? pause : play} disabled={!p.ready} aria-label={playing ? t('motion.stage.pause') : t('motion.stage.play')}>
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
                  onClick={() => (pause(), p.showCover())}
                  title={t('motion.stage.coverHint')}
                >
                  <span className="mname">
                    {t('motion.stage.cover')}
                    {notesOf(scenes[coverScene]) && <i className="mnotedot" title={t('motion.notes.onScene')} />}
                  </span>
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
                  p.showCover();
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
                    <span className="mname">
                      {w.id}
                      {notesOf(scenes[w.id]) && <i className="mnotedot" title={t('motion.notes.onScene')} />}
                    </span>
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
  );
}
