/**
 * Message handling: everything the editor sends into the frame (render,
 * selection, seek, mode, steps, export, edit-in-place), and the embed seek
 * channel a host uses for a moving artboard. The gestures answer with their
 * own messages from input.ts; this is the frame's inbox.
 */
import type { FromRuntime, MotionStageInfo, ToRuntime } from '@dc/core';
import { answerSnaps } from '@dc/export/snap';
import { post } from './post';
import { current, mount } from './stage';
import { instances, overlay, setExternalHover } from './overlay';
import { showTime } from './scene';
import { render, rerender, committedSource } from './render';
import { beginText, editableTids } from './text';
import { inspect } from './inspect';
import { docFor } from './template';
import { showSteps } from './slide';
import { flushSync } from 'react-dom';

// an artboard embedded in a slide or scene hands the page a picture of itself when it exports (.design/export.md)
answerSnaps();

/** What went wrong in a picture: html-to-image rejects with the failing <img>'s load Event, which has no message of its own. */
function exportError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return typeof err === 'string' && err ? err : 'the picture could not be made';
}

async function exportPng(id: string, scale: number, tid?: number) {
  const prevSel = current.selected;
  try {
    const node = (tid === undefined ? mount.querySelector('[data-dc-tid]') : instances(tid)[0]) as HTMLElement | null;
    if (!node) throw new Error('nothing to export');
    const broken = [...node.querySelectorAll('img')].find((i) => i.complete && !i.naturalWidth && i.getAttribute('src'));
    if (broken) throw new Error(`could not load the picture ${broken.getAttribute('src')!.slice(0, 120)}`);
    const { toPng } = await import('html-to-image');
    current.selected = null;
    overlay.innerHTML = '';
    const dataUrl = await toPng(node, { pixelRatio: scale, skipFonts: true, cacheBust: false });
    post({ dc: 'exported', id, dataUrl });
  } catch (err) {
    post({ dc: 'exported', id, error: exportError(err) });
  } finally {
    current.selected = prevSel;
  }
}

export function onMessage(m: ToRuntime) {
  if (m.dc === 'render') {
    if (current.editing) {
      current.pending = m;
      return;
    }
    const slide = m.slide ?? null;
    const motion = m.motion ?? null;
    const drawn = (x: MotionStageInfo | null) => (x ? JSON.stringify([x.format, x.formats, x.size]) : '');
    const changed =
      m.source !== current.source ||
      m.files !== current.files ||
      JSON.stringify(m.props) !== JSON.stringify(current.props) ||
      m.mode !== current.mode ||
      JSON.stringify(slide) !== JSON.stringify(current.slide) ||
      (m.base ?? '') !== current.base ||
      drawn(motion) !== drawn(current.motion);
    if (m.mode !== current.mode || m.source !== current.source) current.step = 0;
    Object.assign(current, { file: m.file, source: m.source, files: m.files, props: m.props, mode: m.mode, selected: m.selected, slide, base: m.base ?? '', motion });
    document.documentElement.dataset.mode = m.mode;
    if (changed) render();
    else showTime();
  } else if (m.dc === 'select') {
    current.selected = m.tid;
    showTime();
    inspect();
  } else if (m.dc === 'seek') {
    if (current.motion) current.motion = { ...current.motion, t: m.t, landed: m.landed };
    showTime();
  } else if (m.dc === 'hover') {
    setExternalHover(m.tid);
  } else if (m.dc === 'mode') {
    current.mode = m.mode;
    document.documentElement.dataset.mode = m.mode;
    rerender();
  } else if (m.dc === 'step') {
    current.step = m.step;
    post({ dc: 'steps', total: showSteps(mount, m.step) });
  } else if (m.dc === 'export') {
    void exportPng(m.id, m.scale, m.tid);
  } else if (m.dc === 'edit') {
    // the element may only exist after the render that is on its way
    let tries = 0;
    const tid = m.tid;
    const attempt = () => {
      // tids are positions in the source: only trust them once that source is rendered
      const el = committedSource === current.source ? (instances(tid)[0] as HTMLElement | undefined) : undefined;
      if (el && editableTids().has(tid)) {
        current.selected = tid;
        showTime();
        beginText(el);
      } else if (tries++ < 20) setTimeout(attempt, 50);
    };
    attempt();
  }
}

/**
 * An artboard drawn inside an embed (a slide's or a motion scene's): its host
 * seeks it like any seekable embed. It draws that time at once and answers
 * once the frame has it, so a render waits for the right picture.
 */
function seekBoard(t: number, n: number) {
  current.time = t;
  if (current.source && !docFor(current.source).slide) flushSync(render);
  requestAnimationFrame(() => post({ dcMotion: 'seeked', n } as unknown as FromRuntime));
}

window.addEventListener('message', (e) => {
  if (e.source !== window.parent) return;
  const d = e.data as { dcMotion?: string; t?: unknown; n?: unknown } | null;
  if (d && d.dcMotion === 'seek' && typeof d.t === 'number') return seekBoard(d.t, typeof d.n === 'number' ? d.n : -1);
  const m = e.data as ToRuntime;
  if (!m || typeof m !== 'object' || !('dc' in m)) return;
  onMessage(m);
});

window.addEventListener('error', (e) => post({ dc: 'error', message: e.message }));
