import { useEffect, useLayoutEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { SLIDE_H, SLIDE_W, slideFile, slideNotes } from '@dc/core';
import { display, slidesOf, toast, useStore } from '../../store';
import { isSkipped } from '../../deck';
import { SlideFrame } from './SlideFrame';

/**
 * Present: the deck full screen, one slide at a time. Skipped slides are
 * left out; a slide's pinned `data-build-in` children come in one step per
 * click before the next slide; `data-transition` is how a slide leaves.
 */

const get = useStore.getState;
const set = useStore.setState;

type Kind = 'fade' | 'push' | 'none';

function shownIds(s: ReturnType<typeof get>): string[] {
  return slidesOf(s).filter((id) => !isSkipped(display(s, slideFile(id))));
}

function transitionOf(id: string): Kind {
  const src = display(get(), slideFile(id)) ?? '';
  const m = /^\s*<section\b[^>]*\bdata-transition=(["'])(\w+)\1/i.exec(src);
  const t = m?.[2];
  // magic move matches elements across slides; until that lands it reads as a fade
  return t === 'push' ? 'push' : t === 'fade' || t === 'magic' ? 'fade' : 'none';
}

let entered = false;

export function startPresenting(from: string | null): void {
  const s = get();
  const ids = shownIds(s);
  if (!ids.length) return toast('每张幻灯片都被跳过了，先取消跳过一张再演示。');
  const all = slidesOf(s);
  let index = 0;
  if (from) {
    // a skipped slide: start at the next one that is shown
    const after = all.slice(all.indexOf(from)).find((id) => ids.includes(id));
    index = Math.max(0, after ? ids.indexOf(after) : 0);
  }
  set({ presenting: { index, step: 0, notes: false }, menu: null });
  entered = false;
  document.documentElement
    .requestFullscreen?.()
    .then(() => (entered = true))
    .catch(() => {});
}

export function stopPresenting(): void {
  const p = get().presenting;
  if (!p) return;
  const ids = shownIds(get());
  set({ presenting: null, slide: ids[p.index] ?? get().slide });
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

let handler: ((key: string) => boolean) | null = null;
/** Keys while presenting (from the window or forwarded by a frame). */
export function presenterKey(key: string): boolean {
  return handler?.(key) ?? false;
}

export function Presenter() {
  const p = useStore((s) => s.presenting);
  const ids = useStore(useShallow((s) => shownIds(s)));
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [leaving, setLeaving] = useState<{ id: string; kind: Kind; dir: 1 | -1; at: number } | null>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [hud, setHud] = useState(true);

  useLayoutEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  useEffect(() => {
    const on = () => {
      if (entered && !document.fullscreenElement) stopPresenting();
    };
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  // the hud (counter, hint) fades after a moment of no input
  useEffect(() => {
    setHud(true);
    const t = setTimeout(() => setHud(false), 2500);
    return () => clearTimeout(t);
  }, [p?.index, p?.step]);

  const index = Math.min(p?.index ?? 0, Math.max(0, ids.length - 1));
  const cur = ids[index];

  const go = (delta: 1 | -1) => {
    const st = get().presenting;
    if (!st) return;
    const curId = ids[st.index];
    if (delta > 0) {
      if (st.step < (counts[curId] ?? 0)) return set({ presenting: { ...st, step: st.step + 1 } });
      if (st.index >= ids.length - 1) return toast('已经是最后一张了。按 Esc 退出演示。');
      setLeaving({ id: curId, kind: transitionOf(curId), dir: 1, at: Date.now() });
      set({ presenting: { ...st, index: st.index + 1, step: 0 } });
    } else {
      if (st.step > 0) return set({ presenting: { ...st, step: st.step - 1 } });
      if (st.index <= 0) return;
      const prev = ids[st.index - 1];
      setLeaving({ id: curId, kind: transitionOf(prev), dir: -1, at: Date.now() });
      set({ presenting: { ...st, index: st.index - 1, step: counts[prev] ?? 0 } });
    }
  };

  handler = (key: string) => {
    const st = get().presenting;
    if (!st) return false;
    if (key === 'Escape') stopPresenting();
    else if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown' || key === ' ' || key === 'Enter') go(1);
    else if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp' || key === 'Backspace') go(-1);
    else if (key === 'Home') set({ presenting: { ...st, index: 0, step: 0 } });
    else if (key === 'End') set({ presenting: { ...st, index: ids.length - 1, step: 0 } });
    else if (key === 'n' || key === 'N') set({ presenting: { ...st, notes: !st.notes } });
    else return false;
    return true;
  };

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(null), leaving.kind === 'none' ? 0 : 620);
    return () => clearTimeout(t);
  }, [leaving]);

  const notes = useStore((s) => (cur ? slideNotes(display(s, slideFile(cur)) ?? '') : ''));
  if (!p || !cur) return null;

  const scale = Math.min(size.w / SLIDE_W, size.h / SLIDE_H);
  // the slides around the current one stay mounted, so moving to them is instant
  const mounted = [...new Set([ids[index - 1], cur, ids[index + 1], leaving?.id].filter((x): x is string => !!x))];
  const anim = leaving && leaving.kind !== 'none' ? `t-${leaving.kind} d-${leaving.dir > 0 ? 'fwd' : 'back'}` : '';

  return (
    <div
      className="presenter"
      role="dialog"
      aria-label="演示"
      onClick={() => go(1)}
      onContextMenu={(e) => {
        e.preventDefault();
        go(-1);
      }}
      onMouseMove={() => setHud(true)}
    >
      {mounted.map((id) => {
        const role = id === cur ? (leaving && leaving.id !== cur ? `on entering ${anim}` : 'on') : leaving?.id === id ? `leaving ${anim}` : 'off';
        return (
          <div key={id} className={`p-layer ${role}`}>
            <SlideFrame
              file={slideFile(id)}
              scale={scale}
              mode="play"
              step={id === cur ? p.step : id === leaving?.id && leaving.dir > 0 ? counts[id] ?? 0 : 0}
              onBuilds={(c) => setCounts((m) => (m[id] === c ? m : { ...m, [id]: c }))}
              label={`第 ${ids.indexOf(id) + 1} 张`}
            />
          </div>
        );
      })}
      {p.notes && (
        <div className="p-notes" onClick={(e) => e.stopPropagation()}>
          {notes || <span className="muted">这张幻灯片没有备注。</span>}
        </div>
      )}
      <div className={`p-hud ${hud ? 'show' : ''}`} aria-live="polite">
        <span>
          {index + 1} / {ids.length}
        </span>
        <span className="muted">← → 翻页 · N 备注 · Esc 退出</span>
      </div>
    </div>
  );
}
