/**
 * The slide subset's own elements, rendered inside a slide frame:
 * `<x-shape>`, `<x-icon>`, `<x-connector>` and `<x-embed>`, plus the build
 * animations of present mode. Each keeps its tag and `data-dc-tid` in the DOM,
 * so selection, dragging and the panel treat it like any other element.
 */
import React from 'react';
import { connectorArt, iconArt, parseStyle, shapeArt, styleObject } from '@dc/core';

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
