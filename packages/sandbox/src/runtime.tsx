/**
 * The artboard runtime: runs inside a sandboxed iframe, renders one
 * `.dc.html` with React, and turns pointer gestures into editor messages.
 *
 * In edit mode clicks select (they never reach the design's handlers),
 * double-click retypes literal text in place, and hover/selection outlines
 * are drawn here, inside the frame, so they line up at any canvas zoom.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  parseDc,
  styleObject,
  isTextEditable,
  VOID_ELEMENTS,
  type DcDoc,
  type DcElement,
  type DcNode,
  type FromRuntime,
  type Inspect,
  type Mode,
  type ToRuntime,
  type SlideRender,
} from '@dc/core';
import { collectBuilds, installSlide, renderConnector, renderEmbed, renderIcon, renderShape, resolveSrc, showBuilds } from './slide';

const post = (m: FromRuntime) => window.parent.postMessage(m, '*');

// ------------------------------------------------------------------ holes

type Scope = Record<string, unknown>;

function lookup(expr: string, scope: Scope): unknown {
  const e = expr.trim();
  if (e === 'true') return true;
  if (e === 'false') return false;
  if (e === 'null') return null;
  if (e === 'undefined' || e === '') return undefined;
  if (/^-?\d+(\.\d+)?$/.test(e)) return Number(e);
  if (/^(['"]).*\1$/.test(e)) return e.slice(1, -1);
  let v: unknown = scope;
  for (const part of e.split('.')) {
    if (v === null || v === undefined) return undefined;
    v = (v as Record<string, unknown>)[part];
  }
  return v;
}

const WHOLE = /^\s*\{\{\s*([^}]*?)\s*\}\}\s*$/;
const HOLE = /\{\{\s*([^}]*?)\s*\}\}/g;

function interp(s: string, scope: Scope): unknown {
  const m = WHOLE.exec(s);
  if (m) return lookup(m[1], scope);
  if (!s.includes('{{')) return s;
  return s.replace(HOLE, (_, p: string) => {
    const v = lookup(p, scope);
    return v === null || v === undefined ? '' : String(v);
  });
}

// ------------------------------------------------------------- attributes

const EVENTS: Record<string, string> = {};
for (const n of [
  'Click', 'DoubleClick', 'Change', 'Input', 'Submit', 'KeyDown', 'KeyUp', 'KeyPress', 'Focus', 'Blur',
  'MouseEnter', 'MouseLeave', 'MouseDown', 'MouseUp', 'MouseMove', 'MouseOver', 'MouseOut', 'PointerDown',
  'PointerUp', 'PointerMove', 'PointerEnter', 'PointerLeave', 'Wheel', 'Scroll', 'ContextMenu', 'Load', 'Error',
  'DragStart', 'Drag', 'DragEnd', 'DragOver', 'DragEnter', 'DragLeave', 'Drop', 'TouchStart', 'TouchEnd', 'TouchMove',
  'AnimationEnd', 'TransitionEnd', 'Toggle',
]) {
  EVENTS['on' + n.toLowerCase()] = 'on' + n;
}
EVENTS.ondblclick = 'onDoubleClick';

const HTML_ATTRS: Record<string, string> = {
  class: 'className', for: 'htmlFor', tabindex: 'tabIndex', readonly: 'readOnly', maxlength: 'maxLength',
  minlength: 'minLength', colspan: 'colSpan', rowspan: 'rowSpan', contenteditable: 'contentEditable',
  crossorigin: 'crossOrigin', srcset: 'srcSet', autocomplete: 'autoComplete', autofocus: 'autoFocus',
  novalidate: 'noValidate', accesskey: 'accessKey', enctype: 'encType', inputmode: 'inputMode',
  spellcheck: 'spellCheck', datetime: 'dateTime', usemap: 'useMap', cellpadding: 'cellPadding',
  cellspacing: 'cellSpacing', frameborder: 'frameBorder', playsinline: 'playsInline', enterkeyhint: 'enterKeyHint',
  referrerpolicy: 'referrerPolicy', fetchpriority: 'fetchPriority',
};
const BOOLEAN = new Set([
  'disabled', 'checked', 'selected', 'readonly', 'required', 'hidden', 'autofocus', 'multiple', 'open',
  'novalidate', 'controls', 'autoplay', 'loop', 'muted', 'playsinline', 'default', 'reversed', 'inert',
]);
const SKIP = new Set(['hint-placeholder-count', 'hint-placeholder-val', 'hint-size']);

function camel(s: string): string {
  return s.replace(/[-:]([a-z])/g, (_, c: string) => c.toUpperCase());
}

interface Ctx {
  /** tag elements with data-dc-tid (false inside imported components) */
  tagged: boolean;
  files: Record<string, string>;
  file: string;
  mode: Mode;
  /** a deck slide: its elements and paths */
  slide: SlideRender | null;
  /** the file being rendered (an <x-embed> is its own source text) */
  source: string;
}

function toProps(el: DcElement, scope: Scope, ctx: Ctx, key: React.Key): Record<string, unknown> {
  const p: Record<string, unknown> = { key };
  const handlers = new Set<string>();
  for (const a of el.attrs) {
    const name = a.name;
    if (SKIP.has(name)) continue;
    const lower = name.toLowerCase();
    if (EVENTS[lower] || /^on[a-z]+$/.test(lower)) {
      const fn = interp(a.value, scope);
      if (typeof fn === 'function') {
        const reactName = EVENTS[lower] ?? 'on' + lower.slice(2, 3).toUpperCase() + lower.slice(3);
        handlers.add(reactName);
        p[reactName] = (e: unknown) => {
          if (current.mode === 'play') (fn as (e: unknown) => void)(e);
        };
      }
      continue;
    }
    const v = interp(a.value, scope);
    if (name === 'style') {
      p.style = styleObject(v === null || v === undefined ? '' : String(v));
      continue;
    }
    if (BOOLEAN.has(lower) && el.ns === 'html') {
      p[HTML_ATTRS[lower] ?? lower] = v === '' || v === lower || v === true || v === 'true';
      continue;
    }
    if (el.ns === 'svg' || el.ns === 'math') {
      const k = name === 'class' ? 'className' : name.startsWith('data-') || name.startsWith('aria-') ? name : camel(name);
      p[k] = v;
      continue;
    }
    p[HTML_ATTRS[lower] ?? name] = v;
  }
  // form controls without handlers keep their initial value, as written
  if ((el.tag === 'input' || el.tag === 'textarea' || el.tag === 'select') && !handlers.has('onChange') && !handlers.has('onInput')) {
    if ('value' in p) {
      p.defaultValue = p.value;
      delete p.value;
    }
    if ('checked' in p) {
      p.defaultChecked = p.checked;
      delete p.checked;
    }
  }
  if (ctx.tagged) p['data-dc-tid'] = el.tid;
  return p;
}

// --------------------------------------------------------------- renderer

/** Parents where whitespace-only text is not content (React warns about it there). */
const NO_WS = new Set(['helmet', 'head', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup', 'select', 'svg', 'defs', 'g', 'marker']);

function renderNodes(nodes: DcNode[], scope: Scope, ctx: Ctx, parent?: string): React.ReactNode[] {
  const strip = parent !== undefined && NO_WS.has(parent);
  return nodes.map((n, i) => (strip && n.kind === 'text' && !n.text.trim() ? null : renderNode(n, scope, ctx, i, parent)));
}

function renderNode(n: DcNode, scope: Scope, ctx: Ctx, key: React.Key, parent?: string): React.ReactNode {
  if (n.kind === 'comment') return null;
  if (n.kind === 'text') {
    const v = interp(n.text, scope);
    if (v === null || v === undefined || typeof v === 'boolean') return null;
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  const el = n;
  switch (el.tag) {
    case 'sc-for': {
      const listAttr = el.attrs.find((a) => a.name === 'list');
      const list = listAttr ? interp(listAttr.value, scope) : [];
      const as = el.attrs.find((a) => a.name === 'as')?.value ?? 'item';
      const arr = Array.isArray(list) ? list : [];
      return (
        <React.Fragment key={key}>
          {arr.map((item, i) => (
            <React.Fragment key={i}>{renderNodes(el.children, { ...scope, [as]: item, $index: i }, ctx, parent)}</React.Fragment>
          ))}
        </React.Fragment>
      );
    }
    case 'sc-if': {
      const v = el.attrs.find((a) => a.name === 'value');
      const show = v ? interp(v.value, scope) : false;
      return show ? <React.Fragment key={key}>{renderNodes(el.children, scope, ctx, parent)}</React.Fragment> : null;
    }
    case 'helmet':
      return createPortal(<>{renderNodes(el.children, scope, { ...ctx, tagged: false }, 'helmet')}</>, document.head, String(key));
    case 'script':
      return null;
    case 'dc-import': {
      const name = el.attrs.find((a) => a.name === 'name')?.value ?? '';
      const dir = ctx.file.includes('/') ? ctx.file.slice(0, ctx.file.lastIndexOf('/') + 1) : '';
      const target = name.startsWith('/') ? name.slice(1) + '.dc.html' : dir + name + '.dc.html';
      const props: Record<string, unknown> = {};
      for (const a of el.attrs) {
        if (a.name === 'name' || SKIP.has(a.name)) continue;
        props[camel(a.name)] = interp(a.value, scope);
      }
      const src = ctx.files[target];
      const inner = src ? (
        <DcComponent source={src} file={target} props={props} ctx={{ ...ctx, tagged: false, file: target }} />
      ) : (
        <div style={{ padding: 8, border: '1px dashed #c33', color: '#c33', font: '12px system-ui' }}>
          missing {target}
        </div>
      );
      return ctx.tagged ? (
        <div key={key} data-dc-tid={el.tid} style={{ display: 'contents' }}>
          {inner}
        </div>
      ) : (
        <React.Fragment key={key}>{inner}</React.Fragment>
      );
    }
  }
  if (el.tag.startsWith('sc-') || el.tag === 'x-import') {
    return <React.Fragment key={key}>{renderNodes(el.children, scope, ctx, parent)}</React.Fragment>;
  }
  const props = toProps(el, scope, ctx, key);
  if (ctx.slide) {
    switch (el.tag) {
      case 'x-shape':
        return renderShape(el, props, key);
      case 'x-icon':
        return renderIcon(el, props, key);
      case 'x-connector':
        return renderConnector(el, props, key);
      case 'x-embed':
        return renderEmbed(el, ctx.source, props, key, !!ctx.slide.still);
      case 'section':
        // a skipped slide is still shown while editing
        delete props.hidden;
        break;
      case 'img':
      case 'video':
      case 'source':
        if (typeof props.src === 'string') props.src = resolveSrc(props.src, ctx.slide.base);
        if (el.tag === 'img' && !props.src) delete props.src;
        break;
    }
  }
  if (VOID_ELEMENTS.has(el.tag) && el.ns === 'html') return React.createElement(el.tag, props);
  if (el.tag === 'textarea') {
    const text = el.children.map((c) => (c.kind === 'text' ? String(interp(c.text, scope) ?? '') : '')).join('');
    if (!('value' in props)) props.defaultValue = text;
    return React.createElement('textarea', props);
  }
  if (el.tag === 'table' && el.children.some((c) => c.kind === 'el' && c.tag === 'tr')) {
    // <tr>s written straight into a <table> (the slide subset does): the browser's parser would
    // put them in a <tbody>, so render one around them, untagged — selection skips it
    const kids = renderNodes(el.children, scope, ctx, el.tag);
    const out: React.ReactNode[] = [];
    let rows: React.ReactNode[] = [];
    el.children.forEach((c, i) => {
      if (c.kind === 'el' && c.tag === 'tr') rows.push(kids[i]);
      else {
        if (rows.length) out.push(React.createElement('tbody', { key: `tb${i}` }, ...rows));
        rows = [];
        out.push(kids[i]);
      }
    });
    if (rows.length) out.push(React.createElement('tbody', { key: 'tb-end' }, ...rows));
    return React.createElement('table', props, ...out);
  }
  return React.createElement(el.tag, props, ...renderNodes(el.children, scope, ctx, el.tag));
}

// -------------------------------------------------------------- components

const docCache = new Map<string, DcDoc>();
function docFor(source: string): DcDoc {
  let d = docCache.get(source);
  if (!d) {
    d = parseDc(source);
    if (docCache.size > 64) docCache.clear();
    docCache.set(source, d);
  }
  return d;
}

type LogicClass = React.ComponentClass<Record<string, unknown>>;
const classCache = new Map<string, LogicClass>();

function compile(source: string, file: string): { cls: LogicClass; doc: DcDoc } {
  const doc = docFor(source);
  const hit = classCache.get(file + '\0' + source);
  if (hit) return { cls: hit, doc };

  class DCLogic extends React.Component<Record<string, unknown>, Record<string, unknown>> {
    __ctx!: Ctx;
    constructor(props: Record<string, unknown>) {
      super(props);
      this.state = {};
    }
    renderVals(): Scope {
      return {};
    }
    render() {
      const ctx = (this.props.__ctx as Ctx) ?? current.ctx();
      const vals = this.renderVals() ?? {};
      return <>{renderNodes(doc.children, vals, ctx)}</>;
    }
  }
  let cls: LogicClass = DCLogic as unknown as LogicClass;
  if (doc.script && doc.script.code.trim()) {
    const factory = new Function(
      'DCLogic',
      'React',
      `"use strict";\n${doc.script.code}\n;return typeof Component !== "undefined" ? Component : null;`,
    ) as (b: unknown, r: unknown) => LogicClass | null;
    cls = factory(DCLogic, React) ?? cls;
  }
  classCache.set(file + '\0' + source, cls);
  return { cls, doc };
}

class Boundary extends React.Component<{ children: React.ReactNode; file: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    post({ dc: 'error', message: `${this.props.file}: ${error.message}` });
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, font: '13px/1.5 ui-monospace,monospace', color: '#b42318', background: '#fff5f5', whiteSpace: 'pre-wrap' }}>
          {this.props.file} 出错了{'\n'}
          {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

function defaultsOf(doc: DcDoc): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, spec] of Object.entries(doc.props)) {
    if (k.startsWith('$')) continue;
    if (spec && typeof spec === 'object' && 'default' in spec) out[k] = spec.default;
  }
  return out;
}

function DcComponent(p: { source: string; file: string; props: Record<string, unknown>; ctx: Ctx }) {
  let compiled: { cls: LogicClass; doc: DcDoc };
  try {
    compiled = compile(p.source, p.file);
  } catch (e) {
    throw new Error('script: ' + (e as Error).message);
  }
  const Cls = compiled.cls;
  return <Cls {...defaultsOf(compiled.doc)} {...p.props} __ctx={p.ctx} />;
}

// ------------------------------------------------------------------- host

interface State {
  file: string;
  source: string;
  files: Record<string, string>;
  props: Record<string, unknown>;
  slide: SlideRender | null;
  mode: Mode;
  selected: number | null;
  hover: number | null;
  editing: HTMLElement | null;
  pending: Extract<ToRuntime, { dc: 'render' }> | null;
  ctx(): Ctx;
}

const current: State = {
  file: '',
  source: '',
  files: {},
  props: {},
  slide: null,
  mode: 'edit',
  selected: null,
  hover: null,
  editing: null,
  pending: null,
  ctx() {
    return { tagged: true, files: this.files, file: this.file, mode: this.mode, slide: this.slide, source: this.source };
  },
};

const mount = document.getElementById('dc-app')!;
const root = createRoot(mount);
let renderKey = 0;
/** The source whose DOM is actually on screen (React commits asynchronously). */
let committedSource = '';
function Committed({ source }: { source: string }) {
  React.useLayoutEffect(() => {
    committedSource = source;
    if (current.slide && current.mode === 'play' && !current.slide.still) {
      post({ dc: 'builds', count: collectBuilds(mount) });
      showBuilds(buildStep);
    }
  }, [source]);
  return null;
}
let buildStep = 0;

function render() {
  const doc = docFor(current.source);
  post({ dc: 'error', message: doc.errors.length ? doc.errors.join('\n') : null });
  root.render(
    <Boundary key={renderKey} file={current.file}>
      <DcComponent key={current.source} source={current.source} file={current.file} props={current.props} ctx={current.ctx()} />
      <Committed source={current.source} />
    </Boundary>,
  );
}

// ---------------------------------------------------------------- overlay

const BLUE = '#2f6fed';
const overlay = document.createElement('div');
overlay.setAttribute('aria-hidden', 'true');
overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
document.documentElement.appendChild(overlay);

let externalHover: number | null = null;
let indicator: { x: number; y: number; w: number; h: number } | null = null;

function rectOf(el: Element): DOMRect | null {
  const r = el.getBoundingClientRect();
  if (r.width || r.height) return r;
  // display: contents wrappers (dc-import): union of the children
  let u: DOMRect | null = null;
  for (const c of Array.from(el.children)) {
    const cr = rectOf(c);
    if (!cr) continue;
    if (!u) u = DOMRect.fromRect(cr);
    else {
      const x = Math.min(u.x, cr.x);
      const y = Math.min(u.y, cr.y);
      u = new DOMRect(x, y, Math.max(u.right, cr.right) - x, Math.max(u.bottom, cr.bottom) - y);
    }
  }
  return u;
}

const instances = (tid: number) => Array.from(document.querySelectorAll(`[data-dc-tid="${tid}"]`));

function box(r: { left: number; top: number; width: number; height: number }, css: string): string {
  return `<div style="position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;box-sizing:border-box;${css}"></div>`;
}

function drawBoxes() {
  const out: string[] = [];
  if (current.mode === 'edit' && !current.editing) {
    const hover = externalHover ?? current.hover;
    if (hover !== null && hover !== current.selected) {
      for (const el of instances(hover)) {
        const r = rectOf(el);
        if (r) out.push(box(r, `border:1px solid ${BLUE}`));
      }
    }
    if (current.selected !== null) {
      const els = instances(current.selected);
      for (const el of els) {
        const r = rectOf(el);
        if (!r) continue;
        out.push(box(r, `border:1.5px solid ${BLUE}`));
        if (els.length === 1 && !drag?.active) {
          for (const [x, y] of [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]]) {
            out.push(box({ left: x - 3.5, top: y - 3.5, width: 7, height: 7 }, `background:#fff;border:1.5px solid ${BLUE}`));
          }
        }
      }
    }
    if (indicator) out.push(box({ left: indicator.x, top: indicator.y, width: indicator.w, height: indicator.h }, `background:${BLUE};border-radius:1px`));
  }
  const html = out.join('');
  if (overlay.innerHTML !== html) overlay.innerHTML = html;
}
(function loop() {
  drawBoxes();
  requestAnimationFrame(loop);
})();

function tidOf(target: EventTarget | null): number | null {
  const el = (target as Element | null)?.closest?.('[data-dc-tid]');
  if (!el) return null;
  return Number(el.getAttribute('data-dc-tid'));
}

// ---------------------------------------------------------------- inspect

const COMPUTED = [
  'display', 'position', 'flex-direction', 'flex-wrap', 'flex-grow', 'align-items', 'justify-content', 'gap',
  'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'text-align',
  'background-color', 'background-image', 'opacity', 'border-radius', 'border-top-width', 'border-top-style', 'border-top-color',
  'box-shadow', 'left', 'top', 'transform', 'overflow',
];

function opaque(c: string): boolean {
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) return c !== 'transparent' && c !== '';
  const parts = m[1].split(/[,\s/]+/).filter(Boolean);
  return parts.length < 4 || parseFloat(parts[3]) > 0.5;
}

let lastInspect = '';
function inspect() {
  const tid = current.selected;
  const el = tid === null ? null : (instances(tid)[0] as HTMLElement | undefined);
  let info: Inspect | null = null;
  if (el && tid !== null) {
    const r = rectOf(el) ?? new DOMRect();
    const cs = getComputedStyle(el.style.display === 'contents' && el.firstElementChild ? el.firstElementChild : el);
    const computed: Record<string, string> = {};
    for (const k of COMPUTED) computed[k] = cs.getPropertyValue(k);
    computed['offset-left'] = String(el.offsetLeft);
    computed['offset-top'] = String(el.offsetTop);
    let backdrop = '#ffffff';
    for (let a: Element | null = el; a; a = a.parentElement) {
      const bg = getComputedStyle(a).backgroundColor;
      if (opaque(bg)) {
        backdrop = bg;
        break;
      }
    }
    const p = el.parentElement?.closest('[data-dc-tid]') as HTMLElement | null;
    const pcs = p ? getComputedStyle(p) : null;
    const doc = docFor(current.source);
    const srcParent = doc.elements[tid]?.parent ?? null;
    info = {
      tid,
      rect: { x: r.left, y: r.top, w: r.width, h: r.height },
      count: instances(tid).length,
      computed,
      backdrop,
      parent: {
        tid: p ? Number(p.getAttribute('data-dc-tid')) : null,
        display: pcs?.display ?? 'block',
        flexDirection: pcs?.flexDirection ?? 'row',
        position: pcs?.position ?? 'static',
        hasHeight: !!(srcParent && /(^|;)\s*height\s*:/.test(srcParent.attrs.find((a) => a.name === 'style')?.value ?? '')),
      },
    };
  }
  const sig = JSON.stringify(info);
  if (sig !== lastInspect) {
    lastInspect = sig;
    post({ dc: 'inspect', info });
  }
}

let lastCounts = '';
function postCounts() {
  const counts: Record<number, number> = {};
  for (const el of Array.from(document.querySelectorAll('[data-dc-tid]'))) {
    const t = Number(el.getAttribute('data-dc-tid'));
    counts[t] = (counts[t] ?? 0) + 1;
  }
  const sig = JSON.stringify(counts);
  if (sig !== lastCounts) {
    lastCounts = sig;
    post({ dc: 'counts', counts });
  }
}

// layout settles over a few frames (fonts, images): keep the inspection fresh
setInterval(() => {
  if (current.mode === 'edit' && !drag?.active) {
    inspect();
    postCounts();
  }
}, 250);

// ------------------------------------------------------------- gestures

const inEdit = () => current.mode === 'edit';

interface Drag {
  tid: number;
  el: HTMLElement;
  parent: HTMLElement;
  start: { x: number; y: number };
  rect: DOMRect;
  abs: boolean;
  axis: 'x' | 'y';
  siblings: HTMLElement[];
  active: boolean;
  mode: 'reorder' | 'out';
  drop: { target: number; where: 'before' | 'after' } | null;
  saved: { opacity: string; transform: string; transition: string };
}
let drag: Drag | null = null;
let suppressClick = false;

function draggable(tid: number): boolean {
  const doc = docFor(current.source);
  const el = doc.elements[tid];
  if (!el || !el.parent) return false; // top-level: the artboard itself
  for (let a: DcElement | null = el.parent; a; a = a.parent) if (a.tag === 'sc-for') return false;
  return instances(tid).length === 1;
}

/** The source-level sibling of `tid` that contains the rendered element `domTid`. */
function sourceSibling(tid: number, domTid: number): number | null {
  const doc = docFor(current.source);
  const parent = doc.elements[tid]?.parent;
  let el = doc.elements[domTid];
  while (el && el.parent !== parent) el = el.parent as typeof el;
  return el && el.tid !== tid ? el.tid : null;
}

function startDrag(tid: number, e: PointerEvent) {
  const el = instances(tid)[0] as HTMLElement | undefined;
  const parent = el?.parentElement?.closest('[data-dc-tid]') as HTMLElement | null;
  if (!el || !parent) return;
  const cs = getComputedStyle(el);
  const pcs = getComputedStyle(parent);
  const axis: 'x' | 'y' = pcs.display.includes('flex') && !pcs.flexDirection.startsWith('column') ? 'x' : 'y';
  const siblings = (Array.from(parent.querySelectorAll('[data-dc-tid]')) as HTMLElement[]).filter((c) => {
    if (c === el || c.parentElement?.closest('[data-dc-tid]') !== parent) return false;
    const s = getComputedStyle(c);
    return s.position !== 'absolute' && s.position !== 'fixed' && s.display !== 'none';
  });
  drag = {
    tid,
    el,
    parent,
    start: { x: e.clientX, y: e.clientY },
    rect: el.getBoundingClientRect(),
    abs: cs.position === 'absolute',
    axis,
    siblings,
    active: false,
    mode: 'reorder',
    drop: null,
    saved: { opacity: el.style.opacity, transform: el.style.transform, transition: el.style.transition },
  };
}

function moveDrag(e: PointerEvent) {
  const d = drag;
  if (!d) return;
  const dx = e.clientX - d.start.x;
  const dy = e.clientY - d.start.y;
  if (!d.active && Math.hypot(dx, dy) < 4) return;
  d.active = true;
  const pr = d.parent.getBoundingClientRect();
  const outside = e.clientX < pr.left - 16 || e.clientX > pr.right + 16 || e.clientY < pr.top - 16 || e.clientY > pr.bottom + 16;
  d.mode = d.abs || outside || !d.siblings.length ? 'out' : 'reorder';
  d.el.style.transition = 'none';
  if (d.mode === 'out') {
    indicator = null;
    d.drop = null;
    d.el.style.opacity = d.saved.opacity;
    d.el.style.transform = `translate(${dx}px, ${dy}px)`;
    return;
  }
  d.el.style.transform = d.saved.transform;
  d.el.style.opacity = '0.45';
  const p = d.axis === 'x' ? e.clientX : e.clientY;
  let before: HTMLElement | null = null;
  for (const s of d.siblings) {
    const r = s.getBoundingClientRect();
    const mid = d.axis === 'x' ? r.left + r.width / 2 : r.top + r.height / 2;
    if (p < mid) {
      before = s;
      break;
    }
  }
  const ref = before ?? d.siblings[d.siblings.length - 1];
  const rr = ref.getBoundingClientRect();
  const edge = before ? (d.axis === 'x' ? rr.left - 2 : rr.top - 2) : d.axis === 'x' ? rr.right + 1 : rr.bottom + 1;
  indicator =
    d.axis === 'x'
      ? { x: edge - 1, y: rr.top, w: 3, h: rr.height }
      : { x: Math.min(rr.left, d.rect.left), y: edge - 1, w: Math.max(rr.width, d.rect.width), h: 3 };
  const target = sourceSibling(d.tid, Number(ref.getAttribute('data-dc-tid')));
  d.drop = target === null ? null : { target, where: before ? 'before' : 'after' };
}

function endDrag(e: PointerEvent, cancel = false) {
  const d = drag;
  drag = null;
  indicator = null;
  if (!d) return;
  const restore = () => {
    d.el.style.opacity = d.saved.opacity;
    d.el.style.transform = d.saved.transform;
    d.el.style.transition = d.saved.transition;
  };
  if (!d.active || cancel) return restore();
  suppressClick = true;
  if (d.mode === 'reorder') {
    restore();
    if (d.drop) post({ dc: 'move', tid: d.tid, ...d.drop });
    return;
  }
  const dx = e.clientX - d.start.x;
  const dy = e.clientY - d.start.y;
  const pr = d.parent.getBoundingClientRect();
  const left = Math.round(d.rect.left + dx - pr.left - d.parent.clientLeft + d.parent.scrollLeft);
  const top = Math.round(d.rect.top + dy - pr.top - d.parent.clientTop + d.parent.scrollTop);
  const set: Record<string, string> = { left: `${left}px`, top: `${top}px` };
  const parentSet: Record<string, string> = {};
  if (!d.abs) {
    Object.assign(set, { position: 'absolute', width: `${Math.round(d.rect.width)}px`, margin: '0' });
    if (getComputedStyle(d.parent).position === 'static') parentSet.position = 'relative';
    // keep the parent from collapsing now that the element left the flow
    const doc = docFor(current.source);
    const srcParent = doc.elements[d.tid]?.parent;
    const ps = srcParent?.attrs.find((a) => a.name === 'style')?.value ?? '';
    if (srcParent?.parent && !/(^|;)\s*height\s*:/.test(ps)) parentSet.height = `${Math.round(pr.height)}px`;
  }
  const parentTid = Number(d.parent.getAttribute('data-dc-tid'));
  post({ dc: 'dragout', tid: d.tid, set, parentTid: Number.isFinite(parentTid) ? parentTid : null, parentSet });
}

document.addEventListener(
  'pointerdown',
  (e) => {
    if (!inEdit()) return;
    if (current.editing?.contains(e.target as Node)) return;
    e.preventDefault();
    if (current.editing) commitText();
    if (e.button !== 0) return;
    // grabbing anything inside the selected element drags the selected element
    const sel = current.selected;
    const selEl = sel === null ? null : instances(sel)[0];
    if (sel !== null && selEl?.contains(e.target as Node) && draggable(sel)) startDrag(sel, e);
  },
  true,
);
document.addEventListener('pointermove', (e) => drag && moveDrag(e), true);
document.addEventListener('pointerup', (e) => drag && endDrag(e), true);
window.addEventListener('blur', () => drag && endDrag(new PointerEvent('pointerup'), true));

for (const type of ['mousedown', 'mouseup', 'submit', 'auxclick']) {
  document.addEventListener(
    type,
    (e) => {
      if (inEdit() && !current.editing?.contains(e.target as Node)) e.preventDefault();
    },
    true,
  );
}

document.addEventListener(
  'click',
  (e) => {
    if (current.editing?.contains(e.target as Node)) return;
    if (inEdit()) {
      e.preventDefault();
      e.stopPropagation();
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const tid = tidOf(e.target);
      current.selected = tid;
      post({ dc: 'select', tid, shift: e.shiftKey, x: e.clientX, y: e.clientY });
      return;
    }
    // play mode: links between artboards
    const a = (e.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    const href = a.getAttribute('href') ?? '';
    if (/\.dc\.html(#.*)?$/.test(href)) {
      e.preventDefault();
      post({ dc: 'navigate', href });
    } else if (href.startsWith('#')) {
      e.preventDefault();
      document.getElementById(href.slice(1))?.scrollIntoView({ behavior: 'smooth' });
    } else if (/^https?:/.test(href)) {
      e.preventDefault();
      window.open(href, '_blank', 'noopener');
    }
  },
  true,
);

document.addEventListener(
  'contextmenu',
  (e) => {
    if (!inEdit()) return;
    e.preventDefault();
    const tid = tidOf(e.target);
    if (tid !== current.selected) {
      current.selected = tid;
      post({ dc: 'select', tid, shift: false, x: e.clientX, y: e.clientY });
    }
    post({ dc: 'contextmenu', tid, x: e.clientX, y: e.clientY });
  },
  true,
);

document.addEventListener(
  'mousemove',
  (e) => {
    if (!inEdit() || drag?.active) return;
    const tid = tidOf(e.target);
    if (tid !== current.hover) {
      current.hover = tid;
      post({ dc: 'hover', tid });
    }
  },
  true,
);
document.addEventListener('mouseleave', () => {
  current.hover = null;
  post({ dc: 'hover', tid: null });
});

function editableTids(): Set<number> {
  const doc = docFor(current.source);
  return new Set(doc.elements.filter(isTextEditable).map((e) => e.tid));
}

let editingOriginal = '';
function beginText(el: HTMLElement) {
  current.editing = el;
  editingOriginal = el.innerText;
  try {
    el.contentEditable = 'plaintext-only';
  } catch {
    el.contentEditable = 'true';
  }
  if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
  el.style.outline = `1.5px solid ${BLUE}`;
  el.style.outlineOffset = '1px';
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  el.addEventListener('blur', () => commitText(), { once: true });
}

document.addEventListener(
  'dblclick',
  (e) => {
    if (!inEdit()) return;
    e.preventDefault();
    e.stopPropagation();
    const el = (e.target as Element).closest?.('[data-dc-tid]') as HTMLElement | null;
    if (!el) return;
    const tid = Number(el.getAttribute('data-dc-tid'));
    if (!editableTids().has(tid)) return;
    beginText(el);
  },
  true,
);

function commitText(cancel = false) {
  const el = current.editing;
  if (!el) return;
  current.editing = null;
  el.contentEditable = 'inherit';
  el.style.outline = '';
  el.style.outlineOffset = '';
  const text = el.innerText.replace(/\n$/, '');
  const tid = Number(el.getAttribute('data-dc-tid'));
  if (!cancel && text !== editingOriginal) post({ dc: 'text', tid, text });
  else {
    renderKey++;
    render();
  }
  if (current.pending) {
    const p = current.pending;
    current.pending = null;
    onMessage(p);
  }
}

document.addEventListener(
  'keydown',
  (e) => {
    if (current.editing) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commitText();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        commitText(true);
      }
      return;
    }
    if (drag && e.key === 'Escape') {
      endDrag(new PointerEvent('pointerup'), true);
      return;
    }
    // presenting a slide: the editor drives the show with the keys
    const showKey = current.slide && !inEdit() && /^(Arrow\w+|PageUp|PageDown|Home|End| |Enter|Backspace|n|N|Escape)$/.test(e.key);
    if (showKey) {
      e.preventDefault();
      post({ dc: 'key', key: e.key, meta: e.metaKey || e.ctrlKey, shift: e.shiftKey, alt: e.altKey });
      return;
    }
    if (!inEdit() && e.key !== 'Escape') return;
    const t = e.target as HTMLElement;
    if (!inEdit() && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (inEdit() && !(e.metaKey || e.ctrlKey) ) e.preventDefault();
    if (inEdit() && (e.metaKey || e.ctrlKey) && /^[cvxzydg=+-]$/i.test(e.key)) e.preventDefault();
    post({ dc: 'key', key: e.key, meta: e.metaKey || e.ctrlKey, shift: e.shiftKey, alt: e.altKey });
  },
  true,
);

window.addEventListener(
  'wheel',
  (e) => {
    if (!inEdit() && !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    post({ dc: 'wheel', dx: e.deltaX * k, dy: e.deltaY * k, ctrl: e.ctrlKey || e.metaKey, x: e.clientX, y: e.clientY });
  },
  { passive: false },
);

// ----------------------------------------------------------------- export

async function exportPng(id: string, scale: number) {
  try {
    const node = mount.querySelector('[data-dc-tid]') as HTMLElement | null;
    if (!node) throw new Error('nothing to export');
    const { toPng } = await import('html-to-image');
    const prevSel = current.selected;
    current.selected = null;
    overlay.innerHTML = '';
    const dataUrl = await toPng(node, { pixelRatio: scale, skipFonts: true, cacheBust: false });
    current.selected = prevSel;
    post({ dc: 'exported', id, dataUrl });
  } catch (err) {
    post({ dc: 'exported', id, error: (err as Error).message || String(err) });
  }
}

// --------------------------------------------------------------- messages

function onMessage(m: ToRuntime) {
  if (m.dc === 'render') {
    if (current.editing) {
      current.pending = m;
      return;
    }
    const slide = m.slide ?? null;
    const changed =
      m.source !== current.source ||
      m.files !== current.files ||
      JSON.stringify(m.props) !== JSON.stringify(current.props) ||
      JSON.stringify(slide) !== JSON.stringify(current.slide) ||
      m.mode !== current.mode;
    Object.assign(current, { file: m.file, source: m.source, files: m.files, props: m.props, mode: m.mode, selected: m.selected, slide });
    document.documentElement.dataset.mode = m.mode;
    installSlide(slide);
    if (changed) render();
  } else if (m.dc === 'select') {
    current.selected = m.tid;
    inspect();
  } else if (m.dc === 'hover') {
    externalHover = m.tid;
  } else if (m.dc === 'mode') {
    current.mode = m.mode;
    document.documentElement.dataset.mode = m.mode;
    renderKey++;
    render();
  } else if (m.dc === 'build') {
    buildStep = m.step;
    showBuilds(m.step);
  } else if (m.dc === 'export') {
    void exportPng(m.id, m.scale);
  } else if (m.dc === 'edit') {
    // the element may only exist after the render that is on its way
    let tries = 0;
    const tid = m.tid;
    const attempt = () => {
      // tids are positions in the source: only trust them once that source is rendered
      const el = committedSource === current.source ? (instances(tid)[0] as HTMLElement | undefined) : undefined;
      if (el && editableTids().has(tid)) {
        current.selected = tid;
        beginText(el);
      } else if (tries++ < 20) setTimeout(attempt, 50);
    };
    attempt();
  }
}

window.addEventListener('message', (e) => {
  if (e.source !== window.parent) return;
  const m = e.data as ToRuntime;
  if (!m || typeof m !== 'object' || !('dc' in m)) return;
  onMessage(m);
});

window.addEventListener('error', (e) => post({ dc: 'error', message: e.message }));
post({ dc: 'ready' });
