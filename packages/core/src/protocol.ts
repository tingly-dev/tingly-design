import type { StatementResult } from './exec';

/** Messages between the editor and its sandboxed iframes. Every message carries `dc`. */

export type Mode = 'edit' | 'play';

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
    }
  | { dc: 'select'; tid: number | null }
  | { dc: 'mode'; mode: Mode };

export type FromRuntime =
  | { dc: 'ready' }
  | { dc: 'select'; tid: number | null; shift: boolean }
  | { dc: 'hover'; tid: number | null }
  | { dc: 'text'; tid: number; text: string }
  | { dc: 'wheel'; dx: number; dy: number; ctrl: boolean; x: number; y: number }
  | { dc: 'key'; key: string; meta: boolean; shift: boolean; alt: boolean }
  | { dc: 'error'; message: string | null }
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
    `font-src https://fonts.gstatic.com data:`,
    `img-src * data: blob:`,
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
