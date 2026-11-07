/**
 * The text colours a doc can carry. A coloured phrase is written in the tab's Markdown as an inline span,
 * `<span data-color="red">words</span>`, so any Markdown reader still shows the words. The name is the
 * contract (the editor, Claude Code and the exports share it); the colour is the reader's: the editor draws
 * each name with a theme token that holds in dark mode, and a standalone export uses the light value here.
 */
export const DOC_COLORS = {
  red: '#c62828',
  orange: '#b45309',
  green: '#1f7a43',
  blue: '#2f6fed',
  purple: '#6d4fd8',
  gray: '#64748b',
} as const;

/** The same names on a dark page (the editor's dark tokens): the light values are too dark to read there. */
export const DOC_COLORS_ON_DARK: Record<keyof typeof DOC_COLORS, string> = {
  red: '#ff8a80',
  orange: '#fb9a4b',
  green: '#4ade80',
  blue: '#7aa5ff',
  purple: '#a78bfa',
  gray: '#9aa4b2',
};

export type DocColor = keyof typeof DOC_COLORS;

export const DOC_COLOR_NAMES = Object.keys(DOC_COLORS) as DocColor[];

export function isDocColor(name: unknown): name is DocColor {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(DOC_COLORS, name);
}

/** The stylesheet a standalone page (HTML, PDF, PNG export) needs to draw the coloured spans. */
export function docColorCss(colors: Record<DocColor, string> = DOC_COLORS): string {
  return (Object.entries(colors) as [DocColor, string][]).map(([name, hex]) => `span[data-color="${name}"]{color:${hex}}`).join('');
}
