import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { deckSize, faceMarkup, sandboxDoc, slideFile, type DeckJson, type FromRuntime, type MotionStageInfo } from '@dc/core';
import { api } from '../../api';
import { deckOf, display, editElement, parsed, useStore } from '../../store';
import { stageCounts, stageInspect, stageMove, stageResize, stageSelect } from '../runtime';
import { frames, post } from '../canvas/Board';
import { handleKey } from '../../shortcuts';
import { SERVER } from '../../base';
import { htmlLang } from '../../i18n';
import { useBoardFiles } from '../../boards';

export type FrameUse = 'stage' | 'thumb' | 'present';

/** A motion scene on the stage: its file, the piece's typefaces, the format and the time it is stopped at. */
export interface SceneStage {
  file: string;
  faces: DeckJson['faces'];
  info: MotionStageInfo;
}

/**
 * One slide in a sandboxed frame, laid out at the deck’s size and scaled to fit.
 * The stage frame is the editable one: it talks to the same runtime as an
 * artboard, so selection, text editing, dragging and the panel all work.
 * With `scene` it is a motion scene instead, in its format, stopped at a time.
 */
export const SlideFrame = memo(function SlideFrame({
  id,
  scale,
  use,
  step = 0,
  onSteps,
  scene,
}: {
  id: string;
  scale: number;
  use: FrameUse;
  step?: number;
  onSteps?: (total: number) => void;
  scene?: SceneStage;
}) {
  const file = scene?.file ?? slideFile(id);
  const frame = useRef<HTMLIFrameElement>(null);
  // counts the runtime's `ready` messages: a frame that loads again (moved in the DOM, reloaded) must be drawn again
  const [ready, setReady] = useState(0);
  const source = useStore((s) => display(s, file));
  const boards = useBoardFiles([file]);
  const project = useStore((s) => s.project);
  const assetRev = useStore((s) => s.assetRev);
  const deckHead = useStore((s) => (scene ? '' : faceMarkup(deckOf(s))));
  const faces = scene?.faces;
  const head = useMemo(() => (faces ? faceMarkup({ faces } as DeckJson) : deckHead), [faces, deckHead]);
  const deckW = useStore((s) => deckSize(deckOf(s))[0]);
  const deckH = useStore((s) => deckSize(deckOf(s))[1]);
  const [W, H] = scene?.info.size ?? [deckW, deckH];
  const drawn = scene ? JSON.stringify([scene.info.format, scene.info.formats, scene.info.size]) : '';
  const t = scene?.info.t ?? 0;
  const landed = !!scene?.info.landed;
  const info = useRef(scene?.info);
  info.current = scene?.info;
  const selected = useStore((s) => (use === 'stage' && s.selection?.kind === 'el' && s.selection.file === file ? s.selection.tid : null));
  const hover = useStore((s) => (use === 'stage' && s.layerHover?.file === file ? s.layerHover.tid : null));
  const srcdoc = useMemo(() => sandboxDoc(SERVER, 'runtime', htmlLang()), []);
  const mode = use === 'present' ? 'play' : 'edit';
  const slide = useMemo(() => ({ head, base: project ? api.frameBase(project, assetRev) : '', still: use === 'thumb', size: [W, H] as [number, number] }), [head, project, use, assetRev, W, H]);
  const stepsCb = useRef(onSteps);
  stepsCb.current = onSteps;

  useEffect(() => {
    if (use !== 'stage') return;
    const el = frame.current;
    if (el) frames.set(file, el);
    return () => {
      if (frames.get(file) === el) frames.delete(file);
    };
  }, [file, use]);

  // a layout effect: the listener must be there before the frame can say `ready`, or the slide is never drawn
  useLayoutEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const m = e.data as FromRuntime;
      if (!m || typeof m !== 'object' || !('dc' in m)) return;
      if (m.dc === 'ready') return setReady((n) => n + 1);
      if (m.dc === 'steps') return stepsCb.current?.(m.total);
      if (m.dc === 'key') return void handleKey(m.key, m.meta, m.shift, m.alt);
      if (use !== 'stage') return;
      switch (m.dc) {
        case 'select':
          stageSelect(file, m.tid);
          break;
        case 'inspect':
          stageInspect(m, file);
          break;
        case 'counts':
          stageCounts(m.counts, file);
          break;
        case 'contextmenu': {
          const r = frame.current.getBoundingClientRect();
          useStore.setState({ menu: { x: r.left + m.x * scale, y: r.top + m.y * scale } });
          break;
        }
        case 'text':
          editElement(file, [{ kind: 'text', tid: m.tid, text: m.text }]);
          break;
        case 'move':
          stageMove(m, file);
          break;
        case 'resize':
          stageResize(m, file);
          break;
        case 'dragout': {
          // the subset has no margin: drop the margin:0 an artboard drag adds
          const set = { ...m.set };
          delete set.margin;
          const ops = [{ kind: 'styles' as const, tid: m.tid, set }];
          if (m.parentTid !== null && Object.keys(m.parentSet).length) {
            // pinned children of the section itself need no relative parent or frozen height
            const doc = src0();
            const parent = doc?.elements[m.parentTid];
            if (parent?.parent) ops.push({ kind: 'styles', tid: m.parentTid, set: m.parentSet });
          }
          editElement(file, ops);
          break;
        }
        case 'error':
          useStore.setState((st) => (st.runtimeErrors[file] === m.message ? {} : { runtimeErrors: { ...st.runtimeErrors, [file]: m.message } }));
          break;
      }
    };
    const src0 = () => {
      const src = display(useStore.getState(), file);
      return src ? parsed(src) : null;
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [file, use, scale]);

  useEffect(() => {
    if (!ready || source === undefined) return;
    const motion = drawn ? info.current : undefined;
    frame.current?.contentWindow?.postMessage({ dc: 'render', file, source, files: boards, props: {}, mode, selected, slide, motion }, '*');
  }, [ready, source, boards, mode, file, selected, slide, drawn]);

  // moving the playhead only seeks: the scene is not drawn again
  useEffect(() => {
    if (ready && drawn) frame.current?.contentWindow?.postMessage({ dc: 'seek', t, landed }, '*');
  }, [ready, t, landed, drawn]);

  useEffect(() => {
    if (ready && use === 'present') frame.current?.contentWindow?.postMessage({ dc: 'step', step }, '*');
  }, [ready, step, use]);

  useEffect(() => {
    if (ready && use === 'stage') post(file, { dc: 'hover', tid: hover });
  }, [ready, hover, file, use]);

  return (
    <div className={`sframe f-${use}`} style={{ width: W * scale, height: H * scale }}>
      <div className="sinner" style={{ width: W, height: H, transform: `scale(${scale})` }}>
        <iframe ref={frame} title={id} sandbox="allow-scripts allow-popups" srcDoc={srcdoc} tabIndex={use === 'thumb' ? -1 : undefined} />
      </div>
    </div>
  );
});
