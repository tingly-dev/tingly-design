/**
 * Inline style text, edited as text.
 *
 * Style attributes in templates may contain holes (`background:{{r.bg}}`),
 * which a browser's CSSOM would throw away. So styles are never round-tripped
 * through `element.style`: declarations are split as text, the one that changes
 * is rewritten, and everything else is kept byte for byte.
 */

export interface StyleDecl {
  prop: string;
  value: string;
  /** Exact original text of this declaration (between semicolons). */
  raw: string;
}

/** Split on `;` outside parentheses, quotes and `{{ }}` holes. */
function splitDecls(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || (c === '{' && text[i + 1] === '{')) depth++;
    else if (c === ')' || (c === '}' && text[i + 1] === '}')) depth = Math.max(0, depth - 1);
    else if (c === ';' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

export function parseStyle(text: string): StyleDecl[] {
  return splitDecls(text ?? '')
    .map((raw) => {
      const i = raw.indexOf(':');
      if (i < 0) return { prop: '', value: raw.trim(), raw };
      return { prop: raw.slice(0, i).trim().toLowerCase(), value: raw.slice(i + 1).trim(), raw };
    })
    .filter((d) => d.raw.trim() !== '');
}

export function hasHoleValue(v: string): boolean {
  return /\{\{[^}]*\}\}/.test(v);
}

/** The name in `prop: {{name}}` when that is the whole winning declaration (a value the template takes from a hole). */
export function styleHole(text: string, prop: string): string | null {
  const v = getStyle(text, prop);
  return v === undefined ? null : (/^\{\{\s*([A-Za-z_$][\w$]*)\s*\}\}$/.exec(v)?.[1] ?? null);
}

/** Last declaration of `prop` (the one that wins), as written. */
export function getStyle(text: string, prop: string): string | undefined {
  const p = prop.toLowerCase();
  const decls = parseStyle(text).filter((d) => d.prop === p);
  return decls.length ? decls[decls.length - 1].value : undefined;
}

export function kebab(prop: string): string {
  if (prop.startsWith('--')) return prop;
  return prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
}

/**
 * Set (or remove, with `value === null`) one declaration.
 * A declaration whose value is a hole stays as written; a literal one added
 * after it wins, which keeps the template's setting intact.
 */
export function setStyle(text: string, prop: string, value: string | null): string {
  const p = kebab(prop);
  const parts = splitDecls(text ?? '');
  const spaced = /:\s/.test(text ?? '') || !(text ?? '').trim();
  const fresh = value === null ? null : spaced ? `${p}: ${value}` : `${p}:${value}`;

  // find the last literal (non-hole) declaration of the property
  let idx = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    const raw = parts[i];
    const c = raw.indexOf(':');
    if (c < 0) continue;
    if (raw.slice(0, c).trim().toLowerCase() !== p) continue;
    if (hasHoleValue(raw.slice(c + 1))) continue;
    idx = i;
    break;
  }
  if (idx >= 0) {
    if (fresh === null) parts.splice(idx, 1);
    else {
      const lead = /^\s*/.exec(parts[idx])![0];
      parts[idx] = lead + fresh;
    }
  } else if (fresh !== null) {
    // drop a trailing empty segment ("a:b;") before appending
    while (parts.length && !parts[parts.length - 1].trim()) parts.pop();
    const lead = parts.length && spaced ? ' ' : '';
    parts.push(lead + fresh);
  } else {
    return text;
  }
  let out = parts.filter((s, i) => s.trim() || i === parts.length - 1).join(';');
  if ((text ?? '').trim().endsWith(';') && out.trim() && !out.trim().endsWith(';')) out += ';';
  return out.trim() === ';' ? '' : out;
}

/** CSS property name to React style key. */
export function camelProp(prop: string): string {
  if (prop.startsWith('--')) return prop;
  const p = prop.startsWith('-ms-') ? prop.slice(1) : prop;
  return p.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Inline style text (holes already filled) to a React style object. */
export function styleObject(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of parseStyle(text)) {
    if (!d.prop) continue;
    const important = /!\s*important\s*$/i.test(d.value);
    out[camelProp(d.prop)] = important ? d.value.replace(/!\s*important\s*$/i, '').trim() : d.value;
  }
  return out;
}
