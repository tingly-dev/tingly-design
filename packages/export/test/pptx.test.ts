import { describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { writePptx, type PptxDeck, type PptxObject } from '../src/pptx';

const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
const box = { x: 100, y: 50, width: 400, height: 200 };
const SVG_BYTES = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 1"><rect width="2" height="1" fill="#123456"/></svg>');
const text = (s = 'Hello 中文 <&> "'): PptxObject => ({ type: 'text', ...box, style: { fontFace: 'Aptos', fontSizePx: 32 }, paragraphs: [{ runs: [{ text: s }] }] });
const deck = (objects: PptxObject[] = [text()]): PptxDeck => ({ title: 'Deck 中文 <&>', widthPx: 1000, heightPx: 500, widthIn: 10, slides: [{ objects }] });
const xml = (files: Record<string, Uint8Array>, name: string) => strFromU8(files[name]);
const unpack = async (d: PptxDeck) => unzipSync(await writePptx(d));

// This suite reads the OPC package independently; it never reimports with our importer.
describe('writePptx native drawing contract', () => {
  it('writes native Unicode text, escaped metadata, page units and textbox geometry', async () => {
    const f = await unpack(deck());
    const s = xml(f, 'ppt/slides/slide1.xml');
    expect(s).toContain('<p:sp>');
    expect(s).toContain('<a:t>Hello 中文 &lt;&amp;&gt; &quot;</a:t>');
    expect(s).not.toContain('<p:pic>');
    expect(s).toContain('<a:off x="914400" y="457200"/>');
    expect(s).toContain('<a:ext cx="3657600" cy="1828800"/>');
    expect(s).toContain('sz="2304"'); // 32px * (10in / 1000px) * 72pt/in
    expect(s).toContain('typeface="Aptos"');
    expect(xml(f, 'ppt/presentation.xml')).toContain('<p:sldSz cx="9144000" cy="4572000"');
    expect(xml(f, 'docProps/core.xml')).toContain('Deck 中文 &lt;&amp;&gt;');
    expect(xml(f, '[Content_Types].xml')).toContain('presentationml.presentation.main+xml');
    expect(Object.keys(f).some(k => /^ppt\/media\/[^/]+$/.test(k))).toBe(false);
  });

  it('preserves slide order, notes, solid backgrounds, rich runs and distinct paragraphs', async () => {
    const d = deck();
    d.slides = [{ background: '123ABC', notes: 'Speaker 中文 <&>\nsecond', objects: [{ ...text(), type: 'text', ...box, style: { fontFace: 'Aptos', fontSizePx: 20 }, verticalAlign: 'middle', paddingPx: 5, paragraphs: [
      { align: 'center', runs: [{ text: 'FIRST', style: { bold: true, color: 'FF0000', italic: true, underline: true } }, { text: ' plain' }] },
      { align: 'right', runs: [{ text: '下一段' }] },
    ] }] }, { objects: [text('SECOND')] }];
    const f = await unpack(d);
    const first = xml(f, 'ppt/slides/slide1.xml');
    expect(first).toContain('FIRST'); expect(first).not.toContain('SECOND');
    expect(xml(f, 'ppt/slides/slide2.xml')).toContain('SECOND');
    expect(first).toContain('val="123ABC"'); expect(first).toContain('anchor="ctr"');
    expect(first).toContain('lIns="45720"');
    expect(first).toMatch(/<a:rPr[^>]*b="1"[^>]*i="1"[^>]*u="sng"/);
    expect(first).toContain('val="FF0000"');
    expect(first).toContain('algn="ctr"'); expect(first).toContain('algn="r"');
    expect(first.match(/<a:p>/g)?.length).toBe(2);
    expect(xml(f, 'ppt/notesSlides/notesSlide1.xml')).toContain('Speaker 中文 &lt;&amp;&gt;');
    expect(xml(f, 'ppt/notesSlides/notesSlide1.xml')).toContain('second');
    const rels = xml(f, 'ppt/_rels/presentation.xml.rels');
    const order = [...xml(f, 'ppt/presentation.xml').matchAll(/<p:sldId\s[^>]*r:id="([^"]+)"/g)].map(m => m[1]);
    expect(order).toHaveLength(2);
    expect(rels).toMatch(new RegExp(`Id="${order[0]}"[^>]*Target="slides/slide1.xml"`));
    expect(rels).toMatch(new RegExp(`Id="${order[1]}"[^>]*Target="slides/slide2.xml"`));
  });

  it('orders the notes master before slide IDs and sizes while retaining notes relationships', async () => {
    const d = deck(); d.slides[0].notes = 'Notes 中文 <&>\nnext';
    const f = await unpack(d);
    const p = xml(f, 'ppt/presentation.xml');
    expect(p.indexOf('<p:notesMasterIdLst>')).toBeGreaterThan(p.indexOf('</p:sldMasterIdLst>'));
    expect(p.indexOf('</p:notesMasterIdLst>')).toBeLessThan(p.indexOf('<p:sldIdLst>'));
    expect(p.indexOf('</p:sldIdLst>')).toBeLessThan(p.indexOf('<p:sldSz '));
    const id = p.match(/<p:notesMasterId r:id="([^"]+)"/)![1];
    expect(xml(f, 'ppt/_rels/presentation.xml.rels')).toContain(`Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="notesMasters/notesMaster1.xml"`);
    expect(xml(f, 'ppt/notesSlides/notesSlide1.xml')).toContain('Notes 中文 &lt;&amp;&gt;');
    expect(xml(f, 'ppt/notesSlides/notesSlide1.xml')).toContain('next');
  });

  it('emits one leading paragraph properties node for mixed runs without losing text or formatting', async () => {
    const d = deck([{ type: 'text', ...box, style: { fontFace: 'Arial', fontSizePx: 20 }, paragraphs: [
      { align: 'center', runs: [{ text: 'first <&>', style: { bold: true } }, { text: '中文', style: { color: 'FF0000', italic: true } }, { text: 'last', style: { underline: true } }] },
      { align: 'right', runs: [{ text: '' }, { text: 'after blank' }] },
      { align: 'justify', runs: [{ text: 'final' }, { text: ' run' }] },
    ] }]);
    const s = xml(await unpack(d), 'ppt/slides/slide1.xml');
    const paragraphs = [...s.matchAll(/<a:p>(.*?)<\/a:p>/g)].map(m => m[1]);
    expect(paragraphs).toHaveLength(3);
    for (const [i, p] of paragraphs.entries()) {
      expect(p.match(/<a:pPr\b/g)).toHaveLength(1);
      expect(p).toMatch(new RegExp(`^<a:pPr algn="${['ctr', 'r', 'just'][i]}"`));
    }
    expect([...s.matchAll(/<a:t>(.*?)<\/a:t>/g)].map(m => m[1])).toEqual(['first &lt;&amp;&gt;', '中文', 'last', 'after blank', 'final', ' run']);
    expect(s).toMatch(/<a:rPr[^>]*b="1"[^]*?<a:t>first/);
    expect(s).toMatch(/<a:rPr[^>]*i="1"[^]*?val="FF0000"[^]*?<a:t>中文/);
    expect(s).toMatch(/<a:rPr[^>]*u="sng"[^]*?<a:t>last/);
  });

  it.each([1, 3, 12])('declares only existing master parts for a %i-slide deck without changing slide parts', async count => {
    const d = deck(); d.slides = Array.from({ length: count }, (_, i) => ({ objects: [text(`page ${i + 1}`)], ...(i % 2 ? { notes: `note ${i + 1}` } : {}) }));
    const f = await unpack(d);
    const types = xml(f, '[Content_Types].xml');
    const overrides = [...types.matchAll(/<Override PartName="\/([^"]+)"/g)].map(m => m[1]);
    for (const part of overrides) expect(f, part).toHaveProperty(part);
    expect(overrides.filter(p => p.startsWith('ppt/slideMasters/'))).toEqual(['ppt/slideMasters/slideMaster1.xml']);
    for (let i = 1; i <= count; i++) {
      expect(xml(f, `ppt/slides/slide${i}.xml`)).toContain(`<a:t>page ${i}</a:t>`);
      expect(overrides).toContain(`ppt/slides/slide${i}.xml`);
      if (i % 2 === 0) expect(xml(f, `ppt/notesSlides/notesSlide${i}.xml`)).toContain(`note ${i}`);
    }
  });

  it('uses the physical page scale for every font, padding and stroke, not 96dpi', async () => {
    const d = deck([{ type: 'shape', shape: 'rect', ...box, stroke: { color: '000000', widthPx: 2 } }, text()]);
    d.widthIn = 20;
    const s = xml(await unpack(d), 'ppt/slides/slide1.xml');
    expect(s).toContain('w="36576"'); // 2px * .02in * 914400
    expect(s).toContain('sz="4608"');
    expect(s).toContain('<a:off x="1828800" y="914400"/>');
  });

  it('writes editable basic shapes and clockwise rotations including zero-height lines', async () => {
    const f = await unpack(deck(['rect', 'roundRect', 'ellipse', 'line'].map(shape => ({ type: 'shape', shape, ...box, ...(shape === 'line' ? { height: 0 } : {}), fill: shape === 'line' ? undefined : 'FF9900', stroke: { color: '000000', widthPx: 2 }, rotation: 30 } as PptxObject))));
    const s = xml(f, 'ppt/slides/slide1.xml');
    for (const shape of ['rect', 'roundRect', 'ellipse', 'line']) expect(s).toContain(`prst="${shape}"`);
    expect(s.match(/rot="1800000"/g)).toHaveLength(4);
    expect(s.match(/<p:sp>/g)).toHaveLength(4);
  });

  it('embeds local bytes, deduplicates repeated assets on a slide, and writes cover crop/contain/stretch geometry and rotation', async () => {
    const d = deck(['cover', 'contain', 'stretch'].map(fit => ({ type: 'image', asset: 'local', x: 0, y: 0, width: 100, height: 100, fit, rotation: 90 } as PptxObject)));
    d.assets = { local: { bytes: png, mime: 'image/png', widthPx: 2, heightPx: 1 } };
    const f = await unpack(d); const s = xml(f, 'ppt/slides/slide1.xml');
    const media = Object.keys(f).filter(k => /^ppt\/media\/[^/]+$/.test(k));
    expect(media).toHaveLength(1); expect(f[media[0]]).toEqual(png);
    expect(s.match(/<p:pic>/g)).toHaveLength(3);
    expect(s).toContain('<a:srcRect l="25000" r="25000" t="0" b="0"/>');
    expect(s).toContain('<a:off x="0" y="228600"/>'); // centered contain: height 50px
    expect(s).toContain('<a:ext cx="914400" cy="457200"/>');
    expect(s.match(/rot="5400000"/g)).toHaveLength(3);
    expect(Object.values(f).map(v => strFromU8(v)).join('')).not.toContain('TargetMode="External"');
  });

  it('writes translucent fills and text, rounded radii, letter spacing, strike and unwrapped lines', async () => {
    const f = await unpack(deck([
      { type: 'shape', ...box, shape: 'roundRect', fill: 'FF0000', fillOpacity: 0.25, radiusPx: 50 },
      { type: 'text', ...box, wrap: false, style: { fontFace: 'Aptos', fontSizePx: 20, opacity: 0.5, charSpacingPx: 10, strike: true }, paragraphs: [{ runs: [{ text: 'Spaced' }] }] },
    ]));
    const s = xml(f, 'ppt/slides/slide1.xml');
    expect(s).toContain('<a:gd name="adj" fmla="val 25000"/>'); // 50px of the 200px short side
    expect(s).toMatch(/<a:srgbClr val="FF0000"><a:alpha val="25000"\/>/);
    expect(s).toContain('<a:alpha val="50000"/>');
    expect(s).toContain('spc="720"'); // 10px * 0.01in/px * 72pt/in
    expect(s).toContain('strike="sngStrike"');
    expect(s).toContain('wrap="none"');
  });

  it('rejects radius on shapes other than roundRect, opacity without a fill and values out of range', async () => {
    await expect(writePptx(deck([{ type: 'shape', ...box, shape: 'rect', fill: 'FF0000', radiusPx: 4 }]))).rejects.toThrow();
    await expect(writePptx(deck([{ type: 'shape', ...box, shape: 'rect', fillOpacity: 0.5 }]))).rejects.toThrow();
    await expect(writePptx(deck([{ ...text(), style: { fontFace: 'Aptos', fontSizePx: 20, opacity: 2 } } as PptxObject]))).rejects.toThrow();
    await expect(writePptx(deck([{ ...text(), wrap: 'no' } as unknown as PptxObject]))).rejects.toThrow();
  });

  it('escapes font attributes, preserves emoji, and snapshots before the async write', async () => {
    const d = deck([{ ...text('😀 & <'), type: 'text', ...box, style: { fontFace: 'A&B "quoted" <font>', fontSizePx: 20 }, paragraphs: [{ runs: [{ text: '😀 & <' }] }] }]);
    const pending = writePptx(d); d.slides[0].objects = [text('MUTATED')];
    const f = unzipSync(await pending); const s = xml(f, 'ppt/slides/slide1.xml');
    expect(s).toContain('typeface="A&amp;B &quot;quoted&quot; &lt;font&gt;"');
    expect(s).toContain('😀 &amp; &lt;'); expect(s).not.toContain('MUTATED');
  });

  it('rejects font sizes outside DrawingML point limits after scaling', async () => {
    for (const fontSizePx of [0.01, 100000]) await expect(writePptx(deck([{ ...text(), type: 'text', ...box, style: { fontFace: 'Arial', fontSizePx }, paragraphs: [{ runs: [{ text: 'x' }] }] }]))).rejects.toThrow(/pptx/i);
  });

  it('preserves blank paragraphs and per-paragraph alignment without drawing text duplicates', async () => {
    const d = deck([{ ...text(), type: 'text', ...box, style: { fontFace: 'Arial', fontSizePx: 20 }, paragraphs: [
      { align: 'left', runs: [{ text: 'one' }] }, { align: 'center', runs: [{ text: '' }] }, { align: 'right', runs: [{ text: 'three' }] },
    ] }]);
    const s = xml(await unpack(d), 'ppt/slides/slide1.xml');
    expect(s.match(/<a:p>/g)).toHaveLength(3);
    expect(s).toMatch(/<a:p><a:pPr algn="ctr"/);
    expect(s.match(/<a:t>one<\/a:t>/g)).toHaveLength(1);
    expect(s).toMatch(/<a:p><a:pPr algn="r"[^]*?<a:t>three<\/a:t>/);
  });

  it('bounds aggregate counts/text/assets and scaled line widths', async () => {
    const invalid: unknown[] = [
      { ...deck(), assets: null },
      { ...deck(), assets: Object.fromEntries(Array.from({ length: 2049 }, (_, i) => [i, { bytes: png, mime: 'image/png', widthPx: 2, heightPx: 1 }])) },
      deck([text('a'.repeat(700000)), text('b'.repeat(700000)), text('c'.repeat(700000))]),
      deck([{ ...text(), paragraphs: [{ runs: Array.from({ length: 50000 }, () => ({ text: '' })) }] } as PptxObject]),
      { ...deck([{ type: 'shape', shape: 'line', ...box, stroke: { color: '000000', widthPx: 1000 } }]), widthIn: 56 },
    ];
    for (const d of invalid) await expect(writePptx(d as PptxDeck)).rejects.toThrow(/pptx/i);
  });

  it('inherits omitted and explicitly undefined run styles, while allowing explicit false overrides', async () => {
    const o: PptxObject = { type: 'text', ...box, style: { fontFace: 'Arial', fontSizePx: 20, bold: true, underline: true }, paragraphs: [{ runs: [{ text: 'base', style: { fontFace: undefined, fontSizePx: undefined } }, { text: 'off', style: { bold: false, underline: false } }] }] };
    const s = xml(await unpack(deck([o])), 'ppt/slides/slide1.xml');
    expect(s).toContain('typeface="Arial"');
    expect(s).toMatch(/<a:rPr[^>]*b="1"[^>]*u="sng"[^]*?<a:t>base<\/a:t>/);
    const off = s.slice(s.indexOf('</a:r>') + 6, s.indexOf('<a:t>off'));
    expect(off).not.toContain('b="1"'); expect(off).not.toContain('u="sng"');
  });

  it('writes a native table with merges, per-side borders, fills, insets and paragraph spacing', async () => {
    const cell = (t: string, more: Record<string, unknown> = {}) => ({ paragraphs: [{ runs: t ? [{ text: t }] : [] }], style: { fontFace: 'Aptos', fontSizePx: 20 }, ...more });
    const table: PptxObject = { type: 'table', ...box, columnsPx: [100, 300], rowsPx: [100, 50, 50], rows: [
      [cell('Head', { colspan: 2, fill: '4472C4', borders: [null, null, { color: 'FFFFFF', widthPx: 2 }, null], verticalAlign: 'middle', paddingPx: [10, 5, 10, 5] })],
      [cell('Tall', { rowspan: 2, fillOpacity: 0.5, fill: 'DDDDDD' }), { ...cell(''), paragraphs: [{ runs: [{ text: 'A', style: { bold: true } }], align: 'right', spaceBeforePx: 4, lineHeightPx: 30 }, { runs: [] }] }],
      [cell('B')],
    ] };
    const s = xml(await unpack(deck([table])), 'ppt/slides/slide1.xml');
    expect(s).toContain('<a:tbl>');
    expect(s).toContain('<a:gridCol w="914400"/><a:gridCol w="2743200"/>');
    expect(s).toContain('gridSpan="2"');
    expect(s).toContain('rowSpan="2"');
    expect(s).toContain('vMerge="1"');
    expect(s).toContain('anchor="ctr"');
    expect(s).toMatch(/<a:lnB w="\d+"[^>]*><a:solidFill><a:srgbClr val="FFFFFF"/);
    expect(s).toContain('<a:srgbClr val="4472C4"');
    expect(s).toMatch(/<a:srgbClr val="DDDDDD"><a:alpha val="50000"\/>/);
    expect(s).toContain('marT="91440"'); // 10px of a 1000px, 10in page
    expect(s).toContain('<a:t>Tall</a:t>');
    expect(s).toMatch(/<a:pPr[^>]*algn="r"[^>]*>(<a:lnSpc><a:spcPts val="2160"\/><\/a:lnSpc>)?<a:spcBef><a:spcPts val="288"\/>/);
    // no table style is named, so nothing but the cells' own formatting shows
    expect(s).toContain('<a:tblPr/>');
  });
  it('rejects a table whose cells do not cover its grid exactly once, or that is rotated', async () => {
    const cell = { paragraphs: [{ runs: [{ text: 'x' }] }], style: { fontFace: 'Aptos', fontSizePx: 20 } };
    const base = { type: 'table' as const, ...box, columnsPx: [100, 100], rowsPx: [50] };
    await expect(writePptx(deck([{ ...base, rows: [[cell]] }]))).rejects.toThrow(/invalid/);
    await expect(writePptx(deck([{ ...base, rows: [[{ ...cell, colspan: 3 }]] }]))).rejects.toThrow(/invalid/);
    await expect(writePptx(deck([{ ...base, rotation: 90, rows: [[cell, cell]] }]))).rejects.toThrow(/invalid/);
    await expect(writePptx(deck([{ ...base, rows: [[cell, cell]] }]))).resolves.toBeInstanceOf(Uint8Array);
  });
  it('patches double borders and diagonals into the table XML, counting merge continuations', async () => {
    const cell = (t: string, more: Record<string, unknown> = {}) => ({ paragraphs: [{ runs: t ? [{ text: t }] : [] }], style: { fontFace: 'Aptos', fontSizePx: 20 }, ...more });
    const table: PptxObject = { type: 'table', ...box, columnsPx: [100, 100, 200], rowsPx: [100, 100], rows: [
      // the first cell sits before a colspan: its <a:tc> is index 0 even though the row lists one cell
      [cell('D', { colspan: 2, borders: [{ color: '111111', widthPx: 3, double: true }, { color: '222222', widthPx: 1 }, null, { color: '333333', widthPx: 2, double: true }], tl2br: { color: 'CC0000', widthPx: 2 } }),
        cell('diag', { tr2bl: { color: '00AA00', widthPx: 1 }, borders: [null, { color: '444444', widthPx: 1 }, null, null] })],
      [cell('plain'), cell('b'), cell('c')],
    ] };
    const s = xml(await unpack(deck([table])), 'ppt/slides/slide1.xml');
    const tcs = s.match(/<a:tc(?:\s[^>]*)?>.*?<\/a:tc>/gs) ?? [];
    expect(tcs).toHaveLength(6); // 3 grid positions per row, merge continuations included
    // 1px of this page (1000px = 10in) is 9144 EMU
    expect(tcs[0]).toContain('<a:lnT w="27432" cap="flat" cmpd="dbl"');
    expect(tcs[0]).toContain('<a:lnL w="18288" cap="flat" cmpd="dbl"');
    expect(tcs[0]).toContain('<a:lnR w="9144" cap="flat" cmpd="sng"');
    expect(tcs[0]).toContain('<a:lnTlToBr w="18288" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:srgbClr val="CC0000"/>');
    expect(tcs[0]).not.toContain('lnBlToTr');
    expect(tcs[1]).toBe('<a:tc hMerge="1"><a:tcPr/></a:tc>'); // the covered grid position is patched by index, never touched
    expect(tcs[2]).toContain('<a:lnBlToTr w="9144"');
    expect(tcs[2]).toContain(String.raw`<a:srgbClr val="00AA00"/>`);
    expect(tcs[3]).not.toContain('cmpd="dbl"');
    // diagonals join the line children before any fill, in CT_TableCellProperties order
    expect(tcs[0]).toMatch(/<\/a:lnTlToBr>\s*<\/a:tcPr>|<\/a:lnTlToBr><a:solidFill>/);
  });
  it('writes vertical cell text as the cell direction and keeps native double borders on plain cells', async () => {
    const cell = (t: string, more: Record<string, unknown> = {}) => ({ paragraphs: [{ runs: t ? [{ text: t }] : [] }], style: { fontFace: 'Aptos', fontSizePx: 20 }, ...more });
    const table: PptxObject = { type: 'table', ...box, columnsPx: [100, 100], rowsPx: [100], rows: [[
      cell('竖排', { textDirection: 'vert270', borders: [{ color: '111111', widthPx: 2, double: true }, null, null, null] }), cell('flat'),
    ]] };
    const s = xml(await unpack(deck([table])), 'ppt/slides/slide1.xml');
    const tcs = s.match(/<a:tc(?:\s[^>]*)?>.*?<\/a:tc>/gs) ?? [];
    expect(tcs[0]).toContain('vert="vert270"');
    expect(tcs[0]).toContain('cmpd="dbl"');
    expect(tcs[1]).not.toContain('vert=');
  });
  it('carries an SVG asset with its rendered PNG stand-in and svgBlip extension', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 1"><rect width="2" height="1" fill="#123456"/></svg>';
    const d = deck([{ type: 'image', ...box, asset: 'drawing', fit: 'stretch' }]);
    d.assets = { drawing: { bytes: SVG_BYTES, mime: 'image/svg+xml', widthPx: 2, heightPx: 1, fallback: png } };
    const f = await unpack(d);
    const s = xml(f, 'ppt/slides/slide1.xml');
    expect(s).toContain('asvg:svgBlip');
    const media = Object.keys(f).filter(k => /^ppt\/media\//.test(k)).sort();
    const svgPart = media.find(k => k.endsWith('.svg'));
    const pngPart = media.find(k => k.endsWith('.png'));
    expect(svgPart).toBeTruthy();
    expect(f[svgPart!].every((v, i) => v === SVG_BYTES[i])).toBe(true);
    expect([...f[pngPart!]]).toEqual([...png]); // the stand-in is the caller's picture, not the SVG bytes
    expect(xml(f, '[Content_Types].xml')).toContain('image/svg+xml');
  });
  it('rejects an SVG asset without a stand-in, and a stand-in whose dimensions do not match', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 1"/>');
    const base = { bytes: svg, mime: 'image/svg+xml' as const, widthPx: 2, heightPx: 1 };
    await expect(writePptx({ ...deck(), assets: { a: { ...base } } })).rejects.toThrow(/fallback/);
    await expect(writePptx({ ...deck(), assets: { a: { ...base, fallback: png, widthPx: 3 } } })).rejects.toThrow(/dimensions/);
    await expect(writePptx({ ...deck(), assets: { a: { ...base, fallback: png } } })).resolves.toBeInstanceOf(Uint8Array);
  });
  it('does not mutate the supplied drawing or typed byte arrays', async () => {
    const d = deck(); const before = structuredClone(d); Object.freeze(d.slides[0].objects[0]);
    await writePptx(d); expect(d).toEqual(before);
  });
});

describe('writePptx strict input and resource validation', () => {
  async function rejects(d: unknown) { await expect(writePptx(d as PptxDeck)).rejects.toThrow(/pptx/i); }
  it('rejects invalid top-level, empty decks, nonfinite/zero/oversized page dimensions', async () => {
    for (const d of [null, {}, { ...deck(), slides: [] }, ...[0, -1, NaN, Infinity, 1e10].map(widthPx => ({ ...deck(), widthPx })), { ...deck(), widthIn: 57 }, { ...deck(), heightPx: 1e8 }]) await rejects(d);
  });
  it('rejects unsupported DTO and style fields instead of passthrough or coercion', async () => {
    for (const obj of [{ type: 'html', ...box, html: '<b>bad</b>' }, { ...text(), url: 'https://evil.test' }, { ...text(), style: { fontFace: 'Aptos', fontSizePx: 20, shadow: true } }, { type: 'shape', shape: 'triangle', ...box }, { type: 'shape', shape: 'line', ...box, fill: 'FF0000' }]) await rejects(deck([obj as PptxObject]));
    await rejects({ ...deck(), originalPptx: png });
  });
  it('rejects invalid geometry, fonts, colours, text controls and nested structures', async () => {
    for (const obj of [{ ...text(), x: NaN }, { ...text(), width: 0 }, { ...text(), y: 1e12 }, { ...text(), rotation: 361 }, { ...text(), style: { fontFace: '', fontSizePx: 12 } }, { ...text(), style: { fontFace: 'Arial', fontSizePx: -1 } }, { ...text(), style: { fontFace: 'Arial', fontSizePx: 12, color: 'red' } }, text('bad\u0000'), { ...text(), paragraphs: [] }]) await rejects(deck([obj as PptxObject]));
  });
  it('rejects missing references, remote data, mismatched image headers/dimensions and excessive pixels', async () => {
    const d = deck([{ type: 'image', ...box, asset: 'missing' }]); await rejects(d);
    for (const asset of [{ bytes: 'https://evil.test/a.png', mime: 'image/png', widthPx: 2, heightPx: 1 }, { bytes: png, mime: 'image/jpeg', widthPx: 2, heightPx: 1 }, { bytes: png, mime: 'image/png', widthPx: 3, heightPx: 1 }, { bytes: new Uint8Array(), mime: 'image/png', widthPx: 2, heightPx: 1 }, { bytes: png, mime: 'image/svg+xml', widthPx: 2, heightPx: 1 }, { bytes: png, mime: 'image/png', widthPx: 100000, heightPx: 100000 }]) await rejects({ ...deck(), assets: { bad: asset } });
  });
  it('bounds slide/object/text/media allocation before serialization', async () => {
    await rejects({ ...deck(), slides: Array.from({ length: 501 }, () => ({ objects: [] })) });
    await rejects(deck(Array.from({ length: 10001 }, () => text())));
    await rejects(deck([text('x'.repeat(1000001))]));
    await rejects({ ...deck(), assets: { huge: { bytes: new Uint8Array(32 * 1024 * 1024 + 1), mime: 'image/png', widthPx: 1, heightPx: 1 } } });
  });
  it('never calls fetch for valid or invalid input', async () => {
    const fetch = vi.fn(() => { throw Error('network forbidden'); }); vi.stubGlobal('fetch', fetch);
    try { await writePptx(deck()); await rejects(deck([{ type: 'image', ...box, asset: 'https://evil.test' }])); expect(fetch).not.toHaveBeenCalled(); }
    finally { vi.unstubAllGlobals(); }
  });
});
