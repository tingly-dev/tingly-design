// Regenerates packages/core/src/looks.data.ts from the 36 CSS themes of html-ppt
// (MIT, © 2026 lewis; part of nexu-io/open-design's design-templates):
//
//   node scripts/import-looks.mjs <html-ppt/assets/themes>
//
// A theme is one `:root{…}` block of `--bg`, `--text-1`, `--accent`… variables over base.css's defaults,
// which is almost a tokens.json already, plus a few rules of its own (a 2px card border, a gridded page).
// The values become tokens (`looks.ts`); base.css's component rules and the theme's own rules become the
// system's components/bundle.css, renamed to our tokens and to `lk-` classes (`lookKit.ts`). The groups
// are ours (a look belongs to one), see GROUPS below.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GROUPS = {
  clean: ['minimal-white', 'corporate-clean', 'swiss-grid', 'arctic-cool', 'soft-pastel', 'xiaohongshu-white', 'pitch-deck-vc'],
  editorial: ['editorial-serif', 'magazine-bold', 'academic-paper', 'news-broadcast', 'japanese-minimal', 'midcentury'],
  bold: ['bauhaus', 'memphis-pop', 'neo-brutalism', 'rainbow-gradient', 'sunset-warm', 'y2k-chrome', 'vaporwave'],
  tech: ['blueprint', 'engineering-whiteprint', 'cyberpunk-neon', 'terminal-green', 'retro-tv', 'sharp-mono', 'glassmorphism', 'aurora'],
  palette: ['catppuccin-latte', 'catppuccin-mocha', 'dracula', 'gruvbox-dark', 'nord', 'rose-pine', 'solarized-light', 'tokyo-night'],
};
const COLORS = {
  surface: 'bg', 'surface-soft': 'bg-soft', 'surface-raised': 'surface', 'surface-raised-2': 'surface-2', line: 'border', 'line-strong': 'border-strong',
  ink: 'text-1', 'ink-muted': 'text-2', 'ink-faint': 'text-3', accent: 'accent', 'accent-2': 'accent-2', 'accent-3': 'accent-3', good: 'good', warn: 'warn', bad: 'bad',
};

const dir = process.argv[2];
if (!dir) throw new Error('usage: node scripts/import-looks.mjs <html-ppt/assets/themes>');
const parse = (css) => {
  const root = css.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  const v = {};
  for (const m of root.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) v[m[1]] = m[2].trim();
  return v;
};
const colour = (c) => c && (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c) || /^rgba?\(\s*[\d.\s,%]+\)$/i.test(c));
const lum = (c) => {
  const m = c?.match(/^#([0-9a-f]{6})/i);
  if (!m) return 0.5;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const families = (stack) => (stack ?? '').split(',').map((f) => f.replace(/['"]/g, '').trim()).filter(Boolean);
// the webfonts html-ppt loads, each with its own weights (asking Google Fonts for a weight a family lacks fails the whole link)
const WEBFONTS = Object.fromEntries(
  [...readFileSync(join(dir, '../fonts.css'), 'utf8').matchAll(/@import url\('([^']+)'\)/g)].map(([, href]) => [
    decodeURIComponent(new URL(href).searchParams.get('family').split(':')[0]).replace(/\+/g, ' '),
    href,
  ]),
);
// WCAG contrast of white and of near-black on the accent; the higher one wins
const linear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const relLum = (hex) => {
  const m = hex?.match(/^#([0-9a-f]{6})/i);
  if (!m) return 0.5;
  const [r, g, b] = [0, 2, 4].map((i) => linear(parseInt(m[1].slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const onAccent = (accent) => {
  const l = relLum(accent);
  return (l + 0.05) / (relLum('#111111') + 0.05) > 1.05 / (l + 0.05) ? '#111111' : '#ffffff';
};
// a shadow may name a theme variable (`var(--accent)`); it becomes the colour token of ours that has the value
const OURS = Object.fromEntries(Object.entries(COLORS).map(([ours, theirs]) => [theirs, ours]));
const shadowOf = (s, id) =>
  s?.replace(/var\(\s*--([a-z0-9-]+)\s*\)/g, (_, k) => {
    if (!OURS[k]) throw new Error(`${id}: a shadow uses --${k}, which is not a colour of the look`);
    return `var(--${OURS[k]})`;
  });
const px = (s) => (s === '0' ? '0px' : s && /^[\d.]+px$/.test(s) ? s : undefined);

// ---- css: base.css's typography, cards, pills and dividers, then each theme's own rules
const BASE_CSS = readFileSync(join(dir, '../base.css'), 'utf8');
const BASE = parse(BASE_CSS);
// html-ppt's variables that are tokens of ours; the rest (gradients, letter spacing, serif, mono) stay as they are
const VARS = { ...OURS, radius: 'radius-m', 'radius-sm': 'radius-s', 'radius-lg': 'radius-l', shadow: 'raised', 'shadow-lg': 'overlay' };
const KEPT = ['grad', 'grad-soft', 'letter-tight', 'letter-normal', 'ease'];
const CLASSES = ['card-soft', 'card-outline', 'card-accent', 'card', 'pill-accent', 'pill', 'eyebrow', 'kicker', 'lede', 'divider-accent', 'divider', 'gradient-text', 'dim2', 'dim', 'mono', 'serif'];
const renameVars = (css) => css.replace(/var\(\s*--([a-z0-9-]+)/g, (m, k) => (VARS[k] ? `var(--${VARS[k]}` : m));
// a literal colour in a theme rule that is one of the theme's colours becomes that token, so editing the token
// still changes it; when two tokens share the value, the property says which one it means
const PREFER = {
  background: ['surface-raised', 'surface', 'surface-soft', 'surface-raised-2', 'accent', 'accent-2', 'accent-3', 'ink'],
  color: ['ink', 'ink-muted', 'ink-faint', 'accent', 'accent-2', 'accent-3', 'surface'],
  other: ['line-strong', 'line', 'ink', 'accent', 'accent-2', 'accent-3', 'ink-muted', 'surface'],
};
const hex = (c) => {
  const m = c.toLowerCase().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  return m && (m[1].length === 3 ? '#' + [...m[1]].map((x) => x + x).join('') : '#' + m[1]);
};
const tokenColours = (body, colours) =>
  body.replace(/([a-z-]+)\s*:([^;]*)/g, (decl, prop, value) => {
    const order = PREFER[prop.startsWith('background') ? 'background' : prop === 'color' ? 'color' : 'other'];
    return `${prop}:${value.replace(/#[0-9a-fA-F]{3,6}\b/g, (lit) => {
      const name = order.find((n) => colours[n] && hex(colours[n]) === hex(lit));
      return name ? `var(--${name})` : lit;
    })}`;
  });
const renameSelector = (sel) =>
  sel
    .replace(/\bh1\.title\b|\.h1\b/g, '.lk-h1')
    .replace(/\bh2\.title\b|\.h2\b/g, '.lk-h2')
    .replace(/\.h([34])\b/g, '.lk-h$1')
    // base.css styles bare h3/h4; ours style them only inside a look's page or a preview
    .replace(/(^|,)\s*h([34])(?![\w-])/g, '$1:where(.lk-page,.lk-stage) h$2')
    // a theme's slide is our page surface (the cover is one); its rules (grid lines, a side bar, scanlines, padding) come along
    .replace(/\.slide(?![\w-])/g, '.lk-page')
    .replace(/\bhtml,\s*body\b/g, 'body')
    .replace(new RegExp(`\\.(${CLASSES.join('|')})(?![\\w-])`, 'g'), '.lk-$1');
// top-level rules, keeping an @keyframes block whole
const rules = (css) => {
  const out = [];
  let depth = 0, start = 0;
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) {
      out.push(css.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  return out.filter(Boolean);
};
// the deck's own chrome (switching slides, links, headers, notes) is not part of a look; base.css's slide is the
// deck's positioning, but a theme's slide rule is how its page looks
const wanted = (rule, theme) => {
  const sel = rule.slice(0, rule.indexOf('{'));
  if (rule.startsWith('@keyframes')) return true;
  if (/card-hover|\.slide(-|\.is-)|\.deck|\.overview|\.notes|\.progress|^\s*a\b|:root|^\s*\*/.test(sel)) return false;
  if (/\.slide\b/.test(sel)) return theme;
  return /body|title|\.h[1-4]\b|(^|,)\s*h[34]\b|\.(card|pill|eyebrow|kicker|lede|divider|gradient-text|dim2?|mono|serif)\b/.test(sel);
};
const cssOf = (css, colours = {}, theme = true) => rules(css).filter((r) => wanted(r, theme)).map((r) => {
  if (r.startsWith('@keyframes')) return renameVars(r);
  const i = r.indexOf('{');
  const sel = [...new Set(renameSelector(r.slice(0, i).trim()).split(/\s*,\s*/))].join(',');
  return `${sel}{${tokenColours(renameVars(r.slice(i + 1, -1).trim().replace(/\s*\n\s*/g, ' ')), colours)}}`;
}).join('\n');
const BASE_RULES = cssOf(BASE_CSS.slice(BASE_CSS.indexOf('html,body'), BASE_CSS.indexOf('/* ================= CHROME')), {}, false);

const looks = [];
for (const [group, ids] of Object.entries(GROUPS)) {
  for (const id of ids) {
    const text = readFileSync(join(dir, `${id}.css`), 'utf8');
    const own = parse(text);
    // base.css fills in what a theme leaves out, except colours: a dark theme must not borrow base's light ones
    const v = { ...own };
    for (const [k, x] of Object.entries(BASE)) if (!(k in v) && !OURS[k]) v[k] = x;
    // a base font may name another (--font-display: var(--font-sans)); read it through the theme's value
    for (const k of Object.keys(v).filter((k) => k.startsWith('font-'))) v[k] = v[k].replace(/var\(--([a-z0-9-]+)\)/g, (m, n) => v[n] ?? m);
    const c = {};
    for (const [name, key] of Object.entries(COLORS)) if (colour(v[key])) c[name] = v[key].replace(/\s+/g, ' ');
    const stackOf = (k) => (v[k] ?? v['font-sans'] ?? 'system-ui, sans-serif').replace(/"/g, "'");
    const look = {
      id,
      group,
      dark: lum(v.bg) < 0.4,
      colors: { ...c, 'on-accent': onAccent(v.accent) },
      families: { sans: stackOf('font-sans'), display: stackOf('font-display'), serif: stackOf('font-serif'), mono: stackOf('font-mono') },
      // serif and mono are loaded only when the theme itself uses them
      hosted: [...new Set([...families(v['font-sans']), ...families(v['font-display']), ...(text.includes('font-serif') ? families(v['font-serif']) : []), ...(text.includes('font-mono') ? families(v['font-mono']) : [])])].filter((f) => WEBFONTS[f]).map((family) => ({ family, href: WEBFONTS[family] })),
      radius: [px(v['radius-sm']), px(v.radius), px(v['radius-lg'])],
      shadow: [v.shadow, v['shadow-lg']].map((s) => (s && s !== 'none' ? shadowOf(s, id) : null)),
      // what tokens cannot say: the theme's gradients and spacing, and its own rules
      vars: Object.fromEntries(KEPT.filter((k) => v[k]).map((k) => [k, tokenColours(`background:${renameVars(v[k]).replace(/\s+/g, ' ')}`, c).slice('background:'.length)])),
      css: cssOf(text.slice(text.indexOf('}', text.indexOf(':root')) + 1), c),
    };
    looks.push(look);
  }
}
const found = new Set(readdirSync(dir).filter((x) => x.endsWith('.css')).map((x) => basename(x, '.css')));
const missing = [...found].filter((id) => !looks.some((l) => l.id === id));
if (missing.length) throw new Error(`themes without a group: ${missing.join(', ')}`);

const out = join(dirname(fileURLToPath(import.meta.url)), '../packages/core/src/looks.data.ts');
writeFileSync(
  out,
  `// Generated by scripts/import-looks.mjs from the themes of html-ppt (MIT, © 2026 lewis); do not edit by hand.\n` +
    `import type { LookData } from './looks';\n\n/** base.css's typography, cards, pills and dividers, renamed to our tokens and \`lk-\` classes. */\nexport const LOOK_BASE_CSS = ${JSON.stringify(BASE_RULES)};\n\nexport const LOOK_DATA: LookData[] = ${JSON.stringify(looks, null, 2)};\n`,
);
console.log(`${looks.length} looks → ${out}`);
