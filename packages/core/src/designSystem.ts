/**
 * A design system kept in files (the original Design System type's
 * `project/` layout): `design-system.json` (the index), `tokens.json`,
 * `README.md` and other `*.md` sections, `components/<Comp>/README.md` and
 * `preview.html`, `components/bundle.js` / `bundle.css`, `assets/<Group>/…`,
 * `fonts/…`. `tokens.css` is generated from `tokens.json`, never written by hand.
 *
 * The tokens grammar follows the original's `format.md`: every family but
 * `type` is a LIST of `{name, value, usage}`; colours carry a value per theme
 * (a plain string is the first theme's), may alias another colour as
 * `"{name}"`, and a value that breaks the grammar drops with a reason.
 */

export const DS_INDEX = 'design-system.json';
export const DS_TOKENS = 'tokens.json';
export const DS_TOKENS_CSS = 'tokens.css';
export const DS_README = 'README.md';
/** The system's cover: the page its overview opens with and the face its launcher card shows. */
export const DS_COVER = 'components/Cover/preview.html';

// ------------------------------------------------------------------ index

export interface DsAssetGroup {
  name: string;
  tile?: 'l' | 'm' | 's' | 'xs' | string;
  order: string[];
  files: Record<string, { name: string; blob?: string; size?: number; type?: string }>;
}

export interface DsIndex {
  v: number;
  layout: 'files';
  createdOnFiles?: { v: number; at: string };
  title: string;
  namespace: string;
  libraries: { name: string; version: string }[];
  sections: Record<string, unknown>;
  groups: string[];
  assetGroups: Record<string, DsAssetGroup>;
  blobs: Record<string, unknown>;
  docs: { readme: string; sections: unknown[] };
  lastChange?: { by: string; at: string; via?: string; note?: string };
  [k: string]: unknown;
}

export function parseDsIndex(text: string | undefined): DsIndex {
  let raw: Partial<DsIndex> = {};
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    raw = {};
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
  return {
    ...raw,
    v: raw.v ?? 3,
    layout: 'files',
    title: typeof raw.title === 'string' ? raw.title : 'Untitled system',
    namespace: typeof raw.namespace === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(raw.namespace) ? raw.namespace : 'DS',
    libraries: Array.isArray(raw.libraries) ? raw.libraries : [],
    sections: raw.sections && typeof raw.sections === 'object' ? raw.sections : {},
    groups: Array.isArray(raw.groups) ? raw.groups.filter((g): g is string => typeof g === 'string') : [],
    assetGroups: raw.assetGroups && typeof raw.assetGroups === 'object' ? raw.assetGroups : {},
    blobs: raw.blobs && typeof raw.blobs === 'object' ? raw.blobs : {},
    docs: raw.docs && typeof raw.docs === 'object' ? (raw.docs as DsIndex['docs']) : { readme: 'project/README.md', sections: [] },
  };
}

export function stringifyDsIndex(d: DsIndex): string {
  return JSON.stringify(d, null, 2) + '\n';
}

export function newDsIndex(title: string, namespace: string, at = new Date().toISOString()): DsIndex {
  return {
    v: 3,
    layout: 'files',
    createdOnFiles: { v: 1, at },
    title,
    namespace,
    libraries: [],
    sections: {},
    groups: [],
    assetGroups: {},
    blobs: {},
    docs: { readme: 'project/README.md', sections: [] },
    lastChange: { by: 'Claude', at, via: 'tingly-design', note: 'created' },
  };
}

/** A namespace from a title: an ASCII identifier, PascalCase. */
export function namespaceOf(title: string): string {
  const words = title.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const ns = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  const out = /^[A-Za-z_$]/.test(ns) ? ns.slice(0, 40) : 'DS' + ns.slice(0, 38);
  // bundle.js assigns window.<namespace>; a browser global of that name (Math, JSON, Image…) would be replaced
  return BROWSER_GLOBALS.has(out) ? out + 'DS' : out;
}

const BROWSER_GLOBALS = new Set(
  'Array Audio Blob Boolean Date Document Element Error Event File Function Image Infinity Intl JSON Location Map Math NaN Node Number Object Option Promise Proxy Reflect RegExp Set String Symbol Text URL Window'.split(' '),
);

/** A folder name for a system installed into a canvas or deck (`ds/<folder>/`). */
export function dsFolderOf(namespace: string): string {
  return (
    namespace
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^[-_]+|-+$/g, '')
      .slice(0, 64) || 'ds'
  );
}

/** The record a canvas or deck keeps per installed system (`designSystems` in its index). */
export interface DsRecord {
  title: string;
  namespace: string;
  /** where it came from: a project of this repository (`projects/<name>`) or an artifact URL */
  artifact: string;
  version: string | null;
  copiedAt: string;
}

// ----------------------------------------------------------------- tokens

export interface DsTheme {
  id: string;
  name: string;
}

export interface DsIssue {
  /** where in tokens.json, e.g. `color.tokens[3]` */
  at: string;
  message: string;
}

export interface DsColor {
  name: string;
  /** per theme: the value as written (hex, function or `{alias}`) */
  raw: Record<string, string>;
  /** per theme: the colour itself, aliases followed */
  values: Record<string, string>;
  /** per theme: the token this one aliases, if any */
  alias: Record<string, string>;
  usage?: string;
}

export interface DsTypeStyle {
  name: string;
  family?: string;
  fontSize: string;
  lineHeight?: string;
  fontWeight?: string;
  letterSpacing?: string;
  fontStyle?: string;
  sample?: string;
  usage?: string;
}

export interface DsTypeGroup {
  name: string;
  family?: string;
  note?: string;
  styles: DsTypeStyle[];
}

export interface DsFont {
  family: string;
  file: string;
  weight?: string;
  style?: string;
}

/** Our extension (`type.hosted`): a face loaded from Google Fonts rather than a file. */
export interface DsHostedFont {
  family: string;
  href: string;
}

export interface DsPlainToken {
  name: string;
  /** spacing, radius and others: one value; shadow: per theme like colours */
  value: string;
  values?: Record<string, string>;
  usage?: string;
}

export interface DsFamily {
  key: string;
  title: string;
  note?: string;
  tokens: DsPlainToken[];
}

export interface DsTokens {
  name?: string;
  themes: DsTheme[];
  colors: DsColor[];
  families: Record<string, string>;
  fonts: DsFont[];
  hosted: DsHostedFont[];
  groups: DsTypeGroup[];
  /** spacing, radius, shadow, then any other `{tokens:[…]}` family, in file order */
  others: DsFamily[];
  issues: DsIssue[];
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const ID_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const HEX_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FN_RE = /^(rgba?|hsla?|oklch|oklab|lab|lch|color)\(\s*[-+0-9a-z.%\s,/]*\)$/i;
const ALIAS_RE = /^\{\s*([A-Za-z0-9][A-Za-z0-9_.-]{0,63})\s*\}$/;
const LENGTH_RE = /^-?(\d+\.?\d*|\.\d+)(px|rem|em|%)?$/;
const SHADOW_RE = /^[A-Za-z0-9 #%(),./+-]{1,400}$/;
const PLAIN_RE = /^[A-Za-z0-9 #%(),./+_-]{1,200}$/;

const cleanName = (n: unknown) => (typeof n === 'string' ? n.trim().replace(/^(--|\.)/, '') : '');

export function isColorLiteral(v: string): boolean {
  if (HEX_RE.test(v)) return true;
  if (!COLOR_FN_RE.test(v)) return false;
  return !/var\(|url\(|mix\(/i.test(v);
}

function normLength(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return `${v}px`;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!LENGTH_RE.test(s)) return null;
  return /^-?[\d.]+$/.test(s) ? (Number(s) === 0 ? '0' : `${s}px`) : s;
}

function familyTitle(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** Read tokens.json the way the original page does: what breaks the grammar drops, with a reason. */
export function resolveTokens(input: unknown): DsTokens {
  let json: Record<string, unknown> = {};
  const issues: DsIssue[] = [];
  if (typeof input === 'string') {
    try {
      json = input.trim() ? JSON.parse(input) : {};
    } catch (e) {
      issues.push({ at: 'tokens.json', message: `Not valid JSON: ${(e as Error).message}` });
    }
  } else if (input && typeof input === 'object') json = input as Record<string, unknown>;
  if (!json || typeof json !== 'object' || Array.isArray(json)) json = {};
  const drop = (at: string, message: string) => issues.push({ at, message });
  const taken = new Set<string>();

  // themes
  const colorFam = (json.color ?? {}) as { themes?: unknown; tokens?: unknown };
  let themes: DsTheme[] = [];
  if (Array.isArray(colorFam.themes)) {
    for (const [i, t] of colorFam.themes.entries()) {
      const id = typeof (t as DsTheme)?.id === 'string' ? (t as DsTheme).id.toLowerCase() : '';
      if (!ID_RE.test(id) || themes.some((x) => x.id === id)) {
        drop(`color.themes[${i}]`, `A theme needs a unique id of letters, digits, "." "_" "-".`);
        continue;
      }
      themes.push({ id, name: typeof (t as DsTheme).name === 'string' ? (t as DsTheme).name : id });
    }
  }
  if (themes.length > 8) {
    drop('color.themes', 'At most 8 themes; the rest are ignored.');
    themes = themes.slice(0, 8);
  }
  if (!themes.length) themes = [{ id: 'default', name: 'Default' }];
  const first = themes[0].id;

  // colours, first pass: names and raw values
  const raws: { name: string; raw: Record<string, string>; usage?: string; at: string }[] = [];
  if (colorFam.tokens !== undefined && !Array.isArray(colorFam.tokens)) {
    drop('color.tokens', 'color.tokens is a LIST of {name, value, usage}; a name-to-value map cannot be read.');
  }
  for (const [i, t] of (Array.isArray(colorFam.tokens) ? colorFam.tokens : []).entries()) {
    const at = `color.tokens[${i}]`;
    const tok = t as { name?: unknown; value?: unknown; usage?: unknown };
    const name = cleanName(tok?.name);
    if (!NAME_RE.test(name)) {
      drop(at, `"${String(tok?.name ?? '')}" is not a token name (letters, digits, "." "_" "-", 64 at most).`);
      continue;
    }
    if (taken.has(name)) {
      drop(at, `"${name}" is used twice; names are shared by every family but type.`);
      continue;
    }
    const raw: Record<string, string> = {};
    if (typeof tok.value === 'string') raw[first] = tok.value.trim();
    else if (tok.value && typeof tok.value === 'object') {
      for (const th of themes) {
        const v = (tok.value as Record<string, unknown>)[th.id];
        if (typeof v === 'string' && v.trim()) raw[th.id] = v.trim();
      }
    }
    // a value only a later theme has is borrowed for the first
    if (!raw[first]) {
      const any = themes.find((th) => raw[th.id]);
      if (any) raw[first] = raw[any.id];
    }
    if (!raw[first]) {
      drop(at, `"${name}" has no value.`);
      continue;
    }
    taken.add(name);
    raws.push({ name, raw, usage: typeof tok.usage === 'string' ? tok.usage.slice(0, 1000) : undefined, at });
  }
  if (raws.length > 600) {
    drop('color.tokens', 'At most 600 colours; the rest are ignored.');
    raws.length = 600;
  }
  // second pass: literals and aliases, per theme
  const byName = new Map(raws.map((r) => [r.name, r]));
  const literal = (name: string, theme: string, seen: string[] = []): string | null => {
    const r = byName.get(name);
    if (!r || seen.length > 16 || seen.includes(name)) return null;
    const v = r.raw[theme] ?? r.raw[first];
    const m = ALIAS_RE.exec(v);
    if (m) return literal(m[1], theme, [...seen, name]);
    return isColorLiteral(v) ? v.toLowerCase() : null;
  };
  const colors: DsColor[] = [];
  for (const r of raws) {
    const values: Record<string, string> = {};
    const alias: Record<string, string> = {};
    const raw: Record<string, string> = {};
    let bad = '';
    for (const th of themes) {
      const v = r.raw[th.id] ?? r.raw[first];
      const lit = literal(r.name, th.id);
      if (lit === null) {
        const m = ALIAS_RE.exec(v);
        bad = m
          ? byName.has(m[1])
            ? `"${r.name}" aliases "${m[1]}" in a loop, or one that has no colour.`
            : `"${r.name}" aliases "${m[1]}", which does not exist.`
          : `"${v}" is not a colour the page reads (hex, rgb(), hsl(), oklch()…; no names, var() or color-mix()).`;
        break;
      }
      values[th.id] = lit;
      raw[th.id] = v;
      const m = ALIAS_RE.exec(v);
      if (m) alias[th.id] = m[1];
    }
    if (bad) {
      drop(r.at, bad);
      byName.delete(r.name);
      taken.delete(r.name);
      continue;
    }
    colors.push({ name: r.name, raw, values, alias, usage: r.usage });
  }

  // type
  const type = (json.type ?? {}) as { fonts?: unknown; families?: unknown; groups?: unknown; hosted?: unknown };
  const families: Record<string, string> = {};
  if (type.families && typeof type.families === 'object' && !Array.isArray(type.families)) {
    for (const [k, v] of Object.entries(type.families as Record<string, unknown>)) {
      const key = k.toLowerCase();
      const stack = typeof v === 'string' ? v.trim() : '';
      const quotes = (stack.match(/"/g) ?? []).length % 2 === 0 && (stack.match(/'/g) ?? []).length % 2 === 0;
      if (!ID_RE.test(key) || !stack || stack.length > 200 || /[;{}<>\\()]/.test(stack) || !quotes) {
        drop(`type.families.${k}`, `"${k}" is not a font stack the page reads (≤200 characters, no ; { } < > \\ or functions).`);
        continue;
      }
      families[key] = stack;
    }
  }
  const fonts: DsFont[] = [];
  for (const [i, f] of (Array.isArray(type.fonts) ? type.fonts : []).entries()) {
    const ff = f as DsFont;
    const family = typeof ff?.family === 'string' ? ff.family.trim().replace(/^["']|["']$/g, '') : '';
    const file = typeof ff?.file === 'string' ? ff.file.trim() : '';
    // both end up inside url("…") and "…" in a stylesheet: plain names only
    if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,80}$/.test(family) || !/^[A-Za-z0-9_][A-Za-z0-9_./ -]{0,200}\.(woff2?|ttf|otf)$/i.test(file) || file.includes('..')) {
      drop(`type.fonts[${i}]`, 'A font needs a family and a file under fonts/.');
      continue;
    }
    fonts.push({ family, file: file.includes('/') ? file : `fonts/${file}`, weight: ff.weight ? String(ff.weight) : undefined, style: ff.style });
  }
  const hosted: DsHostedFont[] = [];
  for (const [i, h] of (Array.isArray(type.hosted) ? type.hosted : []).entries()) {
    const hh = h as DsHostedFont;
    if (typeof hh?.family !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,80}$/.test(hh.family.trim()) || typeof hh?.href !== 'string' || !/^https:\/\/fonts\.googleapis\.com\/css2\?[^"'<>\s]*$/.test(hh.href)) {
      drop(`type.hosted[${i}]`, 'A hosted face is {family, href} with a https://fonts.googleapis.com/css2?… link.');
      continue;
    }
    hosted.push({ family: hh.family.trim(), href: hh.href });
  }
  const groups: DsTypeGroup[] = [];
  const styleNames = new Set<string>();
  for (const [gi, g] of (Array.isArray(type.groups) ? type.groups : []).slice(0, 12).entries()) {
    const gg = g as { name?: unknown; family?: unknown; note?: unknown; styles?: unknown };
    const group: DsTypeGroup = {
      name: typeof gg?.name === 'string' ? gg.name : `Group ${gi + 1}`,
      family: typeof gg?.family === 'string' ? gg.family.toLowerCase() : undefined,
      note: typeof gg?.note === 'string' ? gg.note.slice(0, 400) : undefined,
      styles: [],
    };
    for (const [si, s] of (Array.isArray(gg?.styles) ? gg.styles : []).entries()) {
      const at = `type.groups[${gi}].styles[${si}]`;
      const st = s as Record<string, unknown>;
      const name = cleanName(st?.name);
      if (!NAME_RE.test(name) || styleNames.has(name)) {
        drop(at, `"${String(st?.name ?? '')}" is not a unique style name.`);
        continue;
      }
      const fontSize = normLength(st.fontSize);
      if (!fontSize) {
        drop(at, `"${name}": fontSize "${String(st.fontSize ?? '')}" is not a length.`);
        continue;
      }
      const lh = st.lineHeight;
      const lineHeight = typeof lh === 'number' && lh < 10 ? String(lh) : typeof lh === 'string' && /^\d*\.?\d+$/.test(lh) && Number(lh) < 10 ? lh : normLength(lh) ?? undefined;
      const fw = st.fontWeight;
      const fontWeight =
        fw === 'normal' ? '400' : fw === 'bold' ? '700' : typeof fw === 'number' || (typeof fw === 'string' && /^\d{1,4}( \d{1,4})?$/.test(fw)) ? String(fw) : undefined;
      styleNames.add(name);
      group.styles.push({
        name,
        family: typeof st.family === 'string' ? st.family.toLowerCase() : undefined,
        fontSize,
        lineHeight,
        fontWeight,
        letterSpacing: normLength(st.letterSpacing) ?? undefined,
        fontStyle: st.fontStyle === 'italic' ? 'italic' : undefined,
        sample: typeof st.sample === 'string' ? st.sample.slice(0, 200) : undefined,
        usage: typeof st.usage === 'string' ? st.usage.slice(0, 1000) : undefined,
      });
    }
    groups.push(group);
  }

  // the other families
  const others: DsFamily[] = [];
  const keys = Object.keys(json).filter((k) => !['name', 'version', 'color', 'type', 'meta', '$schema'].includes(k));
  keys.sort((a, b) => {
    const rank = (k: string) => (k === 'spacing' ? 0 : k === 'radius' ? 1 : k === 'shadow' ? 2 : 3);
    return rank(a) - rank(b);
  });
  for (const key of keys) {
    const fam = json[key] as { note?: unknown; tokens?: unknown };
    if (!fam || typeof fam !== 'object' || !Array.isArray(fam.tokens)) {
      if (key === 'spacing' || key === 'radius' || key === 'shadow') drop(key, `${key} is {"tokens": [{name, value, usage}]}; a name-to-value map cannot be read.`);
      continue;
    }
    if (key === 'motion') {
      drop(key, 'There is no motion family.');
      continue;
    }
    const out: DsFamily = { key, title: familyTitle(key), note: typeof fam.note === 'string' ? fam.note.slice(0, 400) : undefined, tokens: [] };
    for (const [i, t] of fam.tokens.slice(0, 60).entries()) {
      const at = `${key}.tokens[${i}]`;
      const tok = t as { name?: unknown; value?: unknown; usage?: unknown };
      const name = cleanName(tok?.name);
      if (!NAME_RE.test(name) || taken.has(name)) {
        drop(at, NAME_RE.test(name) ? `"${name}" is used twice; names are shared by every family but type.` : `"${String(tok?.name ?? '')}" is not a token name.`);
        continue;
      }
      const usage = typeof tok.usage === 'string' ? tok.usage.slice(0, 1000) : undefined;
      if (key === 'shadow') {
        const per: Record<string, string> = {};
        if (typeof tok.value === 'string') per[first] = tok.value.trim();
        else if (tok.value && typeof tok.value === 'object')
          for (const th of themes) {
            const v = (tok.value as Record<string, unknown>)[th.id];
            if (typeof v === 'string') per[th.id] = v.trim();
          }
        const ok = Object.values(per).length > 0 && Object.values(per).every((v) => SHADOW_RE.test(v) && !/url\(/i.test(v));
        if (!ok || !per[first]) {
          drop(at, `"${name}": not a box-shadow the page reads.`);
          continue;
        }
        // a colour of the system may be named as var(--colour), so a shadow follows the theme
        const unknown = Object.values(per)
          .flatMap((v) => [...v.matchAll(/var\(([^)]*)\)/gi)].map((m) => m[1].trim()))
          .find((ref) => !/^--[A-Za-z0-9_-]+$/.test(ref) || !colors.some((c) => c.name === ref.slice(2)));
        if (unknown !== undefined) {
          drop(at, `"${name}": var(${unknown}) is not one of the system's colours; a shadow may use var(--colour) of a colour token only.`);
          continue;
        }
        taken.add(name);
        out.tokens.push({ name, value: per[first], values: per, usage });
        continue;
      }
      const length = key === 'spacing' || key === 'radius';
      const v = length ? normLength(tok.value) : typeof tok.value === 'string' || typeof tok.value === 'number' ? String(tok.value).trim() : null;
      if (!v || (!length && (!PLAIN_RE.test(v) || /var\(|url\(/i.test(v)))) {
        drop(at, `"${name}": "${String(tok.value ?? '')}" is not ${length ? 'a length (px, rem, em, %)' : 'a plain CSS value'}.`);
        continue;
      }
      taken.add(name);
      out.tokens.push({ name, value: v, usage });
    }
    others.push(out);
  }
  return { name: typeof json.name === 'string' ? json.name : undefined, themes, colors, families, fonts, hosted, groups, others, issues };
}

/** What tells one design system from another at a glance: its roles, faces and shape. */
export interface DsGlance {
  /** the page, a card, the text and the brand colour, in the first theme; unset when the system has none */
  paper?: string;
  surface?: string;
  ink?: string;
  accent?: string;
  /** full font stacks */
  headingFont?: string;
  bodyFont?: string;
  /** the first radius token, e.g. 14px */
  radius?: string;
  /** the colour of hairlines and card borders, when the system has one */
  line?: string;
  /** the first shadow token, `var(--colour)` filled in */
  shadowValue?: string;
  shadow: boolean;
  themes: string[];
  colors: number;
  typeStyles: number;
  /** spacing, radius, shadow and other plain tokens */
  tokens: number;
}

const saturation = (hex: string): number => {
  const m = /^#([0-9a-f]{6})/i.exec(hex);
  if (!m) return 0;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
};

/** Pick the roles that make a system recognisable, by the names brand books use; falls back to the colours themselves. */
export function dsGlance(t: DsTokens, themeId?: string): DsGlance {
  const theme = themeId ?? t.themes[0]?.id;
  const value = (c?: DsColor) => (c && theme ? c.values[theme] : undefined) ?? (c ? Object.values(c.values)[0] : undefined);
  const find = (re: RegExp) => value(t.colors.find((c) => re.test(c.name)));
  // a system whose page colour is called `surface` (the starter's, and every look's) keeps its cards in `surface-raised`
  const named_paper = find(/^(paper|background|bg|page|canvas|base)\b/i) ?? find(/(paper|background|^bg)/i);
  const paper = named_paper ?? find(/^surface$/i);
  const surface = named_paper ? find(/^(surface|card|panel|elevated)\b/i) : find(/^(card|panel|elevated|surface-raised|raised)\b/i);
  const ink = find(/^(ink|text|foreground|fg|content)(?!.*(muted|faint|soft|secondary|subtle))/i);
  const named = find(/^(brand|primary|accent)$/i);
  const accent =
    named ??
    t.colors
      .map(value)
      .filter((v): v is string => !!v)
      .sort((a, b) => saturation(b) - saturation(a))[0];
  const stacks = Object.values(t.families);
  const groupFamily = (re: RegExp) => {
    const g = t.groups.find((x) => re.test(x.name));
    return g ? styleFamily(t, g.styles[0] ?? ({} as DsTypeStyle), g) : undefined;
  };
  const headingFont = t.families.display ?? t.families.heading ?? groupFamily(/display|head|title/i) ?? stacks[0];
  const bodyFont = t.families.sans ?? t.families.body ?? groupFamily(/body|text|ui/i) ?? stacks[1] ?? stacks[0];
  const radius = t.others.find((f) => f.key === 'radius')?.tokens[0]?.value;
  const line = find(/^(line|border|stroke|outline|divider|hairline)(?!.*strong)/i);
  const shadowToken = t.others.find((f) => f.key === 'shadow')?.tokens[0];
  const shadowValue = shadowToken ? shadowIn(t, (theme && shadowToken.values?.[theme]) || shadowToken.value, theme) : undefined;
  return {
    paper,
    surface,
    ink,
    accent,
    headingFont,
    bodyFont,
    radius,
    line,
    shadowValue: shadowValue || undefined,
    shadow: !!t.others.find((f) => f.key === 'shadow')?.tokens.length,
    themes: t.themes.map((x) => x.name),
    colors: t.colors.length,
    typeStyles: t.groups.reduce((n, g) => n + g.styles.length, 0),
    tokens: t.others.reduce((n, f) => n + f.tokens.length, 0),
  };
}

/** A token name as a CSS custom property (`.` escaped). */
export function cssVar(name: string): string {
  return '--' + name.replace(/\./g, '\\.');
}

/** A style's font stack: its own family key, else its group's, through `type.families`. */
export function styleFamily(t: DsTokens, style: DsTypeStyle, group?: DsTypeGroup): string | undefined {
  const key = style.family ?? group?.family;
  return key ? t.families[key] ?? key : undefined;
}

function fontFormat(file: string): string {
  const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
  return ext === 'woff2' ? 'woff2' : ext === 'woff' ? 'woff' : ext === 'otf' ? 'opentype' : 'truetype';
}

/** tokens.css as the original compiles it. `fontBase` prefixes font file paths (for an installed copy). */
export function compileTokensCss(t: DsTokens, opts: { title?: string; fontBase?: string } = {}): string {
  const first = t.themes[0].id;
  const out: string[] = [`/* ${opts.title ?? t.name ?? 'Design system'} — generated from tokens.json */`];
  // hosted faces (our type.hosted extension): @import has to come first
  for (const h of t.hosted) out.push(`@import url("${h.href}");`);
  const decl = (name: string, v: string) => `  ${cssVar(name)}: ${v};`;
  const colorValue = (c: DsColor, theme: string) => (c.alias[theme] ? `var(${cssVar(c.alias[theme])})` : c.raw[theme]);
  const shadows = t.others.find((f) => f.key === 'shadow')?.tokens ?? [];
  const head = [...t.colors.map((c) => decl(c.name, colorValue(c, first))), ...shadows.map((s) => decl(s.name, s.values?.[first] ?? s.value))];
  if (head.length) out.push(`:root, [data-theme="${first}"] {\n${head.join('\n')}\n}`);
  for (const th of t.themes.slice(1)) {
    const lines = [
      ...t.colors.filter((c) => c.raw[th.id] !== c.raw[first] || c.alias[th.id]).map((c) => decl(c.name, colorValue(c, th.id))),
      ...shadows.filter((s) => s.values?.[th.id] && s.values[th.id] !== s.value).map((s) => decl(s.name, s.values![th.id])),
    ];
    if (lines.length) out.push(`[data-theme="${th.id}"] {\n${lines.join('\n')}\n}`);
  }
  const rootLines = [
    ...t.others.filter((f) => f.key !== 'shadow').flatMap((f) => f.tokens.map((x) => decl(x.name, x.value))),
    ...Object.entries(t.families).map(([k, v]) => `  --font-${k}: ${v};`),
  ];
  if (rootLines.length) out.push(`:root {\n${rootLines.join('\n')}\n}`);
  for (const g of t.groups)
    for (const s of g.styles) {
      const fam = s.family ?? g.family;
      const lines = [
        fam ? `  font-family: var(--font-${fam});` : '',
        `  font-size: ${s.fontSize};`,
        s.lineHeight ? `  line-height: ${s.lineHeight};` : '',
        s.fontWeight ? `  font-weight: ${s.fontWeight};` : '',
        s.letterSpacing ? `  letter-spacing: ${s.letterSpacing};` : '',
        s.fontStyle ? `  font-style: ${s.fontStyle};` : '',
      ].filter(Boolean);
      out.push(`.${s.name.replace(/\./g, '\\.')} {\n${lines.join('\n')}\n}`);
    }
  for (const f of t.fonts) {
    out.push(
      `@font-face {\n  font-family: "${f.family.replace(/"/g, '')}";\n  src: url("${(opts.fontBase ?? '') + f.file}") format("${fontFormat(f.file)}");\n${f.weight ? `  font-weight: ${f.weight};\n` : ''}${f.style ? `  font-style: ${f.style};\n` : ''}  font-display: swap;\n}`,
    );
  }
  return out.join('\n\n') + '\n';
}

/** A colour's value in a theme, aliases followed (the first theme's when the theme has none). */
export function colorIn(t: DsTokens, name: string, theme?: string): string | undefined {
  const c = t.colors.find((x) => x.name === name);
  if (!c) return undefined;
  return c.values[theme ?? t.themes[0].id] ?? c.values[t.themes[0].id];
}

/** A shadow with its `var(--colour)` references replaced by that colour's value in `theme`, for drawing outside the system's own tokens.css. */
export function shadowIn(t: DsTokens, value: string, theme?: string): string {
  return value.replace(/var\(\s*--([A-Za-z0-9_-]+)\s*\)/g, (m, name: string) => colorIn(t, name, theme) ?? m);
}

const remPx = (v: string) => {
  const m = /^(-?[\d.]+)(rem|em)$/.exec(v);
  return m ? `${Math.round(Number(m[1]) * 16 * 100) / 100}px` : v;
};

/**
 * A type style as inline declarations an element can carry (what the text
 * style menu writes). `px` turns rem/em into px for the slide subset.
 */
export function styleDeclarations(t: DsTokens, style: DsTypeStyle, group?: DsTypeGroup, px = false): Record<string, string> {
  const fix = (v: string) => (px ? remPx(v) : v);
  const out: Record<string, string> = {};
  const fam = styleFamily(t, style, group);
  if (fam) out['font-family'] = fam;
  out['font-size'] = fix(style.fontSize);
  if (style.lineHeight) out['line-height'] = /^[\d.]+$/.test(style.lineHeight) ? style.lineHeight : fix(style.lineHeight);
  if (style.fontWeight) out['font-weight'] = style.fontWeight.split(' ')[0];
  if (style.letterSpacing) out['letter-spacing'] = fix(style.letterSpacing);
  if (style.fontStyle) out['font-style'] = style.fontStyle;
  return out;
}

/** Edit tokens.json as data, keeping everything the edit does not touch. */
export function editTokensJson(text: string | undefined, fn: (json: Record<string, unknown>) => void): string {
  let json: Record<string, unknown> = {};
  try {
    json = text?.trim() ? JSON.parse(text) : {};
  } catch {
    throw new Error('tokens.json is not valid JSON; fix it by hand first.');
  }
  fn(json);
  return JSON.stringify(json, null, 2) + '\n';
}

// -------------------------------------------------------------- components

export interface DsCardMarker {
  group?: string;
  height?: number;
  width?: number;
  subtitle?: string;
  floor?: string;
  page?: boolean;
}

/** Line 1 of a preview: `<!-- @dsCard group="…" height=N subtitle="…" -->`. */
export function parseCardMarker(html: string): DsCardMarker {
  const m = /^\s*<!--\s*@dsCard\b([^]*?)-->/.exec(html);
  if (!m) return {};
  const out: DsCardMarker = {};
  for (const a of m[1].matchAll(/([a-zA-Z]+)(?:\s*=\s*(?:"([^"]*)"|([^\s"]+)))?/g)) {
    const [, k, q, b] = a;
    const v = q ?? b;
    if (k === 'group' || k === 'subtitle' || k === 'floor') out[k] = v;
    else if (k === 'height' || k === 'width') {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = k === 'height' ? Math.min(4000, Math.max(40, n)) : n;
    } else if (k === 'page') out.page = true;
  }
  return out;
}

/** `/* @ds-bundle: {"format":4,"namespace":"…","components":[{"name":"…"}]} *\/` on line 1 of bundle.js. */
export function parseBundleHeader(js: string | undefined): { namespace?: string; components: string[] } {
  const m = js ? /^\s*\/\*\s*@ds-bundle:\s*(\{[^]*?\})\s*\*\//.exec(js) : null;
  if (!m) return { components: [] };
  try {
    const h = JSON.parse(m[1]) as { namespace?: string; components?: { name?: string }[] };
    return { namespace: h.namespace, components: (h.components ?? []).map((c) => c.name).filter((n): n is string => !!n) };
  } catch {
    return { components: [] };
  }
}

/** The component catalogue: the bundle's order first, then every components/<Comp>/ with a preview or README. */
export function componentNames(files: Iterable<string>, bundle?: string): string[] {
  const out = parseBundleHeader(bundle).components;
  const seen = new Set(out);
  for (const f of [...files].sort()) {
    const m = /^components\/([A-Za-z_$][A-Za-z0-9_$]*)\/(preview\.html|README\.md)$/.exec(f);
    if (m && m[1] !== 'Cover' && !seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}

/** Further brand-book sections: `*.md` at the top level (and in folders outside components/ and archived/), README first. */
export function sectionFiles(files: Iterable<string>): string[] {
  const md = [...files].filter((f) => /\.md$/i.test(f) && !/^(components|archived|assets|api|ds)\//.test(f));
  return [...md.filter((f) => f === DS_README), ...md.filter((f) => f !== DS_README).sort()].slice(0, 25);
}

/** The text files a design system keeps (what the server reads and writes as text). */
export function isDsTextFile(path: string): boolean {
  if (path.includes('..') || /(^|\/)\./.test(path)) return false;
  return (
    path === DS_INDEX ||
    path === DS_TOKENS ||
    path === DS_TOKENS_CSS ||
    /^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,80}\.md$/.test(path) ||
    /^components\/[A-Za-z_$][A-Za-z0-9_$]*\/(preview\.html|README\.md|[A-Za-z_$][A-Za-z0-9_$]*\.d\.ts)$/.test(path) ||
    /^components\/(bundle\.js|bundle\.css|index\.d\.ts)$/.test(path) ||
    /^components\/lib\/[A-Za-z0-9_.-]{1,80}\.js$/.test(path) ||
    /^assets\/[A-Za-z0-9_][A-Za-z0-9_ -]{0,60}\/README\.md$/.test(path)
  );
}

/** A small first system: a few colours in one theme, five text styles, four spaces, three radii. */
export function starterTokens(name: string): string {
  return (
    JSON.stringify(
      {
        name,
        version: 1,
        color: {
          themes: [{ id: 'light', name: 'Light' }],
          tokens: [
            { name: 'surface', value: '#fbfaf7', usage: 'Page background.' },
            { name: 'surface-raised', value: '#ffffff', usage: 'Cards and menus.' },
            { name: 'line', value: '#e3e1db', usage: 'Hairlines and input borders.' },
            { name: 'ink', value: '#1d1d1b', usage: 'Primary text, on surface and surface-raised.' },
            { name: 'ink-muted', value: '#64625c', usage: 'Secondary text, on either surface.' },
            { name: 'accent', value: '#2f6fed', usage: 'Primary action and links.' },
            { name: 'on-accent', value: '#ffffff', usage: 'Text on an accent fill.' },
          ],
        },
        type: {
          fonts: [],
          families: { sans: "system-ui, -apple-system, 'PingFang SC', 'Noto Sans SC', sans-serif" },
          groups: [
            {
              name: 'Text',
              family: 'sans',
              styles: [
                { name: 'display', fontSize: '48px', lineHeight: 1.1, fontWeight: 700, usage: 'One per page.' },
                { name: 'heading', fontSize: '28px', lineHeight: 1.2, fontWeight: 600 },
                { name: 'subheading', fontSize: '20px', lineHeight: 1.3, fontWeight: 600 },
                { name: 'body', fontSize: '16px', lineHeight: 1.5, fontWeight: 400 },
                { name: 'caption', fontSize: '13px', lineHeight: 1.4, fontWeight: 400 },
              ],
            },
          ],
        },
        spacing: {
          tokens: [
            { name: 'space-1', value: '4px', usage: 'Icon to label.' },
            { name: 'space-2', value: '8px', usage: 'Inside controls.' },
            { name: 'space-4', value: '16px', usage: 'Card padding.' },
            { name: 'space-8', value: '32px', usage: 'Between sections.' },
          ],
        },
        radius: {
          tokens: [
            { name: 'radius-s', value: '4px', usage: 'Inputs, tags.' },
            { name: 'radius-m', value: '8px', usage: 'Buttons, cards.' },
            { name: 'radius-l', value: '16px', usage: 'Panels.' },
          ],
        },
      },
      null,
      2,
    ) + '\n'
  );
}
