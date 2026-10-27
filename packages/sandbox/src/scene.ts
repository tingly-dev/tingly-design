/**
 * A motion scene on the stage: the scene's animations are attached to what
 * React just committed and the playhead's time is shown by moving elements,
 * so the editor stage and the player share one draw (sceneAnim.ts). Keep the
 * glue here; the timing itself lives in sceneAnim.ts.
 */
import { DEFAULT_SCENE_MS, parseTime } from '@dc/core';
import { post } from './post';
import { current, mount } from './stage';
import { instances } from './overlay';
import { animateScene, type SceneAnim } from './sceneAnim';

/** Pointer events follow what is on screen at the playhead; a landed (selected) element always takes them. */
export const MOTION_CSS = '[data-dc-off]{pointer-events:none}[data-dc-rest]{pointer-events:auto}';

let sceneAnim: SceneAnim | null = null;
let sceneVisible: { el: Element; from: number; to: number }[] = [];
let sceneEls: Element[] = [];

/** Attach the scene's animations to what React just committed, then show the playhead's time. */
export function animate() {
  sceneAnim?.clear();
  const section = mount.querySelector('.dc-slide-host > section');
  if (!section) return;
  const els = [section, ...Array.from(section.querySelectorAll('*'))];
  const duration = parseTime(section.getAttribute('data-duration') ?? undefined) ?? DEFAULT_SCENE_MS;
  sceneEls = els;
  sceneAnim = animateScene(els, 0, duration);
  sceneVisible = sceneAnim.visible;
  showTime();
}

/**
 * Stop the scene at the playhead; the selected element is drawn landed so what
 * you drag is what is written. On the scene's first moment every element is
 * landed, so the scene reads as a page to edit rather than an empty frame.
 */
export function showTime() {
  const m = current.motion;
  if (!m || !sceneAnim) return;
  const rest = new Set<Element>(m.landed ? sceneEls : current.mode === 'edit' && current.selected !== null ? instances(current.selected) : []);
  sceneAnim.setTime(m.t, rest);
  for (const { el, from, to } of sceneVisible) {
    const off = !m.landed && (m.t < from || m.t > to);
    if (off) el.setAttribute('data-dc-off', '');
    else el.removeAttribute('data-dc-off');
    if (rest.has(el)) el.setAttribute('data-dc-rest', '');
    else el.removeAttribute('data-dc-rest');
  }
  for (const f of Array.from(mount.querySelectorAll('x-embed[data-seek] > iframe')) as HTMLIFrameElement[]) {
    f.contentWindow?.postMessage({ dcMotion: 'seek', t: m.t, n: -1 }, '*');
  }
}

/** What render() holds the page with before drawing a scene again. */
export function clearSceneAnim(): void {
  sceneAnim?.clear();
  sceneAnim = null;
}

// a seekable embed that just loaded draws the playhead's time
window.addEventListener('message', (e) => {
  if (e.data?.dcMotion !== 'embed-ready' || !current.motion) return;
  (e.source as Window | null)?.postMessage({ dcMotion: 'seek', t: current.motion.t, n: -1 }, '*');
});
