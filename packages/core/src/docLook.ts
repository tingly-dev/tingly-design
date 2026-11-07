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
  /** h1, h2, h3 in px; the smaller headings follow */
  sizes: [number, number, number];
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
    headingFont: s.headingFont === 'serif' ? SERIF : SANS,
    bodyFont: s.bodyFont === 'serif' ? SERIF : SANS,
    mono: MONO,
    headingWeight: s.headingFont === 'serif' ? 600 : 700,
    radius: 8,
    colors: DOC_COLORS,
  };
}

const stack = (v: string): string => v.replace(/!important/i, '').replace(/"/g, "'").trim();

/** The look a design system's theme gives a doc: its page, text, line, card and brand colours, its two faces and its corner radius; sizes and rhythm stay the doc's. */
export function docLookFromSystem(t: DsTokens, themeId: string, s?: Pick<DocSettings, 'headingFont' | 'bodyFont'>): DocLook {
  const own = docOwnLook(s);
  const roles = colourRoles(t);
  const val = (c?: DsColor) => (c ? (c.values[themeId] ?? Object.values(c.values)[0]) : undefined);
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
  return {
    page,
    dark,
    ink,
    heading: ink,
    strong: ink,
    muted,
    faint: val(roles.faint) ?? muted,
    link: accent ?? ink,
    rule: val(roles.line) ?? (dark ? '#3a3f4b' : own.rule),
    ground: val(roles.card) ?? (dark ? 'rgba(255,255,255,0.06)' : own.ground),
    inlineCode: ink,
    mark: dark ? 'rgba(255,196,0,0.30)' : own.mark,
    quote: { bar: accent ?? val(roles.line) ?? own.rule, bg: 'transparent' },
    sizes: own.sizes,
    headingFont: g.headingFont ? stack(g.headingFont) : own.headingFont,
    bodyFont: g.bodyFont ? stack(g.bodyFont) : own.bodyFont,
    mono: t.families.mono ? stack(t.families.mono) : own.mono,
    headingWeight: 700,
    radius: Number.isFinite(radius) ? Math.max(0, Math.min(20, radius)) : own.radius,
    colors: dark ? DOC_COLORS_ON_DARK : DOC_COLORS,
  };
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
    '--look-radius': `${l.radius}px`,
  };
  for (const [name, hex] of Object.entries(l.colors)) vars[`--doc-${name}`] = hex;
  return vars;
}

/** The stylesheet of the doc's own page as HTML (the HTML, PDF and PNG exports); layout (width, margins) is the exporter's. */
export function docLookCss(l: DocLook): string {
  return (
    `html,body{${l.page ? `background:${l.page};` : ''}}` +
    `body{font:16px/1.75 ${l.bodyFont};color:${l.ink}}` +
    `h1,h2,h3,h4,h5,h6{font-family:${l.headingFont};font-weight:${l.headingWeight};color:${l.heading};line-height:1.3}` +
    `h1{font-size:${l.sizes[0]}px}h2{font-size:${l.sizes[1]}px}h3{font-size:${l.sizes[2]}px}` +
    `a{color:${l.link}}` +
    `table{border-collapse:collapse;display:block;max-width:100%;overflow-x:auto}td,th{border:1px solid ${l.rule};padding:6px 10px}th{background:${l.ground};font-weight:600;text-align:left}` +
    `pre{background:${l.ground};padding:12px;border-radius:${l.radius}px;overflow:auto}` +
    `code{font-family:${l.mono};font-size:.9em}` +
    `blockquote{margin:0;padding-left:16px;border-left:3px solid ${l.quote.bar};color:${l.muted}}` +
    `hr{border:0;border-top:1px solid ${l.rule}}` +
    `mark{background:${l.mark};color:inherit}` +
    docColorCss(l.colors)
  );
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
