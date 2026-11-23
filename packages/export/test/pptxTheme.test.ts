import { describe, expect, it } from 'vitest';
import { pptxTheme, type PptxDeck, type PptxObject } from '../src/pptx';

const text = (s: string, fontFace: string, color: string, size = 32, title = false): PptxObject => ({
  type: 'text', x: 0, y: 0, width: 100, height: 50, style: { fontFace, fontSizePx: size, color }, paragraphs: [{ runs: [{ text: s }] }], ...(title ? { role: 'title' as const } : {}),
});
const deck = (slides: PptxDeck['slides']): PptxDeck => ({ title: 'T', widthPx: 1920, heightPx: 1080, widthIn: 13.333, slides });

describe('pptxTheme', () => {
  it('takes the titles\' typeface for headings and the most used one for the body', () => {
    const theme = pptxTheme(deck([{ background: 'FFFFFF', objects: [text('Title', 'Georgia', '111111', 64, true), text('body text that is long', 'Inter', '111111'), text('x', 'Courier New', '111111')] }]));
    expect(theme.headingFont).toBe('Georgia');
    expect(theme.bodyFont).toBe('Inter');
  });

  it('falls back to the largest text for headings when no slide has a title', () => {
    expect(pptxTheme(deck([{ objects: [text('Big', 'Georgia', '000000', 96), text('small and plenty of it', 'Arial', '000000', 24)] }])).headingFont).toBe('Georgia');
  });

  it('keeps light colours light and dark colours dark, and picks saturated accents', () => {
    const theme = pptxTheme(deck([
      { background: 'F6F4EF', objects: [text('words words words', 'Arial', '1D1D1F'), text('14 minutes', 'Arial', 'C2410C'), { type: 'shape', shape: 'rect', x: 0, y: 0, width: 400, height: 200, fill: '2563EB' }] },
      { background: 'F6F4EF', objects: [text('more words', 'Arial', '1D1D1F'), text('pale', 'Arial', 'E2E8F0')] },
      { background: '10233F', objects: [text('on dark', 'Arial', 'EEF2F7')] },
    ]));
    expect(theme.colors?.lt1).toBe('F6F4EF');
    expect(theme.colors?.dk1).toBe('1D1D1F');
    expect(theme.colors?.dk2).toBe('10233F');
    expect([theme.colors?.accent1, theme.colors?.accent2].sort()).toEqual(['2563EB', 'C2410C']);
    // a pale grey-blue is not an accent
    expect(Object.entries(theme.colors ?? {}).filter(([k]) => k.startsWith('accent')).map(([, v]) => v)).not.toContain('E2E8F0');
  });

  it('says nothing about slots the deck gives no colour for', () => {
    const theme = pptxTheme(deck([{ background: 'FFFFFF', objects: [text('only black', 'Arial', '000000')] }]));
    expect(theme.colors).toEqual({ lt1: 'FFFFFF', dk1: '000000' });
  });
});
