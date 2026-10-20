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
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  DEFAULT_SCENE_MS,
  HIDE_CSS,
  LOCK_ATTR,
  SLIDE_BASE_CSS,
  attrsForFormat,
  fxMarkup,
  isFxEmbed,
  FX_STILL_MS,
  boardTime,
  embedProps,
  isBoardEmbedPath,
  parseTime,
  timeSpec,
  sceneBaseCss,
  paintLayer,
  textBoxIndent,
  parseDc,
  styleObject,
  isTextEditable,
  retypeKind,
  planRetype,
  RetypeError,
  VOID_ELEMENTS,
  type DcDoc,
  type DcElement,
  type DcNode,
  type FromRuntime,
  type Inspect,
  type Mode,
  type MotionStageInfo,
  type ToRuntime,
} from '@dc/core';
import { BUILD_CSS, XArt, XBoard, XEmbed, innerSource, resolveSrc, showSteps } from './slide';
import { urlsAgainst } from './urls';
import { animateScene, SEEK_BRIDGE, type SceneAnim } from './sceneAnim';
import { msg } from './msg';
import { answerSnaps } from '@dc/export/snap';

const post = (m: FromRuntime) => window.parent.postMessage(m, '*');
// an artboard embedded in a slide or scene hands the page a picture of itself when it exports (.design/export.md)
answerSnaps();

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
          if (current.mode === 'play') (fn as (e: unknown) => void)(e);
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
  if (ctx.slide) {
    const z = paintLayer(el);
    if (z !== undefined) p.style = { ...((p.style as Record<string, string>) ?? {}), zIndex: z };
    const indent = textBoxIndent(el);
    if (indent !== undefined) p.style = { ...((p.style as Record<string, string>) ?? {}), '--dc-indent': `${indent}px` };
  }
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
    return <React.Fragment key={key}>{renderNodes(el.children, scope, ctx, parent)}</React.Fragment>;
  }
  if (el.tag === 'style' && ctx.base) {
    const css = el.children.map((c) => (c.kind === 'text' ? String(interp(c.text, scope) ?? '') : '')).join('');
    return React.createElement('style', { key }, urlsAgainst(css, ctx.base));
  }
  const props = toProps(el, scope, ctx, key);
  if (VOID_ELEMENTS.has(el.tag) && el.ns === 'html') return React.createElement(el.tag, props);
  if (el.tag === 'table' && el.children.some((c) => c.kind === 'el' && c.tag === 'tr')) {
    // rows written straight into <table> (the slide subset does): the DOM wants a tbody around them
    return React.createElement('table', props, React.createElement('tbody', null, ...renderNodes(el.children, scope, ctx, 'tbody')));
  }
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
  slide: { head: string; base: string; still?: boolean } | null;
  base: string;
  /** present mode: how far a slide's builds have played */
  step: number;
  /** a motion scene on the editor stage */
  motion: MotionStageInfo | null;
  /** an artboard that moves with time, drawn inside an embed: the time its host last sought (null = its still) */
  time: number | null;
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
  slide: null,
  base: '',
  step: 0,
  motion: null,
  time: null,
  ctx() {
    return {
      tagged: true,
      files: this.files,
      file: this.file,
      mode: this.mode,
      slide: this.slide ? { base: this.slide.base, source: this.source, still: this.slide.still } : undefined,
      base: this.slide ? undefined : this.base || undefined,
      motion: this.slide && this.motion ? { format: this.motion.format, formats: this.motion.formats } : undefined,
    };
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
    if (!boardReady && window.parent !== window && !current.slide && timeSpec(docFor(source).props)) {
      // a moving artboard inside an embed: its host may seek it now
      boardReady = true;
      post({ dcMotion: 'embed-ready' } as unknown as FromRuntime);
    }
    if (current.slide && current.mode === 'play') post({ dc: 'steps', total: showSteps(mount, current.step) });
  }, [source]);
  return null;
}

// hidden elements go everywhere, canvas artboards included (slides and scenes carry it in SLIDE_BASE_CSS)
document.head.appendChild(Object.assign(document.createElement('style'), { textContent: HIDE_CSS }));

// slides: the subset's base styles once, the deck's typefaces whenever they change
let slideStyles: HTMLStyleElement | null = null;
let facesHtml = '';
function slideHead() {
  if (!slideStyles) {
    slideStyles = document.createElement('style');
    document.head.appendChild(slideStyles);
  }
  const size = current.motion?.size;
  const css =
    (size ? sceneBaseCss(size[0], size[1], SLIDE_BASE_CSS) + MOTION_CSS : SLIDE_BASE_CSS + BUILD_CSS) + 'html,body{background:transparent;overflow:hidden}';
  if (slideStyles.textContent !== css) slideStyles.textContent = css;
  const html = current.slide?.head ?? '';
  if (html !== facesHtml) {
    facesHtml = html;
    // only font links and @font-face rules ever come here (deck.ts faceMarkup)
    const holder = document.createElement('template');
    holder.innerHTML = html;
    document.head.querySelectorAll('[data-dc-face]').forEach((n) => n.remove());
    for (const n of Array.from(holder.content.children)) {
      if (n.tagName !== 'LINK' && n.tagName !== 'STYLE') continue;
      n.setAttribute('data-dc-face', '');
      document.head.appendChild(n);
    }
  }
}

function render() {
  const doc = docFor(current.source);
  post({ dc: 'error', message: doc.errors.length ? doc.errors.join('\n') : null });
  if (doc.slide) slideHead();
  // an artboard that declares $time draws from a time prop: the one its host sought, else what the editor set, else its still
  const spec = doc.slide ? null : timeSpec(doc.props);
  const props = spec ? { ...current.props, time: boardTime(spec, current.time ?? (current.props.time as number | undefined)) } : current.props;
  const body = <DcComponent key={current.source} source={current.source} file={current.file} props={props} ctx={current.ctx()} />;
  const tree = (
    <Boundary key={renderKey} file={current.file}>
      {doc.slide ? <div className="dc-slide-host">{body}</div> : body}
      <Committed source={current.source} />
    </Boundary>
  );
  if (!current.motion) return root.render(tree);
  // a scene's animations hold the page in a state React didn't write: put it back first,
  // and commit at once so no frame shows the scene without its timing
  sceneAnim?.clear();
  sceneAnim = null;
  flushSync(() => root.render(tree));
  animate();
}

// ----------------------------------------------------------------- motion

/** Pointer events follow what is on screen at the playhead; a landed (selected) element always takes them. */
const MOTION_CSS = '[data-dc-off]{pointer-events:none}[data-dc-rest]{pointer-events:auto}';

let sceneAnim: SceneAnim | null = null;
let sceneVisible: { el: Element; from: number; to: number }[] = [];
let sceneEls: Element[] = [];

/** Attach the scene's animations to what React just committed, then show the playhead's time. */
function animate() {
  sceneAnim?.clear();
  const section = mount.querySelector('.dc-slide-host > section');
  if (!section) return;
  const els = [section, ...Array.from(section.querySelectorAll('*'))];
  const duration = parseTime(section.getAttribute('data-duration') ?? undefined) ?? DEFAULT_SCENE_MS;
  sceneEls = els;
  sceneAnim = animateScene(els, 0, duration);
  sceneVisible = sceneAnim.visible;
  showTime();
}

/**
 * Stop the scene at the playhead; the selected element is drawn landed so what
 * you drag is what is written. On the scene's first moment every element is
 * landed, so the scene reads as a page to edit rather than an empty frame.
 */
function showTime() {
  const m = current.motion;
  if (!m || !sceneAnim) return;
  const rest = new Set<Element>(
    m.landed ? sceneEls : current.mode === 'edit' && current.selected !== null ? instances(current.selected) : [],
  );
  sceneAnim.setTime(m.t, rest);
  for (const { el, from, to } of sceneVisible) {
    const off = !m.landed && (m.t < from || m.t > to);
    if (off) el.setAttribute('data-dc-off', '');
    else el.removeAttribute('data-dc-off');
    if (rest.has(el)) el.setAttribute('data-dc-rest', '');
    else el.removeAttribute('data-dc-rest');
  }
  for (const f of Array.from(mount.querySelectorAll('x-embed[data-seek] > iframe')) as HTMLIFrameElement[]) {
    f.contentWindow?.postMessage({ dcMotion: 'seek', t: m.t, n: -1 }, '*');
  }
}

// a seekable embed that just loaded draws the playhead's time
window.addEventListener('message', (e) => {
  if (e.data?.dcMotion !== 'embed-ready' || !current.motion) return;
  (e.source as Window | null)?.postMessage({ dcMotion: 'seek', t: current.motion.t, n: -1 }, '*');
});

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
  if (!resize) spots = [];
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
          const can = resizable(current.selected);
          if (can && !resize) spots = handleSpots(r);
          const corners = can ? handleSpots(r) : isLocked(els[0]) ? [] : handleSpots(r).filter((h) => h.at.length === 2);
          for (const { x, y } of corners) {
            out.push(box({ left: x - 3.5, top: y - 3.5, width: 7, height: 7 }, `background:#fff;border:1.5px solid ${BLUE}`));
          }
        }
      }
    }
    if (indicator) out.push(box({ left: indicator.x, top: indicator.y, width: indicator.w, height: indicator.h }, `background:${BLUE};border-radius:1px`));
    if (resize?.active) {
      const r = resize.el.getBoundingClientRect();
      for (const g of resize.guides) out.push(box(g.axis === 'x' ? { left: g.at, top: 0, width: 1, height: innerHeight } : { left: 0, top: g.at, width: innerWidth, height: 1 }, `background:#e5484d`));
      out.push(
        `<div style="position:fixed;left:${r.left + r.width / 2}px;top:${r.bottom + 8}px;transform:translateX(-50%);padding:2px 6px;border-radius:4px;background:${BLUE};color:#fff;font:600 12px/1.4 system-ui;white-space:nowrap">${resize.w} × ${resize.h}</div>`,
      );
    }
  }
  const html = out.join('');
  if (overlay.innerHTML !== html) overlay.innerHTML = html;
}
(function loop() {
  drawBoxes();
  requestAnimationFrame(loop);
})();

/** What a click lands on: the element under the pointer (a slide's text box as a whole), or the nearest one outside a locked branch. */
function tidOf(target: EventTarget | null): number | null {
  let el = (target as Element | null)?.closest?.('[data-dc-tid]') ?? null;
  // a slide's text box is one box: a click on one of its paragraphs picks the box (a double click still types in the paragraph)
  const box = current.slide ? el?.closest('[data-text][data-dc-tid]') : null;
  if (box) el = box;
  const locked = el?.closest(`[${LOCK_ATTR}]`);
  if (locked) el = locked.parentElement?.closest('[data-dc-tid]') ?? null;
  if (!el) return null;
  return Number(el.getAttribute('data-dc-tid'));
}

/** Locked elements (and what's inside them) are not moved, resized or retyped on the stage. */
const isLocked = (el: Element | undefined | null) => !!el?.closest(`[${LOCK_ATTR}]`);

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
      const acs = getComputedStyle(a);
      const bg = acs.backgroundColor;
      if (opaque(bg)) {
        backdrop = bg;
        break;
      }
      // a gradient backdrop (slides often have one): its last stop covers the most area
      const stops = /gradient\(/.test(acs.backgroundImage) && acs.backgroundClip !== 'text' ? acs.backgroundImage.match(/rgba?\([^)]*\)/g) : null;
      const last = stops?.filter(opaque).at(-1);
      if (last) {
        backdrop = last;
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
  if (current.mode === 'edit' && !drag?.active && !resize?.active) {
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
  return instances(tid).length === 1 && !isLocked(instances(tid)[0]);
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

// ------------------------------------------------------------- resizing

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const CURSORS: Record<Handle, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
/** Where the selected element's handles are drawn now. */
let spots: { at: Handle; x: number; y: number }[] = [];

function handleSpots(r: DOMRect): { at: Handle; x: number; y: number }[] {
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  return [
    { at: 'nw', x: r.left, y: r.top },
    { at: 'n', x: cx, y: r.top },
    { at: 'ne', x: r.right, y: r.top },
    { at: 'e', x: r.right, y: cy },
    { at: 'se', x: r.right, y: r.bottom },
    { at: 's', x: cx, y: r.bottom },
    { at: 'sw', x: r.left, y: r.bottom },
    { at: 'w', x: r.left, y: cy },
  ];
}

/** Elements with a size of their own: not the board or slide itself, not repeated, not drawn by a component. */
function resizable(tid: number | null): boolean {
  if (tid === null || !draggable(tid)) return false;
  const el = docFor(current.source).elements[tid];
  return !!el && !/^(sc-|dc-import$|helmet$|x-import$|br$|tr$|td$|th$|li$|option$)/.test(el.tag);
}

function spotAt(x: number, y: number): Handle | null {
  for (const h of spots) if (Math.abs(x - h.x) <= 6 && Math.abs(y - h.y) <= 6) return h.at;
  return null;
}

interface Resize {
  tid: number;
  el: HTMLElement;
  at: Handle;
  start: { x: number; y: number };
  rect: DOMRect;
  /** border + padding, when the element's width is its content box */
  extra: { w: number; h: number };
  abs: boolean;
  left: number;
  top: number;
  saved: { width: string; height: string; left: string; top: string; transition: string };
  active: boolean;
  w: number;
  h: number;
  guides: { axis: 'x' | 'y'; at: number }[];
}
let resize: Resize | null = null;

function startResize(tid: number, at: Handle, e: PointerEvent) {
  const el = instances(tid)[0] as HTMLElement | undefined;
  if (!el) return;
  const cs = getComputedStyle(el);
  const content = cs.boxSizing === 'content-box';
  const sum = (...ps: string[]) => ps.reduce((n, p) => n + (parseFloat(cs.getPropertyValue(p)) || 0), 0);
  const r = el.getBoundingClientRect();
  resize = {
    tid,
    el,
    at,
    start: { x: e.clientX, y: e.clientY },
    rect: r,
    extra: content
      ? { w: sum('padding-left', 'padding-right', 'border-left-width', 'border-right-width'), h: sum('padding-top', 'padding-bottom', 'border-top-width', 'border-bottom-width') }
      : { w: 0, h: 0 },
    abs: cs.position === 'absolute',
    left: parseFloat(cs.left) || 0,
    top: parseFloat(cs.top) || 0,
    saved: { width: el.style.width, height: el.style.height, left: el.style.left, top: el.style.top, transition: el.style.transition },
    active: false,
    w: Math.round(r.width),
    h: Math.round(r.height),
    guides: [],
  };
}

/** Edges and centre lines of everything else on the page, to snap a moving edge to. */
function snapLines(self: Element): { x: number[]; y: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const o of Array.from(mount.querySelectorAll('[data-dc-tid]'))) {
    if (o === self || self.contains(o) || o.hasAttribute('data-dc-off')) continue;
    const r = o.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    xs.push(r.left, r.right, r.left + r.width / 2);
    ys.push(r.top, r.bottom, r.top + r.height / 2);
  }
  return { x: xs, y: ys };
}

function moveResize(e: PointerEvent) {
  const d = resize;
  if (!d) return;
  let dx = e.clientX - d.start.x;
  let dy = e.clientY - d.start.y;
  if (!d.active && Math.hypot(dx, dy) < 2) return;
  d.active = true;
  d.guides = [];
  const east = d.at.includes('e');
  const west = d.at.includes('w');
  const south = d.at.includes('s');
  const north = d.at.includes('n');
  const k = e.altKey ? 2 : 1;
  // snap the moving edge to another element's edge or centre (not with Shift: the ratio wins)
  if (!e.shiftKey) {
    const lines = snapLines(d.el);
    const snap = (edge: number, list: number[]) => {
      let best: number | null = null;
      for (const v of list) if (Math.abs(v - edge) <= 8 && (best === null || Math.abs(v - edge) < Math.abs(best - edge))) best = v;
      return best;
    };
    if (east || west) {
      const edge = east ? d.rect.right + dx : d.rect.left + dx;
      const v = snap(edge, lines.x);
      if (v !== null) {
        dx += v - edge;
        d.guides.push({ axis: 'x', at: v });
      }
    }
    if (north || south) {
      const edge = south ? d.rect.bottom + dy : d.rect.top + dy;
      const v = snap(edge, lines.y);
      if (v !== null) {
        dy += v - edge;
        d.guides.push({ axis: 'y', at: v });
      }
    }
  }
  let w = d.rect.width + (east ? dx : west ? -dx : 0) * k;
  let h = d.rect.height + (south ? dy : north ? -dy : 0) * k;
  if (e.shiftKey && d.rect.width && d.rect.height) {
    const ratio = d.rect.width / d.rect.height;
    if (d.at.length === 2) {
      if (Math.abs(w / d.rect.width) > Math.abs(h / d.rect.height)) h = w / ratio;
      else w = h * ratio;
    } else if (east || west) h = w / ratio;
    else w = h * ratio;
  }
  w = Math.max(8, Math.round(w));
  h = Math.max(8, Math.round(h));
  d.w = w;
  d.h = h;
  const el = d.el;
  el.style.transition = 'none';
  if (east || west || e.shiftKey) el.style.width = `${w - d.extra.w}px`;
  if (north || south || e.shiftKey) el.style.height = `${h - d.extra.h}px`;
  if (d.abs) {
    const gw = w - d.rect.width;
    const gh = h - d.rect.height;
    // the edge that moves is the one dragged (both, from the centre with Alt); the other stays
    if (west || (e.altKey && east)) el.style.left = `${Math.round(d.left - (e.altKey ? gw / 2 : gw))}px`;
    if (north || (e.altKey && south)) el.style.top = `${Math.round(d.top - (e.altKey ? gh / 2 : gh))}px`;
  }
}

function endResize(cancel = false) {
  const d = resize;
  resize = null;
  if (!d) return;
  const restore = () => {
    if (!d.el.isConnected) return;
    Object.assign(d.el.style, d.saved);
  };
  if (!d.active || cancel) return restore();
  suppressClick = true;
  const set: Record<string, string | null> = {};
  const sized = { w: d.el.style.width !== d.saved.width, h: d.el.style.height !== d.saved.height };
  if (sized.w) set.width = d.el.style.width;
  if (sized.h) set.height = d.el.style.height;
  if (d.abs) {
    if (d.el.style.left !== d.saved.left) set.left = d.el.style.left;
    if (d.el.style.top !== d.saved.top) set.top = d.el.style.top;
  }
  // a size that grows with its parent ("fill") would ignore the new value: it becomes fixed
  const parent = d.el.parentElement?.closest('[data-dc-tid]') as HTMLElement | null;
  const pcs = parent ? getComputedStyle(parent) : null;
  if (pcs?.display.includes('flex')) {
    const row = !pcs.flexDirection.startsWith('column');
    const style = docFor(current.source).elements[d.tid]?.attrs.find((a) => a.name === 'style')?.value ?? '';
    const has = (p: string) => new RegExp(`(^|;)\\s*${p}\\s*:`).test(style);
    if ((row ? sized.w : sized.h) && (has('flex') || has('flex-grow'))) Object.assign(set, { flex: null, 'flex-grow': null });
    if ((row ? sized.h : sized.w) && has('align-self')) set['align-self'] = null;
  }
  post({ dc: 'resize', tid: d.tid, set });
  // a change re-renders the page; if nothing was written, put the element back as it was
  setTimeout(restore, 1500);
}

document.addEventListener(
  'mousemove',
  (e) => {
    if (!inEdit() || drag || resize) return;
    const at = spotAt(e.clientX, e.clientY);
    document.documentElement.style.cursor = at ? CURSORS[at] : '';
  },
  true,
);

document.addEventListener(
  'pointerdown',
  (e) => {
    if (!inEdit()) return;
    if (current.editing?.contains(e.target as Node)) return;
    e.preventDefault();
    if (current.editing) commitText();
    if (e.button !== 0) return;
    const at = spotAt(e.clientX, e.clientY);
    if (at && current.selected !== null) return startResize(current.selected, at, e);
    // grabbing anything inside the selected element drags the selected element
    const sel = current.selected;
    const selEl = sel === null ? null : instances(sel)[0];
    if (sel !== null && selEl?.contains(e.target as Node) && draggable(sel)) startDrag(sel, e);
  },
  true,
);
document.addEventListener('pointermove', (e) => (resize ? moveResize(e) : drag && moveDrag(e)), true);
document.addEventListener('pointerup', (e) => (resize ? endResize() : drag && endDrag(e)), true);
window.addEventListener('blur', () => (resize ? endResize(true) : drag && endDrag(new PointerEvent('pointerup'), true)));

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
      showTime();
      post({ dc: 'select', tid, shift: e.shiftKey, x: e.clientX, y: e.clientY });
      return;
    }
    // play mode: links between artboards
    const a = (e.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a && current.slide) {
      post({ dc: 'key', key: 'ArrowRight', meta: false, shift: false, alt: false });
      return;
    }
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
      showTime();
      post({ dc: 'select', tid, shift: false, x: e.clientX, y: e.clientY });
    }
    post({ dc: 'contextmenu', tid, x: e.clientX, y: e.clientY });
  },
  true,
);

document.addEventListener(
  'mousemove',
  (e) => {
    if (!inEdit() || drag?.active || resize?.active) return;
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
  return new Set(doc.elements.filter((e) => retypeKind(doc, e) !== null).map((e) => e.tid));
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
    if (!editableTids().has(tid) || isLocked(el)) return;
    // text made only of values from the script: say so instead of doing nothing
    if (retypeKind(docFor(current.source), docFor(current.source).elements[tid]) === 'data') return void post({ dc: 'noedit', tid, why: 'data' });
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
  const item = el.hasAttribute('data-dc-item') ? Number(el.getAttribute('data-dc-item')) : null;
  const doc = docFor(current.source);
  const mixed = !!doc.elements[tid] && retypeKind(doc, doc.elements[tid]) === 'mixed';
  let refused: RetypeError | null = null;
  if (!cancel && mixed && text !== editingOriginal) {
    try {
      planRetype(doc, doc.elements[tid], editingOriginal, text, item);
    } catch (e) {
      if (!(e instanceof RetypeError)) throw e;
      refused = e;
    }
  }
  if (refused) {
    post({ dc: 'noedit', tid, why: refused.code });
    renderKey++;
    render();
  } else if (!cancel && text !== editingOriginal) post({ dc: 'text', tid, text, from: editingOriginal, item });
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
    if (resize && e.key === 'Escape') {
      endResize(true);
      return;
    }
    const nav = /^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|PageUp|PageDown|Home|End| |f|F)$/.test(e.key);
    if (!inEdit() && e.key !== 'Escape' && !(current.slide && nav)) return;
    if (!inEdit() && nav) e.preventDefault();
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

/** What went wrong in a picture: html-to-image rejects with the failing <img>'s load Event, which has no message of its own. */
function exportError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return typeof err === 'string' && err ? err : 'the picture could not be made';
}

async function exportPng(id: string, scale: number, tid?: number) {
  const prevSel = current.selected;
  try {
    const node = (tid === undefined ? mount.querySelector('[data-dc-tid]') : instances(tid)[0]) as HTMLElement | null;
    if (!node) throw new Error('nothing to export');
    const broken = [...node.querySelectorAll('img')].find((i) => i.complete && !i.naturalWidth && i.getAttribute('src'));
    if (broken) throw new Error(`could not load the picture ${broken.getAttribute('src')!.slice(0, 120)}`);
    const { toPng } = await import('html-to-image');
    current.selected = null;
    overlay.innerHTML = '';
    const dataUrl = await toPng(node, { pixelRatio: scale, skipFonts: true, cacheBust: false });
    post({ dc: 'exported', id, dataUrl });
  } catch (err) {
    post({ dc: 'exported', id, error: exportError(err) });
  } finally {
    current.selected = prevSel;
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
    const motion = m.motion ?? null;
    const drawn = (x: MotionStageInfo | null) => (x ? JSON.stringify([x.format, x.formats, x.size]) : '');
    const changed =
      m.source !== current.source ||
      m.files !== current.files ||
      JSON.stringify(m.props) !== JSON.stringify(current.props) ||
      m.mode !== current.mode ||
      JSON.stringify(slide) !== JSON.stringify(current.slide) ||
      (m.base ?? '') !== current.base ||
      drawn(motion) !== drawn(current.motion);
    if (m.mode !== current.mode || m.source !== current.source) current.step = 0;
    Object.assign(current, { file: m.file, source: m.source, files: m.files, props: m.props, mode: m.mode, selected: m.selected, slide, base: m.base ?? '', motion });
    document.documentElement.dataset.mode = m.mode;
    if (changed) render();
    else showTime();
  } else if (m.dc === 'select') {
    current.selected = m.tid;
    showTime();
    inspect();
  } else if (m.dc === 'seek') {
    if (current.motion) current.motion = { ...current.motion, t: m.t, landed: m.landed };
    showTime();
  } else if (m.dc === 'hover') {
    externalHover = m.tid;
  } else if (m.dc === 'mode') {
    current.mode = m.mode;
    document.documentElement.dataset.mode = m.mode;
    renderKey++;
    render();
  } else if (m.dc === 'step') {
    current.step = m.step;
    post({ dc: 'steps', total: showSteps(mount, m.step) });
  } else if (m.dc === 'export') {
    void exportPng(m.id, m.scale, m.tid);
  } else if (m.dc === 'edit') {
    // the element may only exist after the render that is on its way
    let tries = 0;
    const tid = m.tid;
    const attempt = () => {
      // tids are positions in the source: only trust them once that source is rendered
      const el = committedSource === current.source ? (instances(tid)[0] as HTMLElement | undefined) : undefined;
      if (el && editableTids().has(tid)) {
        current.selected = tid;
        showTime();
        beginText(el);
      } else if (tries++ < 20) setTimeout(attempt, 50);
    };
    attempt();
  }
}

/**
 * An artboard drawn inside an embed (a slide's or a motion scene's): its host
 * seeks it like any seekable embed. It draws that time at once and answers
 * once the frame has it, so a render waits for the right picture.
 */
let boardReady = false;
function seekBoard(t: number, n: number) {
  current.time = t;
  if (current.source && !docFor(current.source).slide) flushSync(render);
  requestAnimationFrame(() => post({ dcMotion: 'seeked', n } as unknown as FromRuntime));
}

window.addEventListener('message', (e) => {
  if (e.source !== window.parent) return;
  const d = e.data as { dcMotion?: string; t?: unknown; n?: unknown } | null;
  if (d && d.dcMotion === 'seek' && typeof d.t === 'number') return seekBoard(d.t, typeof d.n === 'number' ? d.n : -1);
  const m = e.data as ToRuntime;
  if (!m || typeof m !== 'object' || !('dc' in m)) return;
  onMessage(m);
});

window.addEventListener('error', (e) => post({ dc: 'error', message: e.message }));
post({ dc: 'ready' });
