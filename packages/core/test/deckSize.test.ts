import { describe, expect, it } from 'vitest';
import { deckSize, parseDeck, stringifyDeck, newSlideSource, outlineProject, SLIDE_BASE_CSS, sceneBaseCss } from '../src';

describe('deck dimensions', () => {
  it('keeps old and malformed decks at the original size', () => {
    for (const size of [undefined, null, [0, 1080], [8000, 1080], 'portrait']) {
      expect(deckSize(parseDeck(JSON.stringify({ size })))).toEqual([1920, 1080]);
    }
  });
  it('round trips a portrait size and reports it in the outline', () => {
    const deck = parseDeck(JSON.stringify({ size: [1080, 1920], order: ['cover'] }));
    expect(deckSize(parseDeck(stringifyDeck(deck)))).toEqual([1080, 1920]);
    const outline = outlineProject('slides', { 'deck.json': stringifyDeck(deck), 'slides/cover.html': '<section id="cover"></section>' });
    expect(outline.items[0].size).toEqual([1080, 1920]);
  });
  it('fits starter text and the rendered section to a small canvas', () => {
    const source = newSlideSource('cover', { size: [390, 844] });
    expect(source).toContain('padding:26px');
    expect(source).toContain('width:195px');
    const css = sceneBaseCss(390, 844, SLIDE_BASE_CSS);
    expect(css).not.toContain('width:1920px;height:1080px');
    expect(css).toContain('width:390px;height:844px');
  });
});
