/**
 * One scene's timing, applied to elements already on the page: its timing
 * attributes become paused Web Animations, so setting a time shows exactly
 * that frame. The player (motion.ts, all scenes on one clock) and the editor
 * stage (runtime.tsx, the scene under the playhead) both use this, so what
 * you edit and what you export are drawn by the same rules.
 */
import { countText, easeProgress, planScene, type SceneElement } from '@dc/core';

interface Counter {
  el: Element;
  text: string;
  start: number;
  duration: number;
  easing: string;
}

interface Placed {
  el: Element;
  anim: Animation;
  kind: 'in' | 'out' | 'keys';
}

export interface SceneAnim {
  issues: { index: number; level: string; message: string }[];
  /** When each element is on screen, relative to the scene start. */
  visible: { el: Element; from: number; to: number }[];
  /**
   * Show time `t` (from the start of the whole timeline the scene sits on).
   * Elements in `rest` are drawn landed: entrance done, exit not begun,
   * the final number of a count; keyframe tracks still follow `t`.
   */
  setTime(t: number, rest?: ReadonlySet<Element>): void;
  /** Cancel every animation and put counted text back, so the page is as written. */
  clear(): void;
}

/**
 * Plan and attach a scene's animations. `els` is the section and then its
 * descendants in source order, the list `planScene` indexes into; `start` is
 * where the scene begins on the timeline.
 */
export function animateScene(els: Element[], start: number, duration: number): SceneAnim {
  const elements: SceneElement[] = els.map((el) => ({
    tag: el.tagName.toLowerCase(),
    attrs: Object.fromEntries(Array.from(el.attributes).map((a) => [a.name, a.value])),
    text: el.children.length ? undefined : (el.textContent ?? ''),
  }));
  const plan = planScene(elements, duration);
  const placed: Placed[] = [];
  const counters: Counter[] = [];
  for (const p of plan.plans) {
    const el = els[p.index];
    if (p.kind === 'count') {
      counters.push({ el, text: el.textContent ?? '', start: start + p.delay, duration: p.duration, easing: p.easing });
      continue;
    }
    const anim = el.animate(p.keyframes as Keyframe[], {
      delay: start + p.delay,
      duration: p.duration,
      easing: p.easing,
      // an exit must not hold its first frame over the entrance before it
      fill: p.kind === 'out' || (p.kind === 'keys' && p.composite === 'replace') ? 'forwards' : 'both',
      composite: p.composite,
    });
    anim.pause();
    placed.push({ el, anim, kind: p.kind });
  }
  return {
    issues: plan.issues,
    visible: plan.visible.map((v) => ({ el: els[v.index], from: v.from, to: v.to })),
    setTime(t, rest) {
      for (const { el, anim, kind } of placed) {
        if (rest?.has(el) && kind !== 'keys') {
          const timing = anim.effect?.getComputedTiming();
          // landed: after the entrance's end, before the exit's delay
          anim.currentTime = kind === 'in' ? Number(timing?.endTime ?? 0) : 0;
        } else anim.currentTime = t;
      }
      for (const c of counters) setText(c.el, rest?.has(c.el) ? c.text : countText(c.text, easeProgress(c.easing, (t - c.start) / c.duration)));
    },
    clear() {
      for (const { anim } of placed) anim.cancel();
      for (const c of counters) setText(c.el, c.text);
    },
  };
}

/** Change a leaf's text in place: its one text node, so a renderer that owns the node keeps it. */
function setText(el: Element, text: string) {
  const node = el.firstChild;
  if (node && node.nodeType === Node.TEXT_NODE && el.childNodes.length === 1) {
    if (node.nodeValue !== text) node.nodeValue = text;
  } else if (el.textContent !== text) el.textContent = text;
}

/** Appended to a seekable embed: answers `seek` once the embed has drawn that time. */
export const SEEK_BRIDGE = `<script>
addEventListener('message', function (e) {
  var d = e.data;
  if (!d || d.dcMotion !== 'seek') return;
  var done = function () { requestAnimationFrame(function () { parent.postMessage({ dcMotion: 'seeked', n: d.n }, '*'); }); };
  try {
    var r;
    if (typeof window.seek === 'function') r = window.seek(d.t);
    else if (window.__timelines) for (var k in window.__timelines) window.__timelines[k].seek(d.t / 1000);
    Promise.resolve(r).then(done, done);
  } catch (err) { done(); }
});
parent.postMessage({ dcMotion: 'embed-ready' }, '*');
</script>`;
