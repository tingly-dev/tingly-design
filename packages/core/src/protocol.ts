import type { StatementResult } from './exec';

/** Messages between the editor and its sandboxed iframes. Every message carries `dc`. */

export type Mode = 'edit' | 'play';

/** What the runtime measured about the selected element. */
export interface Inspect {
  tid: number;
  rect: { x: number; y: number; w: number; h: number };
  /** rendered instances (more than 1 inside an <sc-for>) */
  count: number;
  /** a subset of getComputedStyle */
  computed: Record<string, string>;
  /** the first opaque background behind the element, for contrast checks */
  backdrop: string;
  parent: { tid: number | null; display: string; flexDirection: string; position: string; hasHeight: boolean };
}

export type ToRuntime =
  | {
      dc: 'render';
      file: string;
      source: string;
      /** every board's source, for <dc-import> */
      files: Record<string, string>;
      props: Record<string, unknown>;
      mode: Mode;
      selected: number | null;
      /** a deck slide: 1920×1080 canvas with the slide subset's elements and defaults */
      slide?: SlideRender;
    }
  | { dc: 'select'; tid: number | null }
  | { dc: 'hover'; tid: number | null }
  | { dc: 'mode'; mode: Mode }
  | { dc: 'export'; id: string; scale: number }
  /** start retyping an element's text in place */
  | { dc: 'edit'; tid: number }
  /** present mode: show builds up to this step (0 = none yet) */
  | { dc: 'build'; step: number };

export interface SlideRender {
  /** Google Fonts stylesheets of the deck */
  fonts: string[];
  /** @font-face for font files inside the deck (src relative to `base`) */
  faces: { family: string; src: string }[];
  /** URL the slide's relative image paths resolve against */
  base: string;
  /** thumbnails: no live embeds, no motion */
  still?: boolean;
}

export type FromRuntime =
  | { dc: 'ready' }
  | { dc: 'select'; tid: number | null; shift: boolean; x: number; y: number }
  | { dc: 'inspect'; info: Inspect | null }
  | { dc: 'counts'; counts: Record<number, number> }
  | { dc: 'contextmenu'; tid: number | null; x: number; y: number }
  /** a drag inside the artboard: reorder among siblings */
  | { dc: 'move'; tid: number; target: number; where: 'before' | 'after' }
  /** a drag out of the flow: the element becomes absolutely positioned */
  | { dc: 'dragout'; tid: number; set: Record<string, string>; parentTid: number | null; parentSet: Record<string, string> }
  | { dc: 'exported'; id: string; dataUrl?: string; error?: string }
  | { dc: 'hover'; tid: number | null }
  | { dc: 'text'; tid: number; text: string }
  | { dc: 'wheel'; dx: number; dy: number; ctrl: boolean; x: number; y: number }
  | { dc: 'key'; key: string; meta: boolean; shift: boolean; alt: boolean }
  | { dc: 'error'; message: string | null }
  | { dc: 'navigate'; href: string }
  /** present mode: how many build steps this slide has */
  | { dc: 'builds'; count: number };

export type ToExecutor =
  | { dc: 'begin'; id: string; source: string }
  | { dc: 'run'; id: string; code: string }
  | { dc: 'markup'; id: string };

export type FromExecutor =
  | { dc: 'ready' }
  | { dc: 'begun'; id: string; markup: string }
  | ({ dc: 'result'; id: string } & StatementResult)
  | { dc: 'markup'; id: string; markup: string }
  | { dc: 'fail'; id: string; error: string };

export function cspFor(origin: string, kind: 'runtime' | 'executor'): string {
  if (kind === 'executor') {
    return `default-src 'none'; script-src ${origin}/sandbox/ 'unsafe-eval'; style-src 'unsafe-inline'`;
  }
  return [
    `default-src 'none'`,
    // 'unsafe-inline': a slide's <x-embed> is a srcdoc frame, which runs under this same policy
    `script-src ${origin}/sandbox/ 'unsafe-eval' 'unsafe-inline'`,
    `style-src 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src https://fonts.gstatic.com data:`,
    `img-src * data: blob:`,
    `frame-src data: blob: about:`,
    `media-src * data: blob:`,
  ].join('; ');
}

export function sandboxDoc(origin: string, kind: 'runtime' | 'executor'): string {
  const script = kind === 'runtime' ? 'runtime.js' : 'executor.js';
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${cspFor(origin, kind)}">
<style>html,body{margin:0}</style></head><body><div id="dc-app"></div>
<script src="${origin}/sandbox/${script}"></script></body></html>`;
}
