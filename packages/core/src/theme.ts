/**
 * A theme for a whole canvas or deck (`.design/project-theme.md`): the colours (and, in a deck, the type
 * families) of one theme of an installed design system, written over the project's files in one go.
 * Everything here is data: what a project wears now, what switching would change, the plan, and the
 * text it comes to. No UI wording; the editor's Theme tab says it.
 *
 * Files keep ordinary colour values (a deck's subset has no `var()`), so a theme is a rewrite of the values
 * that stand for the system's roles. Which values stand for what is read from the files themselves:
 * a value that is a token of an installed system is that token; a project that never used the system
 * has its three defining colours (page, text, accent) taken as the roles, and those are remembered
 * (`ThemeRecord.base`) so the original look can come back.
 */
import type { DsColor, DsTokens } from './designSystem';
import { rootElement } from './ops';
import { attr, parseDc } from './parse';
import { getStyle } from './style';

export interface ThemeSystem {
  /** the folder under `ds/` */
  namespace: string;
  title: string;
  tokens: DsTokens;
}

/** Which theme of which installed system. */
export interface ThemeTarget {
  system: string;
  theme: string;
}

/** `theme` in canvas.json / deck.json: what the project was last switched to, and the look it came from. */
export interface ThemeRecord extends ThemeTarget {
  base?: { colors: Record<string, string>; fonts: Record<string, string> };
}

export const THEME_KEY = 'theme';

export function themeRecordOf(index: Record<string, unknown> | undefined): ThemeRecord | null {
  const r = index?.[THEME_KEY] as Partial<ThemeRecord> | undefined;
  if (!r || typeof r.system !== 'string' || typeof r.theme !== 'string') return null;
  const strings = (o: unknown): Record<string, string> =>
    o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).filter((e): e is [string, string] => typeof e[1] === 'string')) : {};
  const base = r.base && typeof r.base === 'object' ? { colors: strings(r.base.colors), fonts: strings(r.base.fonts) } : undefined;
  return { system: r.system, theme: r.theme, ...(base ? { base } : {}) };
}

// ---------------------------------------------------------------- colours

const HEX_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** A colour written one way: lower-case `#rrggbb` (`#rrggbbaa`), or a compact `rgba(0,0,0,.5)`; null for what is not a colour. */
export function normColour(v: string): string | null {
  const s = v.trim().toLowerCase();
  if (HEX_RE.test(s)) {
    let h = s.slice(1);
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    if (h.length === 8 && h.endsWith('ff')) h = h.slice(0, 6);
    return `#${h}`;
  }
  const f = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s);
  if (!f) return null;
  const parts = f[2].split(/[\s,/]+/).filter(Boolean);
  if (f[1].startsWith('rgb') && parts.length >= 3 && parts.slice(0, 3).every((p) => /^\d+(\.\d+)?$/.test(p)) && (parts[3] === undefined || Number(parts[3]) === 1)) {
    return '#' + parts.slice(0, 3).map((p) => Math.min(255, Math.round(Number(p))).toString(16).padStart(2, '0')).join('');
  }
  return `${f[1]}(${parts.join(',')})`;
}

function rgbOf(c: string): [number, number, number] | null {
  const n = normColour(c);
  if (!n || !n.startsWith('#') || n.length < 7) return null;
  return [1, 3, 5].map((i) => parseInt(n.slice(i, i + 2), 16)) as [number, number, number];
}

const saturation = (c: string): number => {
  const rgb = rgbOf(c);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
};

const luminance = (c: string): number | null => {
  const rgb = rgbOf(c);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG contrast ratio of two colours; null when either is not an opaque colour. */
export function contrastRatio(a: string, b: string): number | null {
  const [la, lb] = [luminance(a), luminance(b)];
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------- roles

/** The colours a theme is read by, the way brand books name them. A system without one of them leaves it out. */
export const COLOUR_ROLES = ['page', 'card', 'ink', 'muted', 'faint', 'line', 'accent'] as const;
export type ColourRole = (typeof COLOUR_ROLES)[number];

/** Which token plays which role (by the names systems use; the same reading as the launcher card's `dsGlance`). */
export function colourRoles(t: DsTokens): Partial<Record<ColourRole, DsColor>> {
  const find = (re: RegExp) => t.colors.find((c) => re.test(c.name));
  const namedPaper = find(/^(paper|background|bg|page|canvas|base)\b/i) ?? find(/(paper|background|^bg)/i);
  const text = /^(ink|text|foreground|fg|content)/i;
  return {
    page: namedPaper ?? find(/^surface$/i),
    card: namedPaper ? find(/^(surface|card|panel|elevated)\b/i) : find(/^(card|panel|elevated|surface-raised|raised)\b/i),
    ink: find(/^(ink|text|foreground|fg|content)(?!.*(muted|faint|soft|secondary|subtle|tertiary))/i),
    muted: find(new RegExp(text.source + '[-_.]?(muted|secondary|soft|subtle)', 'i')) ?? find(/^(muted|secondary)\b/i),
    faint: find(new RegExp(text.source + '[-_.]?(faint|tertiary|disabled)', 'i')) ?? find(/^(faint|tertiary)\b/i),
    line: find(/^(line|border|stroke|outline|divider|hairline)(?!.*strong)/i),
    accent: find(/^(brand|primary|accent)$/i),
  };
}

/** Which group a token is shown in on the Theme tab. */
export type ColourGroup = 'surfaces' | 'text' | 'lines' | 'accents' | 'status' | 'other';
export const COLOUR_GROUPS: ColourGroup[] = ['surfaces', 'text', 'lines', 'accents', 'status', 'other'];

export function colourGroup(name: string): ColourGroup {
  if (/^(ink|text|foreground|fg|content|muted|faint|on-)/i.test(name)) return 'text';
  if (/^(paper|background|bg|page|canvas|base|surface|card|panel|elevated)/i.test(name)) return 'surfaces';
  if (/^(line|border|stroke|outline|divider|hairline)/i.test(name)) return 'lines';
  if (/^(accent|brand|primary|secondary)/i.test(name)) return 'accents';
  if (/^(good|warn|warning|bad|danger|error|success|info|ok)/i.test(name)) return 'status';
  return 'other';
}

export interface ContrastCheck {
  /** the token drawn as text and the token it is drawn on */
  text: string;
  on: string;
  ratio: number;
  need: number;
  ok: boolean;
}

/** The text-on-surface pairs of one theme: does the text colour read on what it is drawn on. */
export function themeContrast(t: DsTokens, theme: string): ContrastCheck[] {
  const r = colourRoles(t);
  const value = (c?: DsColor) => (c ? c.values[theme] : undefined);
  const onAccent = t.colors.find((c) => /^on-accent/i.test(c.name));
  const pairs: [DsColor | undefined, DsColor | undefined, number][] = [
    [r.ink, r.page, 4.5],
    [r.ink, r.card, 4.5],
    [r.muted, r.page, 4.5],
    [r.muted, r.card, 4.5],
    // faint text is for captions and labels at a large size
    [r.faint, r.page, 3],
    [r.accent, r.page, 3],
    [onAccent, r.accent, 4.5],
  ];
  const out: ContrastCheck[] = [];
  for (const [text, on, need] of pairs) {
    const [a, b] = [value(text), value(on)];
    if (!text || !on || !a || !b) continue;
    const ratio = contrastRatio(a, b);
    if (ratio !== null) out.push({ text: text.name, on: on.name, ratio, need, ok: ratio >= need });
  }
  return out;
}

// ---------------------------------------------------------------- reading files

/** Declarations of the page's style: inline `style`, `<style>` blocks and the presentation attributes colours live in; scripts are left alone. */
const DECL_CONTEXT =
  /(<script\b[\s\S]*?<\/script>)|(<style\b[^>]*>)([\s\S]*?)(<\/style>)|((?<![\w-])style\s*=\s*)("[^"]*"|'[^']*')|((?<![\w-])(?:fill|stroke|stop-color|flood-color|color)\s*=\s*)("[^"]*"|'[^']*')/gi;
const DECL = /url\([^)]*\)|([\w-]+)(\s*:\s*)((?:url\([^)]*\)|[^;{}])*)/g;

type Visit = (prop: string, value: string) => string | undefined;

function declList(text: string, visit: Visit): string {
  return text.replace(DECL, (m, prop: string | undefined, colon: string, value: string) => {
    if (prop === undefined) return m;
    const out = visit(prop.toLowerCase(), value);
    return out === undefined ? m : prop + colon + out;
  });
}

/** Rewrite declaration values: `visit` gets a property and its value and returns the new value, or nothing to keep it. */
export function mapDecls(source: string, visit: Visit): string {
  return source.replace(DECL_CONTEXT, (m, script, sOpen: string, sBody: string, sClose: string, styleAttr: string, styleVal: string, presAttr: string, presVal: string) => {
    if (script) return m;
    if (sOpen) return sOpen + declList(sBody, visit) + sClose;
    if (styleAttr) return styleAttr + styleVal[0] + declList(styleVal.slice(1, -1), visit) + styleVal[0];
    if (presAttr) {
      const prop = /([\w-]+)\s*=/.exec(presAttr)![1].toLowerCase();
      return presAttr + presVal[0] + (visit(prop, presVal.slice(1, -1)) ?? presVal.slice(1, -1)) + presVal[0];
    }
    return m;
  });
}

const COLOUR_IN = /url\([^)]*\)|(?<![\w&#])(#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4}))(?![\w-])|\b((?:rgba?|hsla?)\([^)]*\))/gi;

/** Rewrite the colours in one declaration value (`url(#id)` and the like are not colours). */
export function mapColourValue(value: string, fn: (norm: string, raw: string) => string | undefined): string {
  return value.replace(COLOUR_IN, (m, hex?: string, fnc?: string) => {
    const raw = hex ?? fnc;
    const n = raw ? normColour(raw) : null;
    return raw && n ? (fn(n, raw) ?? m) : m;
  });
}

/** A font stack written one way, for comparing. */
export function normFont(v: string): string {
  return v
    .replace(/!important/i, '')
    .replace(/["']/g, '')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export interface ColourUse {
  /** as first written */
  raw: string;
  count: number;
  /** by the property it was written for */
  props: Record<string, number>;
}

export interface SourceStats {
  colours: Map<string, ColourUse>;
  fonts: Map<string, { raw: string; count: number }>;
  /** the colour each file's root element is painted with, and in how many files */
  pages: Map<string, number>;
}

function scanOne(source: string): SourceStats {
  const stats: SourceStats = { colours: new Map(), fonts: new Map(), pages: new Map() };
  mapDecls(source, (prop, value) => {
    if (prop === 'font-family') {
      const raw = value.replace(/!important/i, '').trim();
      const n = normFont(raw);
      if (n && !n.includes('{{')) {
        const f = stats.fonts.get(n) ?? { raw, count: 0 };
        f.count++;
        stats.fonts.set(n, f);
      }
      return undefined;
    }
    mapColourValue(value, (n, raw) => {
      const u = stats.colours.get(n) ?? { raw, count: 0, props: {} };
      u.count++;
      u.props[prop] = (u.props[prop] ?? 0) + 1;
      stats.colours.set(n, u);
      return undefined;
    });
    return undefined;
  });
  try {
    const root = rootElement(parseDc(source));
    const style = root ? attr(root, 'style') : undefined;
    const paint = style ? (getStyle(style, 'background') ?? getStyle(style, 'background-color')) : undefined;
    let found: string | undefined;
    if (paint) mapColourValue(paint, (n) => ((found ??= n), undefined));
    if (found) stats.pages.set(found, 1);
  } catch {
    // a file that does not parse has no page colour
  }
  return stats;
}

// the Theme tab reads every file on each change while it is open; a file that did not change is not read again
const scanCache = new Map<string, SourceStats>();
function scanCached(source: string): SourceStats {
  let s = scanCache.get(source);
  if (!s) {
    s = scanOne(source);
    if (scanCache.size >= 400) scanCache.delete(scanCache.keys().next().value!);
    scanCache.set(source, s);
  }
  return s;
}

export function scanSources(sources: string[]): SourceStats {
  if (sources.length === 1) return scanCached(sources[0]);
  const all: SourceStats = { colours: new Map(), fonts: new Map(), pages: new Map() };
  for (const src of sources) {
    const st = scanCached(src);
    for (const [k, u] of st.colours) {
      const a = all.colours.get(k) ?? { raw: u.raw, count: 0, props: {} };
      a.count += u.count;
      for (const [p, n] of Object.entries(u.props)) a.props[p] = (a.props[p] ?? 0) + n;
      all.colours.set(k, a);
    }
    for (const [k, f] of st.fonts) {
      const a = all.fonts.get(k) ?? { raw: f.raw, count: 0 };
      a.count += f.count;
      all.fonts.set(k, a);
    }
    for (const [k, n] of st.pages) all.pages.set(k, (all.pages.get(k) ?? 0) + n);
  }
  return all;
}

// ---------------------------------------------------------------- what a project wears

export interface WornTheme extends ThemeTarget {
  /** how many colour uses in the files are this theme's tokens */
  score: number;
}

/** The share of a file's colour uses that must be a theme's tokens for the file to wear it. */
const WEARS_SHARE = 0.4;

/** The (system, theme) whose token values the files use most, or null when they use none of them: the original look. */
export function detectTheme(stats: SourceStats, systems: ThemeSystem[], prefer?: ThemeTarget | null): WornTheme | null {
  let best: WornTheme | null = null;
  const total = [...stats.colours.values()].reduce((n, u) => n + u.count, 0);
  for (const s of systems) {
    for (const th of s.tokens.themes) {
      const values = new Set(s.tokens.colors.map((c) => normColour(c.values[th.id] ?? '')).filter((v): v is string => !!v));
      let score = 0;
      let distinct = 0;
      for (const v of values) {
        const n = stats.colours.get(v)?.count ?? 0;
        score += n;
        if (n) distinct++;
      }
      const better = !best || score > best.score || (score === best.score && prefer?.system === s.namespace && prefer.theme === th.id);
      // a few white buttons in an otherwise unthemed page are not the system's surface: several of its colours, and most of the uses, have to be its own
      if (score > 0 && score >= total * WEARS_SHARE && distinct >= Math.min(2, stats.colours.size) && better) best = { system: s.namespace, theme: th.id, score };
    }
  }
  return best;
}

// ---------------------------------------------------------------- plans

export interface PlannedColour {
  /** the role it plays (or the token's name when it is paired by name) */
  role: string;
  /** the token it becomes */
  token: string;
  from: string;
  to: string;
  count: number;
  /** only where the colour is written for one of these properties (a page colour is a background, not the text on a button) */
  props?: RegExp;
}

export interface PlannedFont {
  key: string;
  from: string;
  to: string;
  count: number;
}

/** What one file gets: the colours and families to rewrite in it. */
export interface FilePlan {
  colours: PlannedColour[];
  fonts: PlannedFont[];
}

export interface ThemePlan {
  /** what the files wear (most of them), null for the original look */
  from: WornTheme | null;
  to: ThemeTarget | 'original';
  /** one per source, in the order given: a deck can be half light and half dark, so each file is read on its own */
  files: FilePlan[];
  /** distinct colours in the files that the plan leaves as they are */
  stay: number;
  /** uses of colours and fonts the plan rewrites */
  changes: number;
  /** the record to keep after it is applied (null: none, the original look is back) */
  record: ThemeRecord | null;
}

export interface PlanOptions {
  /** also switch the type families (a deck loads them as its faces; a canvas does not) */
  fonts?: boolean;
}

const MONO = /mono|code|courier|consolas|menlo/i;

/** Where a role's colour is rewritten when the work never wore a system: its page colour as a background, its text colour as text, stroke or border. */
const ROLE_PROPS: Partial<Record<ColourRole, RegExp>> = {
  page: /^(background(-color)?|fill|stop-color)$/,
  ink: /^(color|fill|stroke|caret-color|text-decoration-color|(border|outline)(-[a-z]+)*)$/,
};

const usesOf = (u: ColourUse | undefined, props?: RegExp): number =>
  !u ? 0 : props ? Object.entries(u.props).reduce((n, [p, c]) => n + (props.test(p) ? c : 0), 0) : u.count;

/** Every colour any installed system's themes hold, written one way. */
function tokenColours(systems: ThemeSystem[]): Set<string> {
  const out = new Set<string>();
  for (const s of systems) for (const c of s.tokens.colors) for (const v of Object.values(c.values)) { const n = normColour(v); if (n) out.add(n); }
  return out;
}

/** The distinct colours in the files that belong to no installed design system. */
export function strayColours(stats: SourceStats, systems: ThemeSystem[]): string[] {
  const known = tokenColours(systems);
  return [...stats.colours.keys()].filter((k) => !known.has(k));
}

function finish(files: FilePlan[], plan: Omit<ThemePlan, 'files' | 'stay' | 'changes'>, all: SourceStats, systems: ThemeSystem[]): ThemePlan {
  const touched = new Set(files.flatMap((f) => f.colours.map((c) => c.from)));
  return {
    ...plan,
    files,
    // what no system owns and the switch did not take: those colours are still the old ones
    stay: strayColours(all, systems).filter((k) => !touched.has(k)).length,
    changes: files.reduce((n, f) => n + f.colours.reduce((m, c) => m + c.count, 0) + f.fonts.reduce((m, x) => m + x.count, 0), 0),
  };
}

/** Pair the tokens of the theme a file wears with the tokens of the one it is going to: by role, then by name. */
function pairTokens(cur: ThemeSystem, curTheme: string, tgt: ThemeSystem, tgtTheme: string, stats: SourceStats): PlannedColour[] {
  const out: PlannedColour[] = [];
  const seen = new Set<string>();
  const add = (role: string, a: DsColor, b: DsColor) => {
    const from = normColour(a.values[curTheme] ?? '');
    const to = b.values[tgtTheme];
    if (!from || !to || seen.has(from) || from === normColour(to)) return;
    const count = stats.colours.get(from)?.count ?? 0;
    if (!count) return;
    seen.add(from);
    out.push({ role, token: b.name, from, to, count });
  };
  const rc = colourRoles(cur.tokens);
  const rt = colourRoles(tgt.tokens);
  const paired = new Set<string>();
  for (const role of COLOUR_ROLES) {
    const a = rc[role];
    const b = rt[role];
    if (!a || !b) continue;
    paired.add(a.name);
    add(role, a, b);
  }
  for (const a of cur.tokens.colors) {
    if (paired.has(a.name)) continue;
    const b = tgt.tokens.colors.find((x) => x.name === a.name);
    if (b) add(a.name, a, b);
  }
  return out;
}

function pairFonts(cur: ThemeSystem, tgt: ThemeSystem, stats: SourceStats): PlannedFont[] {
  const out: PlannedFont[] = [];
  for (const [key, stack] of Object.entries(cur.tokens.families)) {
    const to = tgt.tokens.families[key];
    const from = normFont(stack);
    const count = stats.fonts.get(from)?.count ?? 0;
    if (to && count && normFont(to) !== from && !out.some((f) => f.from === from)) out.push({ key, from, to, count });
  }
  return out;
}

/** The colours that define a work that never wore a system: its page, its text and its accent. */
function definingColours(stats: SourceStats): Partial<Record<'page' | 'ink' | 'accent', string>> {
  const top = (entries: Iterable<[string, number]>, not: (string | undefined)[]) =>
    [...entries].filter(([k]) => !not.includes(k)).sort((a, b) => b[1] - a[1])[0]?.[0];
  const byProp = (re: RegExp) => [...stats.colours].map(([k, u]) => [k, Object.entries(u.props).reduce((n, [p, c]) => n + (re.test(p) ? c : 0), 0)] as [string, number]).filter(([, n]) => n > 0);
  const page = top(stats.pages, []) ?? top(byProp(/^background(-color)?$/), []);
  const ink = top(byProp(/^color$/), [page]);
  const accent = top(
    [...stats.colours].filter(([k]) => saturation(k) >= 0.3).map(([k, u]) => [k, u.count] as [string, number]),
    [page, ink],
  );
  return { page, ink, accent };
}

/** What switching to `to` would do to these sources, each read on its own: one the target's tokens already hold is left alone. */
export function planTheme(sources: string[], systems: ThemeSystem[], to: ThemeTarget, record: ThemeRecord | null, opts: PlanOptions = {}): ThemePlan | null {
  const tgt = systems.find((s) => s.namespace === to.system);
  if (!tgt?.tokens.themes.some((t) => t.id === to.theme)) return null;
  const each = sources.map((src) => scanSources([src]));
  const all = scanSources(sources);
  const wornBy = each.map((st) => detectTheme(st, systems, record));
  const files: FilePlan[] = wornBy.map((cur, i) => {
    const curSys = cur ? systems.find((s) => s.namespace === cur.system) : undefined;
    if (!cur || !curSys) return { colours: [], fonts: [] };
    return { colours: pairTokens(curSys, cur.theme, tgt, to.theme, each[i]), fonts: opts.fonts ? pairFonts(curSys, tgt, each[i]) : [] };
  });
  let base = record?.base;
  // the files that wear no system yet: their defining colours become the roles, and what they were is kept
  const bare = wornBy.flatMap((cur, i) => (cur ? [] : [i]));
  if (bare.length) {
    const st = scanSources(bare.map((i) => sources[i]));
    const rt = colourRoles(tgt.tokens);
    const def = definingColours(st);
    const baseColours: Record<string, string> = {};
    const colours: PlannedColour[] = [];
    for (const role of ['page', 'ink', 'accent'] as const) {
      const from = def[role];
      const tok = rt[role];
      const toValue = tok?.values[to.theme];
      if (!from || !tok || !toValue || from === normColour(toValue)) continue;
      colours.push({ role, token: tok.name, from, to: toValue, count: 0, props: ROLE_PROPS[role] });
      baseColours[role] = st.colours.get(from)?.raw ?? from;
    }
    const baseFonts: Record<string, string> = {};
    const fonts: PlannedFont[] = [];
    if (opts.fonts) {
      const stacks = [...st.fonts].sort((a, b) => b[1].count - a[1].count);
      const body = stacks.find(([, f]) => !MONO.test(f.raw));
      const heading = stacks.find(([n, f]) => n !== body?.[0] && !MONO.test(f.raw));
      for (const [key, found] of [['sans', body], ['display', heading]] as const) {
        const target = tgt.tokens.families[key];
        if (found && target && normFont(target) !== found[0]) {
          fonts.push({ key, from: found[0], to: target, count: 0 });
          baseFonts[key] = found[1].raw;
        }
      }
    }
    for (const i of bare) {
      files[i] = {
        colours: colours.map((c) => ({ ...c, count: usesOf(each[i].colours.get(c.from), c.props) })).filter((c) => c.count),
        fonts: fonts.map((f) => ({ ...f, count: each[i].fonts.get(f.from)?.count ?? 0 })).filter((f) => f.count),
      };
    }
    // what the work was before it first wore a system stays: files added later and themed in a second pass do not replace it
    if (colours.length || fonts.length) base = { colors: { ...baseColours, ...record?.base?.colors }, fonts: { ...baseFonts, ...record?.base?.fonts } };
  }
  const from = detectTheme(all, systems, record);
  return finish(files, { from, to, record: { ...to, ...(base ? { base } : {}) } }, all, systems);
}

/** What putting the original look back would do; null when the work has none to go back to. */
export function planOriginal(sources: string[], systems: ThemeSystem[], record: ThemeRecord | null, opts: PlanOptions = {}): ThemePlan | null {
  if (!record?.base) return null;
  const base = record.base;
  const all = scanSources(sources);
  const from = detectTheme(all, systems, record);
  if (!from) return null;
  const files: FilePlan[] = sources.map((src) => {
    const st = scanSources([src]);
    const cur = detectTheme(st, systems, record);
    const sys = cur ? systems.find((s) => s.namespace === cur.system) : undefined;
    if (!cur || !sys) return { colours: [], fonts: [] };
    const roles = colourRoles(sys.tokens);
    const colours: PlannedColour[] = [];
    for (const [role, raw] of Object.entries(base.colors)) {
      const tok = roles[role as ColourRole];
      const value = tok ? normColour(tok.values[cur.theme] ?? '') : null;
      if (!tok || !value || value === normColour(raw) || colours.some((c) => c.from === value)) continue;
      const props = ROLE_PROPS[role as ColourRole];
      const count = usesOf(st.colours.get(value), props);
      if (count) colours.push({ role, token: tok.name, from: value, to: raw, count, props });
    }
    const fonts: PlannedFont[] = [];
    if (opts.fonts) {
      for (const [key, raw] of Object.entries(base.fonts)) {
        const f = normFont(sys.tokens.families[key] ?? '');
        const count = st.fonts.get(f)?.count ?? 0;
        if (f && count && f !== normFont(raw)) fonts.push({ key, from: f, to: raw, count });
      }
    }
    return { colours, fonts };
  });
  return finish(files, { from, to: 'original', record: null }, all, systems);
}

/** One file's source with its part of a plan written over it. */
export function applyThemePlan(source: string, plan: FilePlan | undefined): string {
  if (!plan) return source;
  const cm = new Map(plan.colours.map((c) => [c.from, c]));
  const fm = new Map(plan.fonts.map((f) => [f.from, f.to]));
  if (!cm.size && !fm.size) return source;
  return mapDecls(source, (prop, value) => {
    if (prop === 'font-family') {
      const to = fm.get(normFont(value));
      if (!to) return undefined;
      const m = /^(\s*)([\s\S]*?)(\s*(?:!important)?\s*)$/i.exec(value)!;
      return m[1] + to + m[3];
    }
    if (!cm.size) return undefined;
    const out = mapColourValue(value, (n) => {
      const c = cm.get(n);
      return c && (!c.props || c.props.test(prop)) ? c.to : undefined;
    });
    return out === value ? undefined : out;
  });
}
