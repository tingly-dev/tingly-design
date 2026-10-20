import { parseDoc, tabOrder } from './docs';

/**
 * A doc as one Markdown file for reading and sharing outside the editor. A tab's source
 * (`tabs/<id>.md`) is written to be edited, so joined as it is it reads badly: every tab keeps
 * its own `# Title`, the doc's title is nowhere, pictures point at `../assets/…` and the
 * editor's `==highlight==` is not Markdown anyone else reads. So:
 *
 *   - the doc's title is the one `#`; each tab is a `##` section (a subtab `###`) and the tab's
 *     own headings move under it, deeper by the same amount (capped at `######`);
 *   - a tab's leading `# Title` is its section heading, not repeated; a tab without one gets its
 *     title from the index. A first tab titled like the doc is its introduction: the title is
 *     the doc's `#` already, so the tab adds no heading of its own;
 *   - local pictures lose the `../` so they resolve from the file's own folder (`assets/x.png`),
 *     and are returned in `images` for the caller to put beside the file;
 *   - `==text==` becomes `<mark>text</mark>`; code spans and fenced blocks are left untouched;
 *   - comments are other people's remarks about the doc, not its text, and are not exported.
 *
 * Nothing is rewritten otherwise: the author's list markers, table padding and line breaks stay.
 */

export interface DocMarkdown {
  markdown: string;
  /** project-relative paths of the local pictures the text points at (`assets/x.png`) */
  images: string[];
}

const LOCAL = /^(?:\.\.\/)?((?:assets|uploads)\/[^)\s"'>]+)/;
/** A fence, also one opening a list item or inside a quote (`- ```bash`, `> ````); any indent closes it. */
const FENCE = /^(?:[ \t>]*(?:[-*+]|\d{1,9}[.)])[ \t]+)*[ \t>]*(`{3,}|~{3,})/;

/** Runs `fn` over the lines outside fenced code blocks, handing it each line's text. */
function mapOutsideCode(source: string, fn: (line: string) => string): string {
  let fence: string | null = null;
  return source
    .split('\n')
    .map((line) => {
      const m = FENCE.exec(line);
      if (fence) {
        if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !line.slice(m[0].length).trim()) fence = null;
        return line;
      }
      if (m) {
        fence = m[1];
        return line;
      }
      return fn(line);
    })
    .join('\n');
}

/** Applies `fn` to the parts of a line that are not inline code spans. */
function outsideSpans(line: string, fn: (text: string) => string): string {
  return line
    .split(/(`+[^`]*`+)/)
    .map((part, i) => (i % 2 ? part : fn(part)))
    .join('');
}

function shiftHeadings(source: string, by: number): string {
  if (!by) return source;
  return mapOutsideCode(source, (line) => line.replace(/^( {0,3})(#{1,6})(?=\s|$)/, (_m, sp: string, h: string) => sp + '#'.repeat(Math.min(6, h.length + by))));
}

/** The shallowest heading level outside code (7 when there is none). */
function topLevel(source: string): number {
  let top = 7;
  mapOutsideCode(source, (line) => {
    const m = /^ {0,3}(#{1,6})(?=\s|$)/.exec(line);
    if (m) top = Math.min(top, m[1].length);
    return line;
  });
  return top;
}

function tidy(source: string, images: Set<string>): string {
  const take = (src: string) => {
    const m = LOCAL.exec(src);
    if (!m) return src;
    const path = m[1].replace(/[?#].*$/, '');
    // a stray % (`50%off.png`) is the path as written
    let decoded = path;
    try {
      decoded = decodeURI(path);
    } catch {}
    images.add(decoded);
    return src.replace(LOCAL, '$1');
  };
  return mapOutsideCode(source, (line) =>
    outsideSpans(line, (text) =>
      text
        .replace(/(!\[[^\]]*\]\()([^)\s]+)/g, (_m, pre: string, src: string) => pre + take(src))
        .replace(/(<img\b[^>]*?\bsrc=["'])([^"']+)/gi, (_m, pre: string, src: string) => pre + take(src))
        .replace(/==(?=\S)([^=]+?)(?<=\S)==/g, '<mark>$1</mark>'),
    ),
  );
}

/** The first line of a tab if it is its `# Title` (after blank lines): the heading text and what follows it. */
function leadTitle(source: string): { title: string; rest: string } | null {
  // a closing run of # only after a space: `# C#` is titled C#
  const m = /^\s*#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*(?:\n|$)/.exec(source);
  return m ? { title: m[1], rest: source.slice(m[0].length) } : null;
}

/**
 * `docSource` is doc.json's text, `tabSource(id)` the text of `tabs/<id>.md`; `only` limits the
 * export to one tab (it is then a section of its own: the tab's title is the `#`).
 */
export function docToMarkdown(docSource: string | undefined, tabSource: (id: string) => string | undefined, only?: string): DocMarkdown {
  const d = parseDoc(docSource);
  const tabs = tabOrder(d).filter((t) => !only || t.id === only);
  const images = new Set<string>();
  const sections: string[] = [];
  const head = (level: number, text: string) => `${'#'.repeat(level)} ${text.replace(/\s+/g, ' ').trim()}`;
  // a first tab that opens with the doc's own title is the doc's introduction, not a section
  const intro = !only && tabs.length && leadTitle(tabSource(tabs[0].id) ?? '')?.title.trim() === d.title.trim() ? tabs[0].id : null;
  if (!only) sections.push(head(1, d.title));

  for (const t of tabs) {
    // where this tab's `#` lands: the doc title is level 1, so tabs are 2 and subtabs 3
    const level = only || t.id === intro ? 1 : t.parent ? 3 : 2;
    const raw = (tabSource(t.id) ?? '').replace(/\r\n?/g, '\n');
    const lead = leadTitle(raw);
    const body = lead ? lead.rest : raw;
    // the body's headings sit under the tab's heading: `##` right below it, a stray `#` too
    const shifted = tidy(shiftHeadings(body, topLevel(body) >= 2 ? level - 1 : level), images).replace(/^\n+|\s+$/g, '');
    sections.push([t.id === intro ? '' : head(level, lead ? lead.title : t.title), shifted].filter(Boolean).join('\n\n'));
  }
  return { markdown: sections.filter(Boolean).join('\n\n') + '\n', images: [...images] };
}

/** What a Markdown file from elsewhere needs to be a tab: `<mark>x</mark>` is the editor's `==x==` (the inverse of the export; code is left alone). */
export function markdownToTab(source: string): string {
  return mapOutsideCode(source, (line) => outsideSpans(line, (text) => text.replace(/<mark>([^<\n]+?)<\/mark>/gi, '==$1==')));
}
