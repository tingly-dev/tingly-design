/**
 * The "Consuming this system" appendix of a design system's README: what an agent
 * (or a person) needs to use the tokens without reading tokens.json: which
 * stylesheet to link and where, the variable per colour and theme, ramps, font
 * families and the text styles with their values. Generated from tokens.json
 * (the server rewrites it with tokens.css), kept between two comment markers at
 * the end of README.md. It is written for models, so it is English like the
 * other model-facing text.
 */
import { DS_TOKENS_CSS, cssVar, type DsColor, type DsTokens } from './designSystem';

export const GUIDE_HEADING = '## Consuming this system (generated — do not edit)';
const BEGIN = '<!-- consuming-this-system:begin -->';
const END = '<!-- consuming-this-system:end -->';

/** Interaction states are listed apart from the colours they modify. */
const STATE_RE = /-(hover|active|pressed|focus|focused|disabled|selected|visited)$/;
const RAMP_RE = /^(.+?)-(\d{2,4})$/;

const cell = (s: string | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const code = (s: string) => '`' + s.replace(/`/g, '') + '`';
const table = (head: string[], rows: string[][]) =>
  [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');

/** Colour tokens named `<ramp>-<step>` (three or more with the same ramp) in step order. */
function ramps(colors: DsColor[]): { ramp: string; steps: DsColor[] }[] {
  const by = new Map<string, DsColor[]>();
  for (const c of colors) {
    const m = RAMP_RE.exec(c.name);
    if (m) by.set(m[1], [...(by.get(m[1]) ?? []), c]);
  }
  return [...by.entries()]
    .filter(([, v]) => v.length >= 3)
    .map(([ramp, steps]) => ({ ramp, steps: steps.sort((a, b) => Number(RAMP_RE.exec(a.name)![2]) - Number(RAMP_RE.exec(b.name)![2])) }));
}

/** The appendix, from the begin marker to the end marker. `tokens.css` exists whenever this is written (the server rebuilds both together). */
export function consumingGuide(t: DsTokens): string {
  const first = t.themes[0].id;
  const themed = t.themes.length > 1;
  const out: string[] = [BEGIN, GUIDE_HEADING, ''];
  out.push('Written from `tokens.json` each time it changes: change a value there, never here or in `tokens.css`.', '');

  out.push('### Use it', '');
  out.push(
    '- A page: `<link rel="stylesheet" href="tokens.css">` (the path from the page to this system\'s `tokens.css`). It defines every colour, spacing, radius and shadow as a custom property, `--font-<key>` for each family, a class per text style, and the `@font-face` rules.',
    '- A canvas artboard or a slide cannot link a stylesheet (its frame loads only inline styles and Google Fonts), so there write each value from the tables below; to keep the variables, copy the `:root { … }` blocks of `tokens.css` into the artboard\'s `<helmet><style>`. A canvas or deck that installed this system also has its `tokens.json` at `ds/<folder>/tokens.json`.',
    '- Where `var()` cannot go (a chart\'s options, an SVG attribute such as `fill` which not every browser reads `var()` in), write the value from the tables below.',
  );
  if (themed) {
    out.push(
      `- Themes: ${t.themes.map((th) => code(th.id)).join(', ')}. ${code(first)} is the default (\`:root\`). For another theme put \`data-theme="<id>"\` on the element that wraps the page; the variables change, and the tables give each theme's value for the places a variable cannot go.`,
    );
  } else {
    out.push(`- One theme, ${code(first)}.`);
  }
  out.push('');

  if (t.colors.length) {
    const ramped = new Set(ramps(t.colors).flatMap((r) => r.steps.map((s) => s.name)));
    const states = t.colors.filter((c) => !ramped.has(c.name) && STATE_RE.test(c.name));
    const plain = t.colors.filter((c) => !ramped.has(c.name) && !STATE_RE.test(c.name));
    const vals = (c: DsColor) => t.themes.map((th) => code(c.values[th.id] ?? c.values[first] ?? ''));
    // with one theme and a variable the CSS column already holds the value as its fallback
    const valueCols = themed;
    const head = ['token', 'CSS', ...(valueCols ? t.themes.map((th) => th.name || th.id) : []), 'use'];
    const row = (c: DsColor) => [code(c.name), code(`var(${cssVar(c.name)}, ${c.values[first]})`), ...(valueCols ? vals(c) : []), c.usage ?? ''];
    out.push('### Colours', '');
    out.push(`Write a colour as ${code(`color: var(${cssVar(t.colors[0].name)}, ${t.colors[0].values[first]})`)}: the variable first, the ${code(first)} value as the fallback, both from the same row.`, '');
    if (plain.length) out.push(table(head, plain.map(row)), '');
    if (states.length) out.push('Interaction states:', '', table(head, states.map(row)), '');
    for (const r of ramps(t.colors)) {
      const step = (x: DsColor) => RAMP_RE.exec(x.name)![2];
      const differs = themed && r.steps.some((x) => t.themes.some((th) => x.values[th.id] !== x.values[first]));
      const line = (th: string) => r.steps.map((x) => `${step(x)} ${code(x.values[th] ?? x.values[first] ?? '')}`).join(', ');
      out.push(
        `Ramp ${code(r.ramp)}, variables ${code(`--${r.ramp.replace(/\./g, '\\.')}-<step>`)}:`,
        ...(differs ? t.themes.map((th) => `- ${th.name || th.id}: ${line(th.id)}`) : [`- ${line(first)}`]),
        '',
      );
    }
  }

  const styles = t.groups.flatMap((g) => g.styles.map((s) => ({ s, g })));
  if (styles.length || Object.keys(t.families).length) {
    out.push('### Type', '');
    out.push('Set text in one of the styles below: give the element the class (a style `body` is `class="body"`), or write the values from the Styles table. No literal sizes of your own.', '');
    const fams = Object.entries(t.families);
    if (fams.length) {
      out.push('Families:', '', table(['family', 'CSS variable', 'stack'], fams.map(([k, v]) => [code(k), code(`var(--font-${k})`), code(v)])), '');
    }
    if (styles.length) {
      out.push(
        'Styles:',
        '',
        table(
          ['style', 'CSS', 'family', 'size', 'line height', 'weight', 'italic', 'letter spacing', 'use'],
          styles.map(({ s, g }) => {
            const fam = s.family ?? g.family;
            return [code(s.name), code(`.${s.name.replace(/\./g, '\\.')}`), fam ? code(fam) : '', code(s.fontSize), s.lineHeight ?? '', s.fontWeight ?? '', s.fontStyle === 'italic' ? 'yes' : '', s.letterSpacing ?? '', s.usage ?? ''];
          }),
        ),
        '',
      );
    }
    if (t.fonts.length || t.hosted.length) {
      out.push('Faces:', '');
      for (const f of t.fonts) {
        out.push(`- ${code(f.family)}${f.weight ? ` ${f.weight}` : ''}${f.style ? ` ${f.style}` : ''}: ${code(f.file)}${/\.ttc$/i.test(f.file) ? ' (a font collection: kept as a file, browsers do not load a collection in `@font-face`; install it on the machine that draws the page or convert a member to woff2)' : ''}`);
      }
      for (const h of t.hosted) out.push(`- ${code(h.family)}: Google Fonts, loaded by \`tokens.css\` (${h.href})`);
      out.push('');
    }
  }

  for (const f of t.others) {
    if (!f.tokens.length) continue;
    const shadow = f.key === 'shadow';
    out.push(`### ${f.title}`, '');
    if (f.note) out.push(f.note, '');
    out.push(
      table(
        ['token', 'CSS', shadow && themed ? `value (${first})` : 'value', 'use'],
        f.tokens.map((x) => [code(x.name), code(`var(${cssVar(x.name)})`), code(shadow ? (x.values?.[first] ?? x.value) : x.value), x.usage ?? '']),
      ),
      '',
    );
  }
  out.push(`${code(DS_TOKENS_CSS)} is the stylesheet; it never needs editing.`, '');
  out.push(END);
  return out.join('\n');
}

/** `readme` with the appendix replaced (between its markers) or appended; unchanged text keeps its bytes. */
export function withConsumingGuide(readme: string, guide: string): string {
  // the appendix is the last thing in the file: a marker quoted in the brand book above it is not the one
  const b = readme.lastIndexOf(END);
  const a = b >= 0 ? readme.lastIndexOf(BEGIN, b) : -1;
  if (a >= 0) return readme.slice(0, a) + guide + readme.slice(b + END.length);
  return readme.replace(/\s*$/, '') + '\n\n' + guide + '\n';
}
