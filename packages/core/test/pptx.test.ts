import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { importPptx } from '../src/pptx';
import { autoScale, formatValue } from '../src/pptxChart';
import { checkSlide } from '../src/slides';
import { parseDc } from '../src/parse';

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const mime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';
const options = { id: 'test-import', title: '中文 & demo' };
const rels = (items: [string, string, string, string?][]) => `<Relationships xmlns="${REL}">${items.map(([id, type, target, mode]) => `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"${mode ? ` TargetMode="${mode}"` : ''}/>`).join('')}</Relationships>`;
const slide = (body: string, extra = '', attrs = '') => `<p:sld xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}" ${attrs}><p:cSld>${extra}<p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${body}</p:spTree></p:cSld></p:sld>`;
const xfrm = (x = 0, y = 0, w = 9144000, h = 5143500) => `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>`;
const shape = (text = '', geom = 'rect', more = '', transform = xfrm(), id = '7') => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${transform}<a:prstGeom prst="${geom}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="123456"/></a:solidFill>${more}</p:spPr>${text ? `<p:txBody><a:bodyPr/><a:lstStyle/>${text}</p:txBody>` : ''}</p:sp>`;
const para = (text: string, props = '') => `<a:p><a:r><a:rPr sz="2400" ${props}/><a:t>${text}</a:t></a:r></a:p>`;
function parts(body = shape(para('Hello 中文 &amp; &lt;script&gt;', 'b="1"')), width = 9144000, height = 5143500): Record<string, string | Uint8Array> {
  return {
    '[Content_Types].xml': `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="${mime}"/></Types>`,
    '_rels/.rels': rels([['root', 'officeDocument', 'ppt/presentation.xml']]),
    'ppt/presentation.xml': `<p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst><p:sldId id="256" r:id="s2"/><p:sldId id="257" r:id="s1"/></p:sldIdLst><p:sldSz cx="${width}" cy="${height}"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': rels([['s1', 'slide', 'slides/slide1.xml'], ['s2', 'slide', 'slides/slide9.xml']]),
    'ppt/slides/slide9.xml': slide(body),
    'ppt/slides/slide1.xml': slide(shape(para('Second'))),
  };
}
function pack(p = parts()) { return zipSync(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])), { level: 6 }); }
function success(p = parts(), limits = {}) {
  const result = importPptx(pack(p), { ...options, limits });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error('expected success');
  return result;
}
function failure(p: Record<string, string | Uint8Array> | Uint8Array, code: string, limits = {}) {
  const result = importPptx(p instanceof Uint8Array ? p : pack(p), { ...options, limits });
  expect(result.ok).toBe(false);
  expect(result.diagnostics.map(d => d.code)).toContain(code);
  expect(result).not.toHaveProperty('files');
  return result;
}
const textFile = (r: ReturnType<typeof success>, path: string) => new TextDecoder().decode(r.files[path]);
const first = (r: ReturnType<typeof success>) => textFile(r, `slides/${r.report.slides[0].id}.html`);


const codes = (r: { diagnostics: { code: string }[] }) => r.diagnostics.map(d => d.code);
const theme = (body = '') => `<a:theme xmlns:a="${A}"><a:themeElements><a:clrScheme><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="ffffff"/></a:lt1><a:accent1><a:srgbClr val="4472c4"/></a:accent1><a:accent2><a:srgbClr val="ed7d31"/></a:accent2></a:clrScheme><a:fontScheme><a:majorFont><a:latin typeface="Georgia"/><a:ea typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/></a:minorFont></a:fontScheme>${body}</a:themeElements></a:theme>`;
const FMT = `<a:fmtScheme><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="50000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill></a:fillStyleLst><a:lnStyleLst><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="ffffff"/></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"/></a:gs></a:gsLst><a:lin ang="0"/></a:gradFill></a:bgFillStyleLst></a:fmtScheme>`;
/** A package whose slides share one theme (through the presentation). */
function themed(body: string, fmt = FMT) {
  const p = parts(body);
  p['ppt/_rels/presentation.xml.rels'] = rels([['s1', 'slide', 'slides/slide1.xml'], ['s2', 'slide', 'slides/slide9.xml'], ['theme', 'theme', 'theme/t.xml']]);
  p['ppt/theme/t.xml'] = theme(fmt);
  return p;
}
const png = () => Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH1sAAAAASUVORK5CYII=', 'base64'));
const sp = (id: string, inner: string, geometry = '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>', at = xfrm(0, 0, 914400, 914400)) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="S${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${at}${geometry}${inner}</p:spPr></p:sp>`;

describe('PPTX import conversion contract', () => {
  it('uses relationship order, emits editable valid escaped CJK and retains exact original bytes deterministically', () => {
    const bytes = pack();
    const a = importPptx(bytes, options), b = importPptx(bytes, options);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.report.slides.map(s => s.part)).toEqual(['ppt/slides/slide9.xml', 'ppt/slides/slide1.xml']);
    const deck = JSON.parse(textFile(a, 'deck.json'));
    expect(deck.title).toBe(options.title);
    expect(deck.order).toEqual(a.report.slides.map(s => s.id));
    expect(deck.size).toBeUndefined();
    expect(a.files[a.report.source]).toEqual(bytes);
    expect(JSON.parse(textFile(a, a.report.path))).toEqual(a.report);
    expect(first(a)).toContain('Hello 中文 &amp; &lt;script&gt;');
    expect(first(a)).toContain('<b>');
    expect(first(a)).toContain('font-size:64px');
    for (const s of a.report.slides) expect(checkSlide(parseDc(textFile(a, `slides/${s.id}.html`)), s.id).filter(i => i.level === 'error')).toEqual([]);
  });
  it('keeps a 4:3 page as a 4:3 deck without changing source units', () => {
    const r = success(parts(shape(para('Page'), 'rect', '', xfrm(914400, 914400, 1828800, 914400)), 9144000, 6858000));
    expect(first(r)).toContain('left:144px;top:144px;width:288px;height:144px');
    expect(first(r)).toContain('font-size:48px');
    expect(JSON.parse(textFile(r, 'deck.json')).size).toEqual([1440, 1080]);
    expect(r.report.size).toEqual([1440, 1080]);
  });
  it('keeps a portrait page upright', () => {
    const r = success(parts(shape(para('Tall')), 6858000, 9144000));
    expect(JSON.parse(textFile(r, 'deck.json')).size).toEqual([1080, 1440]);
  });
  it('recognizes namespace URIs rather than prefixes', () => {
    const p = parts();
    for (const [k, v] of Object.entries(p)) if (typeof v === 'string') p[k] = v.replace(/xmlns:p=/g, 'xmlns:z=').replace(/\bp:/g, 'z:').replace(/xmlns:a=/g, 'xmlns:d=').replace(/\ba:/g, 'd:');
    expect(first(success(p))).toContain('Hello 中文');
  });
  it.each(['rect', 'roundRect', 'ellipse', 'diamond', 'rightArrow'])('maps %s to the slide shape', geom => {
    const r = success(parts(shape('', geom, '<a:ln w="12700"><a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill></a:ln>')));
    expect(first(r)).toContain(`kind="${{ rect: 'rect', roundRect: 'rounded', ellipse: 'ellipse', diamond: 'diamond', rightArrow: 'arrow-right' }[geom]}"`);
    expect(first(r)).toContain('#abcdef');
  });
  it('maps lines and connectors to editable connectors with their arrow heads', () => {
    const line = '<a:ln w="25400"><a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill><a:prstDash val="dash"/><a:tailEnd type="triangle"/></a:ln>';
    const html = first(success(parts(shape('', 'line', line, xfrm(0, 0, 914400, 457200)))));
    expect(html).toContain('<x-connector x1="0" y1="0" x2="192" y2="96"');
    expect(html).toContain('head-start="none" head-end="filled"');
    expect(html).toContain('color:#abcdef;border-width:5.333px;border-style:dashed');
    const flipped = first(success(parts(shape('', 'line', line, xfrm(0, 0, 914400, 457200).replace('<a:xfrm>', '<a:xfrm flipH="1">')))));
    expect(flipped).toContain('x1="192" y1="0" x2="0" y2="96"');
    const bent = `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="4" name="C"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(0, 0, 914400, 457200)}<a:prstGeom prst="bentConnector3"><a:avLst/></a:prstGeom>${line}</p:spPr></p:cxnSp>`;
    expect(first(success(parts(bent)))).toContain('route="elbow"');
  });
  it('draws other preset and custom outlines as vector paths', () => {
    expect(first(success(parts(shape('', 'triangle'))))).toContain('<path d="M50 0L100 100H0Z" fill="#123456"');
    const custom = '<a:custGeom><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="50"/></a:lnTo><a:cubicBezTo><a:pt x="50" y="100"/><a:pt x="20" y="100"/><a:pt x="0" y="50"/></a:cubicBezTo><a:close/></a:path></a:pathLst></a:custGeom>';
    const r = success(parts(sp('5', '<a:solidFill><a:srgbClr val="00FF00"/></a:solidFill>', custom)));
    expect(first(r)).toContain('viewBox="0 0 192 192"');
    expect(first(r)).toContain('d="M0 0L192 96C96 192 38.4 192 0 96Z" fill="#00ff00"');
    const unknown = success(parts(shape('', 'cloud')));
    expect(first(unknown)).toContain('kind="rect"');
    expect(codes(unknown)).toContain('geometry_approximate');
  });
  it('retains multiple paragraphs, mixed emphasis, explicit line breaks and plain notes excluding slide numbers', () => {
    const p = parts(shape(`${para('One', 'i="1"')}<a:p><a:r><a:rPr sz="2400"/><a:t>Two</a:t></a:r><a:br/><a:r><a:rPr sz="2400"/><a:t>三</a:t></a:r></a:p>`));
    p['ppt/slides/_rels/slide9.xml.rels'] = rels([['n', 'notesSlide', '../notesSlides/n.xml']]);
    p['ppt/notesSlides/n.xml'] = `<p:notes xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody>${para('Notes &amp; 中文')}</p:txBody></p:sp><p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody>${para('99')}</p:txBody></p:sp></p:spTree></p:cSld></p:notes>`;
    const html = first(success(p));
    expect(html).toContain('<i>One</i>');
    expect(html).toContain('Two<br>三');
    expect(html).toContain('<aside>Notes &amp; 中文</aside>');
    expect(html).not.toContain('99');
  });
  it('keeps mixed sizes, fonts and run styling inside one paragraph', () => {
    const body = `<a:p><a:r><a:rPr sz="2400"/><a:t>Big </a:t></a:r><a:r><a:rPr sz="1200" strike="sngStrike" spc="300" cap="all" baseline="30000"><a:latin typeface="Georgia"/><a:highlight><a:srgbClr val="FFFF00"/></a:highlight></a:rPr><a:t>small</a:t></a:r><a:fld id="{1}" type="slidenum"><a:rPr sz="2400"/><a:t>‹#›</a:t></a:fld></a:p>`;
    const html = first(success(parts(shape(body))));
    expect(html).toContain('font-size:64px');
    expect(html).toContain('font-size:20.8px');
    expect(html).toContain('font-family:Georgia');
    expect(html).toContain('text-decoration:line-through');
    expect(html).toContain('letter-spacing:8px');
    expect(html).toContain('text-transform:uppercase');
    expect(html).toContain('background:#ffff00');
    expect(html).toContain('position:relative;top:-9.6px');
    expect(html).toMatch(/>1<\/p>/);
  });
  it('turns bullets inherited from the master into lists, numbered and plain', () => {
    const ph = '<p:nvSpPr><p:cNvPr id="7" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr>';
    const paras = `<a:p><a:r><a:t>First</a:t></a:r></a:p><a:p><a:r><a:t>Second</a:t></a:r></a:p><a:p><a:pPr marL="0" indent="0"><a:buNone/></a:pPr><a:r><a:t>Plain</a:t></a:r></a:p><a:p><a:pPr marL="914400"><a:buAutoNum type="arabicPeriod" startAt="3"/></a:pPr><a:r><a:t>Third</a:t></a:r></a:p>`;
    const p = parts(`<p:sp>${ph}<p:spPr>${xfrm()}</p:spPr><p:txBody><a:bodyPr/>${paras}</p:txBody></p:sp>`);
    p['ppt/slides/_rels/slide9.xml.rels'] = rels([['l', 'slideLayout', '../slideLayouts/l.xml']]);
    p['ppt/slideLayouts/l.xml'] = `<p:sldLayout xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree/></p:cSld></p:sldLayout>`;
    p['ppt/slideLayouts/_rels/l.xml.rels'] = rels([['m', 'slideMaster', '../slideMasters/m.xml']]);
    p['ppt/slideMasters/m.xml'] = `<p:sldMaster xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="B"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp></p:spTree></p:cSld><p:txStyles><p:bodyStyle><a:lvl1pPr marL="228600" indent="-228600"><a:buChar char="•"/><a:defRPr sz="2800"/></a:lvl1pPr></p:bodyStyle></p:txStyles></p:sldMaster>`;
    const html = first(success(p));
    expect(html).toMatch(/<ul style="padding:0px 0px 0px 48px"><li [^>]*>First<\/li><li [^>]*>Second<\/li><\/ul><p [^>]*>Plain<\/p><ol start="3" style="padding:0px 0px 0px 192px"><li [^>]*>Third<\/li><\/ol>/);
    expect(html).toContain('font-size:74.667px');
  });
  it('shrinks autofit text and applies paragraph spacing', () => {
    const body = `<a:p><a:pPr><a:spcBef><a:spcPts val="1200"/></a:spcBef></a:pPr><a:r><a:rPr sz="2400"/><a:t>Fit</a:t></a:r></a:p>`;
    const html = first(success(parts(shape(body).replace('<p:txBody><a:bodyPr/>', '<p:txBody><a:bodyPr><a:normAutofit fontScale="50000"/></a:bodyPr>'))));
    expect(html).toContain('font-size:32px');
    expect(html).toContain('padding:32px 0px 0px 0px');
  });
  it('retains PNG media once and links local uploads, with rotation and hidden slides', () => {
    const pic = `<p:pic><p:nvPicPr><p:cNvPr id="8" name="A &amp; B"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="im"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm().replace('<a:xfrm>', '<a:xfrm rot="5400000">')}<a:prstGeom prst="rect"/></p:spPr></p:pic>`;
    const p = parts(pic + pic.replace('id="8"', 'id="9"'));
    p['ppt/slides/slide9.xml'] = slide(pic, '', 'show="0"');
    p['ppt/slides/_rels/slide9.xml.rels'] = rels([['im', 'image', '../media/image.png']]);
    p['ppt/media/image.png'] = png();
    const r = success(p);
    expect(first(r)).toContain(' hidden');
    expect(first(r)).toContain('rotate(90deg)');
    expect(first(r)).toContain('src="uploads/test-import/media/');
    expect(Object.keys(r.files).filter(f => f.endsWith('.png'))).toHaveLength(1);
  });
  it('retains source image bytes and maps asymmetric crop into an editable clipped image', () => {
    const p = parts(`<p:pic><p:nvPicPr><p:cNvPr id="8" name="Crop"/></p:nvPicPr><p:blipFill><a:blip r:embed="im"/><a:srcRect l="10000" t="20000" r="30000" b="0"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(914400, 457200, 1828800, 914400)}</p:spPr></p:pic>`);
    p['ppt/slides/_rels/slide9.xml.rels'] = rels([['im', 'image', '../media/crop.png']]);
    const image = png();
    p['ppt/media/crop.png'] = image;
    const r = success(p), html = first(r);
    expect(html).toContain('left:192px;top:96px;width:384px;height:192px;overflow:hidden');
    expect(html).toContain('left:-16.667%;top:-25%;width:166.667%;height:125%');
    expect(r.files['uploads/test-import/media/image-1.png']).toEqual(image);
    const bad = success({ ...p, 'ppt/slides/slide9.xml': String(p['ppt/slides/slide9.xml']).replace('r="30000"', 'r="90000"') });
    expect(bad.diagnostics.find(d => d.code === 'object_skipped')).toMatchObject({ object: '8', params: { reason: 'invalid_value' } });
  });
  it('imports a native table with editable cell text, independent fonts, exact cell geometry and merged cells', () => {
    const cell = (text: string, size: number, fill: string, attrs = '') => `<a:tc${attrs}><a:txBody><a:bodyPr/><a:lstStyle/>${para(text, '').replace('sz="2400"', `sz="${size}"`)}</a:txBody><a:tcPr marL="45720" marR="45720" marT="0" marB="0" anchor="ctr"><a:lnL><a:noFill/></a:lnL><a:lnR><a:noFill/></a:lnR><a:lnT><a:noFill/></a:lnT><a:lnB><a:noFill/></a:lnB><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></a:tcPr></a:tc>`;
    const frame = (row1: string) => `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="Table"/></p:nvGraphicFramePr><p:xfrm><a:off x="914400" y="457200"/><a:ext cx="2743200" cy="1371600"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="914400"/><a:gridCol w="1828800"/></a:tblGrid><a:tr h="457200">${row1}</a:tr><a:tr h="914400">${cell('Value A', 1800, 'ABCDEF')}${cell('Value B', 1600, 'ABCDEF')}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    const html = first(success(parts(frame(cell('Header A', 2400, '123456') + cell('Header B', 2000, '123456')))));
    expect(html).toContain('<table');
    expect(html.match(/<td\b/g)).toHaveLength(4);
    expect(html).toContain('Header A');
    expect(html).toContain('Value B');
    expect(html).toContain('width:192px;height:96px');
    expect(html).toContain('background:#abcdef');
    expect(html).toContain('font-size:42.667px');
    const merged = first(success(parts(frame(cell('Wide', 2400, '123456', ' gridSpan="2"') + cell('', 2400, '123456', ' hMerge="1"')))));
    expect(merged.match(/<td\b/g)).toHaveLength(3);
    expect(merged).toContain('left:0px;top:0px;width:576px;height:96px');
  });
  it('applies a table style from the package to header, banded and plain cells', () => {
    const cell = (t: string) => `<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>${t}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`;
    const p = themed(`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="T"/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="1371600"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{S}</a:tableStyleId></a:tblPr><a:tblGrid><a:gridCol w="914400"/></a:tblGrid><a:tr h="457200">${cell('Head')}</a:tr><a:tr h="457200">${cell('Odd')}</a:tr><a:tr h="457200">${cell('Even')}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`);
    p['ppt/_rels/presentation.xml.rels'] = rels([['s1', 'slide', 'slides/slide1.xml'], ['s2', 'slide', 'slides/slide9.xml'], ['theme', 'theme', 'theme/t.xml'], ['ts', 'tableStyles', 'tableStyles.xml']]);
    p['ppt/tableStyles.xml'] = `<a:tblStyleLst xmlns:a="${A}" def="{S}"><a:tblStyle styleId="{S}" styleName="Test"><a:wholeTbl><a:tcTxStyle><a:schemeClr val="dk1"/></a:tcTxStyle><a:tcStyle><a:tcBdr><a:insideH><a:ln w="12700"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:insideH></a:tcBdr><a:fill><a:solidFill><a:srgbClr val="dddddd"/></a:solidFill></a:fill></a:tcStyle></a:wholeTbl><a:band1H><a:tcStyle><a:fill><a:solidFill><a:srgbClr val="bbbbbb"/></a:solidFill></a:fill></a:tcStyle></a:band1H><a:firstRow><a:tcTxStyle b="on"><a:schemeClr val="lt1"/></a:tcTxStyle><a:tcStyle><a:fill><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:fill></a:tcStyle></a:firstRow></a:tblStyle></a:tblStyleLst>`;
    const html = first(success(p));
    const cells = html.match(/<td [^]*?<\/td>/g)!;
    expect(cells[0]).toContain('background:#4472c4');
    expect(cells[0]).toContain('color:#ffffff');
    expect(cells[0]).toContain('<b>Head</b>');
    expect(cells[1]).toContain('background:#bbbbbb');
    expect(cells[2]).toContain('background:#dddddd');
    expect(cells[0]).toContain('border-bottom:2.667px solid #ffffff');
  });
  it('resolves simple layout/master placeholder geometry, text defaults and theme color/font', () => {
    const ph = '<p:nvSpPr><p:cNvPr id="7" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title" idx="1"/></p:nvPr></p:nvSpPr>';
    const p = parts(`<p:sp>${ph}<p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>Inherited</a:t></a:r></a:p></p:txBody></p:sp>`);
    p['ppt/slides/_rels/slide9.xml.rels'] = rels([['l', 'slideLayout', '../slideLayouts/l.xml']]);
    p['ppt/slideLayouts/l.xml'] = `<p:sldLayout xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree><p:sp>${ph}<p:spPr>${xfrm(914400, 0, 1828800, 914400)}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:defRPr sz="3000"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></a:lstStyle></p:txBody></p:sp></p:spTree></p:cSld></p:sldLayout>`;
    p['ppt/slideLayouts/_rels/l.xml.rels'] = rels([['m', 'slideMaster', '../slideMasters/m.xml']]);
    p['ppt/slideMasters/m.xml'] = `<p:sldMaster xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:bgPr></p:bg><p:spTree/></p:cSld></p:sldMaster>`;
    p['ppt/slideMasters/_rels/m.xml.rels'] = rels([['t', 'theme', '../theme/t.xml']]);
    p['ppt/theme/t.xml'] = `<a:theme xmlns:a="${A}"><a:themeElements><a:clrScheme><a:accent1><a:srgbClr val="fedcba"/></a:accent1></a:clrScheme><a:fontScheme><a:majorFont><a:latin typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;
    const html = first(success(p));
    expect(html).toContain('left:192px;top:0px;width:384px;height:192px');
    expect(html).toContain('font-size:80px');
    expect(html).toContain('font-family:Arial');
    expect(html).toContain('background:#fedcba');
    expect(html).toContain('color:#fedcba');
  });
  it('fills shapes from the theme style matrix, including gradients and the text colour of fontRef', () => {
    const style = '<p:style><a:lnRef idx="1"><a:schemeClr val="accent2"/></a:lnRef><a:fillRef idx="2"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>';
    const body = `<p:sp><p:nvSpPr><p:cNvPr id="5" name="S"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm()}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>${style}<p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>On fill</a:t></a:r></a:p></p:txBody></p:sp>`;
    const html = first(success(themed(body)));
    expect(html).toContain('background:linear-gradient(180deg, #4472c4 0%, #203864 100%)');
    expect(html).toContain('border:2.667px solid #ed7d31');
    expect(html).toContain('color:#ffffff');
  });
  it('computes HSL colour transforms', () => {
    const fill = (mods: string) => first(success(parts(shape().replace('<a:srgbClr val="123456"/>', `<a:srgbClr val="FF0000">${mods}</a:srgbClr>`))));
    expect(fill('<a:lumMod val="50000"/>')).toContain('background:#800000');
    expect(fill('<a:lumMod val="50000"/><a:lumOff val="50000"/>')).toContain('background:#ff8080');
    expect(fill('<a:alpha val="50000"/>')).toContain('background:rgba(255,0,0,0.5)');
  });
  it('flattens groups through their child space, flips and rotation', () => {
    const child = sp('11', '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>', undefined, xfrm(0, 0, 457200, 457200));
    const group = (attrs = '') => `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="10" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm${attrs}><a:off x="914400" y="914400"/><a:ext cx="1828800" cy="1828800"/><a:chOff x="0" y="0"/><a:chExt cx="914400" cy="914400"/></a:xfrm></p:grpSpPr>${child}</p:grpSp>`;
    expect(first(success(parts(group())))).toContain('left:192px;top:192px;width:192px;height:192px');
    expect(first(success(parts(group(' flipH="1"'))))).toContain('left:384px;top:192px;width:192px;height:192px;transform:scaleX(-1)');
    expect(first(success(parts(group(' rot="5400000"'))))).toContain('left:384px;top:192px;width:192px;height:192px;transform:rotate(90deg)');
  });
  it('reads the picture fallback of alternate content and SmartArt drawings', () => {
    const alt = `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="p14">${shape(para('Choice'))}</mc:Choice><mc:Fallback>${shape(para('Fallback'))}</mc:Fallback></mc:AlternateContent>`;
    const html = first(success(parts(alt)));
    expect(html).toContain('Fallback');
    expect(html).not.toContain('Choice');
    const DGM = 'http://schemas.openxmlformats.org/drawingml/2006/diagram', DSP = 'http://schemas.microsoft.com/office/drawing/2008/diagram';
    const p = parts(`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="D"/></p:nvGraphicFramePr><p:xfrm><a:off x="914400" y="0"/><a:ext cx="914400" cy="914400"/></p:xfrm><a:graphic><a:graphicData uri="${DGM}"><dgm:relIds xmlns:dgm="${DGM}" r:dm="dm" r:lo="dm" r:qs="dm" r:cs="dm"/></a:graphicData></a:graphic></p:graphicFrame>`);
    p['ppt/slides/_rels/slide9.xml.rels'] = rels([['dm', 'diagramData', '../diagrams/data1.xml'], ['dr', 'diagramDrawing', '../diagrams/drawing1.xml']]);
    p['ppt/diagrams/data1.xml'] = `<dgm:dataModel xmlns:dgm="${DGM}" xmlns:a="${A}"><dgm:extLst><a:ext uri="x"><dsp:dataModelExt xmlns:dsp="${DSP}" relId="dr"/></a:ext></dgm:extLst></dgm:dataModel>`;
    p['ppt/diagrams/drawing1.xml'] = `<dsp:drawing xmlns:dsp="${DSP}" xmlns:a="${A}"><dsp:spTree><dsp:nvGrpSpPr/><dsp:grpSpPr/><dsp:sp><dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="457200" cy="457200"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="00AA00"/></a:solidFill></dsp:spPr><dsp:txBody><a:bodyPr/><a:p><a:r><a:t>Step</a:t></a:r></a:p></dsp:txBody></dsp:sp></dsp:spTree></dsp:drawing>`;
    const drawn = first(success(p));
    expect(drawn).toContain('kind="ellipse" style="position:absolute;left:192px;top:0px;width:96px;height:96px;background:#00aa00"');
    expect(drawn).toContain('Step');
  });
  it('holds the place of a chart with an empty frame and a note', () => {
    const r = success(parts(`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Chart"/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphic></p:graphicFrame>`));
    expect(first(r)).toContain('border:2px dashed');
    expect(r.diagnostics.find(d => d.code === 'object_placeholder')).toMatchObject({ object: '4', params: { element: 'chart' } });
  });
  it('draws gradient, picture and theme backgrounds', () => {
    const grad = '<p:bg><p:bgPr><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="000000"/></a:gs><a:gs pos="100000"><a:srgbClr val="FFFFFF"/></a:gs></a:gsLst><a:lin ang="0"/></a:gradFill></p:bgPr></p:bg>';
    const p = parts(); p['ppt/slides/slide9.xml'] = slide(shape(), grad);
    expect(first(success(p))).toContain('background:linear-gradient(90deg, #000000 0%, #ffffff 100%)');
    p['ppt/slides/slide9.xml'] = slide(shape(), '<p:bg><p:bgPr><a:blipFill><a:blip r:embed="im"/><a:stretch><a:fillRect/></a:stretch></a:blipFill></p:bgPr></p:bg>');
    p['ppt/slides/_rels/slide9.xml.rels'] = rels([['im', 'image', '../media/bg.png']]);
    p['ppt/media/bg.png'] = png();
    expect(first(success(p))).toMatch(/style="background:#ffffff;[^"]*"><img src="uploads\/test-import\/media\/image-1.png" alt="" style="position:absolute;left:0px;top:0px;width:1920px;height:1080px/);
    const t = themed(shape()); t['ppt/slides/slide9.xml'] = slide(shape(), '<p:bg><p:bgRef idx="1002"><a:srgbClr val="fedcba"/></p:bgRef></p:bg>');
    expect(first(success(t))).toContain('background:linear-gradient(90deg, #ffffff 0%, #fedcba 100%)');
    t['ppt/slides/slide9.xml'] = slide(shape(), '<p:bg><p:bgRef idx="1001"><a:srgbClr val="fedcba"/></p:bgRef></p:bg>');
    expect(first(success(t))).toContain('background:#fedcba');
  });
  it('maps shadows to CSS and notes dropped effects once per slide', () => {
    const r = success(parts(shape(para('Effects'), 'rect', '<a:effectLst><a:outerShdw blurRad="38100" dist="38100" dir="5400000"><a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr></a:outerShdw><a:glow rad="1"/></a:effectLst>')));
    expect(first(r)).toContain('box-shadow:0px 8px 8px rgba(0,0,0,0.4)');
    expect(codes(r).filter(c => c === 'effect_dropped')).toHaveLength(1);
  });
  it('supports identical script fonts, dashes and zero paragraph spacing without inventing a text border', () => {
    const body = `<a:p><a:pPr><a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft></a:pPr><a:r><a:rPr sz="2400"><a:latin typeface="Arial"/><a:ea typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>Text</a:t></a:r></a:p>`;
    const r = success(parts(shape(body, 'rect', '<a:ln/>')));
    expect(first(r)).not.toContain('border:');
    expect(first(success(parts(shape('', 'rect', '<a:ln w="12700"><a:solidFill><a:srgbClr val="123456"/></a:solidFill><a:prstDash val="solid"/></a:ln>'))))).toContain('border:2.667px solid #123456');
    expect(first(success(parts(shape('', 'rect', '<a:ln w="12700"><a:solidFill><a:srgbClr val="123456"/></a:solidFill><a:prstDash val="sysDot"/></a:ln>'))))).toContain('border:2.667px dotted #123456');
    expect(first(success(parts(shape('<a:p><a:r><a:rPr><a:ea typeface="SimSun"/></a:rPr><a:t>中文</a:t></a:r></a:p>'))))).toContain('font-family:Arial, SimSun');
  });
  it.each([
    ['spcPct', '115000', '1.38'],
    ['spcPts', '3000', '80px'],
  ])('maps explicit %s paragraph line spacing to editable CSS', (kind, value, expected) => {
    const body = `<a:p><a:pPr><a:lnSpc><a:${kind} val="${value}"/></a:lnSpc></a:pPr><a:r><a:rPr sz="2400"/><a:t>First line</a:t></a:r><a:br/><a:r><a:rPr sz="2400"/><a:t>Second line</a:t></a:r></a:p>`;
    const html = first(success(parts(shape(body))));
    expect(html).toContain(`line-height:${expected};`);
    expect(html).toContain('First line<br>Second line');
  });
  it('keeps painted empty text shapes without interpreting unused default script fonts', () => {
    const p = parts(shape().replace('</p:sp>', '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr/><a:endParaRPr/></a:p></p:txBody></p:sp>'));
    p['ppt/presentation.xml'] = String(p['ppt/presentation.xml']).replace('</p:presentation>', `<p:defaultTextStyle><a:lvl1pPr xmlns:a="${A}"><a:defRPr><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>`);
    p['ppt/slides/slide1.xml'] = p['ppt/slides/slide9.xml'];
    const html = first(success(p));
    expect(html).toContain('<x-shape');
    expect(html).not.toContain('<p ');
    expect(html).toContain('background:#123456');
  });
  it('lets concrete run properties override inherited script fonts', () => {
    const p = parts(shape(`<a:p><a:r><a:rPr sz="2400"><a:latin typeface="Arial"/><a:ea typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>Override 中文</a:t></a:r></a:p>`));
    p['ppt/slides/slide1.xml'] = p['ppt/slides/slide9.xml'];
    p['ppt/presentation.xml'] = String(p['ppt/presentation.xml']).replace('</p:presentation>', '<p:defaultTextStyle><a:lvl1pPr xmlns:a="' + A + '"><a:defRPr sz="1800" kern="1200"><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>');
    const html = first(success(p)); expect(html).toContain('font-family:Arial;'); expect(html).toContain('Override 中文');
  });
  it('inherits master title text defaults and presentation defaults without layout text', () => {
    const ph = '<p:nvSpPr><p:cNvPr id="7"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>';
    const p = parts(`<p:sp>${ph}<p:spPr>${xfrm()}</p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp>`);
    p['ppt/slides/_rels/slide9.xml.rels'] = rels([['l', 'slideLayout', '../slideLayouts/l.xml']]);
    p['ppt/slideLayouts/l.xml'] = `<p:sldLayout xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree/></p:cSld></p:sldLayout>`;
    p['ppt/slideLayouts/_rels/l.xml.rels'] = rels([['m', 'slideMaster', '../slideMasters/m.xml']]);
    p['ppt/slideMasters/m.xml'] = `<p:sldMaster xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree/></p:cSld><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3600" b="1"/></a:lvl1pPr></p:titleStyle></p:txStyles></p:sldMaster>`;
    const html = first(success(p)); expect(html).toContain('font-size:96px'); expect(html).toContain('<b>Title</b>');
  });
  it('recognizes JPEG and GIF dimensions from bytes, not the filename', () => {
    const p = parts(`<p:pic><p:blipFill><a:blip r:embed="im"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm()}</p:spPr></p:pic>`);
    p['ppt/slides/_rels/slide9.xml.rels'] = rels([['im', 'image', '../media/a.bin']]);
    // Minimal structural JPEG frame fixture; no decoding or raster fidelity is claimed.
    p['ppt/media/a.bin'] = new Uint8Array([255,216,255,192,0,11,8,0,2,0,3,1,1,17,0,255,217]);
    const r = success(p); expect(Object.keys(r.files).some(k => k.endsWith('.jpg'))).toBe(true);
    failure(p, 'limit_exceeded', { mediaPixels: 5 });
    p['ppt/media/a.bin'] = new Uint8Array([71, 73, 70, 56, 57, 97, 4, 0, 3, 0, 0, 0, 0, 59]);
    expect(Object.keys(success(p).files).some(k => k.endsWith('.gif'))).toBe(true);
  });
});

describe('PPTX best effort inside one object or slide', () => {
  it('leaves out only an object that cannot be converted, with its location', () => {
    const r = success(parts(shape(para('Kept'), 'rect', '', xfrm(), '6') + '<p:contentPart r:id="ink"/>' + shape('', 'rect', '', '', '8')));
    expect(first(r)).toContain('Kept');
    expect(r.diagnostics.filter(d => d.code === 'object_skipped').map(d => [d.object, d.params?.reason])).toEqual([[undefined, 'unsupported_element'], ['8', 'missing_geometry']]);
    expect(r.diagnostics.find(d => d.code === 'object_skipped')).toMatchObject({ part: 'ppt/slides/slide9.xml', slide: 'test-import-1' });
  });
  it.each(['1', 'true'])('leaves hidden objects (%s) out, as the slideshow does', hidden => {
    const r = success(parts(shape(para('Secret')).replace('name="Shape"', `name="Shape" hidden="${hidden}"`)));
    expect(first(r)).not.toContain('Secret');
    expect(r.diagnostics.find(d => d.code === 'hidden_skipped')).toMatchObject({ part: 'ppt/slides/slide9.xml', slide: 'test-import-1', object: '7' });
  });
  it('leaves out a slide that cannot be read and keeps the rest', () => {
    const p = parts();
    p['ppt/slides/slide9.xml'] = slide(shape()).replace(P, 'urn:fake');
    const r = success(p);
    expect(r.report.slides.map(s => s.part)).toEqual(['ppt/slides/slide1.xml']);
    expect(r.diagnostics.find(d => d.code === 'slide_skipped')).toMatchObject({ slide: 'test-import-1', params: { reason: 'invalid_part' } });
    p['ppt/slides/slide1.xml'] = p['ppt/slides/slide9.xml'];
    failure(p, 'invalid_part');
  });
  it('notes animations, links and transparent text without refusing them', () => {
    const p = parts(shape('<a:p><a:r><a:rPr><a:noFill/><a:hlinkClick r:id="link"/></a:rPr><a:t>Ghost</a:t></a:r></a:p>'));
    p['ppt/slides/slide9.xml'] = String(p['ppt/slides/slide9.xml']).replace('</p:sld>', '<p:timing><p:tnLst><p:par><p:cTn id="1"><p:childTnLst><p:set/></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing></p:sld>');
    p['ppt/slides/_rels/slide9.xml.rels'] = rels([['link', 'hyperlink', 'https://example.com', 'External']]);
    const r = success(p);
    expect(first(r)).toContain('color:transparent');
    expect(codes(r)).toEqual(expect.arrayContaining(['animation_dropped', 'link_dropped']));
  });
  it('ignores unknown children and run content it cannot draw', () => {
    const r = success(parts(shape('<a:p><a:r><a:t>Keep</a:t><a:unknown>lost</a:unknown></a:r></a:p>').replace('</p:sp>', '<p:unknownVisible/></p:sp>')));
    expect(first(r)).toContain('Keep');
    expect(first(r)).not.toContain('lost');
  });
  it('truncates speaker notes past the editor capacity with a note', () => {
    const p = parts();
    p['ppt/slides/_rels/slide9.xml.rels'] = rels([['n', 'notesSlide', '../notesSlides/n.xml']]);
    p['ppt/notesSlides/n.xml'] = `<p:notes xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody>${para('A'.repeat(4001))}</p:txBody></p:sp></p:spTree></p:cSld></p:notes>`;
    const r = success(p);
    expect(first(r)).toContain(`<aside>${'A'.repeat(4000)}</aside>`);
    expect(codes(r)).toContain('notes_too_long');
  });
  it('leaves out pictures it cannot read and notes approximate picture fills', () => {
    const pic = `<p:pic><p:nvPicPr><p:cNvPr id="8"/></p:nvPicPr><p:blipFill><a:blip r:embed="im"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm()}</p:spPr></p:pic>`;
    const p = parts(pic);
    p['ppt/slides/_rels/slide9.xml.rels'] = rels([['im', 'image', '../media/a.png']]);
    p['ppt/media/a.emf'] = new Uint8Array([1]);
    expect(success(p).diagnostics.find(d => d.code === 'object_skipped')).toMatchObject({ object: '8', params: { reason: 'missing_part' } });
    p['ppt/media/a.png'] = new Uint8Array([1, 2, 3]);
    expect(success(p).diagnostics.find(d => d.code === 'object_skipped')).toMatchObject({ object: '8', params: { reason: 'invalid_media' } });
    p['ppt/media/a.png'] = png();
    const media = p['ppt/media/a.png'] as Uint8Array;
    const original = media.slice(); new DataView(media.buffer).setUint32(16, 2);
    failure(p, 'limit_exceeded', { mediaPixels: 1 });
    p['ppt/media/a.png'] = original;
    p['ppt/slides/slide9.xml'] = slide(pic.replace('<a:fillRect/>', '<a:fillRect l="10000"/>'));
    const r = success(p);
    expect(first(r)).toContain('<img');
    expect(codes(r)).toContain('style_approximate');
  });
  it('keeps as many objects as a slide can hold and notes the rest', () => {
    const r = success(parts(Array.from({ length: 210 }, (_, i) => shape('', 'rect', '', xfrm(), String(i))).join('')));
    expect(first(r).match(/<x-shape/g)!.length).toBeLessThan(210);
    expect(r.diagnostics.find(d => d.code === 'objects_dropped')?.params?.count).toBeGreaterThan(0);
  });
  it('resolves a master background picture in the master, not the slide', () => {
    const p = parts();
    p['ppt/slides/_rels/slide9.xml.rels'] = rels([['l', 'slideLayout', '../slideLayouts/l.xml'], ['im', 'image', '../media/other.png']]);
    p['ppt/slideLayouts/l.xml'] = `<p:sldLayout xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree/></p:cSld></p:sldLayout>`;
    p['ppt/slideLayouts/_rels/l.xml.rels'] = rels([['m', 'slideMaster', '../slideMasters/m.xml']]);
    p['ppt/slideMasters/m.xml'] = `<p:sldMaster xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"><p:cSld><p:bg><p:bgPr><a:blipFill><a:blip r:embed="im"/><a:stretch><a:fillRect/></a:stretch></a:blipFill></p:bgPr></p:bg><p:spTree/></p:cSld></p:sldMaster>`;
    p['ppt/slideMasters/_rels/m.xml.rels'] = rels([['im', 'image', '../media/bg.png']]);
    p['ppt/media/bg.png'] = png();
    p['ppt/media/other.png'] = Uint8Array.from([...png().slice(0, 33), 0]);
    const r = success(p);
    expect(Object.keys(r.files).filter(f => f.includes('/media/'))).toHaveLength(1);
    expect(first(r)).toContain('<img src="uploads/test-import/media/image-1.png" alt="" style="position:absolute;left:0px;top:0px;width:1920px;height:1080px');
    expect(r.diagnostics.filter(d => d.slide === r.report.slides[0].id).map(d => d.code)).not.toContain('background_defaulted');
  });
  it('shows an embedded object by its own picture, in the frame of the object', () => {
    const pic = `<p:pic><p:nvPicPr><p:cNvPr id="5" name="Poster"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="im"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(0, 0, 1, 1)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
    const p = parts(`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Object"/></p:nvGraphicFramePr><p:xfrm><a:off x="914400" y="0"/><a:ext cx="914400" cy="914400"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole"><p:oleObj r:id="ole"><p:embed/>${pic}</p:oleObj></a:graphicData></a:graphic></p:graphicFrame>`);
    p['ppt/slides/_rels/slide9.xml.rels'] = rels([['im', 'image', '../media/poster.png']]);
    p['ppt/media/poster.png'] = png();
    const r = success(p);
    expect(first(r)).toContain('left:192px;top:0px;width:192px;height:192px');
    expect(codes(r)).not.toContain('object_skipped');
    expect(codes(r)).not.toContain('object_placeholder');
  });
  it('redraws a chart with bounded points and ticks whatever the file says', () => {
    const CH = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
    const p = parts(`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Chart"/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="4572000" cy="2743200"/></p:xfrm><a:graphic><a:graphicData uri="${CH}"><c:chart xmlns:c="${CH}" r:id="ch"/></a:graphicData></a:graphic></p:graphicFrame>`);
    p['ppt/slides/_rels/slide9.xml.rels'] = rels([['ch', 'chart', '../charts/chart1.xml']]);
    const pts = (vals: string[], far = false) => vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('') + (far ? '<c:pt idx="999999999"><c:v>1</c:v></c:pt>' : '');
    p['ppt/charts/chart1.xml'] = `<c:chartSpace xmlns:c="${CH}" xmlns:a="${A}"><c:chart><c:plotArea><c:barChart><c:barDir val="col"/><c:ser><c:idx val="0"/><c:cat><c:strRef><c:strCache>${pts(['A', 'B'])}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:numCache>${pts(['0.2', '0.8'], true)}</c:numCache></c:numRef></c:val></c:ser></c:barChart><c:valAx><c:scaling><c:max val="1000000000"/></c:scaling><c:majorGridlines/></c:valAx></c:plotArea></c:chart></c:chartSpace>`;
    const r = success(p);
    expect(codes(r), JSON.stringify(r.diagnostics)).toContain('chart_redrawn');
    expect((first(r).match(/<line /g) ?? []).length).toBeLessThan(50);
  });
  it('draws a built-in table style named only by its id, with its corner and total cells', () => {
    const cell = (t: string) => `<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>${t}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`;
    const row = (...t: string[]) => `<a:tr h="457200">${t.map(cell).join('')}</a:tr>`;
    // Medium Style 2 - Accent 1, PowerPoint's default, with no tableStyles.xml in the package
    const html = first(success(themed(`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="T"/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="1371600"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1" lastRow="1"><a:tableStyleId>{5c22544a-7ee6-4342-b048-85bdc9fd1c3a}</a:tableStyleId></a:tblPr><a:tblGrid><a:gridCol w="914400"/><a:gridCol w="914400"/></a:tblGrid>${row('Head', 'H2')}${row('Odd', '1')}${row('Total', '2')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`)));
    const cells = html.match(/<td [^]*?<\/td>/g)!;
    expect(cells[0]).toContain('background:#4472c4');
    expect(cells[0]).toContain('color:#ffffff');
    expect(cells[0]).toContain('<b>Head</b>');
    // the first band is a tint of the accent, with white rules between cells
    expect(cells[4]).toContain('<b>Total</b>');
    expect(cells[2]).toContain('background:#cfd5ea');
    expect(cells[2]).toContain('border-bottom:2.667px solid #ffffff');
  });
  it('keeps a cell\'s own borders over the style, with double and diagonal rules and vertical text', () => {
    const own = '<a:lnR w="38100"><a:solidFill><a:srgbClr val="C00000"/></a:solidFill></a:lnR><a:lnB w="57150" cmpd="dbl"><a:solidFill><a:srgbClr val="1F4E79"/></a:solidFill></a:lnB><a:lnTlToBr w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:lnTlToBr>';
    const cell = (t: string, pr = '', attrs = '') => `<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>${t}</a:t></a:r></a:p></a:txBody><a:tcPr${attrs}>${pr}</a:tcPr></a:tc>`;
    const html = first(success(themed(`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="T"/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="914400"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr><a:tableStyleId>{5940675A-B579-460E-94D1-54222C63F5DA}</a:tableStyleId></a:tblPr><a:tblGrid><a:gridCol w="914400"/><a:gridCol w="914400"/></a:tblGrid><a:tr h="457200">${cell('Own', own)}${cell('Up', '', ' vert="vert270"')}</a:tr><a:tr h="457200">${cell('A')}${cell('B')}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`)));
    const cells = html.match(/<td [^]*?<\/td>/g)!;
    expect(cells[0]).toContain('border-right:8px solid #c00000');
    expect(cells[0]).toMatch(/border-bottom:[\d.]+px double #1f4e79/);
    expect(cells[0]).toContain('<svg');
    expect(cells[1]).toContain('rotate(270deg)');
  });
  it('formats chart numbers and dates as Excel does, and scales axes as Office does', () => {
    expect(formatValue(1234.5, '#,##0')).toBe('1,235');
    expect(formatValue(0.256, '0.0%')).toBe('25.6%');
    expect(formatValue(1234.5, '"$"#,##0.00')).toBe('$1,234.50');
    expect(formatValue(12345, '0.00E+00')).toBe('1.23E+04');
    expect(formatValue(45292, 'mmm yy')).toBe('Jan 24');
    expect(formatValue(45292.5, 'yyyy-mm-dd hh:mm')).toBe('2024-01-01 12:00');
    expect(formatValue(12000, '#,##0,"k"')).toBe('12k');
    expect(formatValue(-5, '0;(0)')).toBe('(5)');
    expect(autoScale(0, 20)).toEqual({ min: 0, max: 25, step: 5 });
    expect(autoScale(0, 18)).toEqual({ min: 0, max: 20, step: 2 });
    expect(autoScale(-10, 20)).toEqual({ min: -15, max: 25, step: 5 });
  });
  const chartPackage = (xml: string, ex = false) => {
    const CH = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
    const p = themed(`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Chart"/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="4572000" cy="2743200"/></p:xfrm><a:graphic><a:graphicData uri="${ex ? 'http://schemas.microsoft.com/office/drawing/2014/chartex' : CH}"><c:chart xmlns:c="${ex ? 'http://schemas.microsoft.com/office/drawing/2014/chartex' : CH}" r:id="ch"/></a:graphicData></a:graphic></p:graphicFrame>`);
    p['ppt/slides/_rels/slide9.xml.rels'] = ex ? `<Relationships xmlns="${REL}"><Relationship Id="ch" Type="http://schemas.microsoft.com/office/2014/relationships/chartEx" Target="../charts/chartEx1.xml"/></Relationships>` : rels([['ch', 'chart', '../charts/chart1.xml']]);
    p[ex ? 'ppt/charts/chartEx1.xml' : 'ppt/charts/chart1.xml'] = xml;
    return p;
  };
  const pts = (vals: (string | number)[]) => vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('');
  const ser = (i: number, name: string, vals: number[], extra = '') => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:strCache>${pts([name])}</c:strCache></c:strRef></c:tx>${extra}<c:cat><c:strRef><c:strCache>${pts(vals.map((_, k) => `C${k}`))}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:numCache>${pts(vals)}</c:numCache></c:numRef></c:val></c:ser>`;
  const space = (plot: string, more = '') => `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="${A}"><c:chart>${more}<c:plotArea>${plot}</c:plotArea><c:legend><c:legendPos val="r"/></c:legend></c:chart></c:chartSpace>`;
  it('colours every slice of a pie and puts a doughnut\'s first series innermost', () => {
    const pie = first(success(chartPackage(space(`<c:pieChart><c:varyColors val="1"/>${ser(0, 'Share', [3, 2, 1])}</c:pieChart>`))));
    expect(new Set(pie.match(/<path d="M[^"]*A[^"]*" fill="(#[0-9a-f]{6})"/g)?.map(m => m.slice(-8, -1))).size).toBe(3);
    // a single series names the chart
    expect(pie).toContain('>Share</text>');
    const ring = first(success(chartPackage(space(`<c:doughnutChart><c:varyColors val="1"/>${ser(0, 'Inner', [1, 1])}${ser(1, 'Outer', [1, 1])}<c:holeSize val="50"/></c:doughnutChart>`, '<c:autoTitleDeleted val="1"/>'))));
    // the legend lists categories, not series
    expect(ring).toContain('>C0</text>');
    expect(ring).not.toContain('>Inner</text>');
  });
  it('draws stacked percentages, secondary axes, trendlines, stock and surface charts', () => {
    const axes = '<c:catAx><c:axId val="1"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx><c:valAx><c:axId val="2"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="1"/></c:valAx>';
    const pct = first(success(chartPackage(space(`<c:barChart><c:barDir val="col"/><c:grouping val="percentStacked"/><c:overlap val="100"/>${ser(0, 'A', [1, 3])}${ser(1, 'B', [1, 1])}<c:axId val="1"/><c:axId val="2"/></c:barChart>${axes}`))));
    expect(pct).toContain('>100%</text>');
    expect(pct).not.toContain('>10000%</text>');
    const trend = first(success(chartPackage(space(`<c:lineChart><c:grouping val="standard"/>${ser(0, 'Sales', [1, 2, 3, 5], '<c:trendline><c:trendlineType val="linear"/><c:dispEq val="1"/></c:trendline>')}<c:axId val="1"/><c:axId val="2"/></c:lineChart>${axes}`))));
    expect(trend).toContain('Linear (Sales)');
    expect(trend).toMatch(/y = [\d.]+x/);
    const surface = first(success(chartPackage(space(`<c:surfaceChart>${ser(0, 'R1', [1, 9, 1])}${ser(1, 'R2', [9, 1, 9])}<c:axId val="1"/><c:axId val="2"/><c:axId val="3"/></c:surfaceChart>${axes}<c:serAx><c:axId val="3"/><c:axPos val="b"/><c:crossAx val="2"/></c:serAx>`))));
    // a legend of value bands, the series named along the side
    expect(surface).toContain('>0-1</text>');
    expect(surface).toContain('>9-10</text>');
    expect(surface).toContain('>R2</text>');
  });
  it('redraws Office 2016 waterfall, histogram and treemap charts from their chartex part', () => {
    const CX = 'http://schemas.microsoft.com/office/drawing/2014/chartex';
    const dim = (type: string, vals: (string | number)[], num = true) => `<cx:${num ? 'numDim' : 'strDim'} type="${type}"><cx:lvl ptCount="${vals.length}">${vals.map((v, i) => `<cx:pt idx="${i}">${v}</cx:pt>`).join('')}</cx:lvl></cx:${num ? 'numDim' : 'strDim'}>`;
    const ex = (layout: string, data: string, pr = '') => `<cx:chartSpace xmlns:cx="${CX}" xmlns:a="${A}"><cx:chartData><cx:data id="0">${data}</cx:data></cx:chartData><cx:chart><cx:plotArea><cx:plotAreaRegion><cx:series layoutId="${layout}"><cx:dataLabels pos="outEnd"><cx:visibility seriesName="0" categoryName="0" value="1"/></cx:dataLabels><cx:dataId val="0"/>${pr}</cx:series></cx:plotAreaRegion><cx:axis id="0"><cx:catScaling/></cx:axis><cx:axis id="1"><cx:valScaling/></cx:axis></cx:plotArea><cx:legend pos="b"/></cx:chart></cx:chartSpace>`;
    const fall = success(chartPackage(ex('waterfall', dim('cat', ['Start', 'Up', 'Down', 'End'], false) + dim('val', [100, 40, -20, 120]), '<cx:layoutPr><cx:subtotals><cx:idx val="0"/><cx:idx val="3"/></cx:subtotals></cx:layoutPr>'), true));
    expect(codes(fall)).toContain('chart_redrawn');
    const html = first(fall);
    expect(html).toContain('>Increase</text>');
    expect(html).toContain('>120</text>');
    // the totals stand on the axis: four bars, none of them empty
    expect((html.match(/<rect [^>]*height="(?!0\.5")[\d.]+"[^>]*fill="#/g) ?? []).length).toBeGreaterThanOrEqual(4);
    const hist = first(success(chartPackage(ex('clusteredColumn', dim('val', [1, 2, 2, 3, 3, 3, 4, 9]), '<cx:layoutPr><cx:binning intervalClosed="r"><cx:binCount val="4"/></cx:binning></cx:layoutPr>'), true)));
    expect((hist.match(/>[[(][\d.]+, [\d.]+\]<\/text>/g) ?? []).length).toBe(4);
    const tree = first(success(chartPackage(ex('treemap', `<cx:strDim type="cat"><cx:lvl ptCount="3"><cx:pt idx="0">A1</cx:pt><cx:pt idx="1">A2</cx:pt><cx:pt idx="2">B1</cx:pt></cx:lvl><cx:lvl ptCount="3"><cx:pt idx="0">A</cx:pt><cx:pt idx="1">A</cx:pt><cx:pt idx="2">B</cx:pt></cx:lvl></cx:strDim>${dim('size', [5, 3, 2])}`), true)));
    expect(tree).toContain('>A</text>');
    expect(tree).toContain('>B</text>');
  });
  it('reads embedded workbooks and OLE objects as nothing but keeps the file', () => {
    const p = parts(); p['ppt/embeddings/Book1.xlsx'] = new Uint8Array([80, 75, 3, 4]);
    expect(success(p).files['uploads/test-import/source.pptx']).toBeDefined();
  });
});

describe('PPTX hostile input and resource budgets', () => {
  it('rejects non-PPTX, corrupt ZIP and invalid options atomically', () => {
    failure(new Uint8Array([1, 2, 3]), 'invalid_zip');
    failure(pack({ 'hello.txt': 'not pptx' }), 'invalid_package');
    expect(importPptx(pack(), { ...options, id: '../escape' }).ok).toBe(false);
    const bytes = pack(); bytes[40] ^= 255;
    expect(importPptx(bytes, options).ok).toBe(false);
  });
  it.each(['../escape.xml', '/absolute.xml', 'ppt/../escape.xml', 'ppt\\evil.xml', 'ppt/%2e%2e/evil.xml'])('rejects unsafe archive path %s', path => {
    failure({ ...parts(), [path]: 'evil' }, 'unsafe_path');
  });
  it('rejects duplicate ZIP entries even if unzip would overwrite one', () => {
    // Rename a second equal-length member in local and central headers.
    const bytes = pack({ ...parts(), 'abc.xml': '<a/>', 'def.xml': '<b/>' });
    const from = strToU8('def.xml'), to = strToU8('abc.xml');
    for (let i = 0; i <= bytes.length - from.length; i++) if (from.every((v, j) => bytes[i + j] === v)) bytes.set(to, i);
    failure(bytes, 'duplicate_path');
  });
  it('rejects DTD and malformed XML anywhere in the package', () => {
    const p = parts();
    p['ppt/slides/slide9.xml'] = '<!DOCTYPE x [<!ENTITY x "boom">]>' + slide(shape());
    failure(p, 'forbidden_xml');
    p['ppt/slides/slide9.xml'] = '<bad>';
    failure(p, 'invalid_xml');
  });
  it('rejects package escapes and never follows external relationships', () => {
    const p = parts();
    p['ppt/_rels/presentation.xml.rels'] = rels([['s2', 'slide', '../../../evil.xml']]);
    failure(p, 'unsafe_relationship');
    p['ppt/_rels/presentation.xml.rels'] = rels([['s2', 'slide', 'https://example.com/evil', 'External'], ['s1', 'slide', 'slides/slide1.xml']]);
    const r = success(p);
    expect(r.diagnostics.find(d => d.code === 'slide_skipped')?.params?.reason).toBe('missing_relationship');
    p['ppt/_rels/presentation.xml.rels'] = rels([['s2', 'slide', 'https://example.com/evil', 'External']]);
    failure(p, 'missing_relationship');
  });
  it('rejects duplicate relationship IDs and macro payloads, and leaves out missing slides', () => {
    const p = parts();
    p['ppt/_rels/presentation.xml.rels'] = rels([['s2', 'slide', 'slides/slide9.xml'], ['s2', 'slide', 'slides/slide1.xml']]);
    failure(p, 'duplicate_relationship');
    delete p['ppt/slides/slide9.xml'];
    p['ppt/_rels/presentation.xml.rels'] = rels([['s2', 'slide', 'slides/slide9.xml']]);
    failure(p, 'missing_part');
    failure({ ...parts(), 'ppt/vbaProject.bin': new Uint8Array([1]) }, 'forbidden_package');
  });
  it.each([
    ['compressedBytes', 10], ['expandedBytes', 100], ['entries', 2], ['partBytes', 50],
    ['xmlBytes', 50], ['xmlDepth', 3], ['xmlNodes', 5], ['totalXmlNodes', 5], ['slides', 1],
  ] as const)('enforces %s budget', (key, value) => {
    failure(parts(), 'limit_exceeded', { [key]: value });
  });
  it('stops the report, not the import, at the diagnostics budget', () => {
    expect(success(parts(), { diagnostics: 1 }).diagnostics).toHaveLength(1);
  });
  it('still says which slides were left out once the diagnostics budget is spent', () => {
    const p = parts(); p['ppt/slides/slide1.xml'] = slide(shape()).replace(P, 'urn:fake');
    const r = success(p, { diagnostics: 1 });
    expect(codes(r)).toContain('slide_skipped');
  });
  it('bounds actual expansion independently of forged ZIP uncompressed size', () => {
    const bytes = pack({ ...parts(), 'bomb.txt': 'A'.repeat(100000) });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < bytes.length - 46; i++) if (view.getUint32(i, true) === 0x02014b50) {
      const len = view.getUint16(i + 28, true);
      if (new TextDecoder().decode(bytes.subarray(i + 46, i + 46 + len)) === 'bomb.txt') view.setUint32(i + 24, 1, true);
    }
    expect(importPptx(bytes, { ...options, limits: { expandedBytes: 10000 } }).ok).toBe(false);
  });
  it('rejects encrypted ZIP flags', () => {
    const bytes = pack(); const view = new DataView(bytes.buffer);
    for (let i = 0; i < bytes.length - 46; i++) {
      const signature = view.getUint32(i, true);
      if (signature === 0x04034b50) view.setUint16(i + 6, view.getUint16(i + 6, true) | 1, true);
      if (signature === 0x02014b50) view.setUint16(i + 8, view.getUint16(i + 8, true) | 1, true);
    }
    failure(bytes, 'forbidden_package');
  });
});
