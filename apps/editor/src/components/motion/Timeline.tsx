import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sceneFile, snapSceneMs, type MotionJson, type motionTimeline } from '@dc/core';
import { addCover, addScene, deleteScene, duplicateScene, moveScene, removeCover, setCoverAt, setSceneDuration } from './motion';
import { LaneLabels, LaneRows, useLanes, type BarDraft } from './ElementLanes';
import { ItemMenuItems } from '../ItemMenu';
import { Menu } from '../Menu';
import { notesOf } from '../slides/slides';
import { PauseFilled, Picture, PlayFilled } from '../icons';
import { useElementSize } from '../../hooks';

export const secs = (ms: number) => (ms / 1000).toFixed(1);

type Line = ReturnType<typeof motionTimeline>;
type Clip = Line['scenes'][number];

/**
 * The bar under the stage: play, the time, the scene's length, where the
 * playhead is; then the cover slot, the ruler and one clip per scene, whose
 * right edge drags (or arrows) to set the scene's length. A cover that is a
 * frame of the video stands on the ruler as a pin that drags to another frame.
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
  /** a cover that is a frame of the video: its time in authored ms */
  coverAt: number | null;
  current: Clip | undefined;
  stageAt: number;
  stageLanded: boolean;
  /** the size on screen: whose overrides the lane edits write to */
  format: string;
  play: () => void;
  pause: () => void;
  seek: (ms: number) => void;
  showCover: () => void;
  onDrag: (d: { id: string; ms: number; total: number } | null) => void;
}) {
  const { t } = useTranslation();
  const { motion, scenes, timeline, axisMs, axis, rate, time, duration, playing, cover, coverScene, current, stageAt, stageLanded, play, pause, seek } = p;
  // the cover pin while it is dragged (authored ms), written once on release
  const [pinMs, setPinMs] = useState<number | null>(null);
  const coverAt = pinMs ?? (p.coverAt !== null ? Math.min(p.coverAt, timeline.duration) : null);
  const frameMs = 1000 / (motion.fps || 30);
  const onCoverFrame = !cover && coverAt !== null && Math.abs(time * rate - coverAt) < frameMs * rate;

  // a scene just made or copied: once it is on the axis, the playhead goes to its start
  const [pending, setPending] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  useEffect(() => {
    if (!pending) return;
    const w = timeline.scenes.find((x) => x.id === pending);
    if (!w) return void (motion.order.includes(pending) || setPending(null));
    setPending(null);
    seek(w.start / rate);
  }, [pending, timeline, motion.order, rate, seek]);
  const afterAdd = (id: string | null) => {
    if (id) setPending(id);
  };

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
  // the cover pin: drag along the axis to another frame; the stage follows so the frame shows as it moves
  const dragPin = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    pause();
    const rect = (e.currentTarget.closest('.maxis') as HTMLElement).getBoundingClientRect();
    const at = (x: number) => Math.max(0, Math.min(timeline.duration, ((x - rect.left) / Math.max(1, rect.width)) * axisMs));
    let last = at(e.clientX);
    setPinMs(last);
    seek(last / rate);
    const move = (ev: PointerEvent) => {
      last = at(ev.clientX);
      setPinMs(last);
      seek(last / rate);
    };
    const end = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key, true);
      setPinMs(null);
      if (commit) setCoverAt(last);
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

  // the element rows under the scene blocks: the animated elements of the scene under the playhead
  const elementLanes = useLanes(motion, p.format, !cover && current ? current.id : null);
  const [openLane, setOpenLane] = useState<number | null>(null);
  const [barDraft, setBarDraft] = useState<BarDraft | null>(null);
  const [keyDraft, setKeyDraft] = useState<{ tid: number; prop: string; index: number; t: number } | null>(null);
  // the playhead within the scene, in authored ms
  const playAt = current ? Math.max(0, Math.min(current.duration, time * rate - current.start)) : 0;
  const seekScene = (ms: number) => current && seek((current.start + Math.max(0, Math.min(current.duration, ms))) / rate);
  // the label column has no scrollbar of its own: it follows the rows
  const labelScroll = useRef<HTMLDivElement>(null);
  const rowsScroll = useRef<HTMLDivElement>(null);
  const syncLabels = () => {
    if (labelScroll.current && rowsScroll.current) labelScroll.current.scrollTop = rowsScroll.current.scrollTop;
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
        <button className="btn ghost sm" onClick={() => afterAdd(addScene(!cover && current ? current.id : null))} title={t('motion.stage.sceneAddHint')}>
          {t('motion.stage.sceneAdd')}
        </button>
        {!cover && current && !onCoverFrame && (
          <button className="btn ghost sm mcoverset" onClick={() => (pause(), setCoverAt(time * rate))} title={t('motion.stage.coverFrameHint')}>
            <Picture />
            {t('motion.stage.coverFrame')}
          </button>
        )}
        <span className="mwhere" title={cover || onCoverFrame ? t('motion.stage.whereCover') : stageLanded ? t('motion.stage.whereLanded') : t('motion.stage.whereHint')}>
          {cover
            ? t('motion.stage.whereCover')
            : onCoverFrame
              ? t('motion.stage.whereCoverAt', { time: secs(time) })
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
            ) : coverAt !== null ? (
              <>
                <button
                  className={`mcoverclip frame${onCoverFrame ? ' on' : ''}`}
                  aria-pressed={onCoverFrame}
                  onClick={() => seek(coverAt / rate)}
                  title={t('motion.stage.coverAtHint', { time: secs(coverAt / rate) })}
                >
                  <span className="mname">{t('motion.stage.cover')}</span>
                  <span className="mlen">{t('motion.stage.coverAtShort', { time: secs(coverAt / rate) })}</span>
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
          {elementLanes.length > 0 && (
            <div className="mlanescroll" ref={labelScroll}>
              <LaneLabels lanes={elementLanes} open={openLane} setOpen={setOpenLane} />
            </div>
          )}
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
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ x: e.clientX, y: e.clientY, id: w.id });
                    }}
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
          {elementLanes.length > 0 && current && (
            <div className="mlanescroll rows" ref={rowsScroll} onScroll={syncLabels}>
            <LaneRows
              motion={motion}
              lanes={elementLanes}
              file={sceneFile(current.id)}
              sceneStart={current.start}
              sceneDur={current.duration}
              axisMs={axisMs}
              perMs={lanes.w / Math.max(1, axisMs)}
              playAt={playAt}
              open={openLane}
              setOpen={setOpenLane}
              draft={barDraft}
              keyDraft={keyDraft}
              onDrag={setBarDraft}
              onKeyDrag={setKeyDraft}
              axisRect={() => lanesRef.current?.getBoundingClientRect() ?? null}
              seekScene={seekScene}
            />
            </div>
          )}
          {menu && (
            <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} label={t('motion.stage.sceneMenu')}>
              <ItemMenuItems
                close={() => setMenu(null)}
                axis="horizontal"
                onAdd={() => afterAdd(addScene(menu.id))}
                onDuplicate={() => afterAdd(duplicateScene(menu.id))}
                onEarlier={motion.order[0] === menu.id ? null : () => moveScene(menu.id, -1)}
                onLater={motion.order.at(-1) === menu.id ? null : () => moveScene(menu.id, 1)}
                onDelete={() => void deleteScene(menu.id)}
              />
            </Menu>
          )}
          {!cover && axis > 0 && <div className="mhead" style={{ left: `${(time / axis) * 100}%` }} />}
          {coverAt !== null && axisMs > 0 && (
            <div className={`mcoverpin${pinMs !== null ? ' dragging' : ''}`} style={{ left: `${(coverAt / axisMs) * 100}%` }}>
              <span
                role="slider"
                tabIndex={0}
                aria-label={t('motion.stage.coverPinLabel')}
                aria-valuemin={0}
                aria-valuemax={Math.round(duration)}
                aria-valuenow={Math.round(coverAt / rate)}
                aria-valuetext={t('motion.stage.coverAt', { time: secs(coverAt / rate) })}
                title={t('motion.stage.coverPin', { time: secs(coverAt / rate) })}
                onPointerDown={dragPin}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                  e.preventDefault();
                  e.stopPropagation();
                  const next = Math.max(0, Math.min(timeline.duration, coverAt + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1000 : frameMs)));
                  setCoverAt(next);
                  seek(next / rate);
                }}
              >
                <Picture />
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
