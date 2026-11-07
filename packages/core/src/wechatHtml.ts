import { marked, type Token, type Tokens } from 'marked';
import { parseDataFile } from './dash';

/**
 * A doc's Markdown as the HTML the WeChat Official Account editor keeps when it is pasted
 * (.design/wechat-export.md). The editor drops `<style>`, classes and `var()` and keeps what sits in a
 * tag's own `style` (the one class we write is the platform's own code-block structure), so every tag is written with its style attached from a table, not styled by
 * a sheet and inlined after. Pure: pictures and drawn blocks come in through the options, so the
 * editor, the server and the command line all make the same text.
 */
export interface WechatPicture {
  /** what goes in `src`: a `data:` address made by the caller */
  src: string;
  width?: number;
  height?: number;
}

export interface WechatOptions {
  headingFont?: 'sans' | 'serif';
  bodyFont?: 'sans' | 'serif';
  /** `<span data-color="name">` names and their colours; a name not in here is left uncoloured */
  colors?: Record<string, string>;
  /** the picture behind each local path the Markdown writes (as `docToMarkdown` lists them) */
  images?: Map<string, WechatPicture>;
  /** the picture of each drawn fence (`wechatFigures` lists them), by `figureKey` */
  figures?: Map<string, WechatPicture>;
}

export type WechatIssue =
  | { kind: 'links'; count: number }
  | { kind: 'picture-missing'; path: string }
  | { kind: 'picture-remote'; url: string }
  | { kind: 'figure-missing'; lang: string }
  | { kind: 'html-dropped' };

export interface WechatLink {
  n: number;
  text: string;
  url: string;
}

export interface WechatResult {
  html: string;
  /** the plain-text twin for the clipboard's `text/plain` */
  text: string;
  links: WechatLink[];
  issues: WechatIssue[];
}

/** The brand colour of the links, the quote bar and the reference list. */
export const WECHAT_ACCENT = '#07c160';

const DRAWN: Record<string, 'diagram' | 'math'> = { mermaid: 'diagram', latex: 'math', tex: 'math', math: 'math' };

export function figureKey(lang: string, source: string): string {
  return `${lang.toLowerCase()}\n${source}`;
}

/** The fences the editor has to draw into pictures before `markdownToWechat` can place them. */
export function wechatFigures(markdown: string): { key: string; lang: string; source: string; kind: 'diagram' | 'math' }[] {
  const out: { key: string; lang: string; source: string; kind: 'diagram' | 'math' }[] = [];
  const seen = new Set<string>();
  const walk = (tokens: Token[]) => {
    for (const t of tokens) {
      if (t.type === 'code') {
        const c = t as Tokens.Code;
        const lang = (c.lang ?? '').trim().split(/\s+/)[0].toLowerCase();
        const kind = DRAWN[lang];
        if (kind && c.text.trim()) {
          const key = figureKey(lang, c.text);
          if (!seen.has(key)) (seen.add(key), out.push({ key, lang, source: c.text, kind }));
        }
      } else if ('tokens' in t && Array.isArray((t as { tokens?: Token[] }).tokens)) walk((t as { tokens: Token[] }).tokens);
      else if (t.type === 'list') for (const item of (t as Tokens.List).items) walk(item.tokens);
    }
  };
  walk(marked.lexer(markdown, { gfm: true }));
  return out;
}

const SANS = `-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif`;
const SERIF = `'Songti SC','Noto Serif SC',Georgia,'Times New Roman',serif`;
const MONO = `'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace`;
const INK = '#333333';

/** The style of each tag. A declaration list, no `var()`, nothing the editor is known to drop (position, float, flex, grid, transform, shadow). */
export function wechatStyles(o: Pick<WechatOptions, 'headingFont' | 'bodyFont'> = {}): Record<string, string> {
  const body = o.bodyFont === 'serif' ? SERIF : SANS;
  const head = o.headingFont === 'serif' ? SERIF : SANS;
  const heading = (size: number, top: number, bottom: number, extra = '') =>
    `font-family:${head};font-size:${size}px;font-weight:bold;color:#1a1a1a;line-height:1.4;margin:${top}px 0 ${bottom}px;padding:0;${extra}`;
  return {
    root: `font-family:${body};font-size:16px;line-height:1.8;color:${INK};letter-spacing:0.5px;word-break:break-word;padding:0 8px;margin:0;`,
    h1: heading(24, 32, 16),
    h2: heading(20, 28, 14, `padding-left:10px;border-left:4px solid ${WECHAT_ACCENT};`),
    h3: heading(18, 24, 12),
    h4: heading(16, 20, 10),
    h5: heading(15, 16, 8, 'color:#555555;'),
    h6: heading(14, 16, 8, 'color:#666666;'),
    p: `font-family:${body};font-size:16px;line-height:1.8;color:${INK};margin:0 0 16px;padding:0;`,
    strong: 'font-weight:bold;color:#1a1a1a;',
    em: 'font-style:italic;',
    del: 'text-decoration:line-through;color:#888888;',
    mark: 'background-color:#fff3a3;color:inherit;',
    // the editor puts its own grey ground behind a bare <code>: say none out loud
    code: `font-family:${MONO};font-size:14px;color:#d63384;background:none;padding:0 2px;`,
    pre: `background-color:#f6f8fa;border-radius:6px;padding:14px 16px;margin:0 0 16px;overflow-x:auto;`,
    preCode: `font-family:${MONO};font-size:13px;line-height:1.6;color:#24292e;background:none;padding:0;display:block;white-space:pre-wrap;`,
    blockquote: `border-left:4px solid ${WECHAT_ACCENT};background-color:#f9f9f9;color:#666666;padding:8px 16px;margin:0 0 16px;`,
    ul: 'padding-left:24px;margin:0 0 16px;list-style-type:disc;',
    ol: 'padding-left:24px;margin:0 0 16px;list-style-type:decimal;',
    li: `font-size:16px;line-height:1.8;color:${INK};margin:4px 0;`,
    hr: 'border:none;border-top:1px solid #eeeeee;margin:28px 0;height:1px;',
    a: `color:${WECHAT_ACCENT};text-decoration:none;`,
    sup: `color:${WECHAT_ACCENT};font-size:12px;vertical-align:super;line-height:0;`,
    img: 'max-width:100%;display:block;margin:16px auto;',
    table: 'width:100%;border-collapse:collapse;margin:0 0 16px;font-size:14px;display:table;',
    th: `background-color:#f0f0f0;border:1px solid #dddddd;padding:8px 10px;font-weight:bold;color:${INK};`,
    td: `border:1px solid #dddddd;padding:8px 10px;color:${INK};`,
    refs: 'margin:32px 0 0;padding-top:12px;border-top:1px solid #eeeeee;',
    refsTitle: 'font-size:14px;font-weight:bold;color:#555555;margin:0 0 6px;',
    ref: 'font-size:12px;line-height:1.7;color:#888888;margin:0 0 2px;word-break:break-all;',
  };
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const unesc = (s: string): string =>
  s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, d?: string, h?: string, n?: string) => (n ? (NAMED[n.toLowerCase()] ?? m) : String.fromCodePoint(d ? Number(d) : parseInt(h!, 16))));

const ALIGN: Record<string, string> = { left: 'left', center: 'center', right: 'right' };

class Writer {
  readonly st: Record<string, string>;
  readonly links: WechatLink[] = [];
  readonly issues: WechatIssue[] = [];
  private readonly urls = new Map<string, number>();
  private readonly noted = new Set<string>();

  constructor(private readonly o: WechatOptions) {
    this.st = wechatStyles(o);
  }

  note(i: WechatIssue, key: string): void {
    if (this.noted.has(key)) return;
    this.noted.add(key);
    this.issues.push(i);
  }

  // ---------------------------------------------------------------- inline

  inline(tokens: Token[], pre?: { color: string | null; mark: boolean }): string {
    const state = pre ?? { color: null, mark: false };
    let x = '';
    const wrap = (inner: string): string => {
      let r = inner;
      if (state.color) r = `<span style="color:${state.color};">${r}</span>`;
      if (state.mark) r = `<span style="${this.st.mark}">${r}</span>`;
      return r;
    };
    for (const t of tokens) {
      switch (t.type) {
        case 'text':
        case 'escape': {
          const tt = t as Tokens.Text;
          x += tt.tokens?.length ? this.inline(tt.tokens, state) : wrap(tt.text);
          break;
        }
        case 'strong':
          x += `<strong style="${this.st.strong}">${this.inline((t as Tokens.Strong).tokens, state)}</strong>`;
          break;
        case 'em':
          x += `<em style="${this.st.em}">${this.inline((t as Tokens.Em).tokens, state)}</em>`;
          break;
        case 'del':
          x += `<span style="${this.st.del}">${this.inline((t as Tokens.Del).tokens, state)}</span>`;
          break;
        case 'codespan':
          x += `<code style="${this.st.code}">${(t as Tokens.Codespan).text}</code>`;
          break;
        case 'br':
          x += '<br>';
          break;
        case 'link':
          x += this.link(t as Tokens.Link, state);
          break;
        case 'image':
          x += this.picture(t as Tokens.Image);
          break;
        case 'html': {
          const tag = (t as Tokens.HTML).text.trim();
          if (/^<mark\b/i.test(tag)) state.mark = true;
          else if (/^<\/mark>/i.test(tag)) state.mark = false;
          else if (/^<span\b/i.test(tag)) {
            const name = /data-color="([a-z]+)"/i.exec(tag)?.[1];
            state.color = (name && this.o.colors?.[name]) || null;
          } else if (/^<\/span>/i.test(tag)) state.color = null;
          else if (/^<br\s*\/?>/i.test(tag)) x += '<br>';
          else this.note({ kind: 'html-dropped' }, 'html');
          break;
        }
        default:
          if ('tokens' in t && Array.isArray((t as { tokens?: Token[] }).tokens)) x += this.inline((t as { tokens: Token[] }).tokens, state);
          else if ('text' in t) x += String((t as { text: string }).text);
      }
    }
    return x;
  }

  /** A link to another article of the platform stays a link; any other address cannot be followed from an article, so it is numbered and listed at the end. */
  private link(l: Tokens.Link, state: { color: string | null; mark: boolean }): string {
    const text = this.inline(l.tokens, state);
    if (/^https?:\/\/mp\.weixin\.qq\.com\//i.test(l.href)) return `<a href="${esc(l.href)}" style="${this.st.a}">${text}</a>`;
    if (!/^(https?:|mailto:)/i.test(l.href)) return text;
    const plain = unesc(l.tokens.map((t) => ('text' in t ? String((t as { text: string }).text) : t.raw)).join(''));
    // the address already shown as the words needs no second line
    if (plain.replace(/^https?:\/\//i, '') === l.href.replace(/^https?:\/\//i, '')) return `<span style="${this.st.a}">${text}</span>`;
    let n = this.urls.get(l.href);
    if (!n) {
      n = this.links.length + 1;
      this.urls.set(l.href, n);
      this.links.push({ n, text: plain, url: l.href });
    }
    return `<span style="${this.st.a}">${text}</span><sup style="${this.st.sup}">[${n}]</sup>`;
  }

  private picture(t: Tokens.Image): string {
    const alt = esc(unesc(t.text || ''));
    let path = t.href;
    try {
      path = decodeURI(path);
    } catch {
      // keep as written
    }
    const given = this.o.images?.get(path) ?? this.o.images?.get(t.href);
    if (given) return this.img(given, alt);
    if (/^data:image\//i.test(t.href)) return `<img src="${esc(t.href)}" alt="${alt}" style="${this.st.img}">`;
    if (/^https?:\/\//i.test(t.href)) {
      this.note({ kind: 'picture-remote', url: t.href }, `remote:${t.href}`);
      return `<img src="${esc(t.href)}" alt="${alt}" style="${this.st.img}">`;
    }
    this.note({ kind: 'picture-missing', path }, `missing:${path}`);
    return `<span style="color:#888888;font-style:italic;">[${alt || 'image'}]</span>`;
  }

  private img(p: WechatPicture, alt: string): string {
    const size = p.width && p.height ? `width:${Math.min(p.width, 677)}px;` : '';
    return `<img src="${esc(p.src)}" alt="${alt}" style="${this.st.img}${size}">`;
  }

  // ---------------------------------------------------------------- blocks

  blocks(tokens: Token[]): string {
    let x = '';
    for (const t of tokens) {
      switch (t.type) {
        case 'heading': {
          const h = t as Tokens.Heading;
          const tag = `h${Math.min(h.depth, 6)}`;
          x += `<${tag} style="${this.st[tag]}">${this.inline(h.tokens)}</${tag}>`;
          break;
        }
        case 'paragraph':
          x += `<p style="${this.st.p}">${this.inline((t as Tokens.Paragraph).tokens)}</p>`;
          break;
        case 'text':
          x += `<p style="${this.st.p}">${this.inline((t as Tokens.Text).tokens ?? [t])}</p>`;
          break;
        case 'blockquote':
          x += `<blockquote style="${this.st.blockquote}">${this.blocks((t as Tokens.Blockquote).tokens)}</blockquote>`;
          break;
        case 'list':
          x += this.list(t as Tokens.List);
          break;
        case 'code':
          x += this.code(t as Tokens.Code);
          break;
        case 'table':
          x += this.table(t as Tokens.Table);
          break;
        case 'hr':
          x += `<hr style="${this.st.hr}">`;
          break;
        case 'html':
          this.note({ kind: 'html-dropped' }, 'html');
          break;
        default:
          break; // space, definitions
      }
    }
    return x;
  }

  private list(l: Tokens.List): string {
    const tag = l.ordered ? 'ol' : 'ul';
    const start = l.ordered && typeof l.start === 'number' && l.start !== 1 ? ` start="${l.start}"` : '';
    let x = `<${tag}${start} style="${this.st[tag]}">`;
    for (const item of l.items) {
      const box = item.task ? (item.checked ? '☑ ' : '☐ ') : '';
      let lead = true;
      let inner = '';
      for (const t of item.tokens) {
        if ((t.type === 'text' || t.type === 'paragraph') && lead) {
          inner += box + this.inline((t as Tokens.Text).tokens ?? [t]);
          lead = false;
        } else inner += this.blocks([t]);
      }
      x += `<li style="${this.st.li}">${inner}</li>`;
    }
    return `${x}</${tag}>`;
  }

  private code(c: Tokens.Code): string {
    const lang = (c.lang ?? '').trim().split(/\s+/)[0].toLowerCase();
    if (DRAWN[lang] && c.text.trim()) {
      const fig = this.o.figures?.get(figureKey(lang, c.text));
      if (fig) return `<section style="text-align:center;margin:0 0 16px;">${this.img(fig, esc(lang))}</section>`;
      this.note({ kind: 'figure-missing', lang }, `figure:${lang}`);
    } else if (lang === 'csv' || lang === 'tsv') {
      const { table } = parseDataFile(c.text, lang);
      if (table && table.columns.length) {
        const cell = (tag: 'th' | 'td', v: unknown) => `<${tag} style="${this.st[tag]}">${esc(v == null ? '' : String(v))}</${tag}>`;
        const head = `<tr>${table.columns.map((k) => cell('th', k)).join('')}</tr>`;
        const rows = table.rows.map((r) => `<tr>${table.columns.map((k) => cell('td', r[k])).join('')}</tr>`).join('');
        return `<table style="${this.st.table}"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
      }
    }
    // the structure the platform's own code block has (the maintainer's vscode-wechat-md copies it, and its
    // output pastes into the editor close to as it was made): a section holding a pre with one <code> a line.
    // Our inline styles stay on it for the editor that does not take it as its own.
    const lines = c.text.replace(/\n$/, '').split('\n');
    const row = (l: string) => `<code style="${this.st.preCode}"><span leaf="">${l === '' ? '<br class="ProseMirror-trailingBreak">' : esc(l).replace(/ {2,}/g, (m) => '&nbsp;'.repeat(m.length))}</span></code>`;
    return `<section class="code-snippet__js" style="margin:0 0 16px;"><pre class="code-snippet__js code-snippet code-snippet_nowrap" data-lang="${esc(lang)}" style="${this.st.pre}">${lines.map(row).join('')}</pre></section>`;
  }

  private table(t: Tokens.Table): string {
    const cell = (tag: 'th' | 'td', c: Tokens.TableCell, i: number) => {
      const a = t.align[i] && ALIGN[t.align[i] as string];
      return `<${tag} style="${this.st[tag]}${a ? `text-align:${a};` : ''}">${this.inline(c.tokens)}</${tag}>`;
    };
    const head = `<tr>${t.header.map((c, i) => cell('th', c, i)).join('')}</tr>`;
    const rows = t.rows.map((r) => `<tr>${r.map((c, i) => cell('td', c, i)).join('')}</tr>`).join('');
    return `<table style="${this.st.table}"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
  }

  references(title: string): string {
    if (!this.links.length) return '';
    const items = this.links.map((l) => `<p style="${this.st.ref}">[${l.n}] ${esc(l.text)}: ${esc(l.url)}</p>`).join('');
    return `<section style="${this.st.refs}"><p style="${this.st.refsTitle}">${esc(title)}</p>${items}</section>`;
  }
}

/** The text of a block as the clipboard's plain twin: the words, one block to a line. */
function plainOf(html: string): string {
  return unesc(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|h[1-6]|li|tr|blockquote|section|table)>/gi, '\n')
      .replace(/<\/t[hd]>/gi, '\t')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n'),
  ).trim();
}

/**
 * The Markdown as WeChat-ready HTML. `referencesTitle` is the heading of the list of addresses at the
 * end (core carries no wording; the editor passes its own).
 */
export function markdownToWechat(markdown: string, o: WechatOptions = {}, referencesTitle = 'References'): WechatResult {
  const w = new Writer(o);
  const body = w.blocks(marked.lexer(markdown, { gfm: true }));
  const refs = w.references(referencesTitle);
  const html = `<section style="${w.st.root}">${body}${refs}</section>`;
  const issues = [...w.issues];
  if (w.links.length) issues.unshift({ kind: 'links', count: w.links.length });
  return { html, text: plainOf(body + refs), links: w.links, issues };
}
