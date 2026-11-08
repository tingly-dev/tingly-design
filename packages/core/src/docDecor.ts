/**
 * What a design system says about how a document's elements are dressed beyond values (`.design/doc-design-system.md`):
 * a heading with a bar beside it, a picture in a photograph's white frame, a rule in a dashed line. It sits in the
 * system's own `tokens.json` as a family named `doc` whose tokens are named for the element and hold a list of CSS
 * declarations, e.g. `{ "name": "h1", "value": "border-left: 6px solid {accent}; padding-left: 12px" }`.
 * `{name}` is a colour (or spacing) token of the system, the same alias writing tokens.json uses, filled in for the
 * theme the doc wears, so the declarations follow the theme and carry no `var()`.
 *
 * The editor's page, the HTML / PDF / PNG exports and the WeChat article all apply the same declarations, so only
 * properties that every one of them keeps are allowed (`box-sizing` among them, so a frame round a picture stays inside the column): no shadows, positioning, floats, flex, grid or transforms
 * (the platform drops them), no pictures by address and no `var()`. What is not allowed is dropped with a reason,
 * like any other token that cannot be read.
 */
export const DOC_ELEMENTS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'quote', 'code', 'pre', 'img', 'hr', 'table', 'th', 'td', 'a', 'ul', 'ol', 'li', 'mark', 'strong'] as const;
export type DocElement = (typeof DOC_ELEMENTS)[number];

/** The tag each element is written on. */
export const DOC_TAG: Record<DocElement, string> = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  h5: 'h5',
  h6: 'h6',
  p: 'p',
  quote: 'blockquote',
  code: 'code',
  pre: 'pre',
  img: 'img',
  hr: 'hr',
  table: 'table',
  th: 'th',
  td: 'td',
  a: 'a',
  ul: 'ul',
  ol: 'ol',
  li: 'li',
  mark: 'mark',
  strong: 'strong',
};

export function isDocElement(name: string): name is DocElement {
  return (DOC_ELEMENTS as readonly string[]).includes(name);
}

/** One element's declarations as the system wrote them (`{token}` aliases still in). */
export interface DocDecor {
  element: DocElement;
  css: string;
  usage?: string;
}

/** The properties a declaration may set: what the editor's page, the exports and the platform's editor all keep. */
const PROPS = new Set([
  'color', 'background-color', 'background',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-width', 'border-style', 'border-color',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-radius', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'font-size', 'font-weight', 'font-style', 'letter-spacing', 'line-height', 'text-align', 'text-indent', 'text-decoration', 'text-transform',
  'width', 'max-width', 'display', 'list-style-type', 'box-sizing',
]);

const VALUE_RE = /^[A-Za-z0-9 #%(),./+_{}-]{1,120}$/;
const DISPLAY = new Set(['block', 'inline', 'inline-block']);
const BOX = new Set(['border-box', 'content-box']);

/**
 * The declarations of one value, kept in the written order and written the same way (`prop:value;`). Each one that
 * cannot be kept is named in `dropped` with the reason, so the page can say why.
 */
export function parseDocDecls(raw: string): { css: string; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const part of raw.split(';')) {
    const text = part.trim();
    if (!text) continue;
    const at = text.indexOf(':');
    const prop = at > 0 ? text.slice(0, at).trim().toLowerCase() : '';
    const value = at > 0 ? text.slice(at + 1).trim() : '';
    if (!PROPS.has(prop)) dropped.push(`"${prop || text}" is not a property a document keeps (the platform drops the others)`);
    else if (!VALUE_RE.test(value) || /url\(|var\(|expression|!important|@/i.test(value)) dropped.push(`"${prop}: ${value.slice(0, 40)}" is not a plain value (no url(), var(), !important)`);
    else if (prop === 'display' && !DISPLAY.has(value)) dropped.push(`"display: ${value}" is not block, inline or inline-block`);
    else if (prop === 'box-sizing' && !BOX.has(value)) dropped.push(`"box-sizing: ${value}" is not border-box or content-box`);
    else kept.push(`${prop}:${value}`);
  }
  return { css: kept.join(';'), dropped };
}

/** The `{name}` aliases in declarations. */
export function docDeclAliases(css: string): string[] {
  return [...css.matchAll(/\{\s*([A-Za-z0-9][A-Za-z0-9_.-]{0,63})\s*\}/g)].map((m) => m[1]);
}

/**
 * The declarations with each `{name}` filled in by `resolve` (a colour in the theme, a length). A declaration with a name
 * `resolve` does not know is left out, so a missing token never draws as the word in braces.
 */
export function resolveDocDecls(css: string, resolve: (name: string) => string | undefined): string {
  const out: string[] = [];
  for (const decl of css.split(';')) {
    if (!decl) continue;
    let ok = true;
    const filled = decl.replace(/\{\s*([A-Za-z0-9][A-Za-z0-9_.-]{0,63})\s*\}/g, (_, name: string) => {
      const v = resolve(name);
      if (v === undefined) ok = false;
      return v ?? '';
    });
    if (ok) out.push(filled);
  }
  return out.join(';');
}
