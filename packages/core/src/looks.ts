import { LOOK_DATA } from './looks.data';

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
  families: { sans: string; display: string };
  /** Families to load from Google Fonts. */
  hosted: string[];
  /** Small, medium, large; a theme that gives no length leaves its slot out. */
  radius: (string | null)[];
  /** Raised cards, overlays. */
  shadow: (string | null)[];
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
          hosted: look.hosted.map((family) => ({ family, href: `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@400;600;800&display=swap` })),
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
        radius: { tokens: pick(['radius-s', 'radius-m', 'radius-l'], look.radius, ['Chips and small controls.', 'Cards.', 'Large panels.']) },
        shadow: { tokens: pick(['raised', 'overlay'], look.shadow, ['Cards.', 'Menus and dialogs.']) },
      },
      null,
      2,
    ) + '\n'
  );
}
