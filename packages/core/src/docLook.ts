/**
 * What a doc looks like: one table of values (`DocLook`) that the editor's page, the HTML / PDF / PNG
 * exports and the WeChat article all read (`.design/doc-design-system.md`). Without a design system a doc is drawn
 * by its own look, what the editor has always drawn; wearing one, the same roles are filled from the system's
 * tokens in the theme the doc chose. The files keep only the choice (`designSystems` and `theme` in doc.json),
 * never colours, so a doc stays plain Markdown and the look is resolved when it is drawn.
 * No wording and no DOM here: the editor and the exporters turn the values into CSS.
 */
import { DOC_COLORS, DOC_COLORS_ON_DARK, docColorCss, type DocColor } from './docColors';
import { dsGlance, type DsColor, type DsTokens } from './designSystem';
import type { DocJson, DocSettings } from './docs';
import { colourRoles, contrastRatio, themeRecordOf, type ThemeSystem } from './theme';
import { DOC_TAG, resolveDocDecls, type DocElement } from './docDecor';
import { DOC_ROLES, docColourOf, docLineOf, docRoleGiven, docSizeOf, docSpaceOf, docWeightOf, type DocRole } from './docRoles';

export interface DocLook {
  /** the page's own ground; empty when the doc has none (the reader's page shows: white in an export) */
  page: string;
  /** the page is dark: text colour names and the highlight take their dark values */
  dark: boolean;
  ink: string;
  heading: string;
  strong: string;
  /** quoted text, small headings, captions */
  muted: string;
  faint: string;
  link: string;
  rule: string;
  /** the ground of code and of a table's head */
  ground: string;
  inlineCode: string;
  mark: string;
  quote: { bar: string; bg: string };
  /** h1, h2, h3 in px */
  sizes: [number, number, number];
  /** h4 in px (h5 and h6 follow it); null leaves it to the reader (a doc's own look) */
  h4: number | null;
  /** the line height of every heading, a multiple of its size */
  headingLine: number;
  /** the ground of a table's head */
  tableHead: string;
  /** what the system adds to an element beyond the values above (a bar beside a heading, a frame round a picture): resolved declarations, `prop:value;…`, for this theme */
  decor: Partial<Record<DocElement, string>>;
  /** code blocks: size in px and line height; null leaves them to the reader */
  codeSize: number | null;
  codeLine: number | null;
  /** space between paragraphs and the indent of lists, px; null leaves them to the reader */
  gap: number | null;
  indent: number | null;
  /** running text, px, and its line height (a multiple of the size) */
  body: number;
  line: number;
  /** the text column in px when the system gives one (a platform's reader), else the doc's own width setting decides */
  column: number | null;
  /** full font stacks, single-quoted so they sit in an inline `style` */
  headingFont: string;
  bodyFont: string;
  mono: string;
  headingWeight: number;
  /** corners of code and pictures, px */
  radius: number;
  /** the doc's text colour names, drawn for this page */
  colors: Record<DocColor, string>;
}

const SANS = "system-ui,-apple-system,'PingFang SC','Noto Sans SC','Microsoft YaHei',sans-serif";
const SERIF = "'Source Serif 4',Georgia,'Songti SC','Noto Serif SC',serif";
const MONO = "ui-monospace,Menlo,'SFMono-Regular',Consolas,monospace";

/** The doc's own look: the editor's page as it is without a design system, and the doc's HTML export. */
export function docOwnLook(s: Pick<DocSettings, 'headingFont' | 'bodyFont'> = { headingFont: 'sans', bodyFont: 'sans' }): DocLook {
  return {
    page: '',
    dark: false,
    ink: '#1d1d1b',
    heading: '#1d1d1b',
    strong: '#1d1d1b',
    muted: '#555555',
    faint: '#888888',
    link: '#1d4ed8',
    rule: '#d6d4ce',
    ground: '#f5f5f3',
    inlineCode: '#1d1d1b',
    mark: '#ffeeb2',
    quote: { bar: '#d6d4ce', bg: 'transparent' },
    sizes: [30, 22, 18],
    h4: null,
    headingLine: 1.3,
    tableHead: '#f5f5f3',
    decor: {},
    codeSize: null,
    codeLine: null,
    gap: null,
    indent: null,
    body: 16,
    line: 1.75,
    column: null,
    headingFont: s.headingFont === 'serif' ? SERIF : SANS,
    bodyFont: s.bodyFont === 'serif' ? SERIF : SANS,
    mono: MONO,
    headingWeight: s.headingFont === 'serif' ? 600 : 700,
    radius: 8,
    colors: DOC_COLORS,
  };
}

const stack = (v: string): string => v.replace(/!important/i, '').replace(/"/g, "'").trim();

/** The `doc` family with every `{colour}` and `{length}` filled in for the theme. */
function decorOf(t: DsTokens, themeId: string): Partial<Record<DocElement, string>> {
  const lengths = t.others.filter((f) => f.key === 'spacing' || f.key === 'radius').flatMap((f) => f.tokens);
  const resolve = (name: string) => docColourOf(t, name, themeId) ?? lengths.find((x) => x.name === name)?.value;
  const out: Partial<Record<DocElement, string>> = {};
  for (const d of t.docStyles) {
    const css = resolveDocDecls(d.css, resolve);
    if (css) out[d.element] = css;
  }
  return out;
}

/**
 * The look a design system's theme gives a doc: its page, text, line, card and brand colours, its two faces and its corner
 * radius, and every `doc-*` role it gives itself (`DOC_ROLES`: colours, heading and body type, code, column, gap, indent).
 * A role it leaves out follows the generic roles, so a system with none still dresses a doc; the doc's own sizes stand
 * where nothing is said.
 */
export function docLookFromSystem(t: DsTokens, themeId: string, s?: Pick<DocSettings, 'headingFont' | 'bodyFont'>): DocLook {
  const own = docOwnLook(s);
  const roles = colourRoles(t);
  const val = (c?: DsColor) => (c ? (c.values[themeId] ?? Object.values(c.values)[0]) : undefined);
  const doc = (name: string) => docColourOf(t, name, themeId);
  const g = dsGlance(t, themeId);
  const page = val(roles.page) ?? '';
  const onWhite = page ? contrastRatio(page, '#ffffff') : null;
  const onBlack = page ? contrastRatio(page, '#000000') : null;
  const dark = onWhite !== null && onBlack !== null && onWhite > onBlack;
  const ink = val(roles.ink) ?? (dark ? '#e8e8e8' : own.ink);
  const muted = val(roles.muted) ?? ink;
  const accent = val(roles.accent) ?? g.accent;
  const radii = t.others.find((f) => f.key === 'radius')?.tokens ?? [];
  const radius = parseFloat((radii[1] ?? radii[0])?.value ?? '');
  const ground = doc('doc-code-bg') ?? val(roles.card) ?? (dark ? 'rgba(255,255,255,0.06)' : own.ground);
  const rule = doc('doc-rule') ?? val(roles.line) ?? (dark ? '#3a3f4b' : own.rule);
  const body = docSizeOf(t, 'doc-body', 10, 28) ?? own.body;
  const sizes = (['doc-h1', 'doc-h2', 'doc-h3'] as const).map((n, i) => docSizeOf(t, n, 10, 72, body) ?? own.sizes[i]) as [number, number, number];
  const code = docSizeOf(t, 'doc-code', 9, 24, body);
  return {
    page,
    dark,
    ink,
    heading: doc('doc-heading') ?? ink,
    strong: ink,
    muted,
    faint: val(roles.faint) ?? muted,
    link: doc('doc-link') ?? accent ?? ink,
    rule,
    ground,
    inlineCode: doc('doc-code-ink') ?? ink,
    mark: doc('doc-mark') ?? (dark ? 'rgba(255,196,0,0.30)' : own.mark),
    quote: { bar: doc('doc-quote-bar') ?? accent ?? val(roles.line) ?? own.rule, bg: doc('doc-quote-bg') ?? 'transparent' },
    sizes,
    h4: docSizeOf(t, 'doc-h4', 10, 40, body),
    headingLine: docLineOf(t, 'doc-h1', sizes[0]) ?? own.headingLine,
    tableHead: doc('doc-table-head') ?? ground,
    decor: decorOf(t, themeId),
    codeSize: code,
    codeLine: code ? docLineOf(t, 'doc-code', code) : null,
    gap: docSpaceOf(t, 'doc-gap', 0, 48),
    indent: docSpaceOf(t, 'doc-indent', 8, 64),
    body,
    line: docLineOf(t, 'doc-body', body) ?? own.line,
    column: docSpaceOf(t, 'doc-column', 280, 1200),
    headingFont: g.headingFont ? stack(g.headingFont) : own.headingFont,
    bodyFont: g.bodyFont ? stack(g.bodyFont) : own.bodyFont,
    mono: t.families.mono ? stack(t.families.mono) : own.mono,
    headingWeight: docWeightOf(t, 'doc-h1') ?? 700,
    radius: Number.isFinite(radius) ? Math.max(0, Math.min(20, radius)) : own.radius,
    colors: dark ? DOC_COLORS_ON_DARK : DOC_COLORS,
  };
}

export interface DocRoleLine {
  role: DocRole;
  /** the system wrote this role itself, or the look worked it out */
  source: 'system' | 'derived';
  /** the value as the doc is drawn with it */
  value: string;
}

/** Every doc role with the value the doc is drawn by and where it came from: the system's own token, or derived (`role.from` says what it follows). */
export function docRoleReport(t: DsTokens, themeId: string, look: DocLook = docLookFromSystem(t, themeId)): DocRoleLine[] {
  const n = (v: number | null, unit = 'px') => (v === null ? '–' : `${Math.round(v * 100) / 100}${unit}`);
  const type = (size: number | null, line: number | null, weight?: number) => (size === null ? '–' : [n(size), line ? `/ ${Math.round(line * 100) / 100}` : '', weight ? `· ${weight}` : ''].filter(Boolean).join(' '));
  const value: Record<string, string> = {
    'doc-heading': look.heading,
    'doc-link': look.link,
    'doc-quote-bar': look.quote.bar,
    'doc-quote-bg': look.quote.bg,
    'doc-code-bg': look.ground,
    'doc-code-ink': look.inlineCode,
    'doc-table-head': look.tableHead,
    'doc-mark': look.mark,
    'doc-rule': look.rule,
    'doc-h1': type(look.sizes[0], look.headingLine, look.headingWeight),
    'doc-h2': type(look.sizes[1], null),
    'doc-h3': type(look.sizes[2], null),
    'doc-h4': type(look.h4 ?? look.body, null),
    'doc-body': type(look.body, look.line),
    'doc-code': type(look.codeSize ?? 13, look.codeLine ?? 1.6),
    'doc-column': look.column === null ? '–' : n(look.column),
    'doc-gap': n(look.gap ?? 10),
    'doc-indent': n(look.indent ?? 24),
  };
  const lines: DocRoleLine[] = DOC_ROLES.map((role) => ({ role, source: docRoleGiven(t, role, themeId) ? 'system' : 'derived', value: value[role.name] }));
  // what the system adds to an element beyond values: listed only when it says something (the others draw as the values above)
  for (const d of t.docStyles) {
    const css = look.decor[d.element];
    if (css) lines.push({ role: { name: d.element, kind: 'style', use: d.usage ?? `Added to every ${DOC_TAG[d.element]}.`, from: 'none' }, source: 'system', value: css.replace(/;/g, '; ').trim() });
  }
  return lines;
}

/** What a doc wears: the look and, when it is a design system's, which one (`worn`) and the tokens it came from. */
export interface DocLookOf {
  look: DocLook;
  worn: { system: string; theme: string; title: string } | null;
  tokens: DsTokens | null;
}

/** The look of a doc: the system and theme its doc.json chose, if that system is installed, else its own. */
export function docLookOf(doc: DocJson, systems: ThemeSystem[]): DocLookOf {
  const rec = themeRecordOf(doc as Record<string, unknown>);
  const sys = rec ? systems.find((x) => x.namespace === rec.system) : undefined;
  if (rec && sys && sys.tokens.themes.length) {
    const theme = sys.tokens.themes.some((x) => x.id === rec.theme) ? rec.theme : sys.tokens.themes[0].id;
    return { look: docLookFromSystem(sys.tokens, theme, doc.settings), worn: { system: sys.namespace, theme, title: sys.title }, tokens: sys.tokens };
  }
  return { look: docOwnLook(doc.settings), worn: null, tokens: null };
}

/** The editor's custom properties for a doc that wears a system (`.app.docs[data-wears]` reads them; the others keep the editor's own tokens). */
export function docLookVars(l: DocLook): Record<string, string> {
  const vars: Record<string, string> = {
    '--look-page': l.page || 'transparent',
    '--look-ink': l.ink,
    '--look-heading': l.heading,
    '--look-muted': l.muted,
    '--look-faint': l.faint,
    '--look-link': l.link,
    '--look-rule': l.rule,
    '--look-ground': l.ground,
    '--look-mark': l.mark,
    '--look-quote': l.quote.bar,
    '--look-head': l.headingFont,
    '--look-body': l.bodyFont,
    '--look-mono': l.mono,
    '--look-head-weight': String(l.headingWeight),
    '--look-h1': `${l.sizes[0]}px`,
    '--look-h2': `${l.sizes[1]}px`,
    '--look-h3': `${l.sizes[2]}px`,
    '--look-size': `${l.body}px`,
    '--look-head-line': String(l.headingLine),
    '--look-quote-bg': l.quote.bg,
    '--look-code-ink': l.inlineCode,
    '--look-table-head': l.tableHead,
    '--look-line': String(l.line),
    '--look-radius': `${l.radius}px`,
  };
  if (l.column) vars['--look-column'] = `${l.column}px`;
  if (l.h4) vars['--look-h4'] = `${l.h4}px`;
  if (l.codeSize) vars['--look-code'] = `${l.codeSize}px`;
  if (l.codeLine) vars['--look-code-line'] = String(l.codeLine);
  if (l.gap !== null) vars['--look-gap'] = `${l.gap}px`;
  if (l.indent !== null) vars['--look-indent'] = `${l.indent}px`;
  for (const [name, hex] of Object.entries(l.colors)) vars[`--doc-${name}`] = hex;
  return vars;
}

/** The stylesheet of the doc's own page as HTML (the HTML, PDF and PNG exports); layout (width, margins) is the exporter's. */
export function docLookCss(l: DocLook): string {
  const gap = l.gap === null ? '' : `p{margin:${l.gap}px 0}`;
  const indent = l.indent === null ? '' : `ul,ol{padding-left:${l.indent}px}`;
  const h4 = l.h4 === null ? '' : `h4{font-size:${l.h4}px}`;
  const code = l.codeSize === null ? '' : `pre{font-size:${l.codeSize}px;${l.codeLine ? `line-height:${l.codeLine}` : ''}}code{font-size:${l.codeSize + 1}px}pre code{font-size:inherit}`;
  return (
    `html,body{${l.page ? `background:${l.page};` : ''}}` +
    `body{font:${l.body}px/${l.line} ${l.bodyFont};color:${l.ink}}` +
    `h1,h2,h3,h4,h5,h6{font-family:${l.headingFont};font-weight:${l.headingWeight};color:${l.heading};line-height:${l.headingLine}}` +
    `h1{font-size:${l.sizes[0]}px}h2{font-size:${l.sizes[1]}px}h3{font-size:${l.sizes[2]}px}${h4}` +
    gap +
    indent +
    `a{color:${l.link}}` +
    `table{border-collapse:collapse;display:block;max-width:100%;overflow-x:auto}td,th{border:1px solid ${l.rule};padding:6px 10px}th{background:${l.tableHead};font-weight:600;text-align:left}` +
    `pre{background:${l.ground};padding:12px;border-radius:${l.radius}px;overflow:auto}` +
    `code{font-family:${l.mono};font-size:.9em;color:${l.inlineCode}}pre code{color:${l.ink}}` +
    code +
    `blockquote{margin:0;padding-left:16px;border-left:3px solid ${l.quote.bar};${l.quote.bg !== 'transparent' ? `background:${l.quote.bg};` : ''}color:${l.muted}}` +
    `hr{border:0;border-top:1px solid ${l.rule}}` +
    `mark{background:${l.mark};color:inherit}` +
    docColorCss(l.colors) +
    docDecorCss(l)
  );
}

/** What the system adds to each element, as rules under `scope` (the editor's page: `.app.docs[data-wears] .docpage .docbody`; an export: ``). */
export function docDecorCss(l: DocLook, scope = ''): string {
  return (Object.keys(l.decor) as DocElement[]).map((e) => `${scope ? `${scope} ` : ''}${DOC_TAG[e]}{${l.decor[e]}}`).join('');
}

/** The faces a system's tokens need drawn on a page: hosted ones by `@import` (it has to come first in a stylesheet) and its font files by `@font-face` under `fontBase`. */
export function lookFontCss(t: DsTokens, fontBase: string): string {
  const out: string[] = [];
  for (const h of t.hosted) out.push(`@import url("${h.href}");`);
  for (const f of t.fonts) {
    const ext = f.file.slice(f.file.lastIndexOf('.') + 1).toLowerCase();
    const format = ext === 'woff2' ? 'woff2' : ext === 'woff' ? 'woff' : ext === 'otf' ? 'opentype' : ext === 'ttc' ? 'collection' : 'truetype';
    out.push(`@font-face{font-family:"${f.family.replace(/"/g, '')}";src:url("${fontBase}${f.file}") format("${format}");${f.weight ? `font-weight:${f.weight};` : ''}${f.style ? `font-style:${f.style};` : ''}font-display:swap}`);
  }
  return out.join('\n');
}
