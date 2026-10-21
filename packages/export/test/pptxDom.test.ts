import { describe, expect, it } from 'vitest';
import { pptxDomColor, slidesDomToPptx } from '../src/pptxDom';

describe('PPTX DOM boundary', () => {
  it('converts concrete opaque computed RGB and distinguishes transparency', () => {
    expect(pptxDomColor('rgb(12, 34, 255)')).toBe('0C22FF');
    expect(pptxDomColor('rgba(0, 0, 0, 0)')).toBeUndefined();
    expect(() => pptxDomColor('rgba(20, 30, 40, 0.5)')).toThrow();
    expect(() => pptxDomColor('linear-gradient(red, blue)')).toThrow();
  });
  it('returns structured failure for an empty deck without requiring a browser', async () => {
    expect(await slidesDomToPptx([], { title: 'Empty', widthIn: 10 })).toMatchObject({ ok: false, diagnostics: [{ code: 'invalid-input' }] });
  });
  it('rejects nonpositive physical size and unsafe budgets before touching DOM', async () => {
    expect(await slidesDomToPptx([{} as HTMLElement], { title: 'Bad', widthIn: 0 })).toMatchObject({ ok: false });
    expect(await slidesDomToPptx([{} as HTMLElement], { title: 'Bad', widthIn: 10, limits: { maxElements: -1 } })).toMatchObject({ ok: false });
    expect(await slidesDomToPptx([{} as HTMLElement], { title: 'Bad', widthIn: 10, limits: { maxObjects: 10001 } })).toMatchObject({ ok: false, diagnostics: [{ code: 'invalid-input' }] });
  });
});
