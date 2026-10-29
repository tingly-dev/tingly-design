import { marked, type Token } from 'marked';
import { tableToCsv } from './dash';

/**
 * A doc: the original Docs type keeps a doc's tabs, blocks and comments in
 * its own service, addressed by block id. Here a doc is files again, so
 * people, the editor and Claude Code all edit the same source:
 *
 *   doc.json         {title, tabs: [{id, title, parent?}], settings}
 *   tabs/<id>.md     one tab's contents, Markdown (GFM: tables, task lists)
 *   comments.json    comment threads, anchored by the words they quote
 *   assets/          uploaded images
 *
 * The editor is a rich-text editor over each tab. Its edits come back as a
 * whole tab of Markdown; `mergeBlocks` keeps every block whose meaning did
 * not change byte for byte as it was written, so a one-word edit is a
 * one-line diff whoever wrote the rest.
 */

export const DOC_INDEX = 'doc.json';
export const DOC_COMMENTS = 'comments.json';
export const TAB_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface DocTab {
  id: string;
  title: string;
  /** a subtab's parent tab */
  parent?: string;
}

export interface DocSettings {
  headingFont: 'serif' | 'sans';
  bodyFont: 'serif' | 'sans';
  width: 'default' | 'wide';
  lang: string;
}

export interface DocJson {
  title: string;
  tabs: DocTab[];
  settings: DocSettings;
  [k: string]: unknown;
}

export const DEFAULT_SETTINGS: DocSettings = { headingFont: 'sans', bodyFont: 'sans', width: 'default', lang: 'zh-CN' };

export function tabFile(id: string): string {
  return `tabs/${id}.md`;
}

export function tabIdOf(path: string): string | null {
  const m = /^tabs\/([A-Za-z0-9_-]{1,64})\.md$/.exec(path);
  return m ? m[1] : null;
}

export function isDocFile(path: string): boolean {
  return path === DOC_INDEX || path === DOC_COMMENTS || tabIdOf(path) !== null;
}

export function parseDoc(text: string | undefined): DocJson {
  let raw: Record<string, unknown> = {};
  try {
    const j = JSON.parse(text ?? '{}');
    if (j && typeof j === 'object' && !Array.isArray(j)) raw = j;
  } catch {
    // unreadable: an empty doc
  }
  const tabs: DocTab[] = [];
  if (Array.isArray(raw.tabs)) {
    for (const t of raw.tabs as Record<string, unknown>[]) {
      if (!t || typeof t.id !== 'string' || !TAB_ID_RE.test(t.id) || tabs.some((x) => x.id === t.id)) continue;
      const tab: DocTab = { id: t.id, title: typeof t.title === 'string' && t.title.trim() ? t.title : t.id };
      if (typeof t.parent === 'string') tab.parent = t.parent;
      tabs.push(tab);
    }
  }
  // a subtab of a tab that is gone, or of a subtab, becomes a tab
  for (const t of tabs) if (t.parent && !tabs.some((p) => p.id === t.parent && !p.parent)) delete t.parent;
  const s = (raw.settings ?? {}) as Partial<DocSettings>;
  const settings: DocSettings = {
    headingFont: s.headingFont === 'serif' ? 'serif' : 'sans',
    bodyFont: s.bodyFont === 'serif' ? 'serif' : 'sans',
    width: s.width === 'wide' ? 'wide' : 'default',
    lang: typeof s.lang === 'string' && s.lang ? s.lang : DEFAULT_SETTINGS.lang,
  };
  return { ...raw, title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : 'Untitled', tabs, settings };
}

export function stringifyDoc(d: DocJson): string {
  return JSON.stringify(d, null, 2) + '\n';
}

/** Tabs in reading order: each tab, then its subtabs. */
export function tabOrder(d: DocJson): DocTab[] {
  const out: DocTab[] = [];
  for (const t of d.tabs) {
    if (t.parent) continue;
    out.push(t);
    for (const c of d.tabs) if (c.parent === t.id) out.push(c);
  }
  return out;
}

export function uniqueTabId(d: DocJson, base = 'tab'): string {
  const stem = base.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'tab';
  let id = stem;
  for (let n = 2; d.tabs.some((t) => t.id === id); n++) id = `${stem}-${n}`;
  return id;
}

// ------------------------------------------------------------------ blocks

export interface Block {
  type: string;
  /** the block's own text, without the blank lines after it */
  text: string;
  start: number;
  end: number;
}

/**
 * A tab's top-level blocks as written: `source` is exactly
 * `lead + blocks[0].text + gaps[0] + blocks[1].text + … + gaps[n-1]`.
 */
export interface Blocks {
  lead: string;
  blocks: Block[];
  gaps: string[];
}

export function splitBlocks(source: string): Blocks {
  const tokens = marked.lexer(source, { gfm: true });
  const out: Blocks = { lead: '', blocks: [], gaps: [] };
  let at = 0;
  for (const t of tokens) {
    const raw = t.raw;
    if (t.type === 'space' || !raw.trim()) {
      if (out.blocks.length) out.gaps[out.gaps.length - 1] += raw;
      else out.lead += raw;
      at += raw.length;
      continue;
    }
    const text = raw.replace(/\s+$/, '');
    out.blocks.push({ type: t.type, text, start: at, end: at + text.length });
    out.gaps.push(raw.slice(text.length));
    at += raw.length;
  }
  // the lexer drops nothing, but be sure the pieces add up
  if (out.lead + out.blocks.map((b, i) => b.text + out.gaps[i]).join('') !== source) {
    return { lead: '', blocks: source.trim() ? [{ type: 'paragraph', text: source.replace(/\s+$/, ''), start: 0, end: source.replace(/\s+$/, '').length }] : [], gaps: source.trim() ? [source.slice(source.replace(/\s+$/, '').length)] : [] };
  }
  return out;
}

export function joinBlocks(b: Blocks): string {
  return b.lead + b.blocks.map((x, i) => x.text + (b.gaps[i] ?? '\n')).join('');
}

const keyCache = new Map<string, string>();
/** What a block means: its rendered HTML, whitespace folded. Two spellings of one block share it. */
export function blockKey(text: string): string {
  const hit = keyCache.get(text);
  if (hit !== undefined) return hit;
  let html: string;
  try {
    html = marked.parse(text, { gfm: true, async: false }) as string;
  } catch {
    html = text;
  }
  const key = html
    .replace(/\s+/g, ' ')
    .replace(/> </g, '><')
    .replace(/ ?(<\/?(p|li|ul|ol|h\d|blockquote|table|thead|tbody|tr|td|th|pre)\b)/g, '$1')
    .trim();
  if (keyCache.size > 5000) keyCache.clear();
  keyCache.set(text, key);
  return key;
}

/** Longest common subsequence of two key lists: index pairs, in order. */
function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  // trim the common ends first: most edits touch one block
  let s = 0;
  while (s < n && s < m && a[s] === b[s]) s++;
  let e = 0;
  while (e < n - s && e < m - s && a[n - 1 - e] === b[m - 1 - e]) e++;
  const pairs: [number, number][] = [];
  for (let i = 0; i < s; i++) pairs.push([i, i]);
  const A = a.slice(s, n - e);
  const B = b.slice(s, m - e);
  if (A.length && B.length) {
    const dp: number[][] = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
    for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < A.length && j < B.length) {
      if (A[i] === B[j]) {
        pairs.push([i + s, j + s]);
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
  }
  for (let k = 0; k < e; k++) pairs.push([n - e + k, m - e + k]);
  return pairs;
}

/**
 * The editor's Markdown for a tab, written back onto what the file says:
 * every block that means the same keeps its own text and the blank lines
 * around it; only blocks that changed take the editor's spelling.
 */
export function mergeBlocks(original: string, edited: string): string {
  const o = splitBlocks(original);
  const e = splitBlocks(edited);
  const ok = o.blocks.map((b) => blockKey(b.text));
  const ek = e.blocks.map((b) => blockKey(b.text));
  const pairs = lcs(ok, ek);
  const same = new Map<number, number>(pairs.map(([i, j]) => [j, i]));
  // a changed block's counterpart: between two kept blocks, as many blocks on each side pair up in order
  const was = new Map(same);
  let pi = -1;
  let pj = -1;
  for (const [i, j] of [...pairs, [o.blocks.length, e.blocks.length] as [number, number]]) {
    if (i - pi === j - pj) for (let k = 1; k < i - pi; k++) was.set(pj + k, pi + k);
    pi = i;
    pj = j;
  }
  const out: string[] = [];
  e.blocks.forEach((b, j) => {
    const i = was.get(j);
    if (same.has(j)) out.push(o.blocks[i!].text);
    else if (i !== undefined && o.blocks[i].type === b.type) out.push(refineBlock(o.blocks[i].text, b.text, b.type));
    else out.push(b.text);
    const next = was.get(j + 1);
    // the blank lines after a block still followed by its old neighbour stay as written
    let gap: string;
    if (i !== undefined && next !== undefined && next === i + 1) gap = o.gaps[i];
    else if (j === e.blocks.length - 1) gap = i !== undefined && i === o.blocks.length - 1 ? o.gaps[i] : '\n';
    else gap = '\n\n';
    out.push(gap);
  });
  return (e.blocks.length ? o.lead : '') + out.join('');
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());
}

const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * One block changed: keep the lines (a table's rows) that did not, as they
 * were written, so ticking one task or retyping one cell is a one-line
 * diff. The result must mean what the editor wrote, or the editor's text is used.
 */
export function refineBlock(orig: string, next: string, type: string): string {
  const ol = orig.split('\n');
  const nl = next.split('\n');
  let out: string[];
  if (type === 'table') {
    const used = new Set<number>();
    const pick = (k: number, test: (l: string) => boolean): number => {
      if (k < ol.length && !used.has(k) && test(ol[k])) return k;
      return ol.findIndex((l, m) => !used.has(m) && test(l));
    };
    out = nl.map((line, k) => {
      const rule = TABLE_RULE.test(line);
      const want = tableCells(line);
      const align = (l: string) => tableCells(l).map((c) => (c.startsWith(':') ? 'l' : '') + (c.endsWith(':') ? 'r' : '')).join(',');
      const m = pick(k, (l) => (rule ? TABLE_RULE.test(l) && align(l) === align(line) : !TABLE_RULE.test(l) && tableCells(l).join('\0') === want.join('\0')));
      if (m >= 0) {
        used.add(m);
        return ol[m];
      }
      return rule ? line : `| ${want.join(' | ')} |`;
    });
  } else if (type === 'code') {
    const pairs = lcs(ol, nl);
    const keep = new Map(pairs.map(([i, j]) => [j, i]));
    out = nl.map((l, j) => (keep.has(j) ? ol[keep.get(j)!] : l));
  } else {
    const pairs = lcs(
      ol.map((l) => blockKey(l)),
      nl.map((l) => blockKey(l)),
    );
    const keep = new Map(pairs.map(([i, j]) => [j, i]));
    // a new item takes the bullet the list was written with (another bullet would start a second list)
    const bullets = new Map<number, string>();
    for (const l of ol) {
      const m = /^(\s*)([-*+])\s/.exec(l);
      if (m && !bullets.has(m[1].length)) bullets.set(m[1].length, m[2]);
    }
    out = nl.map((l, j) => {
      if (keep.has(j)) return ol[keep.get(j)!];
      return l.replace(/^(\s*)([-*+])(\s)/, (all, sp: string, _b, ws: string) => (bullets.has(sp.length) ? sp + bullets.get(sp.length) + ws : all));
    });
  }
  const text = out.join('\n');
  return blockKey(text) === blockKey(next) ? text : next;
}

/**
 * Three-way, by block: my change (basis → mine) applied to someone else's
 * newer text (theirs). Blocks I left alone follow theirs; blocks I changed
 * replace the same blocks in theirs, found by what they meant in the basis.
 */
export function rebaseBlocks(basis: string, mine: string, theirs: string): string {
  if (basis === theirs) return mine;
  if (basis === mine) return theirs;
  const b = splitBlocks(basis);
  const m = splitBlocks(mine);
  const t = splitBlocks(theirs);
  const bk = b.blocks.map((x) => blockKey(x.text));
  const mk = m.blocks.map((x) => blockKey(x.text));
  const tk = t.blocks.map((x) => blockKey(x.text));
  const bm = lcs(bk, mk);
  const bt = new Map(lcs(bk, tk));
  // hunks of basis → mine: basis [i0, i1) became mine [j0, j1)
  const hunks: { i0: number; i1: number; j0: number; j1: number }[] = [];
  let pi = 0;
  let pj = 0;
  for (const [i, j] of [...bm, [bk.length, mk.length] as [number, number]]) {
    if (i > pi || j > pj) hunks.push({ i0: pi, i1: i, j0: pj, j1: j });
    pi = i + 1;
    pj = j + 1;
  }
  const result = t.blocks.map((x) => x.text);
  const keep = result.map(() => true);
  const inserts = new Map<number, string[]>(); // before theirs index
  for (const h of hunks) {
    const mineTexts = m.blocks.slice(h.j0, h.j1).map((x) => x.text);
    const gone = [];
    for (let i = h.i0; i < h.i1; i++) {
      const ti = bt.get(i);
      if (ti !== undefined) gone.push(ti);
    }
    gone.forEach((ti) => (keep[ti] = false));
    // where it goes: after theirs' copy of the basis block before the hunk
    let at = 0;
    for (let i = h.i0 - 1; i >= 0; i--) {
      const ti = bt.get(i);
      if (ti !== undefined) {
        at = ti + 1;
        break;
      }
    }
    if (gone.length) at = Math.min(...gone);
    inserts.set(at, [...(inserts.get(at) ?? []), ...mineTexts]);
  }
  const out: string[] = [];
  for (let k = 0; k <= result.length; k++) {
    out.push(...(inserts.get(k) ?? []));
    if (k < result.length && keep[k]) out.push(result[k]);
  }
  return mergeBlocks(theirs, out.join('\n\n') + '\n');
}

// --------------------------------------------------------------- reading

export interface Heading {
  level: number;
  text: string;
  /** the block's index among the tab's blocks */
  block: number;
}

function plain(tokens: Token[] | undefined): string {
  if (!tokens) return '';
  return tokens.map((t) => (t.type === 'html' ? '' : 'tokens' in t && t.tokens ? plain(t.tokens) : 'text' in t ? String(t.text) : '')).join('');
}

export function outlineOf(source: string): Heading[] {
  const out: Heading[] = [];
  let block = 0;
  for (const t of marked.lexer(source, { gfm: true })) {
    if (t.type === 'space') continue;
    if (t.type === 'heading') out.push({ level: t.depth, text: plain(t.tokens).trim(), block });
    block++;
  }
  return out;
}

/** Words as people count them: each CJK character is one, other runs of letters and digits are one. */
export function wordCount(source: string): number {
  const text = source.replace(/```[\s\S]*?```/g, ' ').replace(/<\/?[a-z][^>\n]*>/gi, ' ').replace(/[#>*_`~|[\]()!-]/g, ' ');
  const cjk = text.match(/[぀-ヿ㐀-鿿豈-﫿가-힯]/g)?.length ?? 0;
  const words = text.replace(/[぀-ヿ㐀-鿿豈-﫿가-힯]/g, ' ').match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  return cjk + words;
}

// --------------------------------------------------------------- comments

export interface DocComment {
  id: string;
  author: string;
  text: string;
  at: string;
  /** emoji → the authors who reacted with it, in the order they did */
  reactions?: Record<string, string[]>;
}

/** The reactions a comment offers: a fixed few, so a reaction means the same thing to every reader and to Claude. */
export const DOC_REACTIONS = ['👍', '✅', '❤️', '🎉', '😄', '👀'] as const;

/** Toggles `who`'s reaction on a comment: added when they had not reacted with it, taken back when they had. */
export function toggleReaction(c: DocComment, emoji: string, who: string): void {
  const have = c.reactions?.[emoji] ?? [];
  const next = have.includes(who) ? have.filter((x) => x !== who) : [...have, who];
  const all = { ...c.reactions };
  if (next.length) all[emoji] = next;
  else delete all[emoji];
  if (Object.keys(all).length) c.reactions = all;
  else delete c.reactions;
}

export interface DocThread {
  id: string;
  tab: string;
  /** the words the thread is pinned to, and a little text on either side to tell repeats apart */
  quote: string;
  prefix?: string;
  suffix?: string;
  resolved?: boolean;
  comments: DocComment[];
}

export interface DocComments {
  threads: DocThread[];
  [k: string]: unknown;
}

export function parseComments(text: string | undefined): DocComments {
  let raw: Record<string, unknown> = {};
  try {
    const j = JSON.parse(text ?? '{}');
    if (j && typeof j === 'object' && !Array.isArray(j)) raw = j;
  } catch {
    // none
  }
  const threads: DocThread[] = [];
  for (const t of Array.isArray(raw.threads) ? (raw.threads as Record<string, unknown>[]) : []) {
    if (!t || typeof t.id !== 'string' || typeof t.tab !== 'string' || typeof t.quote !== 'string') continue;
    const comments = (Array.isArray(t.comments) ? (t.comments as Record<string, unknown>[]) : [])
      .filter((c) => c && typeof c.text === 'string')
      .map((c, n): DocComment => {
        const reactions = parseReactions(c.reactions);
        return { id: typeof c.id === 'string' ? c.id : `${t.id}-${n}`, author: typeof c.author === 'string' ? c.author : '?', text: c.text as string, at: typeof c.at === 'string' ? c.at : '', ...(reactions ? { reactions } : {}) };
      });
    threads.push({
      id: t.id,
      tab: t.tab,
      quote: t.quote,
      ...(typeof t.prefix === 'string' ? { prefix: t.prefix } : {}),
      ...(typeof t.suffix === 'string' ? { suffix: t.suffix } : {}),
      ...(t.resolved === true ? { resolved: true } : {}),
      comments,
    });
  }
  return { ...raw, threads };
}

function parseReactions(raw: unknown): Record<string, string[]> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string[]> = {};
  for (const [emoji, who] of Object.entries(raw)) {
    const names = Array.isArray(who) ? [...new Set(who.filter((x): x is string => typeof x === 'string' && !!x))] : [];
    if (names.length) out[emoji] = names;
  }
  return Object.keys(out).length ? out : undefined;
}

export function stringifyComments(c: DocComments): string {
  return JSON.stringify(c, null, 2) + '\n';
}

/**
 * Where a thread's quote is in a text: the occurrence whose surroundings
 * best match its prefix and suffix. Null when the words are gone.
 */
export function findQuote(text: string, q: { quote: string; prefix?: string; suffix?: string }): { from: number; to: number } | null {
  if (!q.quote) return null;
  let best: { from: number; score: number } | null = null;
  for (let at = text.indexOf(q.quote); at >= 0; at = text.indexOf(q.quote, at + 1)) {
    let score = 0;
    const pre = q.prefix ?? '';
    const suf = q.suffix ?? '';
    for (let k = 1; k <= pre.length && text[at - k] === pre[pre.length - k]; k++) score++;
    for (let k = 0; k < suf.length && text[at + q.quote.length + k] === suf[k]; k++) score++;
    if (!best || score > best.score) best = { from: at, score };
  }
  return best ? { from: best.from, to: best.from + q.quote.length } : null;
}

export function quoteAt(text: string, from: number, to: number): { quote: string; prefix: string; suffix: string } {
  return { quote: text.slice(from, to), prefix: text.slice(Math.max(0, from - 24), from), suffix: text.slice(to, to + 24) };
}

export function newDocTab(title: string): string {
  return `# ${title}\n\n`;
}

/**
 * The cells of a doc table as CSV rows: a header row (when the table has one) names the columns, made
 * unique and never empty; without one the columns are `column 1`, `column 2`… and every row is data.
 */
export function gridToCsv(grid: string[][], hasHeader: boolean): string {
  const width = Math.max(0, ...grid.map((r) => r.length));
  const used = new Set<string>();
  const names = Array.from({ length: width }, (_v, n) => {
    const base = (hasHeader ? (grid[0]?.[n] ?? '').trim() : '') || `column ${n + 1}`;
    let name = base;
    for (let k = 2; used.has(name); k++) name = `${base} ${k}`;
    used.add(name);
    return name;
  });
  const rows = (hasHeader ? grid.slice(1) : grid).map((cells) => Object.fromEntries(names.map((c, n) => [c, cells[n] ?? ''])));
  return tableToCsv({ columns: names, rows });
}

/** What Claude Code is told about the doc the person is looking at, before their request. */
export function docsViewContext(v: { title?: string; file?: string; heading?: string; selection?: string; block?: string; thread?: string }): string {
  const lines: string[] = [];
  if (v.file) lines.push(`The person has the tab "${v.title || v.file}" open (${v.file}).`);
  if (v.heading) lines.push(`The cursor is in the section "${v.heading}".`);
  if (v.selection?.trim()) lines.push(`The person selected these words in the tab:\n"""\n${v.selection.slice(0, 1500)}\n"""`);
  else if (v.block?.trim()) lines.push(`The cursor is in this paragraph:\n"""\n${v.block.slice(0, 500)}\n"""`);
  if (v.thread) lines.push(`The comment thread in the right column is open, pinned to: "${v.thread}".`);
  return lines.join('\n');
}
