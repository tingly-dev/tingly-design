// Optional independent schema fixtures: pnpm exec tsx packages/export/test/pptxSchema.fixtures.mjs <new-directory>
// Then: dotnet run --project scripts/validate-pptx -- <new-directory>
// Writes actual public writePptx output, with no test-side XML repair.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writePptx } from '../src/pptx.ts';

const destination = process.argv[2];
if (!destination || process.argv.length !== 3) throw new Error('Expected one new output directory');
const directory = resolve(destination);
mkdirSync(directory); // refuse to mix fixtures into an existing directory
const text = {
  type: 'text', x: 50, y: 50, width: 700, height: 300,
  style: { fontFace: 'Arial', fontSizePx: 24 },
  paragraphs: [
    { align: 'center', runs: [{ text: 'Bold 中文 <&>', style: { bold: true } }, { text: ' italic', style: { italic: true, color: 'FF0000' } }, { text: ' off', style: { bold: false, underline: true } }] },
    { align: 'right', runs: [{ text: '' }] },
    { align: 'justify', runs: [{ text: 'Last paragraph\nline' }, { text: ' more' }] },
  ],
};
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
for (const [name, count, notes] of [['notes-mixed', 1, true], ['no-notes', 1, false], ['multi-three', 3, true], ['multi-twelve', 12, true]]) {
  const deck = {
    title: 'Actual writer 中文 <&>', widthPx: 1000, heightPx: 500, widthIn: 10,
    assets: { pixel: { bytes: png, mime: 'image/png', widthPx: 2, heightPx: 1 } },
    slides: Array.from({ length: count }, (_, i) => ({
      background: 'FAFAFA', ...(notes ? { notes: `Notes page ${i + 1} 中文 <&>\nsecond` } : {}),
      objects: [text, { type: 'shape', shape: 'rect', x: 0, y: 0, width: 25, height: 25, fill: 'FF0000' }, { type: 'image', asset: 'pixel', x: 800, y: 400, width: 100, height: 50 }],
    })),
  };
  writeFileSync(resolve(directory, `${name}.pptx`), await writePptx(deck));
}
