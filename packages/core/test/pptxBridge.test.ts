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
});
