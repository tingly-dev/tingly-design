/**
 * The slide subset's own elements, rendered inside a slide frame:
 * `<x-shape>`, `<x-icon>`, `<x-connector>` and `<x-embed>`, plus the build
 * animations of present mode. Each keeps its tag and `data-dc-tid` in the DOM,
 * so selection, dragging and the panel treat it like any other element.
 */
import React from 'react';
import { boardFrameDoc, boardSize, connectorArt, coverFit, iconArt, parseDc, parseStyle, shapeArt, styleObject } from '@dc/core';

type Props = Record<string, unknown> & { style?: Record<string, string> };

/** The folder runtime.js was loaded from (…/sandbox/), under whatever base the server has. */
const RUNTIME_DIR = (() => {
  try {
    return new URL('.', (document.currentScript as HTMLScriptElement | null)?.src ?? location.href).href;
  } catch {
    return '';
  }
})();

// ------------------------------------------------- shapes, icons, connectors

/** `<x-shape>`, `<x-icon>`, `<x-connector>`: the shared drawings (core/slideArt), inside the element. */
export function XArt({ tag, props, attrs }: { tag: string; props: Props; attrs: Record<string, string> }) {
  const raw = attrs.style ?? '';
  const art = tag === 'x-shape' ? shapeArt(attrs.kind ?? 'rect', raw) : tag === 'x-icon' ? iconArt(attrs.name ?? '', raw) : connectorArt(attrs, raw);
  const style = { ...(props.style ?? {}), ...styleObject(Object.entries(art.style).map(([k, v]) => `${k}:${v}`).join(';')) };
  if (tag === 'x-connector' && style.position === 'absolute') style.pointerEvents = 'none';
  return React.createElement(tag, { ...props, style, dangerouslySetInnerHTML: { __html: art.inner } });
}

// ------------------------------------------------------------------ embeds

/**
 * `<x-embed>`: its markup runs in a nested frame on our embed page (its own
 * CSP, no network, opaque origin). In edit mode the frame takes no pointer
 * events, so a click selects the embed instead.
 */
export function XEmbed({ props, html, mode, still }: { props: Props; html: string; mode: string; still?: boolean }) {
  const ref = React.useRef<HTMLIFrameElement>(null);
  React.useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow || e.data?.dcEmbed !== 'ready') return;
      frame.contentWindow?.postMessage({ dcEmbed: 'html', html }, '*');
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [html]);
  if (still) {
    // thumbnails: a live page per thumbnail would starve the editor, so a quiet placeholder
    return React.createElement(
      'x-embed',
      props,
      <div style={{ width: '100%', height: '100%', borderRadius: 24, border: '6px dashed rgba(127,127,127,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="30%" height="30%" viewBox="0 0 24 24" fill="rgba(127,127,127,.55)" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
      </div>,
    );
  }
  return React.createElement(
    'x-embed',
    props,
    <iframe
      key={html}
      ref={ref}
      src={`${RUNTIME_DIR}embed.html`}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      tabIndex={-1}
      title="embed"
      style={{ display: 'block', width: '100%', height: '100%', border: 0, background: 'transparent', pointerEvents: mode === 'play' ? 'auto' : 'none' }}
    />,
  );
}

/**
 * `<x-embed src="uploads/…/X.dc.html">`: an artboard imported from a canvas,
 * run by the artboard runtime in its own frame and scaled to cover the embed.
 * `files` holds it and the siblings it mounts. On a motion stage the runtime
 * seeks it with the playhead (the frame is the embed's direct child, as
 * `showTime` expects); presenting a slide, it is given the time since the
 * slide appeared, so a moving artboard loops; otherwise it stands at its still.
 */
export function XBoard({
  props,
  src,
  files,
  tweaks,
  base,
  mode,
  still,
  live,
}: {
  props: Props;
  src: string;
  files: Record<string, string>;
  tweaks: Record<string, unknown>;
  base: string;
  mode: string;
  still?: boolean;
  /** run the artboard's clock (presenting a slide) */
  live?: boolean;
}) {
  const host = React.useRef<HTMLElement>(null);
  const ref = React.useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = React.useState(false);
  const [box, setBox] = React.useState<[number, number]>([0, 0]);
  const source = files[src];
  const size = React.useMemo(() => (source ? boardSize(parseDc(source).props) : null) ?? [1280, 720], [source]) as [number, number];
  const doc = React.useMemo(() => boardFrameDoc({ src: `${RUNTIME_DIR}runtime.js` }), []);
  React.useEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => setBox([el.offsetWidth, el.offsetHeight]);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  React.useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source === ref.current?.contentWindow && e.data?.dc === 'ready') setReady(true);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  React.useEffect(() => {
    if (!ready || source === undefined) return;
    ref.current?.contentWindow?.postMessage({ dc: 'render', file: src, source, files, props: tweaks, mode: 'play', selected: null, base: base || undefined }, '*');
  }, [ready, src, source, files, tweaks, base]);
  React.useEffect(() => {
    if (!ready || !live) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      ref.current?.contentWindow?.postMessage({ dcMotion: 'seek', t: performance.now() - t0, n: -1 }, '*');
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, live]);
  const style = { ...(props.style ?? {}), overflow: 'hidden' } as Record<string, string>;
  if (still || source === undefined) {
    return React.createElement(
      'x-embed',
      { ...props, ref: host, style },
      <div style={{ width: '100%', height: '100%', background: 'repeating-linear-gradient(45deg, rgba(127,127,127,.18) 0 12px, rgba(127,127,127,.08) 12px 24px)' }} />,
    );
  }
  const fit = coverFit(size, box[0] && box[1] ? box : size);
  return React.createElement(
    'x-embed',
    { ...props, ref: host, style },
    <iframe
      ref={ref}
      srcDoc={doc}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      tabIndex={-1}
      title={src}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: size[0],
        height: size[1],
        border: 0,
        background: 'transparent',
        transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`,
        transformOrigin: '0 0',
        pointerEvents: mode === 'play' ? 'auto' : 'none',
      }}
    />,
  );
}

// ------------------------------------------------------------------ builds

/** data-build-in="fade|rise|drop|left|right|scale|pop [order N] [auto]" */
export function parseBuild(v: string): { effect: string; order: number; auto: boolean } {
  const parts = v.trim().split(/\s+/);
  const effect = parts[0] || 'fade';
  const oi = parts.indexOf('order');
  const order = oi >= 0 ? Number(parts[oi + 1]) || 0 : 0;
  return { effect, order, auto: parts.includes('auto') };
}

export const BUILD_CSS = `
html[data-mode=play] [data-build-in]{transition:opacity .55s ease,translate .6s cubic-bezier(.2,.8,.2,1),scale .6s cubic-bezier(.2,.8,.2,1)}
html[data-mode=play] [data-build-in]:not(.dc-in){opacity:0!important}
html[data-mode=play] [data-build-in^=rise]:not(.dc-in){translate:0 48px}
html[data-mode=play] [data-build-in^=drop]:not(.dc-in){translate:0 -48px}
html[data-mode=play] [data-build-in^=left]:not(.dc-in){translate:-96px 0}
html[data-mode=play] [data-build-in^=right]:not(.dc-in){translate:96px 0}
html[data-mode=play] [data-build-in^=scale]:not(.dc-in){scale:.85}
html[data-mode=play] [data-build-in^=pop]:not(.dc-in){scale:.4}
html[data-mode=play] [data-build-in^=pop].dc-in{transition:opacity .3s ease,scale .5s cubic-bezier(.3,1.6,.5,1)}
`;

/** Group a slide's builds into click steps: an `auto` build plays with the step before it. */
export function buildSteps(root: ParentNode): Element[][] {
  const els = Array.from(root.querySelectorAll('[data-build-in]'));
  const sorted = els
    .map((el, i) => ({ el, i, ...parseBuild(el.getAttribute('data-build-in') ?? '') }))
    .sort((a, b) => (a.order || 1e6 + a.i) - (b.order || 1e6 + b.i));
  const steps: Element[][] = [[]];
  for (const b of sorted) {
    if (b.auto) steps[steps.length - 1].push(b.el);
    else steps.push([b.el]);
  }
  return steps;
}

/** Reveal builds up to `step` (0 = only the slide's automatic ones). Returns the number of click steps. */
export function showSteps(root: ParentNode, step: number): number {
  const steps = buildSteps(root);
  steps.forEach((group, i) => {
    for (const el of group) {
      if (i <= step) {
        // stagger automatic builds a little so they read as a sequence
        const j = group.indexOf(el);
        setTimeout(() => el.classList.add('dc-in'), 60 + j * 180);
      } else el.classList.remove('dc-in');
    }
  });
  return steps.length - 1;
}

/** The raw markup inside an element, as written in the source. */
export function innerSource(source: string, inner: { start: number; end: number } | undefined): string {
  return inner ? source.slice(inner.start, inner.end) : '';
}

export { resolveSrc } from './urls';

export { parseStyle, styleObject };
