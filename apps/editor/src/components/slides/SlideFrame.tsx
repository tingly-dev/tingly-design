import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { SLIDE_H, SLIDE_W, elementSource, faceMarkup, sandboxDoc, slideFile, type DeckJson, type FromRuntime, type MotionStageInfo } from '@dc/core';
import { api } from '../../api';
import { deckOf, display, editElement, parsed, useStore } from '../../store';
import { frames, post } from '../Board';
import { handleKey } from '../../shortcuts';
import { SERVER } from '../../base';

export type FrameUse = 'stage' | 'thumb' | 'present';

/** After a move the element's tid changes; find it again by its own source text. */
function follow(file: string, slice: string | null, fallback: number): number {
  const src = display(useStore.getState(), file);
  if (!src || !slice) return fallback;
  return parsed(src).elements.find((e) => src.slice(e.range.start, e.range.end) === slice)?.tid ?? fallback;
}

/** A motion scene on the stage: its file, the piece's typefaces, the format and the time it is stopped at. */
export interface SceneStage {
  file: string;
  faces: DeckJson['faces'];
  info: MotionStageInfo;
}

/**
 * One slide in a sandboxed frame, laid out at 1920×1080 and scaled to fit.
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
  const [ready, setReady] = useState(false);
  const source = useStore((s) => display(s, file));
  const project = useStore((s) => s.project);
  const deckHead = useStore((s) => (scene ? '' : faceMarkup(deckOf(s))));
  const faces = scene?.faces;
  const head = useMemo(() => (faces ? faceMarkup({ faces } as DeckJson) : deckHead), [faces, deckHead]);
  const [W, H] = scene?.info.size ?? [SLIDE_W, SLIDE_H];
  const drawn = scene ? JSON.stringify([scene.info.format, scene.info.formats, scene.info.size]) : '';
  const t = scene?.info.t ?? 0;
  const info = useRef(scene?.info);
  info.current = scene?.info;
  const selected = useStore((s) => (use === 'stage' && s.selection?.kind === 'el' && s.selection.file === file ? s.selection.tid : null));
  const hover = useStore((s) => (use === 'stage' && s.layerHover?.file === file ? s.layerHover.tid : null));
  const srcdoc = useMemo(() => sandboxDoc(SERVER, 'runtime'), []);
  const mode = use === 'present' ? 'play' : 'edit';
  const slide = useMemo(() => ({ head, base: project ? api.rawBase(project) : '', still: use === 'thumb' }), [head, project, use]);
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

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const m = e.data as FromRuntime;
      if (!m || typeof m !== 'object' || !('dc' in m)) return;
      if (m.dc === 'ready') return setReady(true);
      if (m.dc === 'steps') return stepsCb.current?.(m.total);
      if (m.dc === 'key') return void handleKey(m.key, m.meta, m.shift, m.alt);
      if (use !== 'stage') return;
      const s = useStore.getState();
      switch (m.dc) {
        case 'select': {
          // the frame keeps focus where it was on a click; a field in the editor must let go
          const a = document.activeElement as HTMLElement | null;
          if (a && a !== frame.current && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) a.blur();
          useStore.setState({ selection: m.tid === null ? { kind: 'board', file } : { kind: 'el', file, tid: m.tid }, menu: null });
          break;
        }
        case 'inspect':
          if (!m.info || (s.selection?.kind === 'el' && s.selection.file === file)) useStore.setState({ inspect: m.info });
          break;
        case 'counts':
          useStore.setState((st) => ({ counts: { ...st.counts, [file]: m.counts } }));
          break;
        case 'contextmenu': {
          const r = frame.current.getBoundingClientRect();
          useStore.setState({ menu: { x: r.left + m.x * scale, y: r.top + m.y * scale } });
          break;
        }
        case 'text':
          editElement(file, [{ kind: 'text', tid: m.tid, text: m.text }]);
          break;
        case 'move': {
          const src = display(s, file);
          const slice = src ? elementSource(parsed(src), m.tid) : null;
          if (editElement(file, [{ kind: 'moveTo', tid: m.tid, target: m.target, where: m.where }]))
            useStore.setState({ selection: { kind: 'el', file, tid: follow(file, slice, m.tid) } });
          break;
        }
        case 'resize':
          editElement(file, [{ kind: 'styles', tid: m.tid, set: m.set }]);
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
    frame.current?.contentWindow?.postMessage({ dc: 'render', file, source, files: {}, props: {}, mode, selected, slide, motion }, '*');
  }, [ready, source, mode, file, selected, slide, drawn]);

  // moving the playhead only seeks: the scene is not drawn again
  useEffect(() => {
    if (ready && drawn) frame.current?.contentWindow?.postMessage({ dc: 'seek', t }, '*');
  }, [ready, t, drawn]);

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
