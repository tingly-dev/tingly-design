/**
 * Deck slides inside the artboard runtime.
 *
 * A slide is one `<section>` on a fixed 1920×1080 canvas, written in a
 * closed subset of HTML: plain text blocks, flex/grid `<div>`s, images,
 * tables, inline SVG, and a few elements of its own — `<x-shape>`,
 * `<x-icon>`, `<x-connector>` and `<x-embed>` (a sandboxed live page). This
 * module gives those elements their look, the subset its defaults, and runs
 * the build-in animations while presenting.
 */
import React from 'react';
import {
  Activity, BadgeCheck, Book, ChartColumn, CircleCheck, Check, Clock, Cloud, Code, Database, Globe, GraduationCap,
  Hammer, House, Key, Lightbulb, Link, Lock, MessageCircle, Play, Search, Send, Settings, ShieldCheck, Star,
  ThumbsUp, TriangleAlert, Users, Wrench, Zap, type LucideIcon,
} from 'lucide-react';
import { parseBuild, SLIDE_H, SLIDE_W, type DcElement, type SlideRender } from '@dc/core';

export const SLIDE_CSS = `
html[data-slide],html[data-slide] body{margin:0;width:${SLIDE_W}px;height:${SLIDE_H}px;overflow:hidden;background:#fff}
html[data-slide] #dc-app>section{box-sizing:border-box;width:${SLIDE_W}px;height:${SLIDE_H}px;position:relative;overflow:hidden;display:flex;flex-direction:column;font-size:32px;line-height:1.4;font-family:Georgia,serif;color:#1a1a1a;background:#fff}
html[data-slide] #dc-app>section *{box-sizing:border-box;margin:0}
html[data-slide] #dc-app>section div{display:flex;flex-direction:column;min-width:0}
html[data-slide] #dc-app>section h1{font-size:96px;font-weight:600;line-height:1.1}
html[data-slide] #dc-app>section h2{font-size:64px;font-weight:600;line-height:1.15}
html[data-slide] #dc-app>section h3{font-size:44px;font-weight:600;line-height:1.2}
html[data-slide] #dc-app>section p{line-height:1.4;overflow-wrap:anywhere}
html[data-slide] #dc-app>section h1,html[data-slide] #dc-app>section h2,html[data-slide] #dc-app>section h3{overflow-wrap:anywhere}
html[data-slide] #dc-app>section ul,html[data-slide] #dc-app>section ol{padding-left:1.2em;line-height:1.4}
html[data-slide] #dc-app>section li+li{margin-top:.3em}
html[data-slide] #dc-app>section a{color:inherit}
html[data-slide] #dc-app>section img{display:block;max-width:none}
html[data-slide] #dc-app>section img:not([src]),html[data-slide] #dc-app>section img[src=""]{background:repeating-linear-gradient(45deg,rgba(127,127,127,.12) 0 12px,rgba(127,127,127,.2) 12px 24px);outline:2px dashed rgba(127,127,127,.5);outline-offset:-2px}
html[data-slide] #dc-app>section table{border-collapse:collapse;width:100%}
html[data-slide] #dc-app>section th,html[data-slide] #dc-app>section td{padding:.35em .6em;text-align:left;vertical-align:top;border-bottom:1px solid rgba(127,127,127,.35)}
html[data-slide] #dc-app>section th{font-weight:600;border-bottom-width:2px}
html[data-slide] #dc-app>section hr{border:none;border-top:2px solid currentColor;width:100%;height:0}
html[data-slide] #dc-app>section aside{display:none}
html[data-slide] #dc-app>section x-shape,html[data-slide] #dc-app>section x-icon,html[data-slide] #dc-app>section x-embed{display:block;flex:none}
html[data-slide] #dc-app>section x-connector{display:block;flex:none;pointer-events:none}
html[data-slide] #dc-app>section x-connector path{pointer-events:stroke}
html[data-slide] #dc-app>section x-embed>iframe{display:block;width:100%;height:100%;border:0;background:transparent;pointer-events:none}
html[data-slide] .dc-embed-still{width:100%;height:100%;display:flex;align-items:center;justify-content:center;border:2px dashed rgba(127,127,127,.45);border-radius:12px;font:600 28px system-ui,sans-serif;color:rgba(127,127,127,.9);background:rgba(127,127,127,.08)}
html[data-slide][data-mode=play] [data-build-in]:not(.dc-in){visibility:hidden}
.dc-in[data-build-in~=fade]{animation:dc-fade .5s ease both}
.dc-in[data-build-in~=rise]{animation:dc-rise .55s cubic-bezier(.2,.7,.2,1) both}
.dc-in[data-build-in~=drop]{animation:dc-drop .55s cubic-bezier(.2,.7,.2,1) both}
.dc-in[data-build-in~=left]{animation:dc-left .55s cubic-bezier(.2,.7,.2,1) both}
.dc-in[data-build-in~=right]{animation:dc-right .55s cubic-bezier(.2,.7,.2,1) both}
.dc-in[data-build-in~=scale]{animation:dc-scale .5s cubic-bezier(.2,.7,.2,1) both}
.dc-in[data-build-in~=pop]{animation:dc-pop .45s cubic-bezier(.3,1.6,.5,1) both}
@keyframes dc-fade{from{opacity:0}}
@keyframes dc-rise{from{opacity:0;translate:0 60px}}
@keyframes dc-drop{from{opacity:0;translate:0 -60px}}
@keyframes dc-left{from{opacity:0;translate:-80px 0}}
@keyframes dc-right{from{opacity:0;translate:80px 0}}
@keyframes dc-scale{from{opacity:0;scale:.8}}
@keyframes dc-pop{from{opacity:0;scale:.6}}
`;

let styleEl: HTMLStyleElement | null = null;
const fontLinks = new Map<string, HTMLLinkElement>();
let facesEl: HTMLStyleElement | null = null;

/** Make the document a slide page: defaults, the deck's fonts. */
export function installSlide(slide: SlideRender | null): void {
  const html = document.documentElement;
  if (!slide) {
    delete html.dataset.slide;
    return;
  }
  html.dataset.slide = '';
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.textContent = SLIDE_CSS;
    document.head.appendChild(styleEl);
  }
  for (const href of slide.fonts) {
    if (fontLinks.has(href) || !href.startsWith('https://fonts.googleapis.com/')) continue;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
    fontLinks.set(href, l);
  }
  const faces = slide.faces
    .map((f) => `@font-face{font-family:${JSON.stringify(f.family)};src:url(${JSON.stringify(resolveSrc(f.src, slide.base))});font-display:swap}`)
    .join('\n');
  if (faces && !facesEl) {
    facesEl = document.createElement('style');
    document.head.appendChild(facesEl);
  }
  if (facesEl && facesEl.textContent !== faces) facesEl.textContent = faces;
}

/** A slide's image path → a URL the frame can load. */
export function resolveSrc(src: string, base: string): string {
  const s = src.trim();
  if (!s || /^(https?:|data:|blob:)/i.test(s) || s.startsWith('//')) return s;
  // the original keeps a deck's files under project/ and uploads under /_blob/
  const rel = s.replace(/^\/+/, '').replace(/^project\//, '');
  return base + rel.split('/').map(encodeURIComponent).join('/');
}

// ------------------------------------------------------------------ shapes

function strokeOf(style: Record<string, string>): { width: number; color: string; dash?: string } | null {
  const b = style.border;
  if (!b || /\bnone\b/.test(b)) return null;
  const width = Number(/(\d+(?:\.\d+)?)px/.exec(b)?.[1] ?? 1);
  const color = b.replace(/(\d+(?:\.\d+)?)px/, '').replace(/\b(solid|dashed|dotted|double)\b/, '').trim() || '#000';
  const dash = /\bdashed\b/.test(b) ? `${width * 3} ${width * 2}` : /\bdotted\b/.test(b) ? `${width} ${width * 1.5}` : undefined;
  return { width, color, dash };
}

const POLYGONS: Record<string, string> = {
  diamond: '50,0 100,50 50,100 0,50',
  'arrow-right': '0,30 60,30 60,0 100,50 60,100 60,70 0,70',
  'arrow-left': '100,30 40,30 40,0 0,50 40,100 40,70 100,70',
  'arrow-up': '30,100 30,40 0,40 50,0 100,40 70,40 70,100',
  'arrow-down': '30,0 30,60 0,60 50,100 100,60 70,60 70,0',
};

export function renderShape(el: DcElement, props: Record<string, unknown>, key: React.Key): React.ReactNode {
  const kind = el.attrs.find((a) => a.name === 'kind')?.value ?? 'rect';
  const style = { ...((props.style as Record<string, string>) ?? {}) };
  if (kind === 'rect' || kind === 'rounded' || kind === 'ellipse') {
    if (kind === 'rounded' && !style.borderRadius) style.borderRadius = '24px';
    if (kind === 'ellipse') style.borderRadius = '50%';
    if (!style.background && !style.backgroundColor && !style.border) style.background = '#c8ccd4';
    return React.createElement('x-shape', { ...props, key, style });
  }
  const fill = style.background || style.backgroundColor || (kind === 'line' ? 'none' : '#c8ccd4');
  const stroke = strokeOf(style);
  delete style.background;
  delete style.backgroundColor;
  delete style.border;
  const common = { vectorEffect: 'non-scaling-stroke' as const, strokeDasharray: stroke?.dash };
  const shape =
    kind === 'line' ? (
      <line x1="0" y1="50" x2="100" y2="50" stroke={stroke?.color ?? (fill !== 'none' ? fill : '#1a1a1a')} strokeWidth={stroke?.width ?? 2} {...common} />
    ) : (
      <polygon
        points={POLYGONS[kind] ?? POLYGONS.diamond}
        fill={fill}
        stroke={stroke?.color ?? 'none'}
        strokeWidth={stroke?.width ?? 0}
        strokeLinejoin="round"
        {...common}
      />
    );
  return React.createElement(
    'x-shape',
    { ...props, key, style },
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" style={{ display: 'block', overflow: 'visible' }} aria-hidden="true">
      {shape}
    </svg>,
  );
}

// ------------------------------------------------------------------- icons

const ICONS: Record<string, LucideIcon> = {
  Activity, Book, Chart: ChartColumn, Chat: MessageCircle, Check, CheckCircle: CircleCheck, Clock, Cloud, Code,
  Database, Globe, GraduationCap, Home: House, Key, Lightbulb, Lightning: Zap, Link, Lock, PaperPlane: Send, Play,
  Search, Settings, Star, ThumbsUp, Tool: Hammer, Trust: ShieldCheck, Users, Verified: BadgeCheck,
  Warning: TriangleAlert, Wrench,
};

export function renderIcon(el: DcElement, props: Record<string, unknown>, key: React.Key): React.ReactNode {
  const name = el.attrs.find((a) => a.name === 'name')?.value ?? '';
  const Icon = ICONS[name];
  const style = { width: '64px', height: '64px', ...((props.style as Record<string, string>) ?? {}) };
  return React.createElement(
    'x-icon',
    { ...props, key, style, role: 'img', 'aria-label': name },
    Icon ? <Icon width="100%" height="100%" strokeWidth={1.75} absoluteStrokeWidth={false} style={{ display: 'block' }} /> : null,
  );
}

// -------------------------------------------------------------- connectors

function coord(v: string | undefined, size: number): number | null {
  if (v === undefined) return null;
  const t = v.trim();
  if (/%$/.test(t)) return (parseFloat(t) / 100) * size;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function headsOf(el: DcElement): { start: string; end: string } {
  const get = (n: string) => el.attrs.find((a) => a.name === n)?.value;
  const head = get('head') ?? 'end';
  let start = head === 'both' ? 'filled' : 'none';
  let end = head === 'none' ? 'none' : 'filled';
  start = get('head-start') ?? start;
  end = get('head-end') ?? end;
  return { start, end };
}

function routePoints(route: string, x1: number, y1: number, x2: number, y2: number): [number, number][] {
  if (route === 'hv') return [[x1, y1], [x2, y1], [x2, y2]];
  if (route === 'vh') return [[x1, y1], [x1, y2], [x2, y2]];
  if (route === 'elbow') {
    const mx = (x1 + x2) / 2;
    return [[x1, y1], [mx, y1], [mx, y2], [x2, y2]];
  }
  return [[x1, y1], [x2, y2]];
}

function headPath(tip: [number, number], from: [number, number], size: number): string {
  const a = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const l = [tip[0] - size * Math.cos(a - 0.45), tip[1] - size * Math.sin(a - 0.45)];
  const r = [tip[0] - size * Math.cos(a + 0.45), tip[1] - size * Math.sin(a + 0.45)];
  return `M${l[0]},${l[1]} L${tip[0]},${tip[1]} L${r[0]},${r[1]}`;
}

export function renderConnector(el: DcElement, props: Record<string, unknown>, key: React.Key): React.ReactNode {
  const style = { ...((props.style as Record<string, string>) ?? {}) };
  const color = style.color || '#1a1a1a';
  const width = Number(/(\d+(?:\.\d+)?)/.exec(style.borderWidth ?? '')?.[1] ?? 2);
  const dash = /dashed/.test(style.borderStyle ?? '') ? `${width * 3} ${width * 2}` : /dotted/.test(style.borderStyle ?? '') ? `${width} ${width * 1.5}` : undefined;
  delete style.borderWidth;
  delete style.borderStyle;
  const get = (n: string) => el.attrs.find((a) => a.name === n)?.value;
  const heads = headsOf(el);
  const hs = Math.max(14, width * 5);
  const draw = (pts: [number, number][]) => {
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
    const n = pts.length;
    const head = (kind: string, tip: [number, number], from: [number, number]) =>
      kind === 'none' ? null : kind === 'open' ? (
        <path d={headPath(tip, from, hs)} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d={headPath(tip, from, hs) + ' Z'} fill={color} stroke={color} strokeWidth={width} strokeLinejoin="round" />
      );
    return (
      <>
        <path d={d} fill="none" stroke={color} strokeWidth={width} strokeDasharray={dash} strokeLinejoin="round" />
        {head(heads.end, pts[n - 1], pts[n - 2])}
        {head(heads.start, pts[0], pts[1])}
      </>
    );
  };
  if (get('x1') === undefined) {
    // a flow child: corner to corner of its own box
    const from = get('from') ?? 'tl';
    const x1 = from.includes('r') ? 100 : 0;
    const y1 = from.includes('b') ? 100 : 0;
    return React.createElement(
      'x-connector',
      { ...props, key, style: { height: '48px', alignSelf: 'center', ...style } },
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" style={{ display: 'block', overflow: 'visible' }} aria-hidden="true">
        <line x1={x1} y1={y1} x2={100 - x1} y2={100 - y1} stroke={color} strokeWidth={width} vectorEffect="non-scaling-stroke" strokeDasharray={dash} />
      </svg>,
    );
  }
  // coordinates in px, or % of the slide
  const x1 = coord(get('x1'), SLIDE_W) ?? 0;
  const y1 = coord(get('y1'), SLIDE_H) ?? 0;
  const x2 = coord(get('x2'), SLIDE_W) ?? x1;
  const y2 = coord(get('y2'), SLIDE_H) ?? y1;
  const pts = routePoints(get('route') ?? 'straight', x1, y1, x2, y2);
  const pad = hs + width;
  const minX = Math.min(...pts.map((p) => p[0])) - pad;
  const minY = Math.min(...pts.map((p) => p[1])) - pad;
  const maxX = Math.max(...pts.map((p) => p[0])) + pad;
  const maxY = Math.max(...pts.map((p) => p[1])) + pad;
  const local = pts.map((p) => [p[0] - minX, p[1] - minY] as [number, number]);
  return React.createElement(
    'x-connector',
    { ...props, key, style: { ...style, position: 'absolute', left: `${minX}px`, top: `${minY}px`, width: `${maxX - minX}px`, height: `${maxY - minY}px` } },
    <svg width="100%" height="100%" style={{ display: 'block', overflow: 'visible' }} aria-hidden="true">
      {draw(local)}
    </svg>,
  );
}

// ------------------------------------------------------------------ embeds

export function renderEmbed(el: DcElement, source: string, props: Record<string, unknown>, key: React.Key, still: boolean): React.ReactNode {
  const inner = el.inner ? source.slice(el.inner.start, el.inner.end) : '';
  const child = still ? (
    <div className="dc-embed-still">Web embed</div>
  ) : (
    <iframe sandbox="allow-scripts" srcDoc={`<!doctype html>${inner}`} title="Web embed" tabIndex={-1} />
  );
  return React.createElement('x-embed', { ...props, key }, child);
}

// ------------------------------------------------------------------ builds

let builds: HTMLElement[][] = [];

/** Group the slide's build-in elements into steps; `auto` ones join the step before. */
export function collectBuilds(root: ParentNode): number {
  const els = Array.from(root.querySelectorAll<HTMLElement>('[data-build-in]'));
  const items = els
    .map((el, i) => ({ el, i, b: parseBuild(el.getAttribute('data-build-in')) }))
    .filter((x) => x.b)
    .sort((a, b) => (a.b!.order || 1000 + a.i) - (b.b!.order || 1000 + b.i));
  builds = [];
  for (const it of items) {
    if (it.b!.auto && builds.length) builds[builds.length - 1].push(it.el);
    else builds.push([it.el]);
  }
  return builds.length;
}

export function showBuilds(step: number): void {
  builds.forEach((group, i) => group.forEach((el) => el.classList.toggle('dc-in', i < step)));
}
