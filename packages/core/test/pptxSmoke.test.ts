import { readFileSync, readdirSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { SaxesParser } from 'saxes';
import { Window as HappyWindow } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { importPptx } from '../src/pptx';
import { applyHumanOps, checkSlide, parseDc, parseDeck } from '../src';

const root = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/pptx-smoke');
interface Fixture { file: string; pages: number; size: [number, number]; ok: boolean; diagnostics: string[]; diagnosticPart?: string; texts?: string[][]; notes?: string[]; geometry?: string[]; features: string[] }
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8')) as { fixtures: Fixture[] };
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
interface Node { uri: string; local: string; attrs: Record<string, string>; refs: string[]; text: string }
// Deliberately independent of the importer's package and XML helpers.
function xml(bytes: Uint8Array): Node[] {
  const nodes: Node[] = [], stack: Node[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => { throw new Error('Unexpected DTD'); });
  parser.on('opentag', tag => {
    const node = { uri: tag.uri, local: tag.local, attrs: Object.fromEntries(Object.values(tag.attributes).map(a => [a.name, a.value])), refs: Object.values(tag.attributes).filter(a => a.uri === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships').map(a => a.value), text: '' };
    nodes.push(node); stack.push(node);
  });
  parser.on('text', text => { if (stack.length) stack[stack.length - 1].text += text; });
  parser.on('closetag', () => { stack.pop(); });
  parser.write(strFromU8(bytes)).close();
  return nodes;
}

// This is an OPC/namespace/relationship/content smoke check, NOT an OOXML schema validator.
function inspect(bytes: Uint8Array, fixture: Fixture) {
  const parts = unzipSync(bytes);
  const names = Object.keys(parts).filter(n => !n.endsWith('/'));
  const parsed = new Map(names.filter(n => n.endsWith('.xml') || n.endsWith('.rels')).map(n => [n, xml(parts[n])]));
  const types = parsed.get('[Content_Types].xml')!;
  const overrides = new Map(types.filter(n => n.uri === CT && n.local === 'Override').map(n => [n.attrs.PartName.slice(1), n.attrs.ContentType]));
  const defaults = new Map(types.filter(n => n.uri === CT && n.local === 'Default').map(n => [n.attrs.Extension, n.attrs.ContentType]));
  for (const [part] of overrides) expect(names, `missing content-type part ${part}`).toContain(part);
  for (const part of names.filter(n => n !== '[Content_Types].xml')) expect(overrides.get(part) ?? defaults.get(part.split('.').pop()!), `content type ${part}`).toBeTruthy();
  for (const [part, nodes] of parsed) {
    if (!part.endsWith('.rels')) continue;
    const source = part === '_rels/.rels' ? '' : part.replace(/(^|\/)\_rels\//, '$1').replace(/\.rels$/, '');
    const ids = new Set<string>();
    for (const rel of nodes.filter(n => n.uri === REL && n.local === 'Relationship')) {
      expect(ids.has(rel.attrs.Id)).toBe(false); ids.add(rel.attrs.Id);
      expect(rel.attrs.TargetMode).not.toBe('External');
      const target = posix.normalize(rel.attrs.Target.startsWith('/') ? rel.attrs.Target.slice(1) : posix.join(posix.dirname(source), rel.attrs.Target));
      expect(target.startsWith('../')).toBe(false);
      expect(names, `${part} -> ${target}`).toContain(target);
    }
    for (const node of parsed.get(source) ?? []) for (const ref of node.refs) expect(ids.has(ref), `${source} relationship ${ref}`).toBe(true);
  }
  for (const [part, nodes] of parsed) if (!part.endsWith('.rels') && nodes.some(n => n.refs.length)) {
    expect(parsed.has(posix.join(posix.dirname(part), '_rels', `${posix.basename(part)}.rels`)), `relationships for ${part}`).toBe(true);
  }
  const presentation = parsed.get('ppt/presentation.xml')!;
  expect(presentation.filter(n => n.uri === P && n.local === 'sldId')).toHaveLength(fixture.pages);
  const size = presentation.find(n => n.uri === P && n.local === 'sldSz')!;
  expect([Number(size.attrs.cx), Number(size.attrs.cy)]).toEqual(fixture.size.map(n => Math.round(n * 914400)));
  for (let i = 0; i < fixture.pages; i++) {
    const nodes = parsed.get(`ppt/slides/slide${i + 1}.xml`)!;
    expect(nodes[0].uri).toBe(P);
    const text = nodes.filter(n => n.uri === A && n.local === 't').map(n => n.text).join('');
    for (const expected of fixture.texts?.[i] ?? []) expect(text).toContain(expected);
  }
  const slides = [...parsed].filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).flatMap(([, nodes]) => nodes);
  const allNodes = [...parsed.values()].flat();
  const has = (local: string, uri = A) => allNodes.some(n => n.uri === uri && n.local === local);
  for (const feature of fixture.features) {
    if (feature === 'table') expect(has('tbl')).toBe(true);
    if (feature === 'chart') expect(has('chart', 'http://schemas.openxmlformats.org/drawingml/2006/chart')).toBe(true);
    if (feature === 'embedded-workbook') expect(names.some(n => /^ppt\/embeddings\/.*\.xlsx$/.test(n))).toBe(true);
    if (feature === 'bullets') expect(slides.some(n => n.uri === A && n.local === 'buChar')).toBe(true);
    if (feature === 'crop') expect(slides.some(n => n.uri === A && n.local === 'srcRect' && Object.values(n.attrs).some(v => Number(v) !== 0))).toBe(true);
    if (feature === 'complex-geometry') expect(slides.some(n => n.uri === A && n.local === 'prstGeom' && n.attrs.prst === 'chevron')).toBe(true);
    if (feature === 'shadow') expect(has('outerShdw')).toBe(true);
    if (feature === 'mixed-font-size') expect(new Set(slides.filter(n => n.uri === A && n.local === 'rPr').map(n => n.attrs.sz))).toEqual(new Set(['2400', '1800', '3600']));
    if (feature === 'local-png') expect(names.some(n => n.startsWith('ppt/media/') && n.endsWith('.png'))).toBe(true);
  }
  return parts;
}

describe('independent native PPTX smoke corpus', () => {
  it('lists every committed package in the manually authored manifest', () => {
    const actual = [...readdirSync(root).filter(n => n.endsWith('.pptx')), ...readdirSync(resolve(root, 'cases')).filter(n => n.endsWith('.pptx')).map(n => `cases/${n}`)].sort();
    expect(actual).toEqual(manifest.fixtures.map(f => f.file).sort());
  });
  for (const fixture of manifest.fixtures) {
    it(`${fixture.file}: preserves native package structure and ${fixture.ok ? 'editable supported content' : 'fails atomically'}`, () => {
      const bytes = new Uint8Array(readFileSync(resolve(root, fixture.file)));
      const parts = inspect(bytes, fixture);
      const result = importPptx(bytes, { id: 'smoke', title: 'Independent smoke' });
      expect(result.ok, JSON.stringify(result.diagnostics)).toBe(fixture.ok);
      for (const code of fixture.diagnostics) expect(result.diagnostics.map(d => d.code)).toContain(code);
      if (!result.ok) {
        expect(result).not.toHaveProperty('files');
        const error = result.diagnostics.find(d => d.level === 'error')!;
        expect(error).toBeDefined();
        expect(error.part).toBe(fixture.diagnosticPart ?? 'ppt/slides/slide1.xml');
        if (!fixture.diagnosticPart) {
          expect(error.slide).toBe('smoke-1');
          if (fixture.file !== 'cases/table.pptx') expect(error.object).toBe('3');
        }
        return;
      }
      expect(result.diagnostics.filter(d => d.level === 'error')).toEqual([]);
      expect(result.files['uploads/smoke/source.pptx']).toEqual(bytes);
      const deck = parseDeck(strFromU8(result.files['deck.json']));
      expect(deck.order).toHaveLength(fixture.pages);
      expect([result.report.width, result.report.height]).toEqual(fixture.size.map(n => Math.round(n * 914400)));
      for (let i = 0; i < fixture.pages; i++) {
        const source = strFromU8(result.files[`slides/${deck.order[i]}.html`]);
        const parsed = parseDc(source);
        expect(checkSlide(parsed, deck.order[i]).filter(n => n.level === 'error')).toEqual([]);
        for (const text of fixture.texts?.[i] ?? []) expect(source).toContain(text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
        if (fixture.notes?.[i]) expect(source).toContain(fixture.notes[i]);
        if (i === 0) for (const geometry of fixture.geometry ?? []) expect(source).toContain(geometry);
        if (fixture.file === 'supported.pptx' && i === 0) {
          expect(source).toContain('<b>Native </b>'); expect(source).toContain('<u><i>中文');
          expect(source.indexOf('background:#d35400')).toBeLessThan(source.indexOf('kind="ellipse"'));
          expect(source.indexOf('kind="ellipse"')).toBeLessThan(source.indexOf('<img '));
        }
        const paragraph = parsed.elements.find(e => e.tag === 'p');
        expect(paragraph).toBeDefined();
        const edited = applyHumanOps(source, [{ kind: 'text', tid: paragraph!.tid, text: 'Smoke edit persisted' }], new HappyWindow().document as unknown as Document);
        expect(edited.source).toContain('Smoke edit persisted');
        expect(checkSlide(parseDc(edited.source), deck.order[i]).filter(n => n.level === 'error')).toEqual([]);
      }
      for (const [path, media] of Object.entries(parts).filter(([path]) => path.startsWith('ppt/media/') && !path.endsWith('/'))) {
        expect(Object.entries(result.files).some(([target, value]) => target.startsWith('uploads/smoke/') && target.endsWith('.png') && Buffer.from(value).equals(Buffer.from(media)))).toBe(true);
      }
    });
  }
});
