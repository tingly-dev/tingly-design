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
      /** a slide file: the deck's typefaces and where its relative image paths live */
      slide?: { head: string; base: string; still?: boolean };
    }
  | { dc: 'select'; tid: number | null }
  | { dc: 'hover'; tid: number | null }
  | { dc: 'mode'; mode: Mode }
  | { dc: 'export'; id: string; scale: number }
  /** start retyping an element's text in place */
  | { dc: 'edit'; tid: number }
  /** presenting a slide: show its builds up to this step */
  | { dc: 'step'; step: number };

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
  /** a slide in play mode: how many click steps its builds take */
  | { dc: 'steps'; total: number }
  | { dc: 'navigate'; href: string };

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
    `script-src ${origin}/sandbox/ 'unsafe-eval'`,
    `style-src 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src https://fonts.gstatic.com ${origin}/api/ data:`,
    `frame-src ${origin}/sandbox/`,
    `img-src * data: blob:`,
    `media-src * data: blob:`,
  ].join('; ');
}

/** The page a slide's <x-embed> runs in: its own opaque origin, no network, inline scripts allowed. */
export const EMBED_CSP = `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:`;

export function sandboxDoc(origin: string, kind: 'runtime' | 'executor'): string {
  const script = kind === 'runtime' ? 'runtime.js' : 'executor.js';
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${cspFor(origin, kind)}">
<style>html,body{margin:0}</style></head><body><div id="dc-app"></div>
<script src="${origin}/sandbox/${script}"></script></body></html>`;
}
