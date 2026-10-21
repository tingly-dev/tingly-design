import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { importPptx } from '../src/pptx';
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
    expect(a.files[a.report.source]).toEqual(bytes);
    expect(JSON.parse(textFile(a, a.report.path))).toEqual(a.report);
    expect(first(a)).toContain('Hello 中文 &amp; &lt;script&gt;');
    expect(first(a)).toContain('<b>');
    expect(first(a)).toContain('font-size:64px');
    for (const s of a.report.slides) expect(checkSlide(parseDc(textFile(a, `slides/${s.id}.html`)), s.id).filter(i => i.level === 'error')).toEqual([]);
  });
  it('contains a 4:3 page uniformly without changing source units', () => {
    const p = parts(shape(para('Page'), 'rect', '', xfrm(914400, 914400, 1828800, 914400)), 9144000, 6858000);
    const r = success(p);
    expect(first(r)).toContain('left:384px;top:144px;width:288px;height:144px');
    expect(first(r)).toContain('font-size:48px');
    expect(r.diagnostics.map(d => d.code)).toContain('page_contained');
  });
  it('recognizes namespace URIs rather than prefixes', () => {
    const p = parts();
    for (const [k, v] of Object.entries(p)) if (typeof v === 'string') p[k] = v.replace(/xmlns:p=/g, 'xmlns:z=').replace(/\bp:/g, 'z:').replace(/xmlns:a=/g, 'xmlns:d=').replace(/\ba:/g, 'd:');
    expect(first(success(p))).toContain('Hello 中文');
  });
  it.each(['rect', 'roundRect', 'ellipse', 'line'])('maps basic %s geometry', geom => {
    const r = success(parts(shape('', geom, '<a:ln w="12700"><a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill></a:ln>')));
    if (geom === 'line') { expect(first(r)).toContain('<line x1="0" y1="0" x2="100%" y2="100%"'); }
    else expect(first(r)).toContain(`kind="${geom === 'roundRect' ? 'rounded' : geom}"`);
    expect(first(r)).toContain('#abcdef');
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
  it('retains PNG media once and links local uploads, with rotation and hidden slides', () => {
    const pic = `<p:pic><p:nvPicPr><p:cNvPr id="8" name="A &amp; B"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="im"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm().replace('<a:xfrm>', '<a:xfrm rot="5400000">')}<a:prstGeom prst="rect"/></p:spPr></p:pic>`;
    const p = parts(pic + pic.replace('id="8"', 'id="9"'));
    p['ppt/slides/slide9.xml'] = slide(pic, '', 'show="0"');
    p['ppt/slides/_rels/slide9.xml.rels'] = rels([['im', 'image', '../media/image.png']]);
    p['ppt/media/image.png'] = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH1sAAAAASUVORK5CYII=', 'base64'));
    const r = success(p);
    expect(first(r)).toContain(' hidden');
    expect(first(r)).toContain('rotate(90deg)');
    expect(first(r)).toContain('src="uploads/test-import/media/');
    expect(Object.keys(r.files).filter(f => f.endsWith('.png'))).toHaveLength(1);
  });
  it('retains source image bytes and maps asymmetric crop into an editable clipped image', () => {
    const p = parts(`<p:pic><p:nvPicPr><p:cNvPr id="8" name="Crop"/></p:nvPicPr><p:blipFill><a:blip r:embed="im"/><a:srcRect l="10000" t="20000" r="30000" b="0"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(914400, 457200, 1828800, 914400)}</p:spPr></p:pic>`);
    p['ppt/slides/_rels/slide9.xml.rels'] = rels([['im', 'image', '../media/crop.png']]);
    const image = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH1sAAAAASUVORK5CYII=', 'base64'));
    p['ppt/media/crop.png'] = image;
    const r = success(p), html = first(r);
    expect(html).toContain('left:192px;top:96px;width:384px;height:192px;overflow:hidden');
    expect(html).toContain('left:-16.667%;top:-25%;width:166.667%;height:125%');
    expect(r.files['uploads/test-import/media/image-1.png']).toEqual(image);
    const bad = { ...p, 'ppt/slides/slide9.xml': String(p['ppt/slides/slide9.xml']).replace('r="30000"', 'r="90000"') };
    failure(bad, 'invalid_value');
  });
  it('imports an explicit native table with editable cell text, independent fonts and exact cell geometry', () => {
    const cell = (text: string, size: number, fill: string) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${para(text, '').replace('sz="2400"', `sz="${size}"`)}</a:txBody><a:tcPr marL="45720" marR="45720" marT="0" marB="0" anchor="ctr"><a:lnL><a:noFill/></a:lnL><a:lnR><a:noFill/></a:lnR><a:lnT><a:noFill/></a:lnT><a:lnB><a:noFill/></a:lnB><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></a:tcPr></a:tc>`;
    const frame = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="Table"/></p:nvGraphicFramePr><p:xfrm><a:off x="914400" y="457200"/><a:ext cx="2743200" cy="1371600"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="914400"/><a:gridCol w="1828800"/></a:tblGrid><a:tr h="457200">${cell('Header A', 2400, '123456')}${cell('Header B', 2000, '123456')}</a:tr><a:tr h="914400">${cell('Value A', 1800, 'ABCDEF')}${cell('Value B', 1600, 'ABCDEF')}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    const p = parts(frame), html = first(success(p));
    expect(html).toContain('<table');
    expect(html.match(/<td\b/g)).toHaveLength(4);
    expect(html).toContain('Header A');
    expect(html).toContain('Value B');
    expect(html).toContain('width:192px;height:96px');
    expect(html).toContain('background:#abcdef');
    expect(html).toContain('font-size:42.667px');
    failure(parts(frame.replace('<a:tc>', '<a:tc gridSpan="2">')), 'unsupported_element');
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
});

describe('PPTX located unsupported-content failures', () => {
  it.each(['star5', 'triangle'])('rejects unsupported geometry %s with part, slide and object location', geom => {
    const r = failure(parts(shape('', geom)), 'unsupported_geometry');
    expect(r.diagnostics.find(d => d.code === 'unsupported_geometry')).toMatchObject({ part: 'ppt/slides/slide9.xml', slide: 'test-import-1', object: '7' });
  });
  it.each(['graphicFrame', 'grpSp', 'contentPart', 'AlternateContent'])('does not silently drop visible %s', tag => {
    failure(parts(`<p:${tag}/>`), 'unsupported_element');
  });
  it('rejects missing media, mixed font sizes, cropped pictures, notes overflow and unimplemented bullet layout', () => {
    const p = parts(shape(`${para('Big')}<a:p><a:r><a:rPr sz="1200"/><a:t>Small</a:t></a:r></a:p>`));
    failure(p, 'unsupported_text_style');
    failure(parts(shape('<a:p><a:pPr><a:buChar char="•"/></a:pPr><a:r><a:t>Bullet</a:t></a:r></a:p>')), 'unsupported_text_style');
    failure(parts('<p:pic><p:blipFill><a:blip r:embed="missing"/></p:blipFill></p:pic>'), 'missing_relationship');
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
  it('rejects DTD and malformed XML and requires the correct namespace', () => {
    const p = parts();
    p['ppt/slides/slide9.xml'] = '<!DOCTYPE x [<!ENTITY x "boom">]>' + slide(shape());
    failure(p, 'forbidden_xml');
    p['ppt/slides/slide9.xml'] = '<bad>';
    failure(p, 'invalid_xml');
    p['ppt/slides/slide9.xml'] = slide(shape()).replace(P, 'urn:fake');
    failure(p, 'invalid_part');
  });
  it('rejects package escapes and external relationships without fetching', () => {
    const p = parts();
    p['ppt/_rels/presentation.xml.rels'] = rels([['s2', 'slide', '../../../evil.xml']]);
    failure(p, 'unsafe_relationship');
    p['ppt/_rels/presentation.xml.rels'] = rels([['s2', 'slide', 'https://example.com/evil', 'External']]);
    failure(p, 'external_relationship');
  });
  it('rejects duplicate relationship IDs, missing parts and macro payloads', () => {
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
    ['xmlBytes', 50], ['xmlDepth', 3], ['xmlNodes', 5], ['totalXmlNodes', 5], ['diagnostics', 1], ['slides', 1],
  ] as const)('enforces %s budget', (key, value) => {
    failure(parts(), 'limit_exceeded', { [key]: value });
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
  it.each([NaN, Infinity, 0, -1, 1.5, 999999999999])('does not permit invalid or raised limits %s', value => {
    failure(parts(), 'invalid_options', { xmlDepth: value });
  });
  it('rejects foreign namespace visual branches and complex text/style content', () => {
    failure(parts(`<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">${shape(para('lost'))}</mc:AlternateContent>`), 'unsupported_element');
    failure(parts(shape('<a:p><a:r><a:t>Keep</a:t><a:unknown>lost</a:unknown></a:r></a:p>')), 'unsupported_element');
    failure(parts(shape(para('Effects'), 'rect', '<a:effectLst><a:outerShdw/></a:effectLst>')), 'unsupported_style');
  });
  it('rejects notes exceeding editor capacity without truncation', () => {
    const p = parts();
    p['ppt/slides/_rels/slide9.xml.rels'] = rels([['n', 'notesSlide', '../notesSlides/n.xml']]);
    p['ppt/notesSlides/n.xml'] = `<p:notes xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody>${para('A'.repeat(4001))}</p:txBody></p:sp></p:spTree></p:cSld></p:notes>`;
    failure(p, 'notes_too_long');
  });
  it('rejects missing image bytes, malformed image signatures, unsupported fill offsets and excessive image pixels', () => {
    const pic = `<p:pic><p:blipFill><a:blip r:embed="im"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm()}</p:spPr></p:pic>`;
    const p = parts(pic);
    p['ppt/slides/_rels/slide9.xml.rels'] = rels([['im', 'image', '../media/a.png']]);
    failure(p, 'missing_part');
    p['ppt/media/a.png'] = new Uint8Array([1, 2, 3]); failure(p, 'invalid_media');
    p['ppt/media/a.png'] = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH1sAAAAASUVORK5CYII=', 'base64'));
    const media = p['ppt/media/a.png'] as Uint8Array;
    const original = media.slice(); new DataView(media.buffer).setUint32(16, 2);
    failure(p, 'limit_exceeded', { mediaPixels: 1 });
    p['ppt/media/a.png'] = original;
    p['ppt/slides/slide9.xml'] = slide(pic.replace('<a:fillRect/>', '<a:fillRect l="10000"/>'));
    failure(p, 'unsupported_image_style');
  });
  it.each(['1', 'true'])('rejects hidden shape objects (%s) instead of exposing their content', hidden => {
    const r = failure(parts(shape(para('Secret')).replace('name="Shape"', `name="Shape" hidden="${hidden}"`)), 'unsupported_hidden_object');
    expect(r.diagnostics.find(d => d.code === 'unsupported_hidden_object')).toMatchObject({ part: 'ppt/slides/slide9.xml', slide: 'test-import-1', object: '7' });
  });
  it.each(['lumMod', 'lumOff'])('rejects unimplemented HSL luminance modifier %s instead of changing RGB channels', modifier => {
    const r = failure(parts(shape().replace('<a:srgbClr val="123456"/>', `<a:srgbClr val="123456"><a:${modifier} val="50000"/></a:srgbClr>`)), 'unsupported_color');
    expect(r.diagnostics.find(d => d.code === 'unsupported_color')).toMatchObject({ object: '7', params: { modifier } });
  });
  it.each(['l', 't', 'r', 'b'])('rejects nonzero stretch fill rectangle %s, accepting zero', edge => {
    const pic = `<p:pic><p:nvPicPr><p:cNvPr id="8"/></p:nvPicPr><p:blipFill><a:blip r:embed="im"/><a:stretch><a:fillRect ${edge}="0"/></a:stretch></p:blipFill><p:spPr>${xfrm()}</p:spPr></p:pic>`;
    const p = parts(pic);
    p['ppt/slides/_rels/slide9.xml.rels'] = rels([['im', 'image', '../media/a.png']]);
    p['ppt/media/a.png'] = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH1sAAAAASUVORK5CYII=', 'base64'));
    expect(first(success(p))).toContain('<img');
    p['ppt/slides/slide9.xml'] = slide(pic.replace(`${edge}="0"`, `${edge}="10000"`));
    const r = failure(p, 'unsupported_image_style');
    expect(r.diagnostics.find(d => d.code === 'unsupported_image_style')).toMatchObject({ part: 'ppt/slides/slide9.xml', object: '8' });
  });
  it('resolves a solid background style matrix reference and rejects non-solid or missing entries', () => {
    const p = parts();
    p['ppt/slides/slide9.xml'] = slide(shape(), '<p:bg><p:bgRef idx="1001"><a:srgbClr val="fedcba"/></p:bgRef></p:bg>');
    p['ppt/_rels/presentation.xml.rels'] = rels([['s1', 'slide', 'slides/slide1.xml'], ['s2', 'slide', 'slides/slide9.xml'], ['theme', 'theme', 'theme/t.xml']]);
    p['ppt/theme/t.xml'] = `<a:theme xmlns:a="${A}"><a:themeElements><a:fmtScheme><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
    expect(first(success(p))).toContain('background:#fedcba');
    p['ppt/theme/t.xml'] = String(p['ppt/theme/t.xml']).replace(/a:solidFill/g, 'a:gradFill');
    failure(p, 'unsupported_style');
  });
  it('supports identical script fonts, explicit solid dash and zero paragraph spacing without inventing a text border', () => {
    const body = `<a:p><a:pPr><a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft></a:pPr><a:r><a:rPr sz="2400"><a:latin typeface="Arial"/><a:ea typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>Text</a:t></a:r></a:p>`;
    const r = success(parts(shape(body, 'rect', '<a:ln/>')));
    expect(first(r)).not.toContain('border:');
    expect(first(success(parts(shape('', 'rect', '<a:ln w="12700"><a:solidFill><a:srgbClr val="123456"/></a:solidFill><a:prstDash val="solid"/></a:ln>'))))).toContain('border:2.667px solid #123456');
    failure(parts(shape('', 'rect', '<a:ln><a:prstDash val="dash"/></a:ln>')), 'unsupported_style');
  });
  it.each([
    ['spcPct', '115000', '1.15'],
    ['spcPts', '3000', '80px'],
  ])('maps explicit %s paragraph line spacing to editable CSS', (kind, value, expected) => {
    const body = `<a:p><a:pPr><a:lnSpc><a:${kind} val="${value}"/></a:lnSpc></a:pPr><a:r><a:rPr sz="2400"/><a:t>First line</a:t></a:r><a:br/><a:r><a:rPr sz="2400"/><a:t>Second line</a:t></a:r></a:p>`;
    const html = first(success(parts(shape(body))));
    expect(html).toContain(`line-height:${expected};`);
    expect(html).toContain('First line<br>Second line');
  });
  it.each(['-1', 'not-a-number'])('rejects invalid paragraph line spacing %s without partial files', value => {
    failure(parts(shape(`<a:p><a:pPr><a:lnSpc><a:spcPct val="${value}"/></a:lnSpc></a:pPr><a:r><a:t>Text</a:t></a:r></a:p>`)), 'invalid_value');
  });
  it('keeps painted empty text shapes without interpreting unused default script fonts', () => {
    const p = parts(shape().replace('</p:sp>', '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr/><a:endParaRPr/></a:p></p:txBody></p:sp>'));
    p['ppt/presentation.xml'] = String(p['ppt/presentation.xml']).replace('</p:presentation>', `<p:defaultTextStyle><a:lvl1pPr xmlns:a="${A}"><a:defRPr><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>`);
    p['ppt/slides/slide1.xml'] = p['ppt/slides/slide9.xml'];
    const html = first(success(p));
    expect(html).toContain('<x-shape');
    expect(html).not.toContain('<p ');
    expect(html).toContain('background:#123456');
    p['ppt/slides/slide9.xml'] = String(p['ppt/slides/slide9.xml']).replace('<a:pPr/>', '<a:fld id="1" type="slidenum"><a:t>1</a:t></a:fld>');
    failure(p, 'unsupported_text_style');
  });
  it('reports nonzero kerning thresholds as approximate text metrics rather than dropping text', () => {
    const r = success(parts(shape(para('Kerning', 'kern="1200"'))));
    expect(first(r)).toContain('Kerning');
    expect(r.diagnostics.map(d => d.code)).toContain('kerning_approximate');
  });
  it('lets concrete run properties override inherited script fonts before validating the resolved style', () => {
    const p = parts(shape(`<a:p><a:r><a:rPr sz="2400"><a:latin typeface="Arial"/><a:ea typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>Override 中文</a:t></a:r></a:p>`));
    p['ppt/slides/slide1.xml'] = p['ppt/slides/slide9.xml'];
    p['ppt/presentation.xml'] = String(p['ppt/presentation.xml']).replace('</p:presentation>', '<p:defaultTextStyle><a:lvl1pPr xmlns:a="' + A + '"><a:defRPr sz="1800" kern="1200"><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>');
    const html = first(success(p)); expect(html).toContain('font-family:Arial'); expect(html).toContain('Override 中文');
  });
  it('rejects invisible text fill instead of painting it black', () => {
    failure(parts(shape('<a:p><a:r><a:rPr><a:noFill/></a:rPr><a:t>Invisible</a:t></a:r></a:p>')), 'unsupported_text_style');
  });
  it('rejects unknown visible shape children, unsupported fonts and slideshow timing', () => {
    failure(parts(shape(para('text')).replace('</p:sp>', '<p:unknownVisible/></p:sp>')), 'unsupported_element');
    failure(parts(shape('<a:p><a:r><a:rPr><a:ea typeface="Different"/></a:rPr><a:t>中文</a:t></a:r></a:p>')), 'unsupported_text_style');
    const p = parts(); p['ppt/slides/slide9.xml'] = slide(shape()).replace('</p:sld>', '<p:timing/></p:sld>');
    failure(p, 'unsupported_element');
  });
  it('recognizes JPEG dimensions from bytes, not the filename', () => {
    const p = parts(`<p:pic><p:blipFill><a:blip r:embed="im"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm()}</p:spPr></p:pic>`);
    p['ppt/slides/_rels/slide9.xml.rels'] = rels([['im', 'image', '../media/a.bin']]);
    // Minimal structural JPEG frame fixture; no decoding or raster fidelity is claimed.
    p['ppt/media/a.bin'] = new Uint8Array([255,216,255,192,0,11,8,0,2,0,3,1,1,17,0,255,217]);
    const r = success(p); expect(Object.keys(r.files).some(k => k.endsWith('.jpg'))).toBe(true);
    failure(p, 'limit_exceeded', { mediaPixels: 5 });
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
  it('inherits master title text defaults and presentation defaults without layout text', () => {
    const ph = '<p:nvSpPr><p:cNvPr id="7"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>';
    const p = parts(`<p:sp>${ph}<p:spPr>${xfrm()}</p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp>`);
    p['ppt/slides/_rels/slide9.xml.rels'] = rels([['l', 'slideLayout', '../slideLayouts/l.xml']]);
    p['ppt/slideLayouts/l.xml'] = `<p:sldLayout xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree/></p:cSld></p:sldLayout>`;
    p['ppt/slideLayouts/_rels/l.xml.rels'] = rels([['m', 'slideMaster', '../slideMasters/m.xml']]);
    p['ppt/slideMasters/m.xml'] = `<p:sldMaster xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree/></p:cSld><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3600" b="1"/></a:lvl1pPr></p:titleStyle></p:txStyles></p:sldMaster>`;
    const html = first(success(p)); expect(html).toContain('font-size:96px'); expect(html).toContain('<b>Title</b>');
  });
  it('fails on unsupported visible properties nested outside the shape tree', () => {
    const p = parts(); p['ppt/slides/slide9.xml'] = slide(shape()).replace('<p:spTree>', '<p:unknownVisible/><p:spTree>');
    failure(p, 'unsupported_element');
    failure(parts(shape().replace('<a:prstGeom', '<a:unknownVisible/><a:prstGeom')), 'unsupported_style');
  });
  it('bounds generated source rather than truncating it', () => {
    failure(parts(Array.from({ length: 210 }, (_, i) => shape('', 'rect', '', xfrm(), String(i))).join('')), 'generated_slide_invalid');
  });
});
