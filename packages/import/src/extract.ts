import type { ExtractReport, Extracted, XElement, XNode } from './model';

/**
 * Reads a page that a browser has laid out and returns it as plain data.
 *
 * Runs inside the page being imported (it needs the cascade and layout), so
 * it only uses DOM APIs and imports nothing at run time.
 *
 * The idea: an element keeps exactly the properties the page's author set on
 * it (by any rule that matches, or inline), and no others, written as one
 * inline `style`. Only *which* properties comes from the stylesheets; the
 * value is the author's own text when it is unambiguous and self-contained
 * (`repeat(3, 1fr)`, `50%`, `#2f6fed`), otherwise the browser's computed
 * value (anything with `var()`, `rem`, viewport units, or two competing
 * rules). Defaults stay defaults, so the result is as small as what the
 * author wrote, and the editor's properties panel shows real source values.
 */

export interface ExtractOptions {
  /** stop after this many elements (default 6000) */
  maxElements?: number;
}

type Pseudo = 'before' | 'after';

interface Rule {
  /** one selector of the rule's list, without its ::before / ::after */
  selector: string;
  pseudo: Pseudo | null;
  style: CSSStyleDeclaration;
  /** what relative url()s in it are relative to */
  base: string;
  /** specificity (ids, classes, types), then source order: how the cascade ranks it */
  rank: number[];
  /** `*`: its plain declarations go into the page's one stylesheet instead of onto every element */
  universal: boolean;
}

interface Decl {
  prop: string;
  value: string;
  base: string;
  rank: number[];
}

/** A selector's specificity, closely enough: :where() counts nothing, :is()/:not()/:has() count their contents. */
export function specificity(sel: string): [number, number, number] {
  let s = sel.replace(/:where\((?:[^()]|\([^()]*\))*\)/gi, '').replace(/:(is|not|has|matches)\(/gi, ' (');
  s = s.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '');
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]*\]|(?<!:):(?!:)[\w-]+/g) ?? []).length;
  const bare = s.replace(/\[[^\]]*\]/g, '');
  const types = (bare.match(/(?:^|[\s>+~(])[a-z][\w-]*/gi) ?? []).length + (bare.match(/::[\w-]+/g) ?? []).length;
  return [ids, classes, types];
}

/** The properties an element's presentational attributes set (old-style HTML, e-mail templates). */
function hintedProps(el: Element): string[] {
  const out: string[] = [];
  const has = (a: string) => el.hasAttribute(a);
  const tag = el.localName;
  if (has('bgcolor')) out.push('background-color');
  if (has('background')) out.push('background-image');
  if (has('align')) out.push(tag === 'table' || tag === 'img' ? (tag === 'img' ? 'float' : 'margin-left') : 'text-align', ...(tag === 'table' ? ['margin-right'] : []));
  if (has('valign')) out.push('vertical-align');
  if (has('nowrap')) out.push('white-space');
  if (tag === 'font') {
    if (has('color')) out.push('color');
    if (has('face')) out.push('font-family');
    if (has('size')) out.push('font-size');
  }
  if (tag === 'table') {
    if (has('cellspacing')) out.push('border-spacing');
    if (has('border')) out.push('border-top', 'border-right', 'border-bottom', 'border-left');
    if (has('width')) out.push('width');
    if (has('height')) out.push('height');
  }
  if ((tag === 'td' || tag === 'th') && el.closest('table')) {
    const t = el.closest('table')!;
    if (t.hasAttribute('cellpadding')) out.push('padding-top', 'padding-right', 'padding-bottom', 'padding-left');
    if (t.hasAttribute('border') && t.getAttribute('border') !== '0') out.push('border-top', 'border-right', 'border-bottom', 'border-left');
    if (has('width')) out.push('width');
    if (has('height')) out.push('height');
  }
  if (tag === 'hr' && (has('size') || has('noshade') || has('color'))) out.push('height', 'border-top', 'border-right', 'border-bottom', 'border-left', 'background-color');
  return out;
}

/** Substitute var(--x, fallback) with the custom properties `cs` carries; '' when one is missing. */
export function resolveVars(value: string, cs: { getPropertyValue(p: string): string }): string {
  let v = value;
  for (let i = 0; i < 8 && v.includes('var('); i++) {
    const next = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g, (_m, name: string, fallback?: string) => {
      const got = cs.getPropertyValue(name).trim();
      return got || (fallback ?? '').trim() || '\u0000';
    });
    if (next === v) break;
    v = next;
  }
  return v.includes('\u0000') || v.includes('var(') ? '' : v;
}

function compareRank(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const SKIP = new Set(['script', 'noscript', 'template', 'style', 'link', 'meta', 'base', 'title', 'head']);
const DROP = new Set(['iframe', 'frame', 'frameset', 'object', 'embed', 'audio', 'portal', 'dialog']);
const VOID = new Set(['area', 'br', 'col', 'hr', 'img', 'input', 'source', 'track', 'wbr']);

/** html attributes worth keeping; everything else (class, id, data-*, on*) goes */
const HTML_ATTRS = new Set([
  'href', 'src', 'alt', 'title', 'type', 'name', 'value', 'placeholder', 'colspan', 'rowspan', 'checked', 'selected',
  'disabled', 'readonly', 'for', 'role', 'lang', 'dir', 'target', 'rel', 'width', 'height', 'start', 'reversed',
  'open', 'datetime', 'cite', 'scope', 'headers', 'abbr', 'span', 'label', 'multiple', 'rows', 'cols', 'min', 'max', 'step',
]);

const STATE = /:(hover|focus|focus-visible|focus-within|active|visited|target|checked|indeterminate|placeholder-shown|autofill)\b/i;
const OTHER_PSEUDO_ELEMENT = /::?(placeholder|selection|marker|first-letter|first-line|backdrop|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+|cue|part\(|slotted\()/i;
const TRAILING_PSEUDO = /::?(before|after)\s*$/i;
const UNSAFE = /var\(|env\(|attr\(|^\s*(inherit|initial|unset|revert|revert-layer)\s*$|\d(rem|vw|vh|vmin|vmax|svh|lvh|dvh|svw|lvw|dvw|cqw|cqh|cqi|cqb)\b/i;
/** Read as written, biggest first, so `border: 1px solid` stays one declaration instead of twelve. */
const SHORTHANDS = [
  'background', 'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-block', 'border-inline',
  'border-color', 'border-style', 'border-width', 'border-radius', 'border-image', 'outline', 'margin', 'padding', 'inset',
  'margin-block', 'margin-inline', 'padding-block', 'padding-inline', 'gap', 'font', 'font-variant', 'flex', 'flex-flow',
  'grid', 'grid-template', 'grid-area', 'grid-row', 'grid-column', 'place-items', 'place-content', 'place-self', 'overflow',
  'text-decoration', 'list-style', 'transition', 'animation', 'columns', 'column-rule', 'mask', 'text-emphasis',
  'white-space', 'scroll-margin', 'scroll-padding', 'overscroll-behavior', 'container', 'offset',
];
const URL_RE = /url\(\s*(['"]?)(.*?)\1\s*\)/g;

/** Split a selector list on its top-level commas. */
export function splitSelectors(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (const c of text) {
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function absolute(url: string, base: string): string {
  if (!url || url.startsWith('#') || url.startsWith('data:')) return url;
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

export function extractPage(win: Window, opts: ExtractOptions = {}): Extracted {
  const doc = win.document;
  const max = opts.maxElements ?? 6000;
  const report: ExtractReport = {
    elements: 0,
    stateRules: 0,
    otherMediaRules: 0,
    unreadableSheets: [],
    scripts: doc.querySelectorAll('script').length,
    hidden: 0,
    transparent: 0,
    pseudoElements: 0,
    dropped: {},
    truncated: false,
  };
  const urls: string[] = [];
  const seen = new Set<string>();
  const useUrl = (u: string) => {
    if (/^(https?|file):/i.test(u) && !seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
    return u;
  };
  const withUrls = (value: string, base: string) =>
    value.includes('url(')
      ? value.replace(URL_RE, (_m, _q, u: string) => `url("${useUrl(absolute(u.trim(), base))}")`)
      : value;

  // ------------------------------------------------------------ stylesheets

  const rules: Rule[] = [];
  const head: string[] = [];
  const fontLinks: string[] = [];
  const isFontCss = (href: string) => /^https:\/\/fonts\.googleapis\.com\//.test(href);

  // rules that do not apply here (another screen width, :hover…): counted later, only those that would reach an element
  const stateSelectors: string[] = [];
  const mediaSelectors: string[] = [];
  const collectSelectors = (list: CSSRuleList, into: string[]) => {
    for (const r of Array.from(list)) {
      if (r.constructor.name === 'CSSStyleRule') into.push(...splitSelectors((r as CSSStyleRule).selectorText).map((x) => x.replace(TRAILING_PSEUDO, '').replace(new RegExp(STATE.source, 'gi'), '') || '*'));
      else if ('cssRules' in r && (r as CSSGroupingRule).cssRules) collectSelectors((r as CSSGroupingRule).cssRules, into);
    }
  };
  const reaching = (sels: string[]) => {
    let n = 0;
    for (const sel of sels) {
      try {
        if (doc.querySelector(sel)) n++;
      } catch {
        // a selector this browser cannot query
      }
    }
    return n;
  };

  /** `*` rules (resets like box-sizing): once for the page, not once per element. */
  const universalCss = (sel: string, style: CSSStyleDeclaration, base: string) => {
    const keep: string[] = [];
    for (let i = 0; i < style.length; i++) {
      const prop = style[i];
      const v = style.getPropertyValue(prop).trim();
      if (prop.startsWith('--') || !v || UNSAFE.test(v)) continue;
      keep.push(`${prop}: ${withUrls(v, base)}${style.getPropertyPriority(prop) ? ' !important' : ''}`);
    }
    if (keep.length) head.push(`${sel} { ${keep.join('; ')} }`);
  };

  const readRules = (list: CSSRuleList, base: string) => {
    for (const r of Array.from(list)) {
      // by name, not instanceof: the page may be another frame with its own constructors
      const type = r.constructor.name;
      if (type === 'CSSStyleRule') {
        const sr = r as CSSStyleRule;
        for (const sel of splitSelectors(sr.selectorText)) {
          const pm = TRAILING_PSEUDO.exec(sel);
          const bare = pm ? sel.slice(0, pm.index).trim() || '*' : sel;
          if (STATE.test(bare)) {
            stateSelectors.push(bare.replace(new RegExp(STATE.source, 'gi'), ''));
            continue;
          }
          if (OTHER_PSEUDO_ELEMENT.test(bare)) continue;
          const universal = bare === '*';
          if (universal) universalCss(sel, sr.style, base);
          rules.push({ selector: bare, pseudo: pm ? (pm[1].toLowerCase() as Pseudo) : null, style: sr.style, base, rank: [...specificity(sel), rules.length], universal });
        }
      } else if (type === 'CSSMediaRule') {
        const mr = r as CSSMediaRule;
        if (win.matchMedia(mr.media.mediaText).matches) readRules(mr.cssRules, base);
        else collectSelectors(mr.cssRules, mediaSelectors);
      } else if (type === 'CSSSupportsRule') {
        const cr = r as CSSSupportsRule;
        if ((win as unknown as typeof globalThis).CSS.supports(cr.conditionText)) readRules(cr.cssRules, base);
      } else if (type === 'CSSImportRule') {
        const ir = r as CSSImportRule;
        const href = absolute(ir.href, base);
        if (isFontCss(href)) fontLinks.push(href);
        else if (ir.styleSheet) readSheet(ir.styleSheet);
      } else if (type === 'CSSFontFaceRule') {
        head.push(withUrls(r.cssText, base));
      } else if (type === 'CSSKeyframesRule') {
        head.push(r.cssText);
      } else if ('cssRules' in r && (r as CSSGroupingRule).cssRules) {
        // @layer blocks, @container, @scope: read them as if they always applied
        readRules((r as CSSGroupingRule).cssRules, base);
      }
    }
  };

  const readSheet = (sheet: CSSStyleSheet) => {
    if (sheet.disabled) return;
    const owner = sheet.ownerNode as Element | null;
    if (owner && owner.localName === 'link') {
      const href = (owner as HTMLLinkElement).href;
      if (isFontCss(href)) {
        fontLinks.push(href);
        return;
      }
    }
    if (sheet.media && sheet.media.mediaText && !win.matchMedia(sheet.media.mediaText).matches) return;
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      report.unreadableSheets.push(sheet.href ?? '(inline)');
      return;
    }
    readRules(list, sheet.href ?? doc.baseURI);
  };
  for (const sheet of Array.from(doc.styleSheets)) readSheet(sheet as CSSStyleSheet);

  // ------------------------------------------------------- per-element style

  const scratch = doc.createElement('div');

  /** A shorthand's longhands, as this browser expands it ([] for a longhand). */
  const longhandCache = new Map<string, string[]>();
  const scratch2 = doc.createElement('div');
  const longhands = (sh: string): string[] => {
    let l = longhandCache.get(sh);
    if (!l) {
      scratch2.removeAttribute('style');
      scratch2.style.setProperty(sh, 'initial');
      l = Array.from({ length: scratch2.style.length }, (_, i) => scratch2.style[i]).filter((x) => x !== sh);
      longhandCache.set(sh, l);
    }
    return l;
  };

  // each tag as the browser styles it with no author CSS (`all: revert`): which longhands of a resolved shorthand say anything
  const probes = new Map<string, { el: Element; cs: CSSStyleDeclaration }>();
  const uaDefault = (tag: string, ns: XElement['ns'], prop: string): string => {
    let p = probes.get(ns + tag);
    if (!p) {
      const el = ns === 'html' ? doc.createElement(tag) : doc.createElementNS(ns === 'svg' ? 'http://www.w3.org/2000/svg' : 'http://www.w3.org/1998/Math/MathML', tag);
      el.setAttribute('style', 'all: revert; display: none');
      doc.documentElement.appendChild(el);
      p = { el, cs: win.getComputedStyle(el) };
      probes.set(ns + tag, p);
    }
    return p.cs.getPropertyValue(prop);
  };

  /**
   * The declarations that win on `el` (or on its ::before/::after), ranked as
   * the cascade ranks them, lowest first: applying them in this order gives
   * the element's style. Shorthands stay shorthands.
   */
  const declared = (el: Element, pseudo: Pseudo | null): Decl[] => {
    const best = new Map<string, Decl>();
    const put = (prop: string, value: string, base: string, rank: number[]) => {
      const cur = best.get(prop);
      if (!cur || compareRank(rank, cur.rank) >= 0) best.set(prop, { prop, value, base, rank });
    };
    const add = (style: CSSStyleDeclaration, base: string, rank: number[], universal: boolean) => {
      const consumed = new Set<string>();
      const prio = (p: string) => (style.getPropertyPriority(p) ? 1 : 0);
      for (const sh of SHORTHANDS) {
        const v = style.getPropertyValue(sh).trim();
        if (!v) continue;
        const ls = longhands(sh);
        // a shorthand written with var() leaves its longhands empty until computed
        if (!ls.length || ls.some((l) => consumed.has(l) || (!style.getPropertyValue(l) && !v.includes('var(')))) continue;
        for (const l of ls) consumed.add(l);
        if (universal && !UNSAFE.test(v)) continue;
        put(sh, v, base, [prio(ls[0]), ...rank]);
      }
      for (let i = 0; i < style.length; i++) {
        const prop = style[i];
        if (prop.startsWith('--') || consumed.has(prop)) continue;
        const v = style.getPropertyValue(prop).trim();
        if (universal && !UNSAFE.test(v)) continue;
        put(prop, v, base, [prio(prop), ...rank]);
      }
    };
    for (const r of rules) {
      if (r.pseudo !== pseudo) continue;
      let hit = false;
      try {
        hit = el.matches(r.selector);
      } catch {
        hit = false;
      }
      if (hit) add(r.style, r.base, [0, ...r.rank], r.universal);
    }
    if (!pseudo) {
      // presentational attributes (bgcolor, align, cellpadding…): the browser turns them into style; take what it computed
      for (const prop of hintedProps(el)) if (!best.has(prop)) best.set(prop, { prop, value: '', base: doc.baseURI, rank: [0, 0, 0, 0, 0, -1] });
      const inline = (el as HTMLElement).style as CSSStyleDeclaration | undefined;
      if (inline) add(inline, doc.baseURI, [1, 0, 0, 0, 0], false);
    }
    // a longhand that a later-ranked shorthand covers is dead
    const out = [...best.values()].sort((a, b) => compareRank(a.rank, b.rank));
    return out.filter((d, i) => !out.slice(i + 1).some((later) => longhands(later.prop).includes(d.prop)));
  };

  /** One style attribute: the winning declarations in cascade order, the author's text when safe, else the computed value. */
  const styleText = (decls: Decl[], cs: CSSStyleDeclaration, el: { tag: string; ns: XElement['ns'] }, extra?: Record<string, string>): string => {
    scratch.removeAttribute('style');
    for (const d of decls) {
      const { prop, base } = d;
      // var(--x) → the custom property's value on this element, so `line-height: var(--lh)` stays a plain 1.5 instead of a frozen px
      const value = d.value.includes('var(') ? resolveVars(d.value, cs) : d.value;
      const safe = value && !UNSAFE.test(value);
      const ls = longhands(prop);
      if (!safe && ls.length) {
        // a shorthand the browser has to resolve: its longhands, minus the ones at their initial value
        for (const l of ls) {
          const v = cs.getPropertyValue(l);
          if (v && v !== uaDefault(el.tag, el.ns, l)) scratch.style.setProperty(l, withUrls(v, doc.baseURI));
        }
        continue;
      }
      let v = safe ? withUrls(value, base) : withUrls(cs.getPropertyValue(prop), doc.baseURI);
      if (prop === 'position' && v === 'fixed') v = 'absolute';
      if (v) scratch.style.setProperty(prop, v);
    }
    if (extra) for (const [k, v] of Object.entries(extra)) scratch.style.setProperty(k, v);
    return scratch.getAttribute('style') ?? '';
  };

  // ------------------------------------------------------------------ walk

  const scrollY = win.scrollY;
  const nsOf = (el: Element): XElement['ns'] =>
    el.namespaceURI === 'http://www.w3.org/2000/svg' ? 'svg' : el.namespaceURI === 'http://www.w3.org/1998/Math/MathML' ? 'math' : 'html';
  const drop = (tag: string) => (report.dropped[tag] = (report.dropped[tag] ?? 0) + 1);

  const contentText = (content: string): string | null => {
    if (!content || content === 'none' || content === 'normal') return null;
    const parts = content.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g);
    if (!parts) return '';
    return parts
      .map((p) => p.slice(1, -1).replace(/\\([0-9a-f]{1,6})\s?/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16))).replace(/\\(.)/g, '$1'))
      .join('');
  };

  const pseudoBox = (el: Element, which: Pseudo): XElement | null => {
    const cs = win.getComputedStyle(el, `::${which}`);
    const text = contentText(cs.getPropertyValue('content'));
    if (text === null) return null;
    const decl = declared(el, which).filter((d) => d.prop !== 'content');
    if (!decl.length && !text.trim()) return null;
    report.pseudoElements++;
    return {
      kind: 'el',
      tag: 'span',
      ns: 'html',
      attrs: [],
      style: styleText(decl, cs, { tag: 'span', ns: 'html' }),
      children: text ? [{ kind: 'text', text }] : [],
      box: { top: 0, height: 0, marginTop: 0, marginBottom: 0, display: cs.display, whiteSpace: cs.whiteSpace },
      pseudo: which,
    };
  };

  const attrsOf = (el: Element, ns: XElement['ns']): [string, string][] => {
    const out: [string, string][] = [];
    const tag = el.localName;
    for (const a of Array.from(el.attributes)) {
      const name = a.name.toLowerCase();
      if (name === 'style' || name === 'class' || name.startsWith('on')) continue;
      if (ns === 'html' && !HTML_ATTRS.has(name) && !name.startsWith('aria-')) continue;
      let v = a.value;
      if (ns === 'html' && (name === 'src' || name === 'poster')) {
        // links (href) stay as written: they lead nowhere on a canvas, and the author's text is clearer
        v = name === 'src' && tag === 'img' ? (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src : absolute(v, doc.baseURI);
        useUrl(v);
      } else if (ns !== 'html' && (name === 'href' || name === 'xlink:href') && !v.startsWith('#')) {
        v = useUrl(absolute(v, doc.baseURI));
      }
      out.push([name === 'xlink:href' ? 'href' : name, v]);
    }
    if (tag === 'input' || tag === 'textarea') {
      const f = el as HTMLInputElement;
      const rest = out.filter(([k]) => k !== 'value' && k !== 'checked');
      if (tag === 'input' && f.value && f.type !== 'checkbox' && f.type !== 'radio') rest.push(['value', f.value]);
      if (f.checked) rest.push(['checked', '']);
      return rest;
    }
    return out;
  };

  const walk = (el: Element, inSvg: boolean): XElement | null => {
    const tag = el.localName;
    if (SKIP.has(tag)) return null;
    if (DROP.has(tag)) {
      drop(tag);
      return null;
    }
    if (report.elements >= max) {
      report.truncated = true;
      return null;
    }
    const ns = nsOf(el);
    const cs = win.getComputedStyle(el);
    if (!inSvg && cs.display === 'none') {
      report.hidden++;
      return null;
    }
    report.elements++;
    const rect = el.getBoundingClientRect();
    // see-through boxes with content, outermost only: usually a reveal-on-scroll effect that never ran
    if (!inSvg && cs.opacity === '0' && rect.height > 0 && el.parentElement && win.getComputedStyle(el.parentElement).opacity !== '0' && (el.textContent?.trim() || el.querySelector('img,svg')))
      report.transparent++;
    const node: XElement = {
      kind: 'el',
      tag,
      ns,
      attrs: attrsOf(el, ns),
      style: '',
      children: [],
      box: { top: rect.top + scrollY, height: rect.height, marginTop: parseFloat(cs.marginTop) || 0, marginBottom: parseFloat(cs.marginBottom) || 0, display: cs.display, whiteSpace: cs.whiteSpace },
    };
    if (tag === 'canvas' || tag === 'video') {
      // a still of it: what the canvas drew, or the video's poster
      let src = '';
      try {
        src = tag === 'canvas' ? (el as HTMLCanvasElement).toDataURL('image/png') : (el as HTMLVideoElement).poster;
      } catch {
        src = '';
      }
      if (!src) {
        drop(tag);
        report.elements--;
        return null;
      }
      node.tag = 'img';
      node.attrs = [['src', useUrl(src)], ['alt', '']];
    }
    node.style = styleText(declared(el, null), cs, { tag: node.tag, ns });
    if (ns === 'svg' && el.id) node.attrs.unshift(['id', el.id]);
    if (VOID.has(node.tag) && ns === 'html') return node;
    if (tag === 'textarea') {
      node.children = [{ kind: 'text', text: (el as HTMLTextAreaElement).value }];
      return node;
    }
    const pre = /^(pre|break-spaces)/.test(cs.whiteSpace);
    const before = ns === 'html' && tag !== 'canvas' ? pseudoBox(el, 'before') : null;
    if (before) node.children.push(before);
    for (const c of Array.from(el.childNodes)) {
      if (c.nodeType === 3) {
        const raw = c.nodeValue ?? '';
        const text = pre ? raw : raw.replace(/[\t\n\r ]+/g, ' ');
        if (text) node.children.push({ kind: 'text', text });
      } else if (c.nodeType === 1) {
        const child = walk(c as Element, inSvg || ns === 'svg');
        if (child) node.children.push(child);
      }
    }
    const after = ns === 'html' && tag !== 'canvas' ? pseudoBox(el, 'after') : null;
    if (after) node.children.push(after);
    return node;
  };

  // ------------------------------------------------------------------ root

  const html = doc.documentElement;
  const body = doc.body;
  const width = html.clientWidth || win.innerWidth;
  const height = Math.max(html.scrollHeight, body ? body.scrollHeight : 0);
  const root = (body && walk(body, false)) ?? ({ kind: 'el', tag: 'div', ns: 'html', attrs: [], style: '', children: [], box: { top: 0, height, marginTop: 0, marginBottom: 0, display: 'block', whiteSpace: 'normal' } } as XElement);
  root.tag = 'div';
  root.attrs = [];
  if (body) {
    // the page's own frame: <html>'s and <body>'s declarations on one root, body's margin as padding
    const bcs = win.getComputedStyle(body);
    const decl = [...declared(html, null), ...declared(body, null)].filter(
      ({ prop: k }) => !(/^(margin|padding)/.test(k) || /^(width|height|min-|max-)/.test(k) || k === 'overflow' || k.startsWith('overflow-')),
    );
    const has = (k: string) => decl.some((d) => d.prop === k);
    const side = (s: string) => parseFloat(bcs.getPropertyValue(`margin-${s}`)) + parseFloat(bcs.getPropertyValue(`padding-${s}`));
    const pad = ['top', 'right', 'bottom', 'left'].map((s) => `${Math.round(side(s) * 100) / 100}px`).join(' ');
    root.style = styleText(decl, bcs, { tag: 'div', ns: 'html' }, {
      position: 'relative',
      // its own formatting context, so a first child's top margin stays inside (as it did against the page's canvas)
      ...(bcs.display === 'block' && !has('display') ? { display: 'flow-root' } : {}),
      width: `${width}px`,
      'min-height': `${height}px`,
      'box-sizing': 'border-box',
      margin: '0',
      padding: pad,
      ...(has('background-color') || has('background') || has('background-image') ? {} : { background: htmlBackground(win) }),
    });
    root.box = { top: 0, height, marginTop: 0, marginBottom: 0, display: bcs.display, whiteSpace: bcs.whiteSpace };
  }

  for (const p of probes.values()) p.el.remove();
  report.stateRules = reaching(stateSelectors);
  report.otherMediaRules = reaching(mediaSelectors);
  return {
    title: doc.title.trim(),
    lang: html.lang || '',
    width,
    height,
    root,
    headCss: head.join('\n'),
    fontLinks: [...new Set(fontLinks)],
    urls,
    report,
  };
}

/** What paints the page behind the body: <html>'s background, else <body>'s, else white. */
function htmlBackground(win: Window): string {
  const a = win.getComputedStyle(win.document.documentElement).backgroundColor;
  if (a && a !== 'rgba(0, 0, 0, 0)' && a !== 'transparent') return a;
  return '#ffffff';
}
