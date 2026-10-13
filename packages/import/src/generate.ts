import { noteBox, parseCanvas, stringifyCanvas, uniqueNoteId, type BoardEntry } from '@dc/core';
import type { ExtractReport, Extracted, XElement, XNode } from './model';

/**
 * Turns an extracted page into canvas files: `canvas.json` and one
 * `.dc.html` per artboard. Pure: no DOM, no I/O.
 *
 * Formatting matters as much as fidelity here. The editor's write-back keeps
 * every untouched character, so whatever layout this writes is the layout
 * every later diff is read in: one block per line, indented, inline runs of
 * text kept on their line.
 */

export interface GenerateOptions {
  /** the canvas's title (default: the page's <title>, else "Imported page") */
  title?: string;
  /** where the page came from, recorded in canvas.json */
  source?: string;
  /** an absolute url → its path inside the project (e.g. "assets/logo-1a2b3c4d.png"); unmapped urls stay absolute */
  mapUrl?: (url: string) => string | undefined;
  /** cut a long page into one artboard per section: 'auto' (default) splits pages taller than `splitAbove` */
  split?: boolean | 'auto';
  /** default 2400 px */
  splitAbove?: number;
  /** a section shorter than this joins the next one (default 480 px) */
  minBoard?: number;
  /** ISO time for canvas.json; tests pass a fixed one */
  now?: string;
  /** a sticky note beside the artboards saying what the import left behind (default true) */
  note?: boolean;
  /** files the page names that were not given to the import (listed in the report) */
  missing?: string[];
  /** where the caller kept the original entry file in the project (e.g. "source/index.html"), recorded in canvas.json */
  kept?: string;
}

export interface BoardOut {
  file: string;
  /** where this artboard's content starts on the original page, px */
  top: number;
  title: string;
  w: number;
  h: number;
  elements: number;
}

export interface ImportReport extends ExtractReport {
  boards: BoardOut[];
  /** absolute urls left as links (not copied into the project) */
  remoteUrls: string[];
  /** bytes of inline style written, over all artboards */
  styleBytes: number;
  /** files the page names that were not given to the import */
  missing: string[];
}

export interface Generated {
  files: Record<string, string>;
  report: ImportReport;
}

const INLINE_DISPLAY = /^(inline|inline-block|inline-flex|inline-grid|inline-table|contents|ruby)/;
const LINE_PARENT = /^(flex|grid|inline-flex|inline-grid|table|table-row-group|table-header-group|table-footer-group|table-row)$/;
const RAW_TEXT = new Set(['style', 'script', 'textarea', 'title', 'xmp']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

export function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;').replace(/\{\{/g, "{{ '{{' }}");
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/\{\{/g, "{{ '{{' }}");
}

/** Set or remove declarations in an inline style string, keeping the rest as written. */
export function patchStyle(style: string, set: Record<string, string | null>): string {
  const decls: [string, string][] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  const flush = () => {
    const i = cur.indexOf(':');
    if (i > 0) decls.push([cur.slice(0, i).trim().toLowerCase(), cur.slice(i + 1).trim()]);
    cur = '';
  };
  for (const c of style) {
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ';' && depth === 0) {
      flush();
      continue;
    }
    cur += c;
  }
  flush();
  const out = decls.filter(([k]) => !(k in set));
  for (const [k, v] of Object.entries(set)) if (v !== null) out.push([k, v]);
  return out.map(([k, v]) => `${k}: ${v};`).join(' ');
}

const hasText = (n: XElement) => n.children.some((c) => c.kind === 'text' && c.text.trim());

const isBlock = (c: XNode) => c.kind === 'el' && c.tag !== 'br' && !INLINE_DISPLAY.test(c.box.display) && (c.ns === 'html' || c.tag === 'svg');

/**
 * Lines for an element's children, or null to keep them on one line.
 *
 * A line break is only written where whitespace cannot show: between any two
 * children of a flex or grid container, and around a block-level child
 * (whitespace next to a block boundary collapses). Runs of inline content
 * and text stay together, exactly as the page had them.
 */
function runs(n: XElement): XNode[][] | null {
  if (RAW_TEXT.has(n.tag) || /^(pre|break-spaces)/.test(n.box.whiteSpace)) return null;
  const kids = n.children;
  if (n.ns === 'svg') return n.tag === 'text' || hasText(n) || !kids.some((c) => c.kind === 'el') ? null : kids.filter((c) => c.kind === 'el').map((c) => [c]);
  if (n.ns !== 'html' || !kids.some((c) => c.kind === 'el')) return null;
  if (LINE_PARENT.test(n.box.display)) return kids.filter((c) => c.kind === 'el' || c.text.trim()).map((c) => [c]);
  const out: XNode[][] = [];
  let cur: XNode[] = [];
  for (const c of kids) {
    if (isBlock(c)) {
      if (cur.length) out.push(cur);
      out.push([c]);
      cur = [];
    } else cur.push(c);
  }
  if (cur.length) out.push(cur);
  // trim the whitespace that collapses at the block boundaries we break on; drop runs left empty
  const lines = out
    .map((run) => {
      if (run.length === 1 && isBlock(run[0])) return run;
      const r = [...run];
      if (r[0]?.kind === 'text') r[0] = { kind: 'text', text: r[0].text.replace(/^\s+/, '') };
      const last = r.length - 1;
      if (r[last]?.kind === 'text') r[last] = { kind: 'text', text: (r[last] as { text: string }).text.replace(/\s+$/, '') };
      return r.filter((c) => c.kind === 'el' || c.text);
    })
    .filter((r) => r.length);
  return lines.length > 1 || (lines.length === 1 && isBlock(lines[0][0]) && lines[0].length === 1) ? lines : null;
}

interface Ctx {
  mapUrl: (url: string) => string | undefined;
  remote: Set<string>;
  styleBytes: number;
  elements: number;
}

const hex2 = (n: string) => Number(n).toString(16).padStart(2, '0');

/** `rgb(47, 111, 237)` → `#2f6fed`: what people type into the properties panel and read in a diff. */
export function hexColors(style: string): string {
  return style.replace(/rgba?\(\s*(\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})(?:,\s*(1|0?\.\d+|0))?\s*\)/g, (m, r: string, g: string, b: string, a?: string) => {
    if (a === undefined || a === '1') return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
    if (a === '0') return 'transparent';
    return m;
  });
}

function mapUrls(value: string, ctx: Ctx): string {
  return value.replace(/url\(\s*(['"]?)((?:https?|file|data):[^'")]+)\1\s*\)/g, (m, _q, u: string) => {
    const local = ctx.mapUrl(u);
    if (local) return `url("${local}")`;
    if (!u.startsWith('data:')) ctx.remote.add(u.slice(0, 200));
    return m;
  });
}

function openTag(n: XElement, ctx: Ctx): string {
  let s = `<${n.tag}`;
  for (const [k, v] of n.attrs) {
    let value = v;
    if ((k === 'src' || k === 'href' || k === 'poster') && /^(https?|file|data):/i.test(v)) {
      const local = ctx.mapUrl(v);
      if (local) value = local;
      else if ((k !== 'href' || n.ns !== 'html') && !v.startsWith('data:')) ctx.remote.add(v.slice(0, 200));
    }
    s += value === '' && (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'readonly' || k === 'open' || k === 'multiple' || k === 'reversed') ? ` ${k}` : ` ${k}="${escapeAttr(value)}"`;
  }
  if (n.style) {
    const style = mapUrls(hexColors(n.style), ctx);
    ctx.styleBytes += style.length;
    s += ` style="${escapeAttr(style)}"`;
  }
  return s + '>';
}

function inline(n: XNode, ctx: Ctx, raw = false): string {
  if (n.kind === 'text') return raw ? n.text.replace(/<\//g, '<\\/') : escapeText(n.text);
  ctx.elements++;
  const open = openTag(n, ctx);
  if (VOID.has(n.tag) && n.ns === 'html') return open;
  const isRaw = RAW_TEXT.has(n.tag) && n.tag !== 'textarea';
  return open + n.children.map((c) => inline(c, ctx, isRaw)).join('') + `</${n.tag}>`;
}

function block(n: XElement, ctx: Ctx, indent: string): string {
  const lines = runs(n);
  if (!lines) return indent + inline(n, ctx);
  ctx.elements++;
  const pad = indent + '  ';
  const inner = lines
    .map((run) => (run.length === 1 && run[0].kind === 'el' ? block(run[0], ctx, pad) : pad + run.map((c) => inline(c, ctx)).join('')))
    .join('\n');
  return `${indent}${openTag(n, ctx)}\n${inner}\n${indent}</${n.tag}>`;
}

// ------------------------------------------------------------------ split

interface Part {
  /** the wrappers from the root down to the sections' parent, root first */
  chain: XElement[];
  children: XNode[];
  top: number;
  h: number;
  title: string;
}

function firstHeading(nodes: XNode[]): string {
  for (const n of nodes) {
    if (n.kind !== 'el') continue;
    if (/^h[1-3]$/.test(n.tag)) {
      const t = textOf(n).trim();
      if (t) return t;
    }
    const deeper = firstHeading(n.children);
    if (deeper) return deeper;
  }
  return '';
}

function textOf(n: XNode): string {
  return n.kind === 'text' ? n.text : n.children.map(textOf).join('');
}

/** Cut the page at its top-level sections, when it is long and they stack vertically. */
function splitPage(root: XElement, pageH: number, opts: GenerateOptions): Part[] {
  const whole: Part = { chain: [root], children: root.children, top: 0, h: pageH, title: '' };
  const want = opts.split ?? 'auto';
  if (want === false || (want === 'auto' && pageH <= (opts.splitAbove ?? 2400))) return [whole];
  // walk down through wrappers that hold everything (#app, main, .page)
  const chain = [root];
  let at = root;
  for (;;) {
    const els = at.children.filter((c): c is XElement => c.kind === 'el');
    const texty = at.children.some((c) => c.kind === 'text' && c.text.trim());
    if (els.length === 1 && !texty && els[0].box.height >= pageH * 0.8 && els[0].ns === 'html') {
      at = els[0];
      chain.push(at);
    } else break;
  }
  const kids = at.children.filter((c): c is XElement => c.kind === 'el' && c.box.height > 0);
  if (kids.length < 2 || at.children.some((c) => c.kind === 'text' && c.text.trim())) return [whole];
  if (LINE_PARENT.test(at.box.display) && !/^(flex|inline-flex)$/.test(at.box.display)) return [whole];
  for (let i = 1; i < kids.length; i++) {
    if (kids[i].box.top < kids[i - 1].box.top + kids[i - 1].box.height - 2) return [whole];
  }
  // group sections so none is shorter than minBoard
  const min = opts.minBoard ?? 480;
  const groups: XElement[][] = [];
  let cur: XElement[] = [];
  const start = (g: XElement[]) => g[0].box.top - g[0].box.marginTop;
  for (let i = 0; i < kids.length; i++) {
    cur.push(kids[i]);
    const next = kids[i + 1];
    const end = next ? next.box.top - next.box.marginTop : pageH;
    if (end - start(cur) >= min || !next) {
      groups.push(cur);
      cur = [];
    }
  }
  if (groups.length > 1 && groups[groups.length - 1].length && pageH - start(groups[groups.length - 1]) < min) {
    const last = groups.pop()!;
    groups[groups.length - 1].push(...last);
  }
  if (groups.length < 2) return [whole];
  // everything in `at` that is not a section (absolutely placed overlays…) rides with the first part
  const inGroups = new Set(groups.flat());
  const extras = at.children.filter((c) => c.kind === 'el' && !inGroups.has(c));
  return groups.map((g, i) => {
    const top = i === 0 ? 0 : start(g);
    const end = i === groups.length - 1 ? pageH : start(groups[i + 1]);
    return { chain, children: i === 0 ? [...extras, ...g] : g, top, h: Math.max(1, Math.round(end - top)), title: firstHeading(g) };
  });
}

// ------------------------------------------------------------------ files

function boardFile(i: number, title: string, used: Set<string>): string {
  if (i === 0) return 'Main.dc.html';
  let base = slugName(title) || `Part${i + 1}`;
  if (base === 'Main') base = `Part${i + 1}`;
  let name = `${base}.dc.html`;
  for (let k = 2; used.has(name); k++) name = `${base}${k}.dc.html`;
  used.add(name);
  return name;
}

function headStyle(x: Extracted): string {
  const imports = x.fontLinks.map((h) => `@import url("${h}");`);
  return [...imports, 'body{margin:0}', ...(x.headCss ? [x.headCss] : [])].join('\n');
}

function boardSource(x: Extracted, part: Part, i: number, n: number, ctx: Ctx, title: string): string {
  // rebuild the wrapper chain around this part's sections
  const chain = part.chain;
  let body: XElement = { ...chain[chain.length - 1], children: part.children };
  for (let k = chain.length - 2; k >= 0; k--) body = { ...chain[k], children: [body] };
  if (n > 1) {
    const set: Record<string, string | null> = { 'min-height': `${part.h}px` };
    if (i > 0) set['padding-top'] = '0px';
    if (i < n - 1) set['padding-bottom'] = '0px';
    body = { ...body, style: patchStyle(body.style, set) };
  }
  const css = mapUrls(headStyle(x), ctx).replace(/<\//g, '<\\/');
  return [
    '<!doctype html>',
    `<html lang="${escapeAttr(x.lang || 'en')}">`,
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeText(part.title || title)}</title>`,
    '<script src="./support.js"></script>',
    '</head>',
    '<body>',
    '<x-dc>',
    '<helmet>',
    '<style>',
    css,
    '</style>',
    '</helmet>',
    block(body, ctx, ''),
    '</x-dc>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

export function toCanvas(x: Extracted, opts: GenerateOptions = {}): Generated {
  const ctx: Ctx = { mapUrl: opts.mapUrl ?? (() => undefined), remote: new Set(), styleBytes: 0, elements: 0 };
  // an SVG is one picture: never cut it into parts
  const parts = splitPage(x.root, Math.round(x.height), x.from === 'svg' ? { ...opts, split: false } : opts);
  const files: Record<string, string> = {};
  const boards: BoardOut[] = [];
  const used = new Set<string>(['Main.dc.html']);
  const stem = opts.source?.replace(/[?#].*$/, '').split(/[\\/]/).pop()?.replace(/\.[a-z0-9]+$/i, '');
  const title = opts.title || x.title || stem || 'Imported page';
  let y = 0;
  const index: Record<string, unknown> = {};
  // where each artboard came from travels with the artboard, so it survives being added to another canvas
  const imported = { from: x.from, ...(opts.source ? { source: opts.source } : {}), ...(opts.kept ? { original: opts.kept } : {}), at: opts.now ?? new Date().toISOString(), width: Math.round(x.width) };
  parts.forEach((part, i) => {
    const file = boardFile(i, part.title, used);
    const before = ctx.elements;
    files[file] = boardSource(x, part, i, parts.length, ctx, title);
    const w = Math.round(x.width);
    const h = parts.length > 1 ? part.h : Math.max(1, Math.round(x.height));
    const boardTitle = parts.length > 1 ? `${i + 1} · ${(part.title || (i === 0 ? title : `Part ${i + 1}`)).slice(0, 60)}` : title;
    index[file] = { x: 0, y, w, h, title: boardTitle, imported };
    boards.push({ file, top: parts.length > 1 ? part.top : 0, title: boardTitle, w, h, elements: ctx.elements - before });
    y += h + 120;
  });
  const report: ImportReport = { ...x.report, boards, remoteUrls: [...ctx.remote], styleBytes: ctx.styleBytes, missing: opts.missing ?? [] };
  const notes: Record<string, unknown> = {};
  if (opts.note !== false) {
    const lines = describeReport(report).slice(1);
    notes.imported = {
      x: Math.round(x.width) + 80,
      y: 0,
      w: 440,
      fill: 'orange',
      size: 16,
      text: [
        `从 ${x.from === 'svg' ? 'SVG' : 'HTML'} 导入${opts.source ? `：${opts.source.split(/[\\/]/).pop()}` : ''}`,
        '',
        ...(lines.length ? lines.map((l) => `· ${l}`) : [x.from === 'svg' ? '· 图形完整带过来了' : '· 页面的内容和样式都带过来了']),
        '',
        x.from === 'svg'
          ? '图形保持为 SVG：选中形状可以改颜色、描边和位置，文字（如果还是文字）可以直接改。想把它变成普通的布局元素（flex、可改的文字），选中画板让 AI 重建。'
          : '每个元素的样式都写在它自己的 style 里，可以直接选中修改。想要更干净的结构（flex 布局、少一些嵌套），选中画板让 AI 整理。',
      ].join('\n'),
    };
  }
  const canvas = {
    v: 3,
    title,
    boards: index,
    order: boards.map((b) => b.file),
    notes,
    pages: [],
    launch: { view: 'canvas' },
    designSystems: [],
  };
  files['canvas.json'] = JSON.stringify(canvas, null, 2) + '\n';
  return { files, report };
}

/** Space left between what is already on a canvas and what an import adds. */
const ADD_GAP = 240;

export interface Added {
  /** the new artboards, and canvas.json with them added */
  files: Record<string, string>;
  /** the new artboards' files, in order */
  boards: string[];
  /** the area the import now covers on the canvas, to bring into view */
  area: { x: number; y: number; w: number; h: number };
  /** add the same artboards and note to a canvas.json (a newer one, when someone changed it meanwhile) */
  merge: (canvasJson: string | undefined) => string;
}

/**
 * Put a generated import onto an existing canvas: its artboards (and its
 * sticky note) go to the right of everything already there, top-aligned with
 * it, under file names nothing in the project uses yet. Nothing already on
 * the canvas moves or changes. With `page`, only that page's items are
 * measured and the new ones go onto it.
 */
export function addToCanvas(existing: string | undefined, gen: Generated, opts: { taken?: Iterable<string>; page?: string } = {}): Added {
  const canvas = parseCanvas(existing);
  const incoming = parseCanvas(gen.files['canvas.json']);
  const used = new Set<string>([...(opts.taken ?? []), ...Object.keys(canvas.boards)]);
  // items without a page sit on the first one
  const first = canvas.pages[0]?.id ?? '';
  const here = (item: { page?: string }) => opts.page === undefined || (item.page ?? first) === (opts.page || first);
  const page = opts.page && opts.page !== first ? { page: opts.page } : {};
  const boxes = [...Object.values(canvas.boards).filter(here).map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })), ...Object.values(canvas.notes).filter(here).map(noteBox)];
  const dx = boxes.length ? Math.max(...boxes.map((b) => b.x + b.w)) + ADD_GAP : 0;
  const dy = boxes.length ? Math.min(...boxes.map((b) => b.y)) : 0;
  const files: Record<string, string> = {};
  const entries: [string, BoardEntry][] = [];
  const lead = slugName((incoming.order[0] && incoming.boards[incoming.order[0]].title) || '') || 'Imported';
  for (const file of incoming.order) {
    const b = incoming.boards[file];
    const base = file === 'Main.dc.html' ? lead : file.replace(/\.dc\.html$/, '');
    let name = `${base}.dc.html`;
    for (let k = 2; used.has(name); k++) name = `${base}${k}.dc.html`;
    used.add(name);
    files[name] = gen.files[file];
    entries.push([name, { ...b, x: b.x + dx, y: b.y + dy, ...page }]);
  }
  const notes = Object.values(incoming.notes).map((n) => ({ ...n, x: n.x + dx, y: n.y + dy, ...page }));
  const merge = (json: string | undefined): string => {
    const c = parseCanvas(json);
    for (const [name, b] of entries) {
      c.boards[name] = b;
      if (!c.order.includes(name)) c.order.push(name);
    }
    for (const n of notes) c.notes[uniqueNoteId(c, 'imported')] = n;
    return stringifyCanvas(c);
  };
  const placed = [...entries.map(([, b]) => b), ...notes.map(noteBox)];
  const x0 = Math.min(...placed.map((b) => b.x));
  const y0 = Math.min(...placed.map((b) => b.y));
  const area = { x: x0, y: y0, w: Math.max(...placed.map((b) => b.x + b.w)) - x0, h: Math.max(...placed.map((b) => b.y + b.h)) - y0 };
  files['canvas.json'] = merge(existing);
  return { files, boards: entries.map(([n]) => n), area, merge };
}

/** "Landing page — Acme" → "LandingPageAcme": an artboard file name. */
function slugName(title: string): string {
  const s = title
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
    .replace(/[^A-Za-z0-9-]/g, '');
  return /^[A-Za-z]/.test(s) ? s.slice(0, 40) : '';
}

/** The import report in the editor's language, one line per finding; empty lines left out. */
export function describeReport(r: ImportReport): string[] {
  const lines: string[] = [];
  lines.push(`${r.boards.length} 个画板，${r.elements} 个元素${r.truncated ? '（超过上限，后面的内容没有导入）' : ''}`);
  if (r.scripts) lines.push(`${r.scripts} 段脚本没有带过来：导入的是页面渲染后的静态样子，交互需要另外做`);
  if (r.stateRules) lines.push(`${r.stateRules} 条悬停、聚焦等状态样式没有带过来`);
  if (r.otherMediaRules) lines.push(`${r.otherMediaRules} 条只在其他屏幕宽度生效的样式没有带过来`);
  if (r.hidden) lines.push(`${r.hidden} 个隐藏元素（display:none）没有导入`);
  if (r.transparent) lines.push(`${r.transparent} 处内容是透明的（opacity 为 0，多半是滚动时才出现的动画），选中后把不透明度改成 100% 就能看到`);
  if (r.pseudoElements) lines.push(`${r.pseudoElements} 个 ::before / ::after 变成了真实的 <span>`);
  const dropped = Object.entries(r.dropped);
  if (dropped.length) lines.push(`画布放不了的元素已去掉：${dropped.map(([k, v]) => `${k} ×${v}`).join('、')}`);
  if (r.unreadableSheets.length) lines.push(`${r.unreadableSheets.length} 个样式表读不到（跨域），对应的样式会缺失`);
  if (r.missing.length) lines.push(`${r.missing.length} 个引用的文件不在导入的文件里：${r.missing.slice(0, 3).join('、')}${r.missing.length > 3 ? ' 等' : ''}`);
  for (const n of r.notes ?? []) lines.push(n);
  if (r.remoteUrls.length) lines.push(`${r.remoteUrls.length} 个资源仍是外链，没有复制进项目`);
  return lines;
}
