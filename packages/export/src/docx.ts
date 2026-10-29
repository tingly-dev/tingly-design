import { strToU8, zipSync, type Zippable } from 'fflate';
import { marked, type Token, type Tokens } from 'marked';

/**
 * A Word file (.docx) from Markdown, written here with no service and nothing to install: the
 * Markdown is read by `marked`, and each block and span becomes the WordprocessingML element Word
 * has for it (headings, lists with real numbering, tables, quotes, code, links, pictures).
 * Deterministic: the same text makes the same bytes. .design/docs-docx.md says what is kept and
 * what is left out.
 */
export interface DocxOptions {
  /** the file's title property */
  title?: string;
  /** the doc's language: Chinese text gets a CJK font and the document language is set */
  lang?: string;
  headingFont?: 'sans' | 'serif';
  bodyFont?: 'sans' | 'serif';
  /** the bytes of each local picture, by the path the Markdown writes it at (with the size to draw it at, when that is not its pixel size, as for an SVG drawn to a PNG); a picture not in here is left as its description */
  images?: Map<string, Uint8Array | { bytes: Uint8Array; width: number; height: number }>;
  /** `<span data-color="name">` names and their colours (`#rrggbb`); a name not in here is left uncoloured */
  colors?: Record<string, string>;
}

const A4 = { w: 11906, h: 16838, margin: 1440 };
const TEXT_WIDTH = A4.w - 2 * A4.margin; // twips
const MAX_PICTURE = Math.round((TEXT_WIDTH / 1440) * 914400); // EMU

const FONTS = {
  sans: { latin: 'Calibri', east: 'Microsoft YaHei' },
  serif: { latin: 'Cambria', east: 'SimSun' },
  mono: { latin: 'Consolas', east: 'Microsoft YaHei' },
};

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// ------------------------------------------------------------------ small pieces

// eslint-disable-next-line no-control-regex
const BAD_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

function esc(s: string): string {
  return s.replace(BAD_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', times: '×', middot: '·', bull: '•' };

/** `marked` hands text and code spans back with HTML entities in them (the ones it escaped and the ones the writer typed); Word wants the characters. */
function unescapeHtml(s: string): string {
  return s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, dec?: string, hexa?: string, name?: string) => {
    if (name) return NAMED[name.toLowerCase()] ?? m;
    const code = dec ? Number(dec) : parseInt(hexa!, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

function hex(color: string | undefined): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(color ?? '');
  return m ? m[1]!.toUpperCase() : null;
}

interface Fmt {
  b?: boolean;
  i?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: boolean;
  color?: string | null;
  highlight?: boolean;
  /** half-points, when the run is not the style's size */
  size?: number;
}

function rPr(f: Fmt): string {
  let x = '';
  if (f.code) x += `<w:rFonts w:ascii="${FONTS.mono.latin}" w:hAnsi="${FONTS.mono.latin}" w:cs="${FONTS.mono.latin}" w:eastAsia="${FONTS.mono.east}"/>`;
  if (f.b) x += '<w:b/><w:bCs/>';
  if (f.i) x += '<w:i/><w:iCs/>';
  if (f.strike) x += '<w:strike/>';
  const color = f.link ? '2F6FED' : f.color;
  if (color) x += `<w:color w:val="${color}"/>`;
  const size = f.size ?? (f.code ? 20 : undefined);
  if (size) x += `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`;
  if (f.highlight) x += '<w:highlight w:val="yellow"/>';
  if (f.link) x += '<w:u w:val="single"/>';
  if (f.code) x += '<w:shd w:val="clear" w:color="auto" w:fill="F2F2EF"/>';
  return x ? `<w:rPr>${x}</w:rPr>` : '';
}

function run(text: string, f: Fmt): string {
  if (!text) return '';
  // a tab or a line break inside a run is an element of its own
  const parts = text.split(/(\t|\r?\n)/).map((p) => (p === '\t' ? '<w:tab/>' : /^\r?\n$/.test(p) ? '<w:br/>' : p ? `<w:t xml:space="preserve">${esc(p)}</w:t>` : ''));
  return `<w:r>${rPr(f)}${parts.join('')}</w:r>`;
}

function imageSize(b: Uint8Array): { w: number; h: number; ext: 'png' | 'jpeg' | 'gif' } | null {
  const u16 = (o: number) => (b[o]! << 8) | b[o + 1]!;
  const u32 = (o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
  if (b.length > 24 && u32(0) === 0x89504e47) return { w: u32(16), h: u32(20), ext: 'png' };
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { w: b[6]! | (b[7]! << 8), h: b[8]! | (b[9]! << 8), ext: 'gif' };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let o = 2; o + 9 < b.length; ) {
      if (b[o] !== 0xff) return null;
      const m = b[o + 1]!;
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: u16(o + 5), w: u16(o + 7), ext: 'jpeg' };
      o += 2 + u16(o + 2);
    }
  }
  return null;
}

// ------------------------------------------------------------------ the document

class Builder {
  rels: { id: string; type: string; target: string; external?: boolean }[] = [];
  media: Zippable = {};
  mediaTypes = new Set<string>();
  /** a numbered list's own numbering instance, so each one starts again at its own number */
  nums: { id: number; level: number; start: number }[] = [];
  private nextNum = 2;
  private nextDrawing = 1;

  constructor(private o: DocxOptions) {}

  private rel(type: string, target: string, external = false): string {
    const id = `rId${this.rels.length + 10}`;
    this.rels.push({ id, type, target, external });
    return id;
  }

  // ---- inline

  inline(tokens: Token[] | undefined, fmt: Fmt = {}, state: { color: string | null; highlight: boolean } = { color: null, highlight: false }): string {
    let x = '';
    for (const t of tokens ?? []) {
      const f: Fmt = { ...fmt, ...(state.color ? { color: state.color } : {}), ...(state.highlight ? { highlight: true } : {}) };
      switch (t.type) {
        case 'text':
        case 'escape': {
          const tt = t as Tokens.Text;
          x += tt.tokens?.length ? this.inline(tt.tokens, fmt, state) : run(unescapeHtml(tt.text), f);
          break;
        }
        case 'strong':
          x += this.inline((t as Tokens.Strong).tokens, { ...fmt, b: true }, state);
          break;
        case 'em':
          x += this.inline((t as Tokens.Em).tokens, { ...fmt, i: true }, state);
          break;
        case 'del':
          x += this.inline((t as Tokens.Del).tokens, { ...fmt, strike: true }, state);
          break;
        case 'codespan':
          x += run(unescapeHtml((t as Tokens.Codespan).text), { ...f, code: true });
          break;
        case 'br':
          x += '<w:r><w:br/></w:r>';
          break;
        case 'link': {
          const l = t as Tokens.Link;
          if (/^(https?:|mailto:)/i.test(l.href)) {
            const id = this.rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', l.href, true);
            x += `<w:hyperlink r:id="${id}">${this.inline(l.tokens, { ...fmt, link: true }, state)}</w:hyperlink>`;
          } else x += this.inline(l.tokens, fmt, state);
          break;
        }
        case 'image':
          x += this.picture(t as Tokens.Image, f);
          break;
        case 'html': {
          const tag = (t as Tokens.HTML).text.trim();
          if (/^<mark\b/i.test(tag)) state.highlight = true;
          else if (/^<\/mark>/i.test(tag)) state.highlight = false;
          else if (/^<span\b/i.test(tag)) {
            const name = /data-color="([a-z]+)"/i.exec(tag)?.[1];
            state.color = hex(name ? this.o.colors?.[name] : undefined);
          } else if (/^<\/span>/i.test(tag)) state.color = null;
          else if (/^<br\s*\/?>/i.test(tag)) x += '<w:r><w:br/></w:r>';
          break;
        }
        default:
          if ('tokens' in t && Array.isArray((t as { tokens?: Token[] }).tokens)) x += this.inline((t as { tokens: Token[] }).tokens, fmt, state);
          else if ('text' in t) x += run(unescapeHtml(String((t as { text: string }).text)), f);
      }
    }
    return x;
  }

  private picture(t: Tokens.Image, f: Fmt): string {
    const alt = unescapeHtml(t.text || '');
    let path = t.href;
    try {
      path = decodeURI(path);
    } catch {
      // keep as written
    }
    const given = this.o.images?.get(path) ?? this.o.images?.get(t.href);
    const bytes = given && 'bytes' in given ? given.bytes : given;
    const found = bytes ? imageSize(bytes) : null;
    const size = found && given && 'bytes' in given ? { ...found, w: given.width, h: given.height } : found;
    if (!bytes || !size || !size.w || !size.h) return run(alt ? `[${alt}]` : '[image]', { ...f, i: true });
    const n = this.nextDrawing++;
    const name = `image${n}.${size.ext === 'jpeg' ? 'jpg' : size.ext}`;
    this.media[`word/media/${name}`] = [bytes, { level: 0 }];
    this.mediaTypes.add(size.ext === 'jpeg' ? 'jpg' : size.ext);
    const id = this.rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', `media/${name}`);
    // a picture is its pixel size at 96 dpi, scaled down to the page's text width
    let cx = size.w * 9525;
    let cy = size.h * 9525;
    if (cx > MAX_PICTURE) {
      cy = Math.round((cy * MAX_PICTURE) / cx);
      cx = MAX_PICTURE;
    }
    return (
      `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
      `<wp:docPr id="${n}" name="Picture ${n}" descr="${esc(alt)}"/>` +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
      `<pic:nvPicPr><pic:cNvPr id="${n}" name="${esc(name)}" descr="${esc(alt)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
    );
  }

  // ---- blocks

  private p(runs: string, o: { style?: string; num?: { id: number; level: number }; left?: number; hanging?: number; quote?: number; keepNext?: boolean; after?: number } = {}): string {
    let x = '';
    if (o.style || o.quote) x += `<w:pStyle w:val="${o.style ?? 'Quote'}"/>`;
    if (o.keepNext) x += '<w:keepNext/>';
    if (o.num) x += `<w:numPr><w:ilvl w:val="${o.num.level}"/><w:numId w:val="${o.num.id}"/></w:numPr>`;
    if (o.after !== undefined) x += `<w:spacing w:before="0" w:after="${o.after}"/>`;
    // a list line in a quote is indented from its level's own place, which direct indent would otherwise replace
    const left = o.num && o.quote ? 720 * (o.num.level + 1) + 360 * o.quote : (o.left ?? 0) + (o.quote ? 360 * o.quote : 0);
    const hanging = o.num && o.quote ? 360 : o.hanging;
    if (left || hanging) x += `<w:ind w:left="${left}"${hanging ? ` w:hanging="${hanging}"` : ''}/>`;
    return `<w:p>${x ? `<w:pPr>${x}</w:pPr>` : ''}${runs}</w:p>`;
  }

  blocks(tokens: Token[], c: { quote?: number; left?: number } = {}): string {
    let x = '';
    for (const t of tokens) {
      switch (t.type) {
        case 'heading': {
          const h = t as Tokens.Heading;
          x += this.p(this.inline(h.tokens), { style: `Heading${Math.min(6, Math.max(1, h.depth))}` });
          break;
        }
        case 'paragraph':
        case 'text': {
          const tt = t as Tokens.Paragraph;
          x += this.p(this.inline(tt.tokens ?? [{ type: 'text', raw: tt.text, text: tt.text } as Token]), { quote: c.quote, left: c.left });
          break;
        }
        case 'list':
          x += this.list(t as Tokens.List, 0, c);
          break;
        case 'blockquote':
          x += this.blocks((t as Tokens.Blockquote).tokens, { quote: (c.quote ?? 0) + 1, left: c.left });
          break;
        case 'code': {
          const lines = (t as Tokens.Code).text.split(/\r?\n/);
          x += lines.map((l, n) => this.p(run(l, {}), { style: 'CodeBlock', left: c.left, after: n === lines.length - 1 ? 160 : undefined })).join('');
          break;
        }
        case 'table':
          x += this.table(t as Tokens.Table);
          break;
        case 'hr':
          x += '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D6D4CE"/></w:pBdr></w:pPr></w:p>';
          break;
        default:
          break; // space, raw HTML blocks, definitions
      }
    }
    return x;
  }

  private list(l: Tokens.List, depth: number, c: { quote?: number; left?: number }): string {
    const level = Math.min(depth, 8);
    let num = 1; // the bullets' numbering
    if (l.ordered) {
      num = this.nextNum++;
      this.nums.push({ id: num, level, start: typeof l.start === 'number' ? l.start : 1 });
    }
    let x = '';
    for (const item of l.items) {
      let lead = true;
      const left = 720 * (level + 1) + (c.left ?? 0);
      for (const t of item.tokens) {
        if ((t.type === 'text' || t.type === 'paragraph') && lead) {
          lead = false;
          const body = this.inline((t as Tokens.Text).tokens);
          if (item.task) x += this.p(run(item.checked ? '☑ ' : '☐ ', {}) + body, { left, hanging: 360, quote: c.quote });
          else x += this.p(body, { num: { id: num, level }, quote: c.quote });
        } else if (t.type === 'list') x += this.list(t as Tokens.List, depth + 1, c);
        else x += this.blocks([t], { quote: c.quote, left });
      }
    }
    return x;
  }

  private table(t: Tokens.Table): string {
    const cols = Math.max(1, t.header.length);
    // a column's share follows how much its longest cell says (kept between a sliver and most of the page), so a short column does not take what a long one needs
    const weight = Array.from({ length: cols }, (_v, n) => Math.min(40, Math.max(12, ...[t.header[n], ...t.rows.map((r) => r[n])].map((c) => (c?.text.length ?? 0)))));
    const total = weight.reduce((a, b) => a + b, 0);
    const widths = weight.map((x) => Math.floor((TEXT_WIDTH * x) / total));
    const border = (n: string) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`;
    const cell = (c: Tokens.TableCell, head: boolean, align: string | null, w: number) => {
      const jc = align === 'center' ? 'center' : align === 'right' ? 'right' : '';
      const para = `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/>${jc ? `<w:jc w:val="${jc}"/>` : ''}</w:pPr>${this.inline(c.tokens, head ? { b: true } : {})}</w:p>`;
      return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2EF"/>' : ''}</w:tcPr>${para}</w:tc>`;
    };
    const row = (cells: Tokens.TableCell[], head: boolean) =>
      `<w:tr>${head ? '<w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>' : '<w:trPr><w:cantSplit/></w:trPr>'}${Array.from({ length: cols }, (_v, n) => cell(cells[n] ?? { text: '', tokens: [], header: head, align: null }, head, t.align[n] ?? null, widths[n]!)).join('')}</w:tr>`;
    return (
      `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders>` +
      '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
      row(t.header, true) +
      t.rows.map((r) => row(r, false)).join('') +
      '</w:tbl>' +
      '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>'
    );
  }
}

// ------------------------------------------------------------------ the package

function stylesXml(o: DocxOptions): string {
  const body = FONTS[o.bodyFont === 'serif' ? 'serif' : 'sans'];
  const head = FONTS[o.headingFont === 'serif' ? 'serif' : 'sans'];
  const rf = (f: { latin: string; east: string }) => `<w:rFonts w:ascii="${f.latin}" w:hAnsi="${f.latin}" w:cs="${f.latin}" w:eastAsia="${f.east}"/>`;
  const heading = (n: number, pt: number, before: number) =>
    `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr>${rf(head)}<w:b/><w:bCs/><w:sz w:val="${pt * 2}"/><w:szCs w:val="${pt * 2}"/></w:rPr></w:style>`;
  return (
    XML +
    `<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr>${rf(body)}<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="${o.lang === 'zh' ? 'zh-CN' : 'en-US'}"/></w:rPr></w:rPrDefault>` +
    '<w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    heading(1, 22, 360) +
    heading(2, 17, 300) +
    heading(3, 14, 240) +
    heading(4, 12, 200) +
    heading(5, 11, 200) +
    heading(6, 11, 200) +
    '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="D6D4CE"/></w:pBdr><w:ind w:left="360"/></w:pPr><w:rPr><w:color w:val="555555"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="Code Block"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
    `<w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F5F5F3"/><w:spacing w:before="0" w:after="0" w:line="260" w:lineRule="auto"/><w:contextualSpacing/></w:pPr><w:rPr>${rf(FONTS.mono)}<w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>` +
    '</w:styles>'
  );
}

function numberingXml(nums: Builder['nums']): string {
  const bullets = ['•', '◦', '▪'];
  const kinds = ['decimal', 'lowerLetter', 'lowerRoman'];
  const levels = (ordered: boolean) =>
    Array.from({ length: 9 }, (_v, l) => {
      const text = ordered ? `%${l + 1}.` : bullets[l % 3]!;
      return `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="${ordered ? kinds[l % 3] : 'bullet'}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (l + 1)}" w:hanging="360"/></w:pPr></w:lvl>`;
    }).join('');
  return (
    XML +
    `<w:numbering ${NS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${levels(false)}</w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${levels(true)}</w:abstractNum>` +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
    nums.map((n) => `<w:num w:numId="${n.id}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="${n.level}"><w:startOverride w:val="${n.start}"/></w:lvlOverride></w:num>`).join('') +
    '</w:numbering>'
  );
}

export function markdownToDocx(markdown: string, o: DocxOptions = {}): Uint8Array {
  const b = new Builder(o);
  const body = b.blocks(marked.lexer(markdown, { gfm: true }));
  const sect = `<w:sectPr><w:pgSz w:w="${A4.w}" w:h="${A4.h}"/><w:pgMar w:top="${A4.margin}" w:right="${A4.margin}" w:bottom="${A4.margin}" w:left="${A4.margin}" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const rels =
    XML +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${R}/numbering" Target="numbering.xml"/>` +
    b.rels.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('') +
    '</Relationships>';
  const types =
    XML +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    [...b.mediaTypes].sort().map((e) => `<Default Extension="${e}" ContentType="image/${e === 'jpg' ? 'jpeg' : e}"/>`).join('') +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';
  const files: Zippable = {
    '[Content_Types].xml': strToU8(types),
    '_rels/.rels': strToU8(
      XML +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>` +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
    ),
    'docProps/core.xml': strToU8(
      XML +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        `<dc:title>${esc(o.title ?? '')}</dc:title></cp:coreProperties>`,
    ),
    'word/document.xml': strToU8(`${XML}<w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`),
    'word/styles.xml': strToU8(stylesXml(o)),
    'word/numbering.xml': strToU8(numberingXml(b.nums)),
    'word/_rels/document.xml.rels': strToU8(rels),
    ...b.media,
  };
  // a fixed time, so the same text makes the same file
  return zipSync(files, { mtime: new Date(Date.UTC(2020, 0, 1)) });
}
