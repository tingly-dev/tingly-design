/**
 * The artboard template, turned into React: `{{holes}}`, attributes, `<sc-for>` / `<sc-if>`,
 * components with their script. Knows nothing of the editor's gestures; the runtime tells it
 * the one thing it asks of its host (the mode, and the context a bare component draws with).
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { attrsForFormat, fxMarkup, isFxEmbed, FX_STILL_MS, embedProps, isBoardEmbedPath, paintLayer, textBoxIndent, parseDc, styleObject, VOID_ELEMENTS, type DcDoc, type DcElement, type DcNode, type Mode } from '@dc/core';
import { XArt, XBoard, XEmbed, innerSource, resolveSrc } from './slide';
import { urlsAgainst } from './urls';
import { SEEK_BRIDGE } from './sceneAnim';
import { msg } from './msg';
import { post } from './post';

function unset(): never {
  throw new Error('template: the runtime has not said what it draws with (host.mode, host.ctx)');
}

/** What the template asks of the runtime that draws it. */
export const host: { mode: () => Mode; ctx: () => Ctx } = {
  mode: unset,
  ctx: unset,
};

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

export interface Ctx {
  /** tag elements with data-dc-tid (false inside imported components) */
  tagged: boolean;
  files: Record<string, string>;
  file: string;
  mode: Mode;
  /** rendering a slide: relative image paths resolve against `base` */
  slide?: { base: string; source: string; still?: boolean };
  /** a canvas board: relative paths (assets/…) in src and url() resolve against this */
  base?: string;
  /** a motion scene: the format it is drawn in */
  motion?: { format: string; formats: string[] };
}

// a motion scene in one format: each element with that format's overrides merged in (tids unchanged)
const formatted = new WeakMap<DcElement, { key: string; el: DcElement | null }>();
function inFormat(el: DcElement, m: { format: string; formats: string[] }): DcElement | null {
  const key = m.format + '\0' + m.formats.join(' ');
  const hit = formatted.get(el);
  if (hit && hit.key === key) return hit.el;
  const attrs = attrsForFormat(Object.fromEntries(el.attrs.map((a) => [a.name, a.value])), m.format, m.formats);
  const out = attrs ? { ...el, attrs: Object.entries(attrs).map(([name, value]) => ({ ...(el.attrs.find((a) => a.name === name) ?? el.attrs[0]), name, value })) } : null;
  formatted.set(el, { key, el: out });
  return out;
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
          if (host.mode() === 'play') (fn as (e: unknown) => void)(e);
        };
      }
      continue;
    }
    const v = interp(a.value, scope);
    if (name === 'style') {
      const text = v === null || v === undefined ? '' : String(v);
      p.style = styleObject(ctx.base ? urlsAgainst(text, ctx.base) : text);
      continue;
    }
    if (BOOLEAN.has(lower) && el.ns === 'html') {
      p[HTML_ATTRS[lower] ?? lower] = v === '' || v === lower || v === true || v === 'true';
      continue;
    }
    if (el.ns === 'svg' || el.ns === 'math') {
      const k = name === 'class' ? 'className' : name.startsWith('data-') || name.startsWith('aria-') ? name : camel(name);
      // an <image> drawing a project file, like <img src>
      p[k] = ctx.base && lower === 'href' && (el.tag === 'image' || el.tag === 'feImage') ? resolveSrc(v, ctx.base) : v;
      continue;
    }
    p[HTML_ATTRS[lower] ?? name] = ctx.base && (lower === 'src' || lower === 'poster') ? resolveSrc(v, ctx.base) : v;
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
  if (ctx.tagged && typeof scope.$index === 'number') p['data-dc-item'] = scope.$index;
  // Reserved export metadata must never be inherited from authored markup.
  delete p['data-dc-paint-layer'];
  if (ctx.slide) {
    const z = paintLayer(el);
    if (z !== undefined) {
      p.style = { ...((p.style as Record<string, string>) ?? {}), zIndex: z };
      p['data-dc-paint-layer'] = String(z);
    }
    const indent = textBoxIndent(el);
    if (indent !== undefined) p.style = { ...((p.style as Record<string, string>) ?? {}), '--dc-indent': `${indent}px` };
  }
  return p;
}


// --------------------------------------------------------------- renderer

/** Parents where whitespace-only text is not content (React warns about it there). */
const NO_WS = new Set(['helmet', 'head', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup', 'select', 'svg', 'defs', 'g', 'marker']);

function renderNodes(nodes: DcNode[], scope: Scope, ctx: Ctx, docSrc: string, parent?: string): React.ReactNode[] {
  const strip = parent !== undefined && NO_WS.has(parent);
  // siblings are keyed by their own source text (with an occurrence number for equal twins), so a
  // progressive edit that inserts or reorders parts moves the drawn DOM instead of rebuilding it:
  // pictures, embeds and text the person is reading stay put while the new part appears
  const seen = new Map<string, number>();
  return nodes.map((n, i) => {
    if (strip && n.kind === 'text' && !n.text.trim()) return null;
    if (n.kind === 'comment') return null;
    const base = nodeKey(n, docSrc);
    const occ = seen.get(base) ?? 0;
    seen.set(base, occ + 1);
    return renderNode(n, scope, ctx, base + '#' + occ, docSrc, parent);
  });
}

const keyCache = new WeakMap<DcNode, string>();
/** A sibling's stable identity: a short stamp of the source it was written as. */
function nodeKey(n: DcNode, docSrc: string): string {
  let k = keyCache.get(n);
  if (!k) {
    const text = n.kind === 'el' ? docSrc.slice(n.range.start, n.range.end) : n.kind === 'text' ? n.text : '';
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    k = (n.kind === 'el' ? 'e' : 't') + (h >>> 0).toString(36);
    keyCache.set(n, k);
  }
  return k;
}

function renderNode(n: DcNode, scope: Scope, ctx: Ctx, key: React.Key, docSrc: string, parent?: string): React.ReactNode {
  if (n.kind === 'comment') return null;
  if (n.kind === 'text') {
    const v = interp(n.text, scope);
    if (v === null || v === undefined || typeof v === 'boolean') return null;
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  let el = n;
  if (ctx.motion && ctx.tagged) {
    const f = inFormat(n, ctx.motion);
    if (!f) return null;
    el = f;
  }
  switch (el.tag) {
    case 'sc-for': {
      const listAttr = el.attrs.find((a) => a.name === 'list');
      const list = listAttr ? interp(listAttr.value, scope) : [];
      const as = el.attrs.find((a) => a.name === 'as')?.value ?? 'item';
      const arr = Array.isArray(list) ? list : [];
      return (
        <React.Fragment key={key}>
          {arr.map((item, i) => (
            <React.Fragment key={i}>{renderNodes(el.children, { ...scope, [as]: item, $index: i }, ctx, docSrc, parent)}</React.Fragment>
          ))}
        </React.Fragment>
      );
    }
    case 'sc-if': {
      const v = el.attrs.find((a) => a.name === 'value');
      const show = v ? interp(v.value, scope) : false;
      return show ? <React.Fragment key={key}>{renderNodes(el.children, scope, ctx, docSrc, parent)}</React.Fragment> : null;
    }
    case 'helmet':
      return createPortal(<>{renderNodes(el.children, scope, { ...ctx, tagged: false }, docSrc, 'helmet')}</>, document.head, String(key));
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
  if (ctx.slide) {
    const sp = (): Record<string, unknown> => toProps(el, scope, ctx, key);
    const a = (name: string) => el.attrs.find((x) => x.name === name)?.value;
    switch (el.tag) {
      case 'x-shape':
      case 'x-icon':
      case 'x-connector':
        return <XArt key={key} tag={el.tag} props={sp()} attrs={Object.fromEntries(el.attrs.map((x) => [x.name, String(interp(x.value, scope) ?? '')]))} />;
      case 'x-embed': {
        const src = a('src');
        if (src && isBoardEmbedPath(src))
          return (
            <XBoard
              key={key}
              props={sp()}
              src={src}
              files={ctx.files}
              tweaks={embedProps(a('data-props'))}
              base={ctx.slide.base}
              mode={ctx.mode}
              still={ctx.slide.still}
              live={ctx.mode === 'play' && !ctx.motion}
            />
          );
        const own = innerSource(ctx.slide.source, el.inner);
        const fx = a('data-fx');
        // a built-in effect: on a stage it waits to be sought, presenting a slide it runs on its own clock, editing one it stands still
        const markup = fx !== undefined && isFxEmbed({ 'data-fx': fx }, own) ? (fxMarkup(fx, { live: ctx.mode === 'play' && !ctx.motion, at: ctx.motion ? 0 : FX_STILL_MS }) ?? '') : own;
        return (
          <XEmbed
            key={key}
            props={sp()}
            html={markup + (ctx.motion && el.attrs.some((x) => x.name === 'data-seek') ? SEEK_BRIDGE : '')}
            mode={ctx.mode}
            still={ctx.slide.still}
          />
        );
      }
      case 'img': {
        const p = sp();
        p.src = resolveSrc(p.src, ctx.slide.base);
        return React.createElement('img', p);
      }
    }
  }
  if (el.tag.startsWith('sc-') || el.tag === 'x-import') {
    return <React.Fragment key={key}>{renderNodes(el.children, scope, ctx, docSrc, parent)}</React.Fragment>;
  }
  if (el.tag === 'style' && ctx.base) {
    const css = el.children.map((c) => (c.kind === 'text' ? String(interp(c.text, scope) ?? '') : '')).join('');
    return React.createElement('style', { key }, urlsAgainst(css, ctx.base));
  }
  const props = toProps(el, scope, ctx, key);
  if (VOID_ELEMENTS.has(el.tag) && el.ns === 'html') return React.createElement(el.tag, props);
  if (el.tag === 'table' && el.children.some((c) => c.kind === 'el' && c.tag === 'tr')) {
    // rows written straight into <table> (the slide subset does): the DOM wants a tbody around them
    return React.createElement('table', props, React.createElement('tbody', null, ...renderNodes(el.children, scope, ctx, docSrc, 'tbody')));
  }
  if (el.tag === 'textarea') {
    const text = el.children.map((c) => (c.kind === 'text' ? String(interp(c.text, scope) ?? '') : '')).join('');
    if (!('value' in props)) props.defaultValue = text;
    return React.createElement('textarea', props);
  }
  return React.createElement(el.tag, props, ...renderNodes(el.children, scope, ctx, docSrc, el.tag));
}

// -------------------------------------------------------------- components

const docCache = new Map<string, DcDoc>();
export function docFor(source: string): DcDoc {
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

/**
 * The component class for a source, cached by the page's *script*, not the
 * whole source: a markup-only edit (every step of a progressive AI edit)
 * reuses the class, so React reconciles the new markup onto the drawn DOM
 * instead of unmounting the artboard. A changed script is a changed page
 * program and gets a fresh class, which remounts — as before. The class's
 * render reads the markup of the source it is handed (`__dcSource`).
 */
function compile(source: string, file: string): { cls: LogicClass; doc: DcDoc } {
  const doc = docFor(source);
  const script = doc.script?.code ?? '';
  const hit = classCache.get(file + '\0' + script);
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
      const ctx = (this.props.__ctx as Ctx) ?? host.ctx();
      const vals = this.renderVals() ?? {};
      const doc = docFor(this.props.__dcSource as string);
      return <>{renderNodes(doc.children, vals, ctx, doc.source)}</>;
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
  if (classCache.size > 128) classCache.clear();
  classCache.set(file + '\0' + script, cls);
  return { cls, doc };
}

export class Boundary extends React.Component<{ children: React.ReactNode; file: string }, { error: Error | null }> {
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
          {msg('fileFailed', { file: this.props.file })}
          {'\n'}
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

export function DcComponent(p: { source: string; file: string; props: Record<string, unknown>; ctx: Ctx }) {
  let compiled: { cls: LogicClass; doc: DcDoc };
  try {
    compiled = compile(p.source, p.file);
  } catch (e) {
    throw new Error('script: ' + (e as Error).message);
  }
  const Cls = compiled.cls;
  // `__dcSource` is the markup the class's render draws (the current source, whatever instance is mounted)
  return <Cls {...defaultsOf(compiled.doc)} {...p.props} __ctx={p.ctx} __dcSource={p.source} />;
}
