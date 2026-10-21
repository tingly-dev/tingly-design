/** Browser-only, read-only layout snapshot. No source parsing, network or editor imports.
 * Supply connected, unscaled rendered slide roots with fonts/images already loaded.
 * Native support is intentionally bounded: opaque solid boxes, rect/rounded/ellipse/line
 * x-shape, PNG/JPEG images and horizontal text measured with DOM Range (one native
 * text object per rendered text-node line). Unsupported content fails atomically unless
 * the caller supplies a real full-slide rasterizer. That fallback replaces ALL objects.
 * Browser and PowerPoint glyph metrics can differ; fonts are not embedded.
 * This produces drawing data, not validated package bytes: writePptx still validates
 * asset headers/dimensions, text controls and font/physical-unit bounds before writing.
 */
import type { PptxAsset, PptxDeck, PptxObject, PptxSlide, PptxTextStyle } from './pptx';

export interface PptxDomDiagnostic {
  code: 'invalid-input' | 'unsupported' | 'not-ready' | 'budget' | 'asset' | 'rasterized' | 'text-metrics' | 'shape-approximation';
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
export interface PptxDomOptions {
  title: string;
  widthIn: number;
  /** No implicit fetch, even for data/blob URLs. Return validated local PNG/JPEG bytes. */
  resolveImage?: (image: HTMLImageElement, context: { slide: number; signal?: AbortSignal }) => Promise<PptxAsset>;
  /** Real caller-owned capture; entire slide replaces native objects to preserve layering. */
  rasterizeSlide?: (root: HTMLElement, context: { slide: number; diagnostics: readonly PptxDomDiagnostic[]; signal?: AbortSignal }) => Promise<PptxAsset>;
  signal?: AbortSignal;
  /** Opt-in to the runtime's closed paintLayer contract, never arbitrary CSS z-index.
   * Every non-auto layer must carry the matching runtime-authored positive integer.
   * Siblings paint by that layer, ties in source order; direct text cannot mix with layers. */
  paintOrder?: 'tingly-slide-v1';
  /** Budgets may only tighten the defaults. Writer validation remains authoritative. */
  limits?: Partial<PptxDomLimits>;
}
export type PptxDomResult = { ok: true; deck: PptxDeck; diagnostics: PptxDomDiagnostic[] } | { ok: false; diagnostics: PptxDomDiagnostic[] };
const defaults: PptxDomLimits = { maxSlides: 200, maxElements: 10000, maxTextCharacters: 200000, maxObjects: 10000, maxAssetBytes: 100 * 1024 * 1024, maxImagePixels: 40000000, timeoutMs: 30000 };

/** Computed sRGB only. Undefined is fully transparent; partial alpha is unsupported. */
export function pptxDomColor(value: string): string | undefined {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(value);
  if (!m || m.slice(1, 4).some(v => Number(v) > 255)) throw new Error('unsupported-color');
  const alpha = m[4] === undefined ? 1 : Number(m[4]);
  if (alpha === 0) return undefined;
  if (alpha !== 1) throw new Error('unsupported-alpha');
  return m.slice(1, 4).map(v => Number(v).toString(16).padStart(2, '0')).join('').toUpperCase();
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
    const push = (object: PptxObject) => { if (++objects > limits.maxObjects) throw new Error('budget'); output.objects.push(object); };
    try {
      check();
      const win = root?.ownerDocument?.defaultView;
      if (!win || !root.isConnected) throw new Error('not-ready');
      const nodes = root.ownerDocument.createTreeWalker(root, 1 | 4);
      for (let node: Node | null = root; node; node = nodes.nextNode()) {
        check();
        if (node.nodeType === 1 && ++elements > limits.maxElements) throw new Error('budget');
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
      if (slide === 0) { widthPx = rb.width; heightPx = rb.height; }
      else if (Math.abs(widthPx - rb.width) > 0.1 || Math.abs(heightPx - rb.height) > 0.1) throw new Error('page-size');
      const box = (b: DOMRect) => ({ x: b.left - rb.left, y: b.top - rb.top, width: b.width, height: b.height });
      const opaque = (v: string) => pptxDomColor(v);
      const color = (v: string) => { const c = opaque(v); if (!c) throw new Error('transparent-text'); return c; };
      function styleText(st: CSSStyleDeclaration): PptxTextStyle {
        if (st.direction !== 'ltr' || st.writingMode !== 'horizontal-tb' || st.textTransform !== 'none' || !['normal', '0px'].includes(st.letterSpacing) || st.textShadow !== 'none' || st.getPropertyValue('-webkit-text-stroke-width') !== '0px' || !['normal', 'none'].includes(st.fontVariantNumeric) || st.textDecorationLine.includes('line-through')) throw new Error('text-style');
        if (st.fontVariantCaps !== 'normal' || !['normal', '0px'].includes(st.wordSpacing) || st.textDecorationStyle !== 'solid' || st.hyphens === 'auto') throw new Error('text-style');
        if (st.getPropertyValue('-webkit-text-fill-color') && st.getPropertyValue('-webkit-text-fill-color') !== st.color) throw new Error('text-fill');
        return { fontFace: st.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, ''), fontSizePx: parseFloat(st.fontSize), color: color(st.color), bold: Number(st.fontWeight) >= 600 || st.fontWeight === 'bold', italic: st.fontStyle === 'italic', underline: st.textDecorationLine.includes('underline') };
      }
      function text(node: Text, path: string) {
        const parent = node.parentElement!;
        const st = win!.getComputedStyle(parent);
        const value = node.data;
        if (!value.trim() && !['pre', 'pre-wrap', 'break-spaces'].includes(st.whiteSpace)) return;
        const ts = styleText(st);
        // CSS decorations propagate through descendants without appearing in their
        // computed textDecorationLine. The DTO cannot express the ancestor's separate
        // decoration colour/metrics, so reject rather than silently removing it.
        for (let ancestor = parent.parentElement; ancestor && root.contains(ancestor); ancestor = ancestor.parentElement) {
          if (win!.getComputedStyle(ancestor).textDecorationLine !== 'none') throw new Error('propagated-text-decoration');
        }
        const range = root.ownerDocument.createRange();
        let chunk = '', previous: DOMRect | undefined, first: DOMRect | undefined;
        const flush = () => {
          if (chunk && first && previous) {
            const b = box(first);
            b.width = previous.right - first.left;
          if (b.x < -0.5 || b.y < -0.5 || b.x + b.width > rb.width + 0.5 || b.y + b.height > rb.height + 0.5) throw new Error('text-outside-slide');
            if (b.width > 0) push({ type: 'text', ...b, style: ts, paddingPx: 0, verticalAlign: 'top', paragraphs: [{ runs: [{ text: chunk }] }] });
          }
          chunk = ''; first = undefined; previous = undefined;
        };
        for (let i = 0; i < value.length;) {
          check();
          const n = value.codePointAt(i)! > 0xffff ? 2 : 1;
          range.setStart(node, i); range.setEnd(node, i + n);
          const rects = range.getClientRects();
          const b = rects[0];
          let char = value.slice(i, i + n); i += n;
          if (!b || b.width <= 0) continue;
          if (/^[\t\r\n ]+$/.test(char) && !['pre', 'pre-wrap', 'break-spaces'].includes(st.whiteSpace)) char = ' ';
          if (previous && (Math.abs(previous.top - b.top) > 0.5 || b.left < previous.left - 0.5)) flush();
          first ??= b; previous = b; chunk += char;
        }
        flush(); range.detach();
        if (!diagnostics.slice(start).some(d => d.code === 'text-metrics')) issue(slide, path, 'text-metrics', 'font-not-embedded', 'warning');
      }
      function layer(el: HTMLElement): number | undefined {
        if (options.paintOrder !== 'tingly-slide-v1') return undefined;
        const marker = el.getAttribute('data-dc-paint-layer');
        if (!marker || !/^[1-9]\d{0,4}$/.test(marker)) return undefined;
        const st = win!.getComputedStyle(el);
        if (st.zIndex !== marker) return undefined;
        const parent = el.parentElement && win!.getComputedStyle(el.parentElement);
        // z-index affects positioned boxes and flex/grid items only.
        if (st.position === 'static' && !['flex', 'inline-flex', 'grid', 'inline-grid'].includes(parent?.display ?? '')) return undefined;
        return Number(marker);
      }
      function unsupported(el: HTMLElement, st: CSSStyleDeclaration): string | undefined {
        if (st.transform !== 'none' || st.getPropertyValue('rotate') !== 'none' || st.getPropertyValue('scale') !== 'none' || st.getPropertyValue('translate') !== 'none') return 'transform';
        if (st.opacity !== '1' || st.filter !== 'none' || st.backdropFilter !== 'none' || st.mixBlendMode !== 'normal' || st.isolation === 'isolate') return 'compositing';
        if (st.backgroundImage !== 'none' || st.boxShadow !== 'none' || st.clipPath !== 'none' || st.getPropertyValue('mask-image') !== 'none') return 'paint-effect';
        if ((st.zIndex !== 'auto' && layer(el) === undefined) || st.order !== '0') return 'stacking-order';
        if (st.position === 'fixed' || st.position === 'sticky') return 'position';
        if (st.animationName !== 'none') return 'animation';
        for (const pseudo of ['::before', '::after']) {
          const ps = win!.getComputedStyle(el, pseudo);
          if (!['none', 'normal', ''].includes(ps.content) && ps.display !== 'none') return 'pseudo-content';
        }
        if (el !== root && el.tagName !== 'IMG' && [st.overflowX, st.overflowY].some(v => v !== 'visible')) return 'clipping';
        return undefined;
      }
      const supportedTags = new Set(['SECTION', 'DIV', 'P', 'H1', 'H2', 'H3', 'SPAN', 'B', 'I', 'U', 'BR', 'IMG', 'X-SHAPE']);
      async function walk(el: HTMLElement, path: string): Promise<void> {
        check();
        if (el.tagName === 'ASIDE') return;
        const st = win!.getComputedStyle(el);
        if (st.display === 'none') return;
        if (st.visibility !== 'visible') {
          if (Array.from(el.querySelectorAll('*')).some(c => win!.getComputedStyle(c).visibility === 'visible')) issue(slide, path, 'unsupported', 'visibility-override');
          return;
        }
        const feature = unsupported(el, st);
        if (feature) { issue(slide, path, 'unsupported', feature); return; }
        if (!supportedTags.has(el.tagName)) { issue(slide, path, 'unsupported', el.tagName.toLowerCase()); return; }
        const b = box(el.getBoundingClientRect());
        if (b.x < -0.5 || b.y < -0.5 || b.x + b.width > rb.width + 0.5 || b.y + b.height > rb.height + 0.5) { issue(slide, path, 'unsupported', 'outside-slide'); return; }
        let fill = opaque(st.backgroundColor);
        let stroke: { color: string; widthPx: number } | undefined;
        const sides = ['Top', 'Right', 'Bottom', 'Left'] as const;
        const borders = sides.map(s => ({ width: parseFloat(st[`border${s}Width`]), style: st[`border${s}Style`], color: st[`border${s}Color`] }));
        const active = borders.filter(v => v.width > 0 && v.style !== 'none');
        const kind = el.getAttribute('kind') ?? 'rect';
        const line = el.tagName === 'X-SHAPE' && kind === 'line';
        if (active.length) {
          const bs = active[0];
          if (bs.style !== 'solid' || (!line && (active.length !== 4 || active.some(v => v.width !== bs.width || v.style !== bs.style || v.color !== bs.color)))) throw new Error('border');
          stroke = { color: color(bs.color), widthPx: bs.width };
        }
        let shape: 'rect' | 'roundRect' | 'ellipse' | 'line' = 'rect';
        if (el.tagName === 'X-SHAPE') {
          if (!['rect', 'rounded', 'ellipse', 'line'].includes(kind) || el.children.length) throw new Error('shape');
          shape = kind === 'rounded' ? 'roundRect' : kind as 'rect' | 'ellipse' | 'line';
          if (shape === 'roundRect') issue(slide, path, 'shape-approximation', 'roundRect-radius', 'warning');
          if (shape === 'rect' && [st.borderTopLeftRadius, st.borderTopRightRadius, st.borderBottomLeftRadius, st.borderBottomRightRadius].some(v => parseFloat(v))) throw new Error('shape-radius');
        } else if (parseFloat(st.borderTopLeftRadius) || parseFloat(st.borderTopRightRadius) || parseFloat(st.borderBottomLeftRadius) || parseFloat(st.borderBottomRightRadius)) throw new Error('border-radius');
        if (el === root) output.background = fill ?? 'FFFFFF';
        if ((fill || stroke || el.tagName === 'X-SHAPE') && (el !== root || stroke)) push({ type: 'shape', ...b, shape, fill, stroke });
        if (el.tagName === 'IMG') {
          const image = el as HTMLImageElement;
          if (!image.complete || !image.naturalWidth) throw new Error('not-ready');
          if (!options.resolveImage) throw new Error('asset');
          if (st.objectPosition !== '50% 50%' || !['fill', 'contain', 'cover'].includes(st.objectFit) || fill || stroke || parseFloat(st.paddingTop) || parseFloat(st.paddingLeft) || parseFloat(st.paddingRight) || parseFloat(st.paddingBottom)) throw new Error('image-style');
          const resolved = await bounded(options.resolveImage(image, { slide, signal: options.signal }));
          const id = asset(resolved);
          push({ type: 'image', ...b, asset: id, fit: st.objectFit === 'fill' ? 'stretch' : st.objectFit as 'contain' | 'cover' });
          return;
        }
        const positioned = Array.from(el.children).filter(c => c.tagName !== 'ASIDE' && win!.getComputedStyle(c).display !== 'none').map(c => win!.getComputedStyle(c).position !== 'static');
        // Direct text also participates in the in-flow paint phase, before positioned
        // descendants, even when its source node follows them.
        const directText = Array.from(el.childNodes).some(node => {
          if (node.nodeType !== 3) return false;
          const range = root.ownerDocument.createRange();
          range.selectNodeContents(node);
          const painted = Array.from(range.getClientRects()).some(rect => rect.width > 0 && rect.height > 0);
          range.detach();
          return painted;
        });
        const children = Array.from(el.childNodes).map((node, i) => ({ node, i }));
        const visibleChildren = children.filter(({ node }) => node.nodeType === 1 && (node as Element).tagName !== 'ASIDE' && win!.getComputedStyle(node as Element).display !== 'none');
        const layered = visibleChildren.some(({ node }) => layer(node as HTMLElement) !== undefined);
        if (layered) {
          if (directText || visibleChildren.some(({ node }) => layer(node as HTMLElement) === undefined)) { issue(slide, path, 'unsupported', 'mixed-layer-paint-order'); return; }
          // The runtime groups flow siblings on the same layer. Their source order
          // is retained; pinned siblings use their own positive layer.
          children.sort((a, b) => (a.node.nodeType === 1 ? layer(a.node as HTMLElement) ?? 0 : 0) - (b.node.nodeType === 1 ? layer(b.node as HTMLElement) ?? 0 : 0) || a.i - b.i);
        } else if (positioned.some(Boolean) && (positioned.some(v => !v) || directText)) { issue(slide, path, 'unsupported', 'mixed-position-paint-order'); return; }
        for (const { node: child, i } of children) {
          const cp = `${path}/${i}`;
          if (child.nodeType === 3) text(child as Text, cp);
          else if (child.nodeType === 1) await walk(child as HTMLElement, cp);
        }
      }
      await walk(root, 'root');
    } catch (error) {
      const feature = error instanceof Error ? error.message : 'unknown';
      issue(slide, 'root', ['budget', 'asset', 'not-ready'].includes(feature) ? feature as 'budget' | 'asset' | 'not-ready' : 'unsupported', feature);
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
