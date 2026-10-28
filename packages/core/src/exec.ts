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
  /** other artboards (by file) this statement changed, as source; only the ones that changed */
  others?: Record<string, string>;
}

/** The ending an artboard's file name may leave off when a reply names it. */
const BOARD_EXT = '.dc.html';

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

/** An artboard other than the one being edited: parsed the first time a reply names it. */
interface OtherBoard {
  file: string;
  prefix: string;
  /** the source as the session last saw it */
  source: string;
  copy?: DesignCopy;
}

export class FastEditSession {
  readonly copy: DesignCopy;
  private last: unknown = undefined;
  private current: string;
  delegated = false;
  private readonly others = new Map<string, OtherBoard>();
  /** `$` that refuses a selector naming another artboard's handle; `board(file)` is how a line reaches one */
  private readonly guarded: JQ;

  /**
   * `others` are the sources of the artboards a reply may also reach, by file. They are not in the
   * document: only `board(file)` gets to them, and the handles of their elements carry their own
   * prefix (`b1_dc3`), so no handle ever names a different element than the one it was shown on.
   */
  constructor(
    source: string,
    private readonly win: Window & typeof globalThis,
    private readonly $: JQ,
    others: Record<string, string> = {},
  ) {
    this.copy = new DesignCopy(source, win.document);
    this.current = source;
    const body = win.document.body;
    body.replaceChildren(this.copy.root);
    installPlugins($, () => this.copy);
    this.guarded = Object.assign((sel: unknown, ...rest: unknown[]) => {
      this.checkSelector(sel);
      return $(sel, ...rest);
    }, $);
    Object.keys(others)
      .sort()
      .forEach((file, i) => this.others.set(file, { file, prefix: `b${i + 1}_dc`, source: others[file] }));
  }

  get source(): string {
    return this.current;
  }

  markup(): string {
    return this.copy.markup();
  }

  /** The other artboard a reply names: its file, or the file without its ending. */
  private board(name: unknown): OtherBoard {
    const key = String(name);
    const b = this.others.get(key) ?? this.others.get(key + BOARD_EXT);
    if (!b) {
      const names = [...this.others.keys()];
      throw new Error(`board(${JSON.stringify(key)}): no such artboard to reach from here.${names.length ? ` The others are ${names.map((n) => JSON.stringify(n)).join(', ')}.` : ' This design has no other artboard that can be edited.'}`);
    }
    b.copy ??= new DesignCopy(b.source, this.win.document, b.prefix);
    return b;
  }

  /** A selector that holds another artboard's handle was not written to reach it: refuse, and say how. */
  private checkSelector(sel: unknown): void {
    if (typeof sel !== 'string') return;
    for (const m of sel.matchAll(/#(b\d+)_dc\d+/g)) {
      const b = [...this.others.values()].find((o) => o.prefix.startsWith(m[1] + '_'));
      if (b) throw new Error(`${m[0]} is a part of the artboard ${JSON.stringify(b.file)}. A line that reaches another artboard must name it: board(${JSON.stringify(b.file)}).find('${m[0]}')`);
    }
  }

  /** The copy a node belongs to (the artboard being edited, or one a reply reached). */
  private ownerOf(node: Node): DesignCopy {
    for (const b of this.others.values()) if (b.copy && b.copy.root.contains(node)) return b.copy;
    return this.copy;
  }

  private describe(x: unknown): string {
    const W = this.win;
    if (x && typeof x === 'object' && 'jquery' in (x as object)) {
      const arr = (x as JQ).toArray() as Node[];
      if (!arr.length) return '(no elements matched)';
      return arr.map((n) => this.ownerOf(n).markup(n)).join('\n');
    }
    if (x instanceof W.Node) return this.ownerOf(x).markup(x);
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
    // `$` is jQuery that refuses a selector naming another artboard's handle; `board(file)` is how a line reaches one
    const guarded = this.guarded;
    const board = (name: unknown) => {
      const roots = this.$(this.board(name).copy!.root).children().not('helmet, style, script');
      if (!roots.length) throw new Error(`board(${JSON.stringify(String(name))}): that artboard has no element yet to put anything in.`);
      return roots;
    };
    const isChain = src.startsWith('.');
    if (isChain) {
      if (!this.last || typeof this.last !== 'object') {
        return { ok: false, source: this.current, changed: false, error: 'A line starting with "." needs the line before it to return elements.' };
      }
      src = '__last' + src;
    }
    let fn: (...a: unknown[]) => unknown;
    try {
      fn = new Function('$', 'jQuery', 'log', 'askClaude', 'forget', 'board', '__last', `"use strict";\nreturn (${src}\n);`) as typeof fn;
    } catch {
      try {
        fn = new Function('$', 'jQuery', 'log', 'askClaude', 'forget', 'board', '__last', `"use strict";\n${src}\n`) as typeof fn;
      } catch (e) {
        return { ok: false, source: this.current, changed: false, error: 'SyntaxError: ' + (e as Error).message };
      }
    }
    try {
      const v = fn(guarded, guarded, log, askClaude, forget, board, this.last);
      if (v && typeof v === 'object' && 'jquery' in (v as object)) this.last = v;
    } catch (e) {
      return { ok: false, source: this.current, changed: false, error: `${(e as Error).name}: ${(e as Error).message}` };
    }
    // a part goes to another artboard only as a copy: a moved one is still tied to the source of its first artboard
    const copies = [this.copy, ...[...this.others.values()].flatMap((b) => (b.copy ? [b.copy] : []))];
    if (copies.length > 1 && copies.some((c) => Array.from(c.root.querySelectorAll('*')).some((el) => copies.some((o) => o !== c && o.sourceOf(el))))) {
      return { ok: false, source: this.current, changed: false, error: 'A line moved a part from one artboard to another. A part goes to another artboard as a copy, and the original stays: $(\'#dc9\').clone().appendTo(board(\'Other.dc.html\'))' };
    }
    let next: string;
    const others: Record<string, string> = {};
    try {
      next = applyPatches(this.copy.source, this.copy.patches());
      for (const b of this.others.values()) {
        if (!b.copy) continue;
        const text = applyPatches(b.copy.source, b.copy.patches());
        if (text !== b.source) {
          b.source = text;
          others[b.file] = text;
        }
      }
    } catch (e) {
      return { ok: false, source: this.current, changed: false, error: 'Could not write the change back: ' + (e as Error).message };
    }
    const changed = next !== this.current || Object.keys(others).length > 0;
    this.current = next;
    return { ok: true, source: next, changed, log: logs.length ? logs.join('\n') : undefined, delegate, ...(Object.keys(others).length ? { others } : {}) };
  }
}
