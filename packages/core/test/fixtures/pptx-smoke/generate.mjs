// Independent native fixture producer. Never import @dc/export's PPTX writer.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync, strFromU8, strToU8, zlibSync } from 'fflate';
const require = createRequire(new URL('../../../../export/package.json', import.meta.url));
const PptxGenJS = require('pptxgenjs');
const root = dirname(fileURLToPath(import.meta.url));
const check = process.argv.includes('--check');
if (new PptxGenJS().version !== '4.0.1') throw new Error('Fixtures require exactly pptxgenjs 4.0.1');

// Original 48x32 RGBA test image: four opaque quadrants; no downloaded assets.
function png() {
  const crc = data => { let c = 0xffffffff; for (const b of data) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const name = Buffer.from(type), size = Buffer.alloc(4), sum = Buffer.alloc(4); size.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([name, data]))); return Buffer.concat([size, name, data, sum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(48); header.writeUInt32BE(32, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(32 * (1 + 48 * 4));
  const colors = [[26, 82, 118], [211, 84, 0], [39, 174, 96], [142, 68, 173]];
  for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) { const at = y * 193 + 1 + x * 4; rows.set([...colors[(y >= 16 ? 2 : 0) + (x >= 24 ? 1 : 0)], 255], at); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlibSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const image = `image/png;base64,${png().toString('base64')}`;
function deck(width = 12, height = 6.75) {
  const p = new PptxGenJS(); p.defineLayout({ name: 'SMOKE', width, height }); p.layout = 'SMOKE';
  p.author = 'Tingly Design contributors'; p.subject = 'Original native OOXML smoke corpus'; p.title = 'Independent PPTX smoke'; p.company = 'Tingly Design'; p.lang = 'en-US';
  p.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial', lang: 'en-US' };
  return p;
}
const text = { x: 0.5, y: 0.4, w: 7, h: 0.8, fontFace: 'Arial', fontSize: 24, color: '17324D', margin: 0, breakLine: false };
function supported(p) {
  let s = p.addSlide(); s.background = { color: 'F5F7FA' };
  s.addText([{ text: 'Native ', options: { bold: true } }, { text: '中文 & <copy>', options: { italic: true, color: '2255AA', underline: true } }], text);
  s.addText('Uniform font and size\nSecond paragraph', { ...text, y: 1.4, h: 1.1 });
  s.addShape(p.ShapeType.rect, { x: 0.5, y: 3, w: 2, h: 1, fill: { color: 'D35400' }, line: { color: '17324D', width: 2 }, rotate: 15 });
  s.addShape(p.ShapeType.ellipse, { x: 1.5, y: 3.4, w: 2, h: 1, fill: { color: '27AE60' }, line: { color: '17324D', width: 1 } });
  s.addShape(p.ShapeType.line, { x: 0.5, y: 5, w: 3, h: 0.5, line: { color: '2255AA', width: 2 } });
  s.addImage({ data: image, x: 5, y: 3, w: 3, h: 2, rotate: 10, flipH: true });
  s.addNotes('Original speaker notes 中文 page one.');
  s = p.addSlide(); s.background = { color: '17324D' };
  s.addText('Second native slide', { ...text, color: 'FFFFFF' });
  s.addShape(p.ShapeType.roundRect, { x: 0.5, y: 2, w: 3, h: 1.5, radius: 0.2, fill: { color: 'D35400' }, line: { color: 'FFFFFF', width: 1 } });
  s.addImage({ data: image, x: 5, y: 2, w: 3, h: 2 });
  s.addNotes('Original speaker notes page two.');
}
const cases = {
  table(p, s) { s.addTable([['Item', 'Count'], ['Original', '42']], { x: 0.5, y: 2, w: 6, h: 2, fontFace: 'Arial', fontSize: 18, border: { type: 'solid', pt: 1, color: '17324D' } }); },
  chart(p, s) { s.addChart(p.ChartType.pie, [{ name: 'Original series', labels: ['Alpha', 'Beta'], values: [3, 7] }], { x: 0.5, y: 2, w: 6, h: 3, showLegend: false, showTitle: false, showValue: true, catAxisLabelFontFace: 'Arial', valAxisLabelFontFace: 'Arial' }); },
  bullets(p, s) { s.addText([{ text: 'Native bullet', options: { bullet: { indent: 18 }, breakLine: true } }, { text: 'Another bullet', options: { bullet: { indent: 18 } } }], { ...text, y: 2, h: 2 }); },
  crop(p, s) { s.addImage({ data: image, x: 0.5, y: 2, w: 3, h: 2, sizing: { type: 'crop', w: 1.5, h: 1, x: 0.75, y: 0.5 } }); },
  'mixed-font-size'(p, s) { s.addText([{ text: 'Small', options: { fontSize: 18 } }, { text: 'Large', options: { fontSize: 36 } }], { ...text, y: 2, h: 2 }); },
  'complex-geometry'(p, s) { s.addShape(p.ShapeType.chevron, { x: 0.5, y: 2, w: 4, h: 2, fill: { color: '2255AA' }, line: { color: '17324D', width: 1 } }); },
  shadow(p, s) { s.addShape(p.ShapeType.rect, { x: 0.5, y: 2, w: 4, h: 2, fill: { color: '2255AA' }, line: { color: '17324D', width: 1 }, shadow: { type: 'outer', color: '000000', opacity: 0.4, blur: 4, angle: 45, distance: 4 } }); },
};
function addCase(p, name) { const s = p.addSlide(); s.addText(`Native ${name} case`, text); cases[name](p, s); s.addNotes(`Original ${name} notes.`); }
function canonicalZip(parts) {
  // PptxGenJS 4.0.1 emits phantom slideMaster2+ content type overrides.
  // Remove only overrides whose part does not exist, never relationships/objects.
  // Known upstream schema defects, repaired only for this generated vocabulary.
  if (parts['ppt/presentation.xml']) {
    const presentation = strFromU8(parts['ppt/presentation.xml']);
    const ordered = presentation.replace(/(<p:sldIdLst>.*?<\/p:sldIdLst>)(<p:notesMasterIdLst>.*?<\/p:notesMasterIdLst>)/, '$2$1');
    if (ordered === presentation) throw new Error('Expected native notesMaster ordering defect');
    parts['ppt/presentation.xml'] = strToU8(ordered);
    let dropped = 0;
    if (parts['[Content_Types].xml']) parts['[Content_Types].xml'] = strToU8(strFromU8(parts['[Content_Types].xml']).replace(/<Override PartName="\/([^"<>]+)"[^<>]*\/>/g, (tag, part) => {
      if (parts[part]) return tag;
      if (!/^ppt\/slideMasters\/slideMaster(?:[2-9]|[1-9]\d+)\.xml$/.test(part)) throw new Error(`Unexpected missing override ${part}`);
      dropped++; return '';
    }));
    const slideCount = Object.keys(parts).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length;
    if (dropped !== slideCount - 1) throw new Error('Unexpected phantom master count');
    for (const name of Object.keys(parts).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
      parts[name] = strToU8(strFromU8(parts[name]).replace(/<a:p>.*?<\/a:p>/g, paragraph => {
        const properties = paragraph.match(/<a:pPr\b[^>]*>.*?<\/a:pPr>/g) ?? [];
        if (properties.length < 2) return paragraph;
        if (!properties.every(p => p === properties[0])) throw new Error('Conflicting native paragraph properties');
        let seen = false;
        return paragraph.replace(/<a:pPr\b[^>]*>.*?<\/a:pPr>/g, tag => { if (seen) return ''; seen = true; return tag; });
      }));
    }
  }
  for (const [name, bytes] of Object.entries(parts)) {
    if (name.endsWith('.xlsx')) parts[name] = canonicalZip(unzipSync(bytes));
    if (name === 'docProps/core.xml') parts[name] = strToU8(strFromU8(bytes).replace(/(<dcterms:(?:created|modified)[^>]*>)[^<]*(<\/dcterms:(?:created|modified)>)/g, '$12000-01-01T00:00:00Z$2'));
  }
  const entries = Object.fromEntries(Object.keys(parts).sort().map(key => [key, [parts[key], { mtime: new Date('2000-01-01T00:00:00Z') }]]));
  return zipSync(entries, { level: 9 });
}
async function save(name, p) {
  const parts = unzipSync(new Uint8Array(await p.write({ outputType: 'uint8array', compression: false })));
  const bytes = canonicalZip(parts); const path = resolve(root, name);
  if (check) { if (!Buffer.from(readFileSync(path)).equals(Buffer.from(bytes))) throw new Error(`${name} differs; regenerate and review`); }
  else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); }
}
let p = deck(); supported(p); await save('supported.pptx', p);
p = deck(); supported(p); for (const name of Object.keys(cases)) addCase(p, name); await save('comprehensive.pptx', p);
for (const name of Object.keys(cases)) { p = deck(); addCase(p, name); await save(`cases/${name}.pptx`, p); }
for (const [name, width, height] of [['four-three', 10, 7.5], ['portrait', 7.5, 10]]) {
  p = deck(width, height); const s = p.addSlide(); s.addText(`Native ${name} slide`, { ...text, w: 6 });
  s.addShape(p.ShapeType.rect, { x: 1, y: 2, w: 2, h: 1, fill: { color: '2255AA' }, line: { color: '17324D', width: 1 } });
  s.addNotes(`Original ${name} notes.`); await save(`${name}.pptx`, p);
}
console.log(check ? 'All PPTX smoke packages match deterministic regeneration.' : 'Generated original PPTX smoke packages.');
