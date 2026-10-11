import { DesignCopy, applyPatches } from './copy';
import { setStyle, getStyle, kebab } from './style';

/**
 * Runs a fast-edit reply — jQuery statements, one per line — on an
 * artboard's copy and turns the result back into source after every line.
 *
 * This file is DOM-agnostic: the sandboxed executor passes its own window
 * and jQuery, tests pass happy-dom's. It must only ever run model output
 * inside a sandbox.
 */

const UNITLESS = new Set([
  'opacity', 'z-index', 'font-weight', 'line-height', 'flex', 'flex-grow', 'flex-shrink', 'order', 'zoom',
  'orphans', 'widows', 'column-count', 'fill-opacity', 'stroke-opacity', 'stroke-width', 'aspect-ratio',
  'grid-row', 'grid-column', 'tab-size', 'scale',
]);

export interface StatementResult {
  ok: boolean;
  /** source after this statement (unchanged on failure) */
  source: string;
  changed: boolean;
  error?: string;
  log?: string;
  delegate?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JQ = any;

export function installPlugins($: JQ, copy: () => DesignCopy): void {
  if ($.fn.__dcPatched) return;
  $.fn.__dcPatched = true;
  const setOne = (el: Element, prop: string, raw: unknown, i: number) => {
    const p = kebab(prop);
    let v = typeof raw === 'function' ? raw.call(el, i, getStyle(el.getAttribute('style') ?? '', p)) : raw;
    if (typeof v === 'number' && !UNITLESS.has(p)) v = `${v}px`;
    const value = v === '' || v === null || v === undefined ? null : String(v);
    const next = setStyle(el.getAttribute('style') ?? '', p, value);
    if (next.trim()) el.setAttribute('style', next);
    else el.removeAttribute('style');
  };
  // Styles are edited as text: a browser's CSSOM would drop declarations holding {{holes}}.
  $.fn.css = function (this: JQ, name: unknown, value?: unknown) {
    if (typeof name === 'string' && value === undefined) {
      const el = this[0] as Element | undefined;
      return el ? getStyle(el.getAttribute('style') ?? '', kebab(name)) : undefined;
    }
    return this.each(function (this: Element, i: number) {
      if (name && typeof name === 'object') {
        for (const [k, v] of Object.entries(name as Record<string, unknown>)) setOne(this, k, v, i);
      } else setOne(this, String(name), value, i);
    });
  };
  $.fn.show = function (this: JQ) {
    return this.css('display', null);
  };
  $.fn.hide = function (this: JQ) {
    return this.css('display', 'none');
  };
  $.fn.toggle = function (this: JQ, state?: boolean) {
    return this.each(function (this: Element) {
      const hidden = getStyle(this.getAttribute('style') ?? '', 'display') === 'none';
      const show = state === undefined ? hidden : state;
      $(this).css('display', show ? null : 'none');
    });
  };
  const origClone = $.fn.clone;
  $.fn.clone = function (this: JQ, ...args: unknown[]) {
    const out = origClone.apply(this, args);
    out.each(function (this: Element) {
      copy().stripHandles(this);
    });
    return out;
  };
  /** Stamp n copies of each element (the first is the element itself) and return them all. */
  $.fn.repeat = function (this: JQ, n: number) {
    const all: Element[] = [];
    this.each(function (this: Element) {
      all.push(this);
      let prev: Element = this;
      for (let k = 1; k < n; k++) {
        const c = this.cloneNode(true) as Element;
        copy().stripHandles(c);
        prev.after(c);
        prev = c;
        all.push(c);
      }
    });
    return this.pushStack(all);
  };
}

export class FastEditSession {
  readonly copy: DesignCopy;
  private last: unknown = undefined;
  private current: string;
  delegated = false;

  constructor(
    source: string,
    private readonly win: Window & typeof globalThis,
    private readonly $: JQ,
  ) {
    this.copy = new DesignCopy(source, win.document);
    this.current = source;
    const body = win.document.body;
    body.replaceChildren(this.copy.root);
    installPlugins($, () => this.copy);
  }

  get source(): string {
    return this.current;
  }

  markup(): string {
    return this.copy.markup();
  }

  private describe(x: unknown): string {
    const W = this.win;
    if (x && typeof x === 'object' && 'jquery' in (x as object)) {
      const arr = (x as JQ).toArray() as Node[];
      if (!arr.length) return '(no elements matched)';
      return arr.map((n) => this.copy.markup(n)).join('\n');
    }
    if (x instanceof W.Node) return this.copy.markup(x);
    if (x === undefined) return 'undefined';
    if (typeof x === 'string') return x;
    try {
      return JSON.stringify(x);
    } catch {
      return String(x);
    }
  }

  run(code: string): StatementResult {
    let src = code.trim().replace(/;+\s*$/, '');
    if (!src || src.startsWith('//')) return { ok: true, source: this.current, changed: false };
    const logs: string[] = [];
    const log = (...xs: unknown[]) => {
      logs.push(xs.map((x) => this.describe(x)).join(' '));
    };
    let delegate = false;
    const askClaude = () => {
      delegate = true;
      this.delegated = true;
    };
    const forget = () => {};
    const isChain = src.startsWith('.');
    if (isChain) {
      if (!this.last || typeof this.last !== 'object') {
        return { ok: false, source: this.current, changed: false, error: 'A line starting with "." needs the line before it to return elements.' };
      }
      src = '__last' + src;
    }
    let fn: (...a: unknown[]) => unknown;
    try {
      fn = new Function('$', 'jQuery', 'log', 'askClaude', 'forget', '__last', `"use strict";\nreturn (${src}\n);`) as typeof fn;
    } catch {
      try {
        fn = new Function('$', 'jQuery', 'log', 'askClaude', 'forget', '__last', `"use strict";\n${src}\n`) as typeof fn;
      } catch (e) {
        return { ok: false, source: this.current, changed: false, error: 'SyntaxError: ' + (e as Error).message };
      }
    }
    try {
      const v = fn(this.$, this.$, log, askClaude, forget, this.last);
      if (v && typeof v === 'object' && 'jquery' in (v as object)) this.last = v;
    } catch (e) {
      return { ok: false, source: this.current, changed: false, error: `${(e as Error).name}: ${(e as Error).message}` };
    }
    let next: string;
    try {
      next = applyPatches(this.copy.source, this.copy.patches());
    } catch (e) {
      return { ok: false, source: this.current, changed: false, error: 'Could not write the change back: ' + (e as Error).message };
    }
    const changed = next !== this.current;
    this.current = next;
    return { ok: true, source: next, changed, log: logs.length ? logs.join('\n') : undefined, delegate };
  }
}
