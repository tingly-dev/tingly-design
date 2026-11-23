import { describe, expect, it } from 'vitest';
import { slideHeadingDrift, slidePlaceholders, type SlideHeading } from '../src/deckCheck';
import { checkProject } from '../src/project';

const slide = (body: string) => `<section id="s" style="background:#fff">${body}</section>`;

describe('slidePlaceholders', () => {
  it('finds fill-ins the skill asks for and leftovers', () => {
    const found = slidePlaceholders('slides/s.html', slide('<h2>Revenue [€__]</h2><p>Led by [Name] and [COMPANY NAME]</p><p>Lorem ipsum dolor</p>'));
    expect(found.map((f) => f.text)).toEqual(['[€__]', '[Name]', '[COMPANY NAME]', 'Lorem ipsum']);
    expect(found.every((f) => f.rule === 'placeholder' && f.file === 'slides/s.html')).toBe(true);
  });

  it('leaves wiki links, references and ordinary brackets alone', () => {
    expect(slidePlaceholders('s', slide('<p>[[Wiki links]] and backlinks, see [1] (or [beta])</p>'))).toEqual([]);
  });

  it('skips what nobody sees: notes, hidden elements, drawings', () => {
    expect(slidePlaceholders('s', slide('<p data-hide>[insert logo]</p><aside>TODO: say thanks</aside>'))).toEqual([]);
  });

  it('reports through check, as a warning worded by rule', () => {
    const files = { 'deck.json': JSON.stringify({ v: 4, title: 'T', order: ['a'] }), 'slides/a.html': slide('<h1>[Title TBD]</h1>') };
    expect(checkProject('slides', files)).toContainEqual({ level: 'warning', file: 'slides/a.html', code: 'slides', rule: 'placeholder', params: { text: 'TBD' } });
  });
});

describe('slideHeadingDrift', () => {
  const h = (file: string, top: number, left = 128, o: Partial<SlideHeading> = {}): SlideHeading => ({ file, tag: 'h2', size: 72, top, left, height: 1080, text: file, ...o });

  it('names the content slide whose heading sits away from the others of its kind', () => {
    const found = slideHeadingDrift([h('a', 128), h('b', 128), h('c', 129), h('d', 176)]);
    expect(found).toEqual([{ rule: 'headingMoved', file: 'd', text: 'd', dy: 48, dx: 0, others: 3 }]);
  });

  it('needs three of a kind, and leaves centred statements and other sizes out', () => {
    expect(slideHeadingDrift([h('a', 128), h('b', 200)])).toEqual([]);
    expect(slideHeadingDrift([h('a', 128), h('b', 128), h('c', 128), h('quote', 480)])).toEqual([]);
    expect(slideHeadingDrift([h('a', 128), h('b', 128), h('c', 128), h('cover', 300, 128, { size: 120 })])).toEqual([]);
  });

  it('counts a heading moved sideways too', () => {
    expect(slideHeadingDrift([h('a', 128), h('b', 128), h('c', 128, 220)]).map((f) => [f.file, f.dx])).toEqual([['c', 92]]);
  });
});
