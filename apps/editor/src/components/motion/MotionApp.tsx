import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MOTION_FILE, formatTime, motionTimeline, parseMotion, parseTime, primaryFormat, sceneFile, sceneTiming, speedOf, DEFAULT_SCENE_MS } from '@dc/core';
import { api } from '../../api';
import { editMotion, motionImport, motionLocator, setSpeed } from './motion';
import { notesOf } from '../slides/slides';
import { FileMenu } from '../FileMenu';
import { VideoExportDialog, type ScenePick } from './VideoExportDialog';
import { TopBar, BarButton, ProjectTitle } from '../TopBar';
import { display, isSaving, useStore } from '../../store';
import { ContextMenu, JournalPopover } from '../Overlays';
import { RightPanel } from '../panel/RightPanel';
import { PromptBar } from '../PromptBar';
import { useChat } from '../ChatPanel';
import { Checklist, Film, Gif as GifIcon, CopyPicture, Note, Picture } from '../icons';
import { replaceUrl } from '../../host';
import { motionKeys } from '../../shortcuts';
import { SlideFrame } from '../slides/SlideFrame';
import { MotionFrame, type MotionControl, type MotionCoverSpec, type MotionInfo } from './MotionFrame';
import { useBoardFiles } from '../../boards';
import { useElementSize } from '../../hooks';
import { Timeline } from './Timeline';
import { MotionIssues, MotionNotes } from './MotionSidePanes';
import { useMotionExport } from './useMotionExport';
import { ExportProgress } from './ExportProgress';


const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];


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
  const barCollapsed = useStore((s) => s.barCollapsed);
  const barInColumn = useChat().left;
  const { t } = useTranslation();
  const project = useStore((s) => s.project);
  const assetRev = useStore((s) => s.assetRev);
  const base = project ? api.frameBase(project, assetRev) : '';
  const { motionText, scenes } = useSources();
  const boardFiles = useBoardFiles(Object.keys(scenes).map(sceneFile));
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
  // the piece's own speed, saved in motion.json: what plays here is what exports
  const rate = speedOf(motion.speed);

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

  // the cover is a scene before 0 s, or a frame of the video (authored ms); with none, the video's first frame stands for it
  const coverScene = motion.cover && 'scene' in motion.cover && scenes[motion.cover.scene] !== undefined ? motion.cover.scene : null;
  const coverAt = motion.cover && 'at' in motion.cover ? motion.cover.at : null;
  const coverSpec = useMemo<MotionCoverSpec | undefined>(
    () => (coverScene ? { scene: coverScene, html: scenes[coverScene] } : coverAt !== null ? { at: coverAt } : undefined),
    [coverScene, coverAt, scenes],
  );
  const [onCover, setOnCover] = useState(true);
  const cover = !!coverScene && onCover;

  const control = useRef<MotionControl | null>(null);
  const opened = useRef(false);
  const [info, setInfo] = useState<MotionInfo | null>(null);
  const [time, setTime] = useState(0);
  const tRef = useRef(time);
  tRef.current = time;
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [effectErrors, setEffectErrors] = useState<{ scene: string; code: string; detail: string }[]>([]);
  // one hint per cause, naming every scene it hits
  const effectErrorGroups = useMemo(() => {
    const out: { code: string; detail: string; scenes: string[] }[] = [];
    for (const e of effectErrors) {
      const g = out.find((x) => x.code === e.code && x.detail === e.detail);
      if (g) g.scenes.push(e.scene);
      else out.push({ code: e.code, detail: e.detail, scenes: [e.scene] });
    }
    return out;
  }, [effectErrors]);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [stageRef, box] = useElementSize<HTMLDivElement>();

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
  // a file a run changed is shown by seeking to its scene (`locate.ts` asks through this)
  const locate = useRef<(f: string) => boolean>(() => false);
  locate.current = (f) => {
    const w = timeline.scenes.find((x) => sceneFile(x.id) === f);
    if (w) seek(w.start / rate);
    return !!w;
  };
  useEffect(() => {
    const mine = (f: string) => locate.current(f);
    motionLocator.current = mine;
    return () => {
      if (motionLocator.current === mine) motionLocator.current = null;
    };
  }, []);
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

  // the file name of a stretch: the scene it starts in
  const sceneName = (from: number) => timeline.scenes.findLast((w) => w.start / rate <= from + 1)?.id ?? 'scene';
  const { exporting, cancel, where, exportDialog, setExportDialog, openExportDialog, exportVideo, saveFrame, copyFrame, saveCover } = useMotionExport({ motion, fmt, info, playScenes, base, project, control, at: tRef, pause, sceneName, cover: coverSpec });

  // the scene under the playhead as a range the dialog may offer (not on the cover, which is before the video)
  const scenePick: ScenePick | null = !cover && current ? { name: current.id, from: current.start / rate, to: (current.start + current.duration) / rate } : null;

  const errors = info?.issues.filter((i) => i.level === 'error').length ?? 0;
  const [W, H] = motion.formats[fmt]?.size ?? [1920, 1080];
  const scale = Math.max(0.01, Math.min(box.w / W, box.h / H));

  return (
    <div className={`app dash motion${panelOpen ? ' with-panel' : ''}`}>
      <TopBar
        title={
          <ProjectTitle
            value={motion.title}
            label={t('motion.motionProps.nameLabel')}
            hint={t('common.topbar.rename')}
            onRename={(v) => editMotion((r) => (r.title = v), t('motion.journal.title', { title: v }))}
          />
        }
        panel={{ label: t('motion.bar.panel'), hint: t('motion.bar.panelHint') }}
      >
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
          <select value={String(rate)} onChange={(e) => setSpeed(Number(e.target.value))}>
            {[...new Set([...SPEEDS, rate])]
              .sort((a, b) => a - b)
              .map((v) => (
                <option key={v} value={String(v)}>
                  {v}×
                </option>
              ))}
          </select>
        </label>
        <BarButton
          icon={<Note />}
          label={t('motion.notes.toggle')}
          title={t('motion.notes.hint')}
          on={notesOpen}
          badge={motion.note || Object.values(scenes).some((src) => notesOf(src)) ? <i className="mnotedot" /> : null}
          onClick={() => setNotesOpen(!notesOpen)}
          data-notes-toggle=""
        />
        <BarButton
          icon={<Checklist />}
          label={t('motion.bar.issues')}
          title={t('motion.bar.issuesHint')}
          on={issuesOpen}
          badge={info?.issues.length ? <span className={`badge${errors ? '' : ' blue'}`}>{info.issues.length}</span> : null}
          onClick={() => setIssuesOpen(!issuesOpen)}
        />
        {exporting && (
          <ExportProgress exporting={exporting} where={where(exporting.route)} onCancel={cancel} />
        )}
        <FileMenu
          target={motionImport}
          label={t('motion.bar.importLabel')}
          items={[
            { id: 'video', label: t('common.transfer.label.video'), hint: t('common.transfer.hint.motionVideo', { size: `${W}×${H}`, fps: info?.fps ?? motion.fps }), icon: <Film />, disabled: !info || !!exporting, run: () => void openExportDialog() },
            { id: 'gif', label: t('common.transfer.label.gif'), hint: t('common.transfer.hint.motionGif'), icon: <GifIcon />, disabled: !info || !!exporting, run: () => void openExportDialog('gif') },
            { id: 'cover', label: t('common.transfer.label.cover'), hint: coverSpec ? t('common.transfer.hint.motionCover') : t('common.transfer.hint.motionCoverNone'), icon: <Picture />, disabled: !info, rule: true, run: saveCover },
            { id: 'frame', label: t('common.transfer.label.png'), hint: t('common.transfer.hint.motionFrame'), icon: <Picture />, disabled: !info, run: saveFrame },
            { id: 'copy-png', label: t('common.transfer.label.copyPng'), hint: t('common.transfer.hint.motionFrame'), icon: <CopyPicture />, disabled: !info, run: copyFrame },
          ]}
        />
      </TopBar>
      <main className="mmain">
        <div ref={stageRef} className="mstage" onPointerDown={(e) => e.target === e.currentTarget && useStore.setState({ selection: null })}>
          {!motion.order.length && <div className="lhint">{t('motion.stage.noScenes')}</div>}
          {box.w > 0 && motion.order.length > 0 && (
            <div className="mstack" onPointerDown={(e) => e.target === e.currentTarget && useStore.setState({ selection: null })}>
              <div className={`mlayer${playing || exporting ? ' on' : ''}`} aria-hidden={!playing && !exporting}>
                <MotionFrame
                  motion={player.motion}
                  scenes={player.scenes}
                  format={fmt}
                  speed={rate}
                  at={playerAt}
                  base={base}
                  files={boardFiles}
                  box={box}
                  title={t('motion.stage.playerTitle')}
                  control={control}
                  onLoaded={(i) => {
                    // a piece whose cover is a frame opens on that frame, as one with a cover scene opens on it
                    if (!opened.current && coverAt !== null && !coverScene && tRef.current === 0) {
                      const at = Math.min(i.duration, coverAt / i.speed);
                      control.current?.seek(at);
                      setTime(at);
                    }
                    opened.current = true;
                    setInfo(i);
                    setError(null);
                    setEffectErrors(i.effectErrors ?? []);
                    setPlaying(false);
                  }}
                  onTime={(v) => keys.current.playing && setTime(v)}
                  onEnded={() => setPlaying(false)}
                  onError={setError}
                  onEffectError={(e) => setEffectErrors((p) => (p.some((x) => x.scene === e.scene && x.code === e.code && x.detail === e.detail) ? p : [...p, e]))}
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
          {effectErrorGroups.map((g) => (
            <div key={`${g.code}:${g.detail}`} className="dashhint">
              {t(g.code === 'fallback' ? 'motion.effect.fallback' : g.code === 'no-webgl2' ? 'motion.effect.noWebgl2' : g.code === 'shader' ? 'motion.effect.shader' : 'motion.effect.draw', { scenes: g.scenes.map((x) => `“${x}”`).join(', '), detail: g.detail })}
            </div>
          ))}
        </div>
        <Timeline
          motion={motion}
          scenes={scenes}
          timeline={timeline}
          format={fmt}
          axisMs={axisMs}
          axis={axis}
          rate={rate}
          time={time}
          duration={duration}
          ready={!!info}
          playing={playing}
          cover={cover}
          coverScene={coverScene}
          coverAt={coverAt}
          current={current}
          stageAt={stageAt}
          stageLanded={stageLanded}
          play={play}
          pause={pause}
          seek={seek}
          showCover={() => setOnCover(true)}
          onDrag={setDrag}
        />
        {notesOpen && <MotionNotes motion={motion} scenes={scenes} sceneId={stage.id} />}
        {issuesOpen && <MotionIssues info={info} />}
        <div className={`mprompt${barInColumn ? ' in-column' : barCollapsed ? ' collapsed' : ''}`}>
          <PromptBar />
        </div>
      </main>
      {exportDialog && info && (
        <VideoExportDialog
          size={[W, H]}
          fps={info.fps}
          duration={info.duration}
          scene={scenePick}
          hasCover={!!coverSpec}
          coverFirst={motion.coverFirstFrame === true}
          viaServer={exportDialog.viaServer}
          initialFormat={exportDialog.format}
          onClose={() => setExportDialog(null)}
          onStart={(o) => {
            const via = exportDialog.viaServer;
            setExportDialog(null);
            void exportVideo(o, via);
          }}
        />
      )}
      {panelOpen && <RightPanel />}
      <ContextMenu />
      <JournalPopover />
    </div>
  );
}
