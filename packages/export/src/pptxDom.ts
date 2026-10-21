/** Browser-only layout snapshot. No source parsing, network or editor imports.
 * Supply connected, unscaled rendered slide roots with fonts/images already loaded.
 * Native objects are preferred: solid or translucent boxes (square or uniformly rounded),
 * rect/rounded/ellipse/line x-shape, PNG/JPEG images, list markers and horizontal text
 * measured with DOM Range (one native text object per rendered text-node line). Children
 * paint in CSS stacking order (in-flow, then positioned by z-index, ties in source order).
 * What has no native equivalent (gradients, shadows, SVG, embeds, transforms, clipping…)
 * fails unless the caller supplies `rasterizeElement`: then only that element becomes a
 * picture, either with its children (`subtree`) or just its own painting (`self`, its
 * children stay native). `rasterizeSlide` remains the coarser whole-slide alternative.
 * Browser and PowerPoint glyph metrics can differ; fonts are not embedded.
 * This produces drawing data, not validated package bytes: writePptx still validates
 * asset headers/dimensions, text controls and font/physical-unit bounds before writing.
 */
import type { PptxAsset, PptxDeck, PptxObject, PptxSlide, PptxTextStyle } from './pptx';

export interface PptxDomDiagnostic {
  code: 'invalid-input' | 'unsupported' | 'not-ready' | 'budget' | 'asset' | 'rasterized' | 'text-metrics' | 'shape-approximation' | 'approximated';
  slide: number;
  /** Stable child-index path, independent of optional source IDs. */
  path: string;
  feature?: string;
  severity: 'error' | 'warning';
}
export interface PptxDomLimits {
  maxSlides: number; maxElements: number; maxTextCharacters: number; maxObjects: number;
  maxAssetBytes: number; maxImagePixels: number; timeoutMs: number;
}
/** A caller-made picture of one element, placed at `x/y/width/height` CSS pixels relative to the slide root. */
export interface PptxRaster { asset: PptxAsset; x: number; y: number; width: number; height: number }
export interface PptxDomOptions {
  title: string;
  widthIn: number;
  /** No implicit fetch, even for data/blob URLs. Return validated local PNG/JPEG bytes. */
  resolveImage?: (image: HTMLImageElement, context: { slide: number; signal?: AbortSignal }) => Promise<PptxAsset>;
  /** A picture of `element` as painted in place. `subtree` includes its descendants; `self`
   * only its own box (background, border, shadow, pseudo-elements), with its text and child
   * elements left out because they are exported natively. Null when nothing was painted. */
  rasterizeElement?: (element: Element, context: { slide: number; mode: 'subtree' | 'self'; feature: string; signal?: AbortSignal }) => Promise<PptxRaster | null>;
  /** Real caller-owned capture; entire slide replaces native objects to preserve layering. */
  rasterizeSlide?: (root: HTMLElement, context: { slide: number; diagnostics: readonly PptxDomDiagnostic[]; signal?: AbortSignal }) => Promise<PptxAsset>;
  signal?: AbortSignal;
  /** Accepted for compatibility: stacking order is now always derived from computed z-index. */
  paintOrder?: 'tingly-slide-v1';
  /** Budgets may only tighten the defaults. Writer validation remains authoritative. */
  limits?: Partial<PptxDomLimits>;
}
export type PptxDomResult = { ok: true; deck: PptxDeck; diagnostics: PptxDomDiagnostic[] } | { ok: false; diagnostics: PptxDomDiagnostic[] };
const defaults: PptxDomLimits = { maxSlides: 200, maxElements: 10000, maxTextCharacters: 200000, maxObjects: 10000, maxAssetBytes: 100 * 1024 * 1024, maxImagePixels: 40000000, timeoutMs: 30000 };
/** Errors that say the capture itself cannot go on, never "draw this element another way". */
const FATAL = ['budget', 'asset', 'not-ready'];
/** Elements drawn by something other than CSS boxes and text. */
const REPLACED = new Set(['SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'EMBED', 'PICTURE', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'METER', 'PROGRESS', 'MATH', 'X-EMBED', 'X-ICON', 'X-CONNECTOR']);

/** Computed sRGB only. Undefined is fully transparent; partial alpha is unsupported. */
export function pptxDomColor(value: string): string | undefined {
  const paint = pptxDomPaint(value);
  if (paint && paint.opacity !== 1) throw new Error('unsupported-alpha');
  return paint?.color;
}
/** Computed sRGB with its alpha. Undefined is fully transparent. */
export function pptxDomPaint(value: string): { color: string; opacity: number } | undefined {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(value);
  if (!m || m.slice(1, 4).some(v => Number(v) > 255)) throw new Error('unsupported-color');
  const opacity = m[4] === undefined ? 1 : Number(m[4]);
  if (opacity === 0) return undefined;
  if (!(opacity > 0 && opacity <= 1)) throw new Error('unsupported-color');
  return { color: m.slice(1, 4).map(v => Number(v).toString(16).padStart(2, '0')).join('').toUpperCase(), opacity };
}

export async function slidesDomToPptx(roots: readonly HTMLElement[], options: PptxDomOptions): Promise<PptxDomResult> {
  const diagnostics: PptxDomDiagnostic[] = [];
  const limits = { ...defaults, ...options.limits };
  const issue = (slide: number, path: string, code: PptxDomDiagnostic['code'], feature?: string, severity: 'error' | 'warning' = 'error') => diagnostics.push({ slide, path, code, feature, severity });
  if (!roots.length || !Number.isFinite(options.widthIn) || options.widthIn < 1 || options.widthIn > 56 || typeof options.title !== 'string' || options.title.length > 4096 || Object.entries(limits).some(([key, n]) => !Number.isSafeInteger(n) || n <= 0 || n > defaults[key as keyof PptxDomLimits])) {
    issue(0, '', 'invalid-input'); return { ok: false, diagnostics };
  }
  if (roots.length > limits.maxSlides) { issue(0, '', 'budget', 'slides'); return { ok: false, diagnostics }; }
  const deadline = Date.now() + limits.timeoutMs;
  let elements = 0, characters = 0, objects = 0, assetBytes = 0;
  const check = () => { if (options.signal?.aborted || Date.now() > deadline) throw new Error('budget'); };
  const bounded = async <T>(promise: Promise<T>): Promise<T> => {
    check();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      return await Promise.race([promise, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('budget')), Math.max(1, deadline - Date.now()));
        abort = () => reject(new Error('budget'));
        options.signal?.addEventListener('abort', abort, { once: true });
      })]);
    } finally { clearTimeout(timer); if (abort) options.signal?.removeEventListener('abort', abort); }
  };
  const assets: Record<string, PptxAsset> = {};
  function asset(value: PptxAsset): string {
    if (!(value?.bytes instanceof Uint8Array) || !value.bytes.length || !['image/png', 'image/jpeg'].includes(value.mime) || !Number.isSafeInteger(value.widthPx) || !Number.isSafeInteger(value.heightPx) || value.widthPx <= 0 || value.heightPx <= 0 || value.widthPx * value.heightPx > limits.maxImagePixels) throw new Error('asset');
    assetBytes += value.bytes.byteLength;
    if (value.bytes.byteLength > 32 * 1024 * 1024 || Object.keys(assets).length >= 256) throw new Error('budget');
    if (assetBytes > limits.maxAssetBytes) throw new Error('budget');
    const id = `dom-${Object.keys(assets).length + 1}`;
    assets[id] = { ...value, bytes: value.bytes.slice() }; return id;
  }
  const slides: PptxSlide[] = [];
  let widthPx = 0, heightPx = 0;
  for (let slide = 0; slide < roots.length; slide++) {
    const root = roots[slide];
    const start = diagnostics.length;
    const output: PptxSlide = { objects: [] };
    let pageW = 0, pageH = 0;
    const push = (object: PptxObject) => {
      // Nothing of it on the page: leave it out. Shapes reaching far off the page are cut to it (the
      // writer keeps geometry within a page of the slide); text and pictures that far out are dropped.
      if (object.x > pageW || object.y > pageH || object.x + object.width < 0 || object.y + object.height < 0) return;
      if (object.x < -pageW || object.y < -pageH || object.x + object.width > 2 * pageW || object.y + object.height > 2 * pageH) {
        if (object.type !== 'shape') { issue(slide, '', 'approximated', 'outside-slide', 'warning'); return; }
        const x = Math.max(object.x, 0), y = Math.max(object.y, 0);
        object = { ...object, x, y, width: Math.min(object.x + object.width, pageW) - x, height: Math.min(object.y + object.height, pageH) - y };
      }
      if (++objects > limits.maxObjects) throw new Error('budget');
      output.objects.push(object);
    };
    /** Tree order of the slide's elements, for painting positioned boxes. */
    const order = new Map<Element, number>();
    try {
      check();
      const win = root?.ownerDocument?.defaultView;
      if (!win || !root.isConnected) throw new Error('not-ready');
      const nodes = root.ownerDocument.createTreeWalker(root, 1 | 4);
      for (let node: Node | null = root; node; node = nodes.nextNode()) {
        check();
        if (node.nodeType === 1 && ++elements > limits.maxElements) throw new Error('budget');
        if (node.nodeType === 1) order.set(node as Element, order.size);
        if (node.nodeType === 3) characters += node.textContent?.length ?? 0;
        if (characters > limits.maxTextCharacters) throw new Error('budget');
      }
      await bounded(root.ownerDocument.fonts.ready);
      for (let ancestor: Element | null = root; ancestor; ancestor = ancestor.parentElement) {
        const st = win.getComputedStyle(ancestor);
        if (st.transform !== 'none' || (st.getPropertyValue('zoom') && Number(st.getPropertyValue('zoom')) !== 1)) throw new Error('transformed-root');
        if (ancestor !== root && (st.opacity !== '1' || st.filter !== 'none' || st.backdropFilter !== 'none' || st.mixBlendMode !== 'normal' || st.clipPath !== 'none' || st.visibility !== 'visible' || st.display === 'none')) throw new Error('ancestor-effect');
      }
      const rb = root.getBoundingClientRect();
      const notes = Array.from(root.querySelectorAll('aside'));
      if (notes.length) output.notes = notes.map(n => n.textContent ?? '').join('\n');
      if (rb.width < 1 || rb.height < 1 || rb.width > 100000 || rb.height > 100000 || rb.height * options.widthIn / rb.width < 1 || rb.height * options.widthIn / rb.width > 56) throw new Error('page-size');
      pageW = rb.width; pageH = rb.height;
      if (slide === 0) { widthPx = rb.width; heightPx = rb.height; }
      else if (Math.abs(widthPx - rb.width) > 0.1 || Math.abs(heightPx - rb.height) > 0.1) throw new Error('page-size');
      const box = (b: DOMRect) => ({ x: b.left - rb.left, y: b.top - rb.top, width: b.width, height: b.height });
      // Painted wholly off the page: nothing to see, and the writer keeps geometry near the page.
      const offPage = (b: { x: number; y: number; width: number; height: number }) => b.x >= rb.width || b.y >= rb.height || b.x + b.width <= 0 || b.y + b.height <= 0;
      const css = (el: Element, pseudo?: string) => win!.getComputedStyle(el, pseudo);
      const raster = options.rasterizeElement;
      /** Without a rasterizer, an element with no native form is reported and left out (the slide fails); with one, the caller draws it. */
      const refuse = (path: string, feature: string) => { if (raster) throw new Error(feature); issue(slide, path, 'unsupported', feature); };
      const approximated = (path: string, feature: string) => { if (!diagnostics.slice(start).some(d => d.code === 'approximated' && d.feature === feature)) issue(slide, path, 'approximated', feature, 'warning'); };
      async function picture(el: Element, path: string, mode: 'subtree' | 'self', feature: string) {
        let drawn: PptxRaster | null;
        try { drawn = await bounded(raster!(el, { slide, mode, feature, signal: options.signal })); }
        catch (error) { throw new Error(error instanceof Error && error.message === 'budget' ? 'budget' : 'rasterization'); }
        issue(slide, path, 'rasterized', feature, 'warning');
        if (!drawn || offPage(drawn)) return;
        if (![drawn.x, drawn.y, drawn.width, drawn.height].every(Number.isFinite) || drawn.width <= 0 || drawn.height <= 0) throw new Error('rasterization');
        push({ type: 'image', x: drawn.x, y: drawn.y, width: drawn.width, height: drawn.height, asset: asset(drawn.asset), fit: 'stretch' });
      }
      function styleText(st: CSSStyleDeclaration, path: string, alpha: number, inherited: { underline: boolean; strike: boolean }): PptxTextStyle {
        if (st.direction !== 'ltr' || st.writingMode !== 'horizontal-tb' || st.getPropertyValue('-webkit-text-stroke-width') !== '0px') throw new Error('text-direction');
        if (st.getPropertyValue('-webkit-text-fill-color') && st.getPropertyValue('-webkit-text-fill-color') !== st.color) throw new Error('text-fill');
        if (st.getPropertyValue('background-clip') === 'text' || st.getPropertyValue('-webkit-background-clip') === 'text') throw new Error('text-fill');
        // Close enough to keep the text editable: positions come from the measured lines anyway.
        if (st.textShadow !== 'none') approximated(path, 'text-shadow');
        if (st.fontVariantCaps !== 'normal') approximated(path, 'small-caps');
        if (!['normal', '0px'].includes(st.wordSpacing)) approximated(path, 'word-spacing');
        if (st.textDecorationLine !== 'none' && st.textDecorationStyle !== 'solid') approximated(path, 'decoration-style');
        const paint = pptxDomPaint(st.color);
        if (!paint) throw new Error('transparent-text');
        const spacing = parseFloat(st.letterSpacing);
        const opacity = paint.opacity * alpha;
        return {
          fontFace: st.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, ''), fontSizePx: parseFloat(st.fontSize), color: paint.color,
          bold: Number(st.fontWeight) >= 600 || st.fontWeight === 'bold', italic: st.fontStyle === 'italic',
          underline: inherited.underline || st.textDecorationLine.includes('underline'), strike: inherited.strike || st.textDecorationLine.includes('line-through'),
          ...(spacing ? { charSpacingPx: spacing } : {}), ...(opacity < 1 ? { opacity } : {}),
        };
      }
      // CSS decorations propagate to descendants without appearing in their computed
      // textDecorationLine; the run carries them instead (in the run's own colour).
      // They do not reach boxes taken out of the flow or atomic inlines (inline-block…).
      function decorations(el: Element) {
        const found = { underline: false, strike: false };
        for (let x = el; x !== root && x.parentElement; x = x.parentElement) {
          const xs = css(x);
          if (['absolute', 'fixed'].includes(xs.position) || xs.float !== 'none' || /^inline-(block|flex|grid|table)$/.test(xs.display)) break;
          const line = css(x.parentElement).textDecorationLine;
          found.underline ||= line.includes('underline'); found.strike ||= line.includes('line-through');
        }
        return found;
      }
      /** The character painted just before this text node, for capitalize. */
      function before(node: Text): string {
        const walker = root.ownerDocument.createTreeWalker(root, 4);
        walker.currentNode = node;
        for (let prev = walker.previousNode(); prev; prev = walker.previousNode()) if (prev.textContent) return prev.textContent.slice(-1);
        return '';
      }
      function transformText(value: string, previous: string, mode: string): string {
        if (mode === 'uppercase') return value.toUpperCase();
        if (mode === 'lowercase') return value.toLowerCase();
        if (mode === 'capitalize' && (!previous || /\s/.test(previous))) return value.toUpperCase();
        return value;
      }
      function text(node: Text, path: string, alpha: number) {
        const parent = node.parentElement!;
        const st = css(parent);
        if (st.visibility !== 'visible') return;
        const value = node.data;
        const pre = ['pre', 'pre-wrap', 'break-spaces'].includes(st.whiteSpace);
        if (!value.trim() && !pre) return;
        const ts = styleText(st, path, alpha, decorations(parent));
        const range = root.ownerDocument.createRange();
        let chunk = '', previous: DOMRect | undefined, first: DOMRect | undefined;
        const flush = () => {
          if (!pre) chunk = chunk.trimEnd();
          if (chunk && first && previous) {
            const b = box(first);
            b.width = previous.right - first.left;
            if (b.width > 0 && !offPage(b)) push({ type: 'text', ...b, style: ts, paddingPx: 0, verticalAlign: 'top', wrap: false, paragraphs: [{ runs: [{ text: chunk }] }] });
          }
          chunk = ''; first = undefined; previous = undefined;
        };
        for (let i = 0; i < value.length;) {
          check();
          const n = value.codePointAt(i)! > 0xffff ? 2 : 1;
          range.setStart(node, i); range.setEnd(node, i + n);
          const rects = range.getClientRects();
          const b = rects[0];
          let char = transformText(value.slice(i, i + n), i ? value.slice(i - 1, i) : st.textTransform === 'capitalize' ? before(node) : '', st.textTransform); i += n;
          if (!b || b.width <= 0) continue;
          if (/^[\t\r\n ]+$/.test(char) && !pre) {
            // collapsed white space: some builds still give the collapsed characters a width
            if (!chunk || chunk.endsWith(' ')) continue;
            char = ' ';
          }
          if (previous && (Math.abs(previous.top - b.top) > 0.5 || b.left < previous.left - 0.5)) flush();
          first ??= b; previous = b; chunk += char;
        }
        flush(); range.detach();
        if (!diagnostics.slice(start).some(d => d.code === 'text-metrics')) issue(slide, path, 'text-metrics', 'font-not-embedded', 'warning');
      }
      /** The text a list item's marker shows, or undefined for a style with no native stand-in. */
      function marker(el: HTMLElement, st: CSSStyleDeclaration): string | undefined {
        const type = st.listStyleType;
        const list = el.parentElement;
        let n = Number(el.getAttribute('value')) || 0;
        if (!n) {
          n = list?.tagName === 'OL' ? Number(list.getAttribute('start')) || 1 : 1;
          for (let sibling = el.previousElementSibling; sibling; sibling = sibling.previousElementSibling) if (sibling.tagName === 'LI') n++;
        }
        const alpha = (k: number) => { let s = ''; for (; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(97 + ((k - 1) % 26)) + s; return s; };
        const roman = (k: number) => [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']].reduce((s, [v, r]) => { while (k >= (v as number)) { s += r; k -= v as number; } return s; }, '');
        if (/^["']/.test(type)) return type.slice(1, -1);
        return ({ disc: '•', circle: '◦', square: '▪', decimal: `${n}.`, 'decimal-leading-zero': `${String(n).padStart(2, '0')}.`, 'lower-alpha': `${alpha(n)}.`, 'lower-latin': `${alpha(n)}.`, 'upper-alpha': `${alpha(n).toUpperCase()}.`, 'upper-latin': `${alpha(n).toUpperCase()}.`, 'lower-roman': `${roman(n)}.`, 'upper-roman': `${roman(n).toUpperCase()}.` } as Record<string, string>)[type];
      }
      function listMarker(el: HTMLElement, st: CSSStyleDeclaration, path: string, alpha: number) {
        if (st.display !== 'list-item' || st.listStyleType === 'none') return;
        if (st.listStyleImage !== 'none') throw new Error('list-image');
        const label = marker(el, st);
        if (label === undefined) throw new Error('list-style');
        const ms = css(el, '::marker');
        const range = root.ownerDocument.createRange();
        range.selectNodeContents(el);
        const line = Array.from(range.getClientRects()).find(r => r.width > 0 && r.height > 0);
        range.detach();
        if (!line) return;
        const ctx = root.ownerDocument.createElement('canvas').getContext('2d');
        if (!ctx) throw new Error('list-style');
        ctx.font = `${ms.fontStyle} ${ms.fontWeight} ${ms.fontSize} ${ms.fontFamily}`;
        // Chrome draws the marker followed by a space, ending where the content starts.
        const width = ctx.measureText(`${label} `).width;
        const b = el.getBoundingClientRect();
        const contentLeft = b.left + parseFloat(st.borderLeftWidth) + parseFloat(st.paddingLeft);
        const left = (st.listStylePosition === 'inside' ? line.left : contentLeft) - width;
        const at = box(new DOMRect(left, line.top, width, line.height));
        if (!offPage(at)) push({ type: 'text', ...at, style: styleText(ms, path, alpha, { underline: false, strike: false }), paddingPx: 0, verticalAlign: 'top', wrap: false, paragraphs: [{ runs: [{ text: label }] }] });
      }
      /** Whether clipping at this element's padding box cuts anything it contains. */
      function clips(el: Element): boolean {
        const b = el.getBoundingClientRect();
        const inside = (r: DOMRect) => r.width <= 0 || r.height <= 0 || (r.left >= b.left - 0.5 && r.top >= b.top - 0.5 && r.right <= b.right + 0.5 && r.bottom <= b.bottom + 0.5);
        const range = root.ownerDocument.createRange();
        range.selectNodeContents(el);
        const cut = Array.from(range.getClientRects()).some(r => !inside(r)) || Array.from(el.querySelectorAll('*')).some(c => !inside(c.getBoundingClientRect()));
        range.detach();
        return cut;
      }
      /** What stops this element's subtree from being drawn natively. */
      function subtreeFeature(el: Element, st: CSSStyleDeclaration): string | undefined {
        if (st.transform !== 'none' || st.getPropertyValue('rotate') !== 'none' || st.getPropertyValue('scale') !== 'none' || st.getPropertyValue('translate') !== 'none') return 'transform';
        if (st.filter !== 'none' || st.backdropFilter !== 'none' || st.mixBlendMode !== 'normal') return 'compositing';
        if (st.clipPath !== 'none' || st.getPropertyValue('mask-image') !== 'none') return 'clipping';
        if (st.position === 'fixed' || st.position === 'sticky') return 'position';
        if (st.animationName !== 'none') return 'animation';
        if (el !== root && el.tagName !== 'IMG' && [st.overflowX, st.overflowY].some(v => v !== 'visible') && clips(el)) return 'clipping';
        return undefined;
      }
      /** What of this element's own painting has no native form (its children are unaffected). */
      function selfFeature(el: Element, st: CSSStyleDeclaration): string | undefined {
        if (st.backgroundImage !== 'none') return 'gradient';
        if (st.boxShadow !== 'none') return 'shadow';
        for (const pseudo of ['::before', '::after']) {
          const ps = css(el, pseudo);
          if (!['none', 'normal', ''].includes(ps.content) && ps.display !== 'none') return 'pseudo-content';
        }
        return undefined;
      }
      /** A positioned box waiting for its stacking context: CSS paints it after that context's in-flow
       * content, by z-index then tree order, wherever it sits in the tree below. */
      interface Layer { el: Element; path: string; alpha: number; z: number; order: number }
      const positioned = (st: CSSStyleDeclaration, parent: CSSStyleDeclaration) => st.position !== 'static' || (['flex', 'inline-flex', 'grid', 'inline-grid'].includes(parent.display) && st.zIndex !== 'auto');
      const zOf = (st: CSSStyleDeclaration) => st.zIndex === 'auto' ? 0 : Number(st.zIndex);
      async function walk(el: Element, path: string, alpha: number, layers: Layer[]): Promise<void> {
        check();
        if (el.tagName === 'ASIDE') return;
        const st = css(el);
        if (st.display === 'none') return;
        const parent = el.parentElement && el !== root ? css(el.parentElement) : st;
        const context = el === root || (positioned(st, parent) && st.zIndex !== 'auto') || Number(st.opacity) < 1;
        const own: Layer[] = context ? [] : layers;
        const mark = output.objects.length, marked = diagnostics.length, waiting = layers.length;
        const assetMark = Object.keys(assets).length, bytesMark = assetBytes;
        try {
          // Hidden: its own painting and text are not drawn; a descendant may still show itself.
          if (st.visibility !== 'visible') await children(el, st, path, alpha, own, false);
          else await element(el, st, path, alpha, own);
          if (context) await paintLayers(own);
        } catch (error) {
          const feature = error instanceof Error ? error.message : 'unknown';
          if (!raster || FATAL.includes(feature) || feature === 'rasterization') throw error;
          objects -= output.objects.length - mark;
          output.objects.length = mark; diagnostics.length = marked;
          for (const id of Object.keys(assets).slice(assetMark)) delete assets[id];
          assetBytes = bytesMark;
          // its positioned descendants are in the picture now
          for (let i = layers.length - 1; i >= waiting; i--) if (el.contains(layers[i].el)) layers.splice(i, 1);
          await picture(el, path, 'subtree', feature);
        }
      }
      async function paintLayers(layers: Layer[]) {
        while (layers.length) {
          let next = 0;
          for (let i = 1; i < layers.length; i++) {
            const a = layers[i], b = layers[next];
            if (a.z < b.z || (a.z === b.z && a.order < b.order)) next = i;
          }
          const [layer] = layers.splice(next, 1);
          await walk(layer.el, layer.path, layer.alpha, layers);
        }
      }
      /** In-flow children in order (flex `order`, then source); positioned ones go to the stacking context's layers, negative z-index first. */
      async function children(el: Element, st: CSSStyleDeclaration, path: string, alpha: number, layers: Layer[], showText = true) {
        const flow: { node: ChildNode; i: number; z: number; order: number }[] = [];
        for (const [i, node] of Array.from(el.childNodes).entries()) {
          if (node.nodeType === 3) { if (showText) flow.push({ node, i, z: 0, order: 0 }); continue; }
          if (node.nodeType !== 1) continue;
          const cs = css(node as Element);
          if (!positioned(cs, st)) flow.push({ node, i, z: 0, order: Number(cs.order) || 0 });
          else if (zOf(cs) < 0) flow.push({ node, i, z: zOf(cs), order: 0 });
          else layers.push({ el: node as Element, path: `${path}/${i}`, alpha, z: zOf(cs), order: order.get(node as Element) ?? 0 });
        }
        flow.sort((a, b) => a.z - b.z || a.order - b.order || a.i - b.i);
        for (const { node, i } of flow) {
          if (node.nodeType === 3) text(node as Text, `${path}/${i}`, alpha);
          else await walk(node as Element, `${path}/${i}`, alpha, layers);
        }
      }
      async function element(el: Element, st: CSSStyleDeclaration, path: string, inheritedAlpha: number, layers: Layer[]): Promise<void> {
        const tag = el.tagName.toUpperCase();
        if (el.namespaceURI !== 'http://www.w3.org/1999/xhtml' || REPLACED.has(tag)) { refuse(path, tag.toLowerCase()); return; }
        const feature = subtreeFeature(el, st);
        if (feature) { refuse(path, feature); return; }
        const b = box(el.getBoundingClientRect());
        const alpha = inheritedAlpha * Number(st.opacity);
        if (alpha <= 0) return;
        if (el !== root && offPage(b) && st.position !== 'static') return;
        let own = selfFeature(el, st);
        let fill: { color: string; opacity: number } | undefined;
        try { fill = pptxDomPaint(st.backgroundColor); } catch { own ??= 'background'; }
        let stroke: { color: string; widthPx: number } | undefined;
        /** Borders on some sides only (a rule under a heading, a table row): one native line per side. */
        let edges: PptxObject[] = [];
        const sides = ['Top', 'Right', 'Bottom', 'Left'] as const;
        const borders = sides.map(s => ({ width: parseFloat(st[`border${s}Width`]), style: st[`border${s}Style`], color: st[`border${s}Color`] }));
        const active = borders.filter(v => v.width > 0 && v.style !== 'none');
        const kind = el.getAttribute('kind') ?? 'rect';
        const line = tag === 'X-SHAPE' && kind === 'line';
        if (active.length) {
          const bs = active[0];
          let paint: { color: string; opacity: number } | undefined;
          try { paint = pptxDomPaint(bs.color); } catch { /* reported below */ }
          const uniformBorder = active.length === 4 && active.every(v => v.width === bs.width && v.style === bs.style && v.color === bs.color);
          if (bs.style !== 'solid' || !paint || paint.opacity * alpha < 1) own ??= 'border';
          else if (line || uniformBorder) stroke = { color: paint.color, widthPx: bs.width };
          else {
            for (const [i, side] of borders.entries()) {
              if (!(side.width > 0 && side.style !== 'none')) continue;
              let sp: { color: string; opacity: number } | undefined;
              try { sp = pptxDomPaint(side.color); } catch { /* reported below */ }
              if (side.style !== 'solid' || !sp || sp.opacity * alpha < 1) { own ??= 'border'; break; }
              const half = side.width / 2;
              const at = i === 0 ? { x: b.x, y: b.y + half, width: b.width, height: 0 } : i === 2 ? { x: b.x, y: b.y + b.height - half, width: b.width, height: 0 }
                : i === 3 ? { x: b.x + half, y: b.y, width: 0, height: b.height } : { x: b.x + b.width - half, y: b.y, width: 0, height: b.height };
              edges.push({ type: 'shape', shape: 'line', ...at, stroke: { color: sp.color, widthPx: side.width } });
            }
          }
        }
        const radii = [st.borderTopLeftRadius, st.borderTopRightRadius, st.borderBottomLeftRadius, st.borderBottomRightRadius];
        const radius = parseFloat(radii[0]) || 0;
        // One circular radius on all four corners is a native rounded rectangle; anything else is drawn.
        const uniform = radii.every(r => r === radii[0] && !/\s/.test(r.trim()) && !r.includes('%'));
        let shape: 'rect' | 'roundRect' | 'ellipse' | 'line' = 'rect';
        if (tag === 'X-SHAPE') {
          if (!['rect', 'rounded', 'ellipse', 'line'].includes(kind) || el.children.length) { refuse(path, `shape:${kind}`); return; }
          shape = kind === 'rounded' ? 'roundRect' : kind as 'rect' | 'ellipse' | 'line';
          if (shape === 'roundRect' && !radius) issue(slide, path, 'shape-approximation', 'roundRect-radius', 'warning');
          if (shape === 'rect' && radius) { if (uniform) shape = 'roundRect'; else own ??= 'border-radius'; }
        } else if (radius || radii.some(r => parseFloat(r))) {
          if (!uniform) own ??= 'border-radius';
          else shape = radius >= Math.min(b.width, b.height) / 2 - 0.5 && Math.abs(b.width - b.height) < 0.5 ? 'ellipse' : 'roundRect';
        }
        // rounded corners bend the border, which separate lines cannot follow
        if (edges.length && shape !== 'rect') own ??= 'border';
        if (own && tag === 'IMG') { refuse(path, own); return; }
        if (own && !raster) { refuse(path, own); return; }
        if (el === root) output.background = fill?.opacity === 1 ? fill.color : 'FFFFFF';
        if (own) { edges = []; await picture(el, path, 'self', own); }
        else {
          const shown = fill && !(el === root && fill.opacity === 1);
          if ((shown || stroke || tag === 'X-SHAPE') && (el !== root || shown || stroke)) {
            if (stroke && alpha < 1) { refuse(path, 'compositing'); return; }
            const opacity = (fill?.opacity ?? 1) * alpha;
            push({ type: 'shape', ...b, shape, fill: fill?.color, ...(fill && opacity < 1 ? { fillOpacity: opacity } : {}), ...(shape === 'roundRect' && radius ? { radiusPx: radius } : {}), stroke });
          }
          for (const edge of edges) push(edge);
        }
        if (tag === 'IMG') {
          const image = el as HTMLImageElement;
          if (!image.complete || !image.naturalWidth) throw new Error('not-ready');
          if (st.objectPosition !== '50% 50%' || !['fill', 'contain', 'cover'].includes(st.objectFit) || fill || stroke || edges.length || alpha < 1 || shape !== 'rect' || parseFloat(st.paddingTop) || parseFloat(st.paddingLeft) || parseFloat(st.paddingRight) || parseFloat(st.paddingBottom)) { refuse(path, 'image-style'); return; }
          if (!options.resolveImage) throw new Error('asset');
          const resolved = await bounded(options.resolveImage(image, { slide, signal: options.signal }));
          const id = asset(resolved);
          push({ type: 'image', ...b, asset: id, fit: st.objectFit === 'fill' ? 'stretch' : st.objectFit as 'contain' | 'cover' });
          return;
        }
        if (tag === 'LI') listMarker(el as HTMLElement, st, path, alpha);
        await children(el, st, path, alpha, layers);
      }
      await walk(root, 'root', 1, []);
    } catch (error) {
      const feature = error instanceof Error ? error.message : 'unknown';
      issue(slide, 'root', FATAL.includes(feature) ? feature as 'budget' | 'asset' | 'not-ready' : 'unsupported', feature);
    }
    const failures = diagnostics.slice(start).filter(d => d.severity === 'error');
    if (failures.length && options.rasterizeSlide && !failures.some(d => ['budget', 'invalid-input', 'not-ready'].includes(d.code) || ['page-size', 'transformed-root'].includes(d.feature ?? ''))) {
      try {
        const id = asset(await bounded(options.rasterizeSlide(root, { slide, diagnostics: failures, signal: options.signal })));
        output.objects = [{ type: 'image', x: 0, y: 0, width: widthPx, height: heightPx, asset: id, fit: 'stretch' }];
        for (const d of failures) d.severity = 'warning';
        issue(slide, 'root', 'rasterized', 'whole-slide', 'warning');
      } catch (error) { issue(slide, 'root', error instanceof Error && error.message === 'budget' ? 'budget' : 'asset', 'rasterization'); }
    }
    slides.push(output);
  }
  if (diagnostics.some(d => d.severity === 'error')) return { ok: false, diagnostics };
  return { ok: true, deck: { title: options.title, widthPx, heightPx, widthIn: options.widthIn, slides, assets }, diagnostics };
}
