// Spike: turn the 36 CSS themes of OpenDesign's html-ppt template (MIT, lewis) into
// Tingly Design design systems. A theme is one `:root{…}` block of `--bg`, `--text-1`,
// `--accent`… variables, which is almost our tokens.json already.
//
//   node html-ppt-themes-to-ds.mjs <html-ppt/assets/themes> <projects dir> [tingly-design command…]
//
// It creates each project with the CLI (`new design-system`) so the index and
// tokens.css come from the real code, then replaces tokens.json and README.md.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

const [themesDir, projects, ...cli] = process.argv.slice(2);
const td = cli.length ? cli : ['pnpm', '-s', 'tingly-design'];
const env = { ...process.env, DC_PROJECTS: projects };

const parse = (css) => {
  const root = css.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  const v = {};
  for (const m of root.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) v[m[1]] = m[2].trim();
  return v;
};
const hexish = (c) => /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c) || /^rgba?\(\s*[\d.\s,%]+\)$/i.test(c);
const lum = (c) => {
  const m = c?.match(/^#([0-9a-f]{6})/i);
  if (!m) return 0.5;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const firstFamily = (stack) => stack?.split(',')[0].replace(/['"]/g, '').trim();
const SYSTEM = /^(system-ui|sans-serif|serif|monospace|-apple-system|Segoe UI|PingFang SC|Noto .*|Helvetica.*|Arial.*|Georgia)$/i;
const title = (s) => s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const results = [];
for (const f of readdirSync(themesDir).filter((x) => x.endsWith('.css')).sort()) {
  const id = basename(f, '.css');
  const v = parse(readFileSync(join(themesDir, f), 'utf8'));
  const dropped = [];
  const c = [];
  const add = (name, key, usage) => {
    if (v[key] && hexish(v[key])) c.push({ name, value: v[key].replace(/\s+/g, ' '), usage });
    else if (v[key]) dropped.push(`${key}=${v[key]}`);
  };
  add('surface', 'bg', 'Page background.');
  add('surface-soft', 'bg-soft', 'Quiet panels.');
  add('surface-raised', 'surface', 'Cards and panels.');
  add('surface-raised-2', 'surface-2', 'Nested cards.');
  add('line', 'border', 'Hairlines and card borders.');
  add('line-strong', 'border-strong', 'Emphasised borders.');
  add('ink', 'text-1', 'Primary text, on surface, surface-soft and surface-raised.');
  add('ink-muted', 'text-2', 'Secondary text, on surface and surface-raised.');
  add('ink-faint', 'text-3', 'Captions and labels, on surface; large text only.');
  add('accent', 'accent', 'Primary accent: links, key numbers, rules.');
  add('accent-2', 'accent-2', 'Second accent for charts and highlights.');
  add('accent-3', 'accent-3', 'Third accent, used sparingly.');
  add('good', 'good', 'Positive status.');
  add('warn', 'warn', 'Caution status.');
  add('bad', 'bad', 'Negative status.');
  const dark = lum(v.bg) < 0.4;
  c.push({ name: 'on-accent', value: lum(v.accent) > 0.18 ? '#111111' : '#ffffff', usage: 'Text on an accent fill.' });

  const sans = firstFamily(v['font-sans']);
  const display = firstFamily(v['font-display'] ?? v['font-serif'] ?? v['font-sans']);
  const stackOf = (k) => (v[k] ?? v['font-sans'] ?? 'system-ui, sans-serif').replace(/"/g, "'");
  const families = { sans: stackOf('font-sans'), display: stackOf('font-display') };
  const hosted = [...new Set([sans, display])]
    .filter((x) => x && !SYSTEM.test(x))
    .map((family) => ({ family, href: `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@400;600;800&display=swap` }));
  const px = (s) => (s && /^[\d.]+px$/.test(s) ? s : undefined);
  const radius = [['radius-s', 'radius-sm', 'Chips and small controls.'], ['radius-m', 'radius', 'Cards.'], ['radius-l', 'radius-lg', 'Large panels.']]
    .filter(([, k]) => px(v[k]))
    .map(([name, k, usage]) => ({ name, value: v[k], usage }));
  const shadow = [['raised', 'shadow', 'Cards.'], ['overlay', 'shadow-lg', 'Menus and dialogs.']]
    .filter(([, k]) => v[k])
    .map(([name, k, usage]) => ({ name, value: v[k], usage }));

  const tokens = {
    name: title(id),
    version: 1,
    color: { themes: [{ id: dark ? 'dark' : 'light', name: dark ? 'Dark' : 'Light' }], tokens: c },
    type: {
      fonts: [],
      hosted,
      families,
      groups: [{
        name: 'Text',
        family: 'sans',
        styles: [
          { name: 'title', family: 'display', fontSize: '72px', lineHeight: 1.05, fontWeight: 700, usage: 'Slide titles.' },
          { name: 'heading', family: 'display', fontSize: '40px', lineHeight: 1.15, fontWeight: 600, usage: 'Section headings.' },
          { name: 'body', fontSize: '24px', lineHeight: 1.5, fontWeight: 400, usage: 'Running text.' },
          { name: 'caption', fontSize: '16px', lineHeight: 1.4, fontWeight: 500, usage: 'Labels and captions.' },
        ],
      }],
    },
    spacing: { tokens: [4, 8, 16, 32].map((n, i) => ({ name: `space-${i + 1}`, value: `${n}px`, usage: 'Layout rhythm.' })) },
    radius: { tokens: radius },
    shadow: { tokens: shadow },
  };

  const name = `ppt-${id}`;
  const r = spawnSync(td[0], [...td.slice(1), 'new', 'design-system', name], { env, encoding: 'utf8' });
  if (r.status) { console.error(id, 'new failed', r.stderr || r.stdout); continue; }
  writeFileSync(join(projects, name, 'tokens.json'), JSON.stringify(tokens, null, 2) + '\n');
  writeFileSync(
    join(projects, name, 'README.md'),
    `# ${title(id)}\n\nImported from the \`${id}\` theme of the html-ppt template (MIT, © 2026 lewis), part of OpenDesign's design templates.\nColours, type families, radii and shadows are the theme's own variables; text styles and spacing are generic starting points.\n`,
  );
  results.push({ id, colors: c.length, dropped });
}
console.log(JSON.stringify(results, null, 1));
