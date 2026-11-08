/**
 * The words a design system uses to speak for documents (`.design/doc-design-system.md`): each is an ordinary token of
 * the system's own `tokens.json` (a colour, a text style or a spacing token) whose name starts with `doc-`, so there is
 * no new grammar and a system made by hand, by Claude Code or from a look carries them the same way. A role the system
 * leaves out is derived from its generic roles (`docLookFromSystem`), so a system with none still dresses a doc.
 * `use` is what a token's `usage` says when we write one; `from` names what the role follows when it is not given.
 */
import type { DsTokens, DsTypeStyle } from './designSystem';

export type DocRoleKind = 'color' | 'text' | 'space';

export interface DocRole {
  name: string;
  kind: DocRoleKind;
  use: string;
  /** what an absent role follows: a generic colour role, another doc role, or the doc's own value */
  from: string;
}

export const DOC_ROLES: readonly DocRole[] = [
  { name: 'doc-heading', kind: 'color', use: 'Heading text in a document.', from: 'ink' },
  { name: 'doc-link', kind: 'color', use: 'Links in a document.', from: 'accent' },
  { name: 'doc-quote-bar', kind: 'color', use: 'The bar beside a quote.', from: 'accent' },
  { name: 'doc-quote-bg', kind: 'color', use: 'The ground of a quote; none when absent.', from: 'none' },
  { name: 'doc-code-bg', kind: 'color', use: 'The ground of code blocks and inline code.', from: 'card' },
  { name: 'doc-code-ink', kind: 'color', use: 'Inline code text.', from: 'ink' },
  { name: 'doc-table-head', kind: 'color', use: 'The ground of a table head.', from: 'doc-code-bg' },
  { name: 'doc-mark', kind: 'color', use: 'The ground of highlighted text.', from: 'doc' },
  { name: 'doc-rule', kind: 'color', use: 'Rules and table borders in a document.', from: 'line' },
  { name: 'doc-h1', kind: 'text', use: 'A first-level heading; its weight and line height set every heading.', from: 'doc' },
  { name: 'doc-h2', kind: 'text', use: 'A second-level heading.', from: 'doc' },
  { name: 'doc-h3', kind: 'text', use: 'A third-level heading.', from: 'doc' },
  { name: 'doc-h4', kind: 'text', use: 'A fourth-level heading; the smaller ones follow its size.', from: 'doc-body' },
  { name: 'doc-body', kind: 'text', use: 'Running text: size and line height.', from: 'doc' },
  { name: 'doc-code', kind: 'text', use: 'Code blocks: size and line height.', from: 'doc' },
  { name: 'doc-column', kind: 'space', use: 'Width of the text column.', from: 'doc' },
  { name: 'doc-gap', kind: 'space', use: 'Space between paragraphs.', from: 'doc' },
  { name: 'doc-indent', kind: 'space', use: 'Indent of lists.', from: 'doc' },
];

const px = (v: string | undefined, size = 16): number | null => {
  const m = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec((v ?? '').trim());
  if (!m) return null;
  return m[2] === 'rem' || m[2] === 'em' ? parseFloat(m[1]) * size : parseFloat(m[1]);
};

const within = (n: number | null, lo: number, hi: number): number | null => (n !== null && Number.isFinite(n) && n >= lo && n <= hi ? n : null);

/** The text style the system gives a role, if it has one. */
export function docStyleOf(t: DsTokens, name: string): DsTypeStyle | undefined {
  return t.groups.flatMap((g) => g.styles).find((x) => x.name === name);
}

/** The size of a text role in px (`em` against `base`), only when it is a sensible one. */
export function docSizeOf(t: DsTokens, name: string, lo: number, hi: number, base = 16): number | null {
  return within(px(docStyleOf(t, name)?.fontSize, base), lo, hi);
}

/** The line height of a text role as a multiple of its size: a unitless value is one, a length is divided by `size`. */
export function docLineOf(t: DsTokens, name: string, size: number): number | null {
  const raw = docStyleOf(t, name)?.lineHeight?.trim();
  if (!raw) return null;
  const ratio = /^\d*\.?\d+$/.test(raw) ? parseFloat(raw) : (px(raw, size) ?? 0) / size;
  return within(ratio, 1, 3);
}

/** The weight a text role asks for, 100–900. */
export function docWeightOf(t: DsTokens, name: string): number | null {
  const w = parseInt(docStyleOf(t, name)?.fontWeight ?? '', 10);
  return within(Number.isFinite(w) ? w : null, 100, 900);
}

/** A spacing role in px, only inside `lo`–`hi`. */
export function docSpaceOf(t: DsTokens, name: string, lo: number, hi: number): number | null {
  const tok = t.others.find((f) => f.key === 'spacing')?.tokens.find((x) => x.name === name);
  return within(px(tok?.value), lo, hi);
}

/** A colour role's value in a theme (the first theme's when the token has none for it). */
export function docColourOf(t: DsTokens, name: string, themeId: string): string | undefined {
  const c = t.colors.find((x) => x.name === name);
  return c ? (c.values[themeId] ?? Object.values(c.values)[0]) : undefined;
}

/** Whether the system gives this role itself (a token of that name exists and reads). */
export function docRoleGiven(t: DsTokens, role: DocRole, themeId: string): boolean {
  if (role.kind === 'color') return docColourOf(t, role.name, themeId) !== undefined;
  if (role.kind === 'text') return docStyleOf(t, role.name) !== undefined;
  return t.others.find((f) => f.key === 'spacing')?.tokens.some((x) => x.name === role.name) ?? false;
}
