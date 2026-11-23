import { describe, expect, it } from 'vitest';
import { Window as HappyWindow } from 'happy-dom';
import { importPptx } from '../src/pptx';
import { applyHumanOps, checkSlide, parseDc, parseDeck } from '../src';
import { writePptx } from '../../export/src/pptx';

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));

describe('independent PPTX conversion modules', () => {
  it('imports a fresh native deck into ordinary editable slide files', async () => {
    const bytes = await writePptx({
      title: 'Module bridge', widthPx: 1920, heightPx: 1080, widthIn: 40 / 3,
      slides: [{
        notes: 'Speaker 中文',
        objects: [
          { type: 'text', x: 100, y: 100, width: 800, height: 200, style: { fontFace: 'Arial', fontSizePx: 48 }, paragraphs: [{ runs: [{ text: 'Hello 中文' }] }] },
          { type: 'shape', shape: 'rect', x: 100, y: 400, width: 200, height: 100, fill: 'FF9900' },
          { type: 'image', x: 500, y: 400, width: 200, height: 100, asset: 'local', fit: 'stretch' },
        ],
      }, { background: '123456', objects: [{ type: 'text', x: 100, y: 100, width: 800, height: 200, style: { fontFace: 'Arial', fontSizePx: 48 }, paragraphs: [{ runs: [{ text: 'Second page' }] }] }] }],
      assets: { local: { bytes: png, mime: 'image/png', widthPx: 2, heightPx: 1 } },
    });
    const result = importPptx(bytes, { id: 'bridge', title: 'Bridge' });
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;
    const deck = parseDeck(decode(result.files['deck.json']));
    expect(deck.order).toHaveLength(2);
    expect(decode(result.files[`slides/${deck.order[1]}.html`])).toContain('Second page');
    expect(Object.entries(result.files).some(([path, value]) => path.endsWith('.png') && value.every((byte, i) => byte === png[i]) && value.length === png.length)).toBe(true);
    const id = deck.order[0];
    const source = decode(result.files[`slides/${id}.html`]);
    expect(source).toContain('Hello 中文');
    expect(source).toContain('Speaker 中文');
    expect(checkSlide(parseDc(source), id).filter((issue) => issue.level === 'error')).toEqual([]);
    const parsed = parseDc(source);
    const paragraph = parsed.elements.find((element) => element.tag === 'p');
    expect(paragraph).toBeDefined();
    const document = new HappyWindow().document as unknown as Document;
    const edited = applyHumanOps(source, [{ kind: 'text', tid: paragraph!.tid, text: 'Edited in Tingly' }], document);
    expect(edited.source).toContain('Edited in Tingly');
    expect(edited.source).toContain('Speaker 中文');
    expect(checkSlide(parseDc(edited.source), id).filter((issue) => issue.level === 'error')).toEqual([]);
    expect(result.files[`uploads/bridge/source.pptx`]).toEqual(bytes);
  });

  it('keeps titles, lists and sections through export and import', async () => {
    const style = { fontFace: 'Arial', fontSizePx: 32 };
    const bytes = await writePptx({
      title: 'Round trip', widthPx: 1920, heightPx: 1080, widthIn: 40 / 3,
      sections: [{ name: 'Opening', slides: 1 }, { name: 'Detail & next', slides: 2 }],
      theme: { headingFont: 'Georgia', bodyFont: 'Arial', colors: { dk1: '10233F', lt1: 'F6F4EF', accent1: 'C2410C' } },
      slides: [
        { notes: 'n', objects: [{ type: 'text', role: 'title', x: 128, y: 128, width: 1400, height: 220, style: { ...style, fontSizePx: 96 }, paragraphs: [{ runs: [{ text: 'A title over ' }, { text: 'two lines', style: { bold: true } }] }] }] },
        { objects: [
          { type: 'text', role: 'title', x: 128, y: 128, width: 1400, height: 80, style: { ...style, fontSizePx: 64 }, paragraphs: [{ runs: [{ text: 'Lists' }] }] },
          { type: 'text', x: 128, y: 300, width: 800, height: 300, style, paragraphs: [
            { runs: [{ text: 'Intro' }] },
            { bullet: { type: 'char', char: '•' }, indentPx: 38, runs: [{ text: 'one ' }, { text: 'bold', style: { bold: true } }] },
            { bullet: { type: 'char', char: '•' }, indentPx: 38, runs: [{ text: 'two' }, { text: 'after a break', breakBefore: true }] },
          ] },
          { type: 'text', x: 1000, y: 300, width: 800, height: 300, style, paragraphs: [3, 4].map(n => ({ bullet: { type: 'number' as const, style: 'arabicPeriod' as const, startAt: 3 }, indentPx: 38, runs: [{ text: `item ${n}` }] })) },
        ] },
        { objects: [{ type: 'text', x: 128, y: 128, width: 800, height: 80, style, paragraphs: [{ runs: [{ text: 'No title here' }] }] }] },
      ],
    });
    const result = importPptx(bytes, { id: 'trip', title: 'Trip' });
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;
    const deck = parseDeck(decode(result.files['deck.json']));
    expect(Object.values(deck.sections).map(s => [s.description, deck.order.indexOf(s.start)])).toEqual([['Opening', 0], ['Detail & next', 1]]);
    const [cover, lists, plain] = deck.order.map(id => decode(result.files[`slides/${id}.html`]));
    expect(cover).toMatch(/<h2 style="[^"]*font-weight:400[^"]*">A title over <b>two lines<\/b><\/h2>/);
    expect(lists).toMatch(/<h2 [^>]*>Lists<\/h2>/);
    expect(lists).toMatch(/<ul [^>]*><li [^>]*>one <b>bold<\/b><\/li><li [^>]*>two<br>after a break<\/li><\/ul>/);
    expect(lists).toMatch(/<ol start="3" [^>]*><li [^>]*>item 3<\/li><li [^>]*>item 4<\/li><\/ol>/);
    expect(plain).not.toMatch(/<h[12]/);
    for (const [i, source] of [cover, lists, plain].entries()) expect(checkSlide(parseDc(source!), deck.order[i]!).filter(issue => issue.level === 'error')).toEqual([]);
  });
});
