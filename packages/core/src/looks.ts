import { LOOK_BASE_CSS, LOOK_DATA } from './looks.data';

/**
 * Looks: ready-made starting points for a new design system, in groups by what they feel like. A look
 * is the colours, type families, radii and shadows of one theme from html-ppt (MIT, © 2026 lewis, in
 * nexu-io/open-design); `scripts/import-looks.mjs` regenerates `looks.data.ts` from it. To add or retire
 * one, change the script's groups and give its name in @dc/i18n (`ds.look.<id>`; the group is
 * `ds.lookGroup.<group>`); nothing else.
 */
export const LOOK_GROUPS = ['clean', 'editorial', 'bold', 'tech', 'palette'] as const;
export type LookGroup = (typeof LOOK_GROUPS)[number];

export interface LookData {
  id: string;
  group: LookGroup;
  dark: boolean;
  colors: Record<string, string>;
  families: { sans: string; display: string; serif: string; mono: string };
  /** Families to load from Google Fonts, each with the link (and weights) html-ppt loads it by. */
  hosted: { family: string; href: string }[];
  /** Small, medium, large; a theme that gives no length leaves its slot out. */
  radius: (string | null)[];
  /** Raised cards, overlays. */
  shadow: (string | null)[];
  /** html-ppt variables that are not tokens (gradients, letter spacing, easing), by name without `--`. */
  vars: Record<string, string>;
  /** The theme's own rules, on `lk-` classes and our token names. */
  css: string;
}

export const LOOKS: readonly LookData[] = LOOK_DATA;

export function lookOf(id: string): LookData | undefined {
  return LOOKS.find((l) => l.id === id);
}

const COLOUR_USAGE: Record<string, string> = {
  surface: 'Page background.',
  'surface-soft': 'Quiet panels.',
  'surface-raised': 'Cards and panels.',
  'surface-raised-2': 'Nested cards.',
  line: 'Hairlines and card borders.',
  'line-strong': 'Emphasised borders.',
  ink: 'Primary text, on surface, surface-soft and surface-raised.',
  'ink-muted': 'Secondary text, on surface and surface-raised.',
  'ink-faint': 'Captions and labels, on surface; large text only.',
  accent: 'Primary accent: links, key numbers, rules.',
  'accent-2': 'Second accent for charts and highlights.',
  'accent-3': 'Third accent, used sparingly.',
  good: 'Positive status.',
  warn: 'Caution status.',
  bad: 'Negative status.',
  'on-accent': 'Text on an accent fill.',
};

/** tokens.json for a new system that starts from `look`: its colours (one theme), families, radii and shadows, plus the generic text styles and spacing. */
export function lookTokens(look: LookData, name: string): string {
  const pick = <T,>(names: string[], values: (T | null)[], usage: string[]) =>
    names.flatMap((n, i) => (values[i] ? [{ name: n, value: values[i], usage: usage[i] }] : []));
  return (
    JSON.stringify(
      {
        name,
        version: 1,
        color: {
          themes: [look.dark ? { id: 'dark', name: 'Dark' } : { id: 'light', name: 'Light' }],
          tokens: Object.entries(look.colors).map(([n, value]) => ({ name: n, value, usage: COLOUR_USAGE[n] ?? '' })),
        },
        type: {
          fonts: [],
          hosted: look.hosted,
          families: look.families,
          groups: [
            {
              name: 'Text',
              family: 'sans',
              styles: [
                { name: 'title', family: 'display', fontSize: '72px', lineHeight: 1.05, fontWeight: 700, usage: 'Slide titles.' },
                { name: 'heading', family: 'display', fontSize: '40px', lineHeight: 1.15, fontWeight: 600, usage: 'Section headings.' },
                { name: 'body', fontSize: '24px', lineHeight: 1.5, fontWeight: 400, usage: 'Running text.' },
                { name: 'caption', fontSize: '16px', lineHeight: 1.4, fontWeight: 500, usage: 'Labels and captions.' },
              ],
            },
          ],
        },
        spacing: { tokens: [4, 8, 16, 32].map((n, i) => ({ name: `space-${i + 1}`, value: `${n}px`, usage: 'Layout rhythm.' })) },
        // a theme that gives no radius at all draws square corners
        radius: { tokens: pick(['radius-s', 'radius-m', 'radius-l'], look.radius.some(Boolean) ? look.radius : ['0px', '0px', '0px'], ['Chips and small controls.', 'Cards.', 'Large panels.']) },
        shadow: { tokens: pick(['raised', 'overlay'], look.shadow, ['Cards.', 'Menus and dialogs.']) },
      },
      null,
      2,
    ) + '\n'
  );
}

/** The words a look's components show: their READMEs and the sample text in their previews, in the creator's language. */
export const LOOK_KIT_WORDS = [
  'groupText', 'groupSurfaces', 'groupLabels',
  'readmeTitle', 'readmeKicker', 'readmeCard', 'readmePill', 'readmeDivider',
  'titleSample', 'titleSampleAccent', 'kickerSample', 'eyebrowSample', 'ledeSample',
  'cardDefault', 'cardSoft', 'cardOutline', 'cardAccent', 'cardBody',
  'pillSample', 'pillAccentSample',
  'coverKicker', 'coverLede', 'coverPalette', 'coverKpi', 'coverKpiValue', 'coverKpiCaption', 'coverNote', 'coverNoteBody',
  'coverPillTokens', 'coverPillPrimary', 'coverPillRadius', 'coverPillShadow',
] as const;
export type LookKitWord = (typeof LOOK_KIT_WORDS)[number];

const COMPONENTS = ['Title', 'Kicker', 'Card', 'Pill', 'Divider'] as const;

const html = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
// a word inside the preview marker's quotes
const attr = (s: string) => `"${s.replace(/["<>]/g, '')}"`;
// a string as a JavaScript literal inside a preview's script; `</script` can never close it
const js = (s: string) => JSON.stringify(s).replace(/</g, '\\u003c');

const preview = (marker: string, body: string) =>
  `<!-- @dsCard ${marker} -->\n<!doctype html>\n<html>\n<head><meta charset="utf-8"></head>\n<body>\n${body}\n</body>\n</html>\n`;

/**
 * A look's components, as the files of a design system's `components/` folder: html-ppt's typography,
 * cards, pills and dividers with the theme's own rules on top (bundle.css), five small components that
 * draw them (bundle.js, index.d.ts), a README and a preview each, and a cover that is html-ppt's own demo
 * slide in this look. `words` is the visible text, in the language of whoever creates the system.
 */
export function lookKit(look: LookData, namespace: string, title: string, words: Record<LookKitWord, string>): Record<string, string> {
  const w = words;
  const css =
    `/* ${look.id}: html-ppt (MIT, (c) 2026 lewis) base.css components and theme rules, on this system's tokens */\n` +
    `:root{${Object.entries(look.vars).map(([k, v]) => `--${k}:${v}`).join(';')}}\n` +
    // html-ppt sizes every box border-box; a look's page is a slide drawn in place, not positioned by a deck;
    // these come first so the theme's own rules (a page's padding, say) win
    '[class*="lk-"],[class*="lk-"] *{box-sizing:border-box}\n' +
    '.lk-page{position:relative;overflow:hidden;padding:72px 96px;display:flex;flex-direction:column;justify-content:center}\n' +
    '.lk-stage{padding:24px;display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}\n' +
    '.lk-stage>.lk-card{flex:1 1 160px;min-width:160px}\n' +
    `${LOOK_BASE_CSS}\n${look.css}\n`;
  const bundle = `/* @ds-bundle: ${JSON.stringify({ format: 4, namespace, components: COMPONENTS.map((name) => ({ name })) })} */
(function () {
  // No React: each component returns an element. Text goes in as text, never as HTML.
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  window.${namespace} = {
    Title: function (p) {
      var h = el(p.level === 2 ? 'h2' : 'h1', p.level === 2 ? 'lk-h2' : 'lk-h1', p.text);
      if (p.accent) { h.appendChild(document.createTextNode(' ')); h.appendChild(el('span', 'lk-gradient-text', p.accent)); }
      return h;
    },
    Kicker: function (p) { return el('p', p.quiet ? 'lk-eyebrow' : 'lk-kicker', p.text); },
    Card: function (p) {
      var c = el('div', 'lk-card' + (p.variant && p.variant !== 'default' ? ' lk-card-' + p.variant : ''));
      if (p.title) c.appendChild(el('h4', '', p.title));
      if (p.body) c.appendChild(el('p', 'lk-dim', p.body));
      return c;
    },
    Pill: function (p) { return el('span', 'lk-pill' + (p.accent ? ' lk-pill-accent' : ''), p.label); },
    Divider: function (p) { return el('div', p.accent ? 'lk-divider-accent' : 'lk-divider'); },
  };
})();
`;
  const types = `export interface TitleProps { text: string; accent?: string; level?: 1 | 2 }
export interface KickerProps { text: string; quiet?: boolean }
export interface CardProps { title?: string; body?: string; variant?: 'default' | 'soft' | 'outline' | 'accent' }
export interface PillProps { label: string; accent?: boolean }
export interface DividerProps { accent?: boolean }
`;
  const N = namespace;
  const swatch = ['accent', 'accent-2', 'accent-3', 'ink', 'surface-raised-2']
    .map((c) => `<i style="display:block;width:44px;height:44px;border-radius:var(--radius-s);border:1px solid var(--line);background:var(--${c})"></i>`)
    .join('');
  const cover = `<!-- @dsCard height=640 -->
<!doctype html>
<html>
<head><meta charset="utf-8">
<style>
  body { margin: 0; }
  .cv { min-height: 640px; }
  .cv .lk-h1 { margin-top: 12px; }
  .cv .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 28px; }
  .cv .kpi { font-family: var(--font-display); font-size: 44px; font-weight: 800; line-height: 1.1; margin: 4px 0 8px; }
  .cv .pills { display: flex; gap: 8px; margin-top: 20px; }
</style>
</head>
<body>
<div class="lk-page cv">
  <p class="lk-kicker">${html(w.coverKicker)}</p>
  <h1 class="lk-h1">${html(title)}</h1>
  <p class="lk-lede">${html(w.coverLede)}</p>
  <div class="grid">
    <div class="lk-card"><h4>${html(w.coverPalette)}</h4><div style="display:flex;gap:10px;margin-top:12px">${swatch}</div></div>
    <div class="lk-card"><h4>${html(w.coverKpi)}</h4><p class="kpi lk-gradient-text">${html(w.coverKpiValue)}</p><p class="lk-dim">${html(w.coverKpiCaption)}</p></div>
    <div class="lk-card lk-card-accent"><h4>${html(w.coverNote)}</h4><p class="lk-dim">${html(w.coverNoteBody)}</p></div>
  </div>
  <div class="pills"><span class="lk-pill">${html(w.coverPillTokens)}</span><span class="lk-pill lk-pill-accent">${html(w.coverPillPrimary)}</span><span class="lk-pill">${html(w.coverPillRadius)}</span><span class="lk-pill">${html(w.coverPillShadow)}</span></div>
</div>
</body>
</html>
`;
  const stage = (script: string) => `<div id="root" class="lk-stage"></div>\n<script>\n  var root = document.getElementById('root');\n${script}\n</script>`;
  const card = (marker: string, script: string) => preview(marker, stage(script));
  const files: Record<string, string> = {
    'components/bundle.css': css,
    'components/bundle.js': bundle,
    'components/index.d.ts': types,
    'components/Cover/preview.html': cover,
    'components/Title/README.md': `# Title\n\n${w.readmeTitle}\n`,
    'components/Title/preview.html': card(
      `group=${attr(w.groupText)} height=220`,
      `  root.style.display = 'block';\n  root.appendChild(${N}.Title({ text: ${js(w.titleSample)}, accent: ${js(w.titleSampleAccent)} }));\n  root.appendChild(${N}.Title({ text: ${js(w.titleSample)}, level: 2 }));`,
    ),
    'components/Kicker/README.md': `# Kicker\n\n${w.readmeKicker}\n`,
    'components/Kicker/preview.html': card(
      `group=${attr(w.groupText)} height=150`,
      `  root.style.display = 'block';\n  root.appendChild(${N}.Kicker({ text: ${js(w.kickerSample)} }));\n  root.appendChild(${N}.Kicker({ text: ${js(w.eyebrowSample)}, quiet: true }));\n  var lede = document.createElement('p'); lede.className = 'lk-lede'; lede.textContent = ${js(w.ledeSample)}; root.appendChild(lede);`,
    ),
    'components/Card/README.md': `# Card\n\n${w.readmeCard}\n`,
    'components/Card/preview.html': card(
      `group=${attr(w.groupSurfaces)} height=220`,
      `  [['default', ${js(w.cardDefault)}], ['soft', ${js(w.cardSoft)}], ['outline', ${js(w.cardOutline)}], ['accent', ${js(w.cardAccent)}]].forEach(function (c) { root.appendChild(${N}.Card({ title: c[1], body: ${js(w.cardBody)}, variant: c[0] })); });`,
    ),
    'components/Pill/README.md': `# Pill\n\n${w.readmePill}\n`,
    'components/Pill/preview.html': card(
      `group=${attr(w.groupLabels)} height=88`,
      `  root.appendChild(${N}.Pill({ label: ${js(w.pillSample)} }));\n  root.appendChild(${N}.Pill({ label: ${js(w.pillAccentSample)}, accent: true }));`,
    ),
    'components/Divider/README.md': `# Divider\n\n${w.readmeDivider}\n`,
    'components/Divider/preview.html': card(
      `group=${attr(w.groupLabels)} height=100`,
      `  root.style.display = 'block';\n  root.appendChild(${N}.Divider({}));\n  var gap = document.createElement('div'); gap.style.height = '24px'; root.appendChild(gap);\n  root.appendChild(${N}.Divider({ accent: true }));`,
    ),
  };
  return files;
}
