// Regenerates packages/core/src/looks.data.ts from the 36 CSS themes of html-ppt
// (MIT, © 2026 lewis; part of nexu-io/open-design's design-templates):
//
//   node scripts/import-looks.mjs <html-ppt/assets/themes>
//
// A theme is one `:root{…}` block of `--bg`, `--text-1`, `--accent`… variables, which is almost a
// tokens.json already. Only the values are kept; `looks.ts` turns them into tokens. The groups are
// ours (a look belongs to one), see GROUPS below.
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
const px = (s) => (s && /^[\d.]+px$/.test(s) ? s : undefined);

const looks = [];
for (const [group, ids] of Object.entries(GROUPS)) {
  for (const id of ids) {
    const v = parse(readFileSync(join(dir, `${id}.css`), 'utf8'));
    const c = {};
    for (const [name, key] of Object.entries(COLORS)) if (colour(v[key])) c[name] = v[key].replace(/\s+/g, ' ');
    const stackOf = (k) => (v[k] ?? v['font-sans'] ?? 'system-ui, sans-serif').replace(/"/g, "'");
    const look = {
      id,
      group,
      dark: lum(v.bg) < 0.4,
      colors: { ...c, 'on-accent': onAccent(v.accent) },
      families: { sans: stackOf('font-sans'), display: stackOf('font-display') },
      hosted: [...new Set([...families(v['font-sans']), ...families(v['font-display'] ?? v['font-serif'])])].filter((f) => WEBFONTS[f]).map((family) => ({ family, href: WEBFONTS[family] })),
      radius: [px(v['radius-sm']), px(v.radius), px(v['radius-lg'])],
      shadow: [v.shadow, v['shadow-lg']].map((s) => (s && s !== 'none' ? shadowOf(s, id) : null)),
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
    `import type { LookData } from './looks';\n\nexport const LOOK_DATA: LookData[] = ${JSON.stringify(looks, null, 2)};\n`,
);
console.log(`${looks.length} looks → ${out}`);
