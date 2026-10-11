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
  type Mode,
  type ToRuntime,
} from '@dc/core';

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
  if (VOID_ELEMENTS.has(el.tag) && el.ns === 'html') return React.createElement(el.tag, props);
  if (el.tag === 'textarea') {
    const text = el.children.map((c) => (c.kind === 'text' ? String(interp(c.text, scope) ?? '') : '')).join('');
    if (!('value' in props)) props.defaultValue = text;
    return React.createElement('textarea', props);
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
  mode: 'edit',
  selected: null,
  hover: null,
  editing: null,
  pending: null,
  ctx() {
    return { tagged: true, files: this.files, file: this.file, mode: this.mode };
  },
};

const mount = document.getElementById('dc-app')!;
const root = createRoot(mount);
let renderKey = 0;

function render() {
  const doc = docFor(current.source);
  post({ dc: 'error', message: doc.errors.length ? doc.errors.join('\n') : null });
  root.render(
    <Boundary key={renderKey} file={current.file}>
      <DcComponent key={current.source} source={current.source} file={current.file} props={current.props} ctx={current.ctx()} />
    </Boundary>,
  );
}

// ---------------------------------------------------------------- overlay

const overlay = document.createElement('div');
overlay.setAttribute('aria-hidden', 'true');
overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
document.documentElement.appendChild(overlay);

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

function drawBoxes() {
  const boxes: string[] = [];
  const add = (tid: number | null, solid: boolean) => {
    if (tid === null) return;
    for (const el of Array.from(document.querySelectorAll(`[data-dc-tid="${tid}"]`))) {
      const r = rectOf(el);
      if (!r) continue;
      boxes.push(
        `<div style="position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;box-sizing:border-box;border:${solid ? '2px solid #2f6fed' : '1px dashed #2f6fed'};${solid ? 'background:rgba(47,111,237,.06)' : ''}"></div>`,
      );
    }
  };
  if (current.mode === 'edit' && !current.editing) {
    if (current.hover !== current.selected) add(current.hover, false);
    add(current.selected, true);
  }
  const html = boxes.join('');
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

// ------------------------------------------------------------- gestures

const inEdit = () => current.mode === 'edit';

for (const type of ['mousedown', 'pointerdown', 'mouseup', 'submit', 'auxclick']) {
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
      if (current.editing) commitText();
      post({ dc: 'select', tid: tidOf(e.target), shift: e.shiftKey });
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
  'mousemove',
  (e) => {
    if (!inEdit()) return;
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
    current.editing = el;
    editingOriginal = el.innerText;
    try {
      el.contentEditable = 'plaintext-only';
    } catch {
      el.contentEditable = 'true';
    }
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    el.style.outline = '2px solid #2f6fed';
    el.style.outlineOffset = '2px';
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    el.addEventListener('blur', () => commitText(), { once: true });
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
    if (!inEdit() && e.key !== 'Escape') return;
    const t = e.target as HTMLElement;
    if (!inEdit() && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (inEdit()) e.preventDefault();
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

// --------------------------------------------------------------- messages

function onMessage(m: ToRuntime) {
  if (m.dc === 'render') {
    if (current.editing) {
      current.pending = m;
      return;
    }
    const changed = m.source !== current.source || m.files !== current.files || JSON.stringify(m.props) !== JSON.stringify(current.props) || m.mode !== current.mode;
    Object.assign(current, { file: m.file, source: m.source, files: m.files, props: m.props, mode: m.mode, selected: m.selected });
    document.documentElement.dataset.mode = m.mode;
    if (changed) render();
  } else if (m.dc === 'select') {
    current.selected = m.tid;
  } else if (m.dc === 'mode') {
    current.mode = m.mode;
    document.documentElement.dataset.mode = m.mode;
    renderKey++;
    render();
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
