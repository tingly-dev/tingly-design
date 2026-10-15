/**
 * Pictures of one DOM tree, many times over: the frames of a video.
 *
 * `rasterize` (html-to-image) reads every one of a node's ~400 computed style
 * properties and writes each into the copy, every frame; on a few hundred nodes
 * that is most of an export's time. A `FrameRasterizer` copies the tree the same
 * way but writes only the properties whose value differs from what that tag has
 * in a blank page (a node's style is then a few dozen properties, not four
 * hundred), builds the markup as one string and keeps what does not change from
 * frame to frame (the blank-page styles, the images as data: URLs). Starting a
 * frame returns once the tree has been copied; the browser decodes the picture
 * while the caller seeks to the next one (`begin`).
 *
 * What it leaves out on purpose: stylesheets and scripts (the copy carries
 * every style it needs, and a keyframe rule left in would run its animation again
 * inside the picture) and the properties of animation, transition and pointer.
 * Same limits as `rasterize`: a video layer, an <iframe> or a WebGL canvas comes out blank.
 */
import type { Clock } from './timing';

const XHTML = 'http://www.w3.org/1999/xhtml';
const SKIP =
  /^(animation|transition|cursor|pointer-events|user-select|-webkit-user|scroll|overscroll|touch-action|caret|resize|view-transition|will-change|container|contain|page|break-|orphans|widows|-webkit-tap|-webkit-app-region|interactivity|anchor|position-|field-sizing|speak|-webkit-locale|inline-size|block-size|min-inline-size|min-block-size|max-inline-size|max-block-size|inset-(inline|block)|margin-(inline|block)|padding-(inline|block)|border-(inline|block|start|end)|-webkit-(margin|padding|border)-(start|end|before|after))/;
/** Properties a node takes from its parent when it has none of its own, so "same as a blank page" is not enough to leave one out: it must also equal the parent's. */
const INHERITED =
  /^(color|color-interpolation(-filters)?|color-scheme|direction|dominant-baseline|empty-cells|fill(-opacity|-rule)?|clip-rule|font(-.*)?|hyphens|image-(orientation|rendering)|letter-spacing|line-break|line-height|list-style(-.*)?|marker(-.*)?|overflow-wrap|paint-order|quotes|shape-rendering|stroke(-.*)?|tab-size|text-(align|align-last|anchor|indent|orientation|rendering|shadow|transform|underline-offset|underline-position|decoration-skip-ink|wrap-mode|wrap-style|size-adjust|emphasis-.*|justify|spacing-trim|autospace)|visibility|white-space(-collapse)?|widows|orphans|word-(break|spacing)|writing-mode|border-(collapse|spacing)|caption-side|ruby-.*|math-.*|-webkit-(font-smoothing|text-fill-color|text-stroke-color|text-stroke-width|text-security|box-direction|line-break|rtl-ordering|text-orientation|locale))$/;
/** Values that come from the box a node sits in, not from its style: always written, because an equal value in a blank page says nothing. */
const FROM_LAYOUT = new Set(['width', 'height', 'transform-origin', 'perspective-origin']);
const DROP = new Set(['SCRIPT', 'STYLE', 'LINK', 'NOSCRIPT', 'TEMPLATE', 'META', 'TITLE']);
const isSafari = typeof navigator !== 'undefined' && /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

export interface FrameOptions {
  /** CSS pixels of the picture. */
  width: number;
  height: number;
  /** @font-face CSS with fonts as data: URLs (see `fontCss`). */
  fontEmbedCSS?: string;
  /** Return false to leave a node out. */
  filter?: (node: Node) => boolean;
  /** Collects the time of `frame.snapshot`, `frame.decode` and `frame.draw`. */
  clock?: Clock;
}

export interface Frame {
  /** The picture is decoded and can be drawn. */
  ready: Promise<void>;
  /** Draw it onto `canvas`, scaled to fill it. */
  draw(canvas: HTMLCanvasElement | OffscreenCanvas): void;
}

export class FrameRasterizer {
  private props: string[];
  /** Positions in `props` of the inherited ones. */
  private inherited: boolean[];
  private blank = new Map<string, string[]>();
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private urls = new Map<string, string>();
  private missing = new Set<string>();
  private rules: string[] = [];
  private classes = 0;
  /** The @font-face rules by family, and the families the tree being copied sets text in. */
  private faces = new Map<string, string[]>();
  private plainCss = '';
  private families = new Set<string>();
  private familyAt: number;

  constructor(private o: FrameOptions) {
    this.props = Array.from(getComputedStyle(document.documentElement)).filter((p) => !SKIP.test(p));
    this.inherited = this.props.map((p) => INHERITED.test(p));
    this.familyAt = this.props.indexOf('font-family');
    // a face nothing uses costs every frame its weight in base64 (the fonts are most of the markup), so only the faces in use go in
    this.plainCss = (o.fontEmbedCSS ?? '').replace(/@font-face\s*\{[^}]*\}/g, (rule) => {
      const family = /font-family:\s*["']?([^;"']+?)["']?\s*[;}]/.exec(rule)?.[1]?.trim();
      if (!family) return rule;
      this.faces.set(family, [...(this.faces.get(family) ?? []), rule]);
      return '';
    });
  }

  /** Copy `node` now, and have the browser start decoding the copy. */
  async begin(node: HTMLElement): Promise<Frame> {
    const clock = this.o.clock;
    const svg = await (clock ? clock.time('snapshot', () => this.snapshot(node)) : this.snapshot(node));
    const img = new Image();
    img.decoding = 'async';
    // a blob: URL would be faster to make, but a canvas drawn from one cannot be read back by the encoder
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const ready = img.decode().then(() => (isSafari ? new Promise<void>((ok) => requestAnimationFrame(() => ok())) : undefined));
    return {
      ready,
      draw: (canvas) => {
        const g = (canvas as HTMLCanvasElement).getContext('2d')!;
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, 0, 0, canvas.width, canvas.height);
      },
    };
  }

  dispose() {
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.blank.clear();
    this.urls.clear();
  }

  // ---------------------------------------------------------------- the copy

  private async snapshot(node: HTMLElement): Promise<string> {
    for (let pass = 0; ; pass++) {
      this.missing.clear();
      this.families.clear();
      this.rules = [];
      this.classes = 0;
      const svg = this.markup(node);
      // an image seen for the first time is fetched once, then the copy is made again with it inlined
      if (!this.missing.size || pass > 0) return svg;
      await Promise.all([...this.missing].map(async (u) => this.urls.set(u, await dataUrl(u))));
    }
  }

  private markup(node: HTMLElement): string {
    const { width, height } = this.o;
    const root = this.copy(node, this.baseline('div'), true) as HTMLElement;
    root.style.width = `${width}px`;
    root.style.height = `${height}px`;
    root.style.margin = '0';
    const fonts = [...this.families].flatMap((f) => this.faces.get(f) ?? []);
    const css = [this.plainCss, ...fonts, ...this.rules].filter(Boolean).join('\n');
    if (css) {
      const style = document.createElementNS(XHTML, 'style');
      style.textContent = css;
      root.insertBefore(style, root.firstChild);
    }
    const body = new XMLSerializer().serializeToString(root);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject x="0" y="0" width="100%" height="100%">${body}</foreignObject></svg>`;
  }

  /** `parent` is the computed style of the node's parent, as values in the order of `props`. */
  private copy(node: Node, parent: string[], isRoot = false): Node | null {
    if (node.nodeType === 3) return node.cloneNode(false);
    if (node.nodeType !== 1) return null;
    const el = node as HTMLElement;
    if (DROP.has(el.tagName.toUpperCase())) return null;
    if (!isRoot && this.o.filter && !this.o.filter(el)) return null;
    const tag = el.tagName.toLowerCase();

    let out: HTMLElement;
    if (tag === 'canvas') out = this.canvas(el as unknown as HTMLCanvasElement);
    else if (tag === 'video') out = this.video(el as unknown as HTMLVideoElement);
    else out = el.cloneNode(tag === 'svg') as HTMLElement;

    // a canvas or video is drawn as an <img> that takes the style of its box
    const mine = this.read(el);
    for (const f of mine[this.familyAt].split(',')) this.families.add(f.trim().replace(/^["']|["']$/g, ''));
    out.setAttribute('style', this.diff(mine, this.baseline(el), parent));
    this.pseudo(el, out, mine);
    if (tag === 'img') this.image(out as HTMLImageElement, el as HTMLImageElement);
    if (tag === 'svg' || tag === 'canvas' || tag === 'video' || tag === 'iframe') return out;

    const kids = (el.shadowRoot ?? el).childNodes;
    for (let i = 0; i < kids.length; i++) {
      const c = this.copy(kids[i], mine);
      if (c) out.appendChild(c);
    }
    if (tag === 'textarea') out.textContent = (el as unknown as HTMLTextAreaElement).value;
    if (tag === 'input') out.setAttribute('value', (el as unknown as HTMLInputElement).value);
    return out;
  }

  /** All the properties of `el` (or of its pseudo-element), as values in the order of `props`. */
  private read(el: Element, pseudo?: string): string[] {
    const cs = getComputedStyle(el, pseudo);
    return this.props.map((p) => cs.getPropertyValue(p));
  }

  /**
   * `name:value;` for each property that would come out differently if left out:
   * one a bare element of the tag has by default is left out when it has the same value;
   * an inherited one the tag does not set itself, when the parent has the same value.
   */
  private diff(mine: string[], blank: string[], parent: string[]): string {
    const props = this.props;
    const plain = this.baseline('div');
    let css = '';
    for (let i = 0; i < props.length; i++) {
      const v = mine[i];
      // the tag's own default rule (an <h1> is bold) beats what its parent passes down
      const expected = this.inherited[i] && blank[i] === plain[i] ? parent[i] : blank[i];
      if (v !== expected || FROM_LAYOUT.has(props[i])) css += `${props[i]}:${v.includes('url(') ? this.inline(v) : v};`;
    }
    return css;
  }

  /** The computed style of a bare element of this tag, read once, in a page of its own. */
  private baseline(el: Element | string): string[] {
    const tag = typeof el === 'string' ? el : el.tagName.toLowerCase();
    const key = typeof el === 'string' ? tag : `${el.namespaceURI}|${tag}`;
    const known = this.blank.get(key);
    if (known) return known;
    if (!this.host) {
      // a shadow tree sees none of the page's stylesheets and starts from initial values, which is what a bare tag looks like in the copy (an iframe would do too, but a sandboxed page cannot reach into one)
      const h = document.createElement('div');
      h.style.cssText = 'all:initial;display:block;position:fixed;left:-10000px;top:0;width:1000px;height:800px;visibility:hidden';
      this.shadow = h.attachShadow({ mode: 'open' });
      (document.body ?? document.documentElement).appendChild(h);
      this.host = h;
    }
    const shadow = this.shadow!;
    const bare = typeof el === 'string' || el.namespaceURI === XHTML ? document.createElement(tag) : document.createElementNS(el.namespaceURI, tag);
    shadow.appendChild(bare);
    const cs = getComputedStyle(bare);
    const values = this.props.map((p) => cs.getPropertyValue(p));
    bare.remove();
    this.blank.set(key, values);
    return values;
  }

  /** ::before and ::after that hold content become a rule on a class of the copy. */
  private pseudo(el: Element, out: Element, mine: string[]) {
    for (const p of ['::before', '::after'] as const) {
      const content = getComputedStyle(el, p).getPropertyValue('content');
      if (!content || content === 'none' || content === 'normal') continue;
      const cls = `dcp${this.classes++}`;
      out.classList.add(cls);
      const theirs = this.read(el, p);
      for (const f of theirs[this.familyAt].split(',')) this.families.add(f.trim().replace(/^["']|["']$/g, ''));
      this.rules.push(`.${cls}${p}{${this.diff(theirs, this.baseline('span'), mine)}content:${this.inline(content)};}`);
    }
  }

  private image(out: HTMLImageElement, el: HTMLImageElement) {
    const src = el.currentSrc || el.src;
    out.removeAttribute('srcset');
    out.removeAttribute('sizes');
    out.removeAttribute('loading');
    out.removeAttribute('crossorigin');
    if (src) out.setAttribute('src', this.url(src));
  }

  private canvas(c: HTMLCanvasElement): HTMLElement {
    const out = document.createElement('img');
    try {
      const data = c.toDataURL();
      if (data !== 'data:,') out.setAttribute('src', data);
    } catch {
      /* a canvas holding another origin's picture cannot be read: it is left blank */
    }
    return out;
  }

  private video(v: HTMLVideoElement): HTMLElement {
    const out = document.createElement('img');
    try {
      if (v.currentSrc && v.videoWidth) {
        const c = document.createElement('canvas');
        c.width = v.clientWidth;
        c.height = v.clientHeight;
        c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
        out.setAttribute('src', c.toDataURL());
      } else if (v.poster) out.setAttribute('src', this.url(v.poster));
    } catch {
      /* left blank */
    }
    return out;
  }

  // ---------------------------------------------------------------- pictures a style or a tag points at

  private url(u: string): string {
    if (u.startsWith('data:')) return u;
    const known = this.urls.get(u);
    if (known !== undefined) return known || u;
    this.missing.add(u);
    return u;
  }

  private inline(value: string): string {
    return value.replace(/url\(\s*(["']?)(.*?)\1\s*\)/g, (m, _q, u: string) => (u.startsWith('data:') || u.startsWith('#') ? m : `url("${this.url(u)}")`));
  }
}

async function dataUrl(url: string): Promise<string> {
  try {
    const r = await fetch(url);
    if (!r.ok) return '';
    const b = await r.blob();
    return await new Promise<string>((ok, fail) => {
      const f = new FileReader();
      f.onload = () => ok(String(f.result));
      f.onerror = () => fail(f.error);
      f.readAsDataURL(b);
    });
  } catch {
    return '';
  }
}
