import { describe, expect, it } from 'vitest';
import { Window as HappyWindow } from 'happy-dom';
import {
  applyHumanOps,
  checkSlide,
  deckOrder,
  newSlideSource,
  parseDc,
  parseDeck,
  projectKind,
  sectionsOf,
  slideIdOf,
  uniqueSlideId,
  withSlideId,
  faceMarkup,
  isSlideFile,
} from '../src';

const doc = () => new HappyWindow({ url: 'http://localhost/' }).document as unknown as Document;

const SLIDE = `<section id="plan" data-transition="fade" style="background:#fbfbf8;color:#1a1a1a;padding:128px;display:flex;flex-direction:column;gap:48px">
<h2 style="font-size:72px;font-weight:400;line-height:1.1">Changes</h2>
<div style="display:flex;gap:32px">
<p style="font-size:32px">One path</p>
</div>
<x-embed style="position:absolute;left:800px;top:128px;width:992px;height:824px"><style>html{margin:0}</style><canvas id="c"></canvas><script>const a = 1 < 2;</script></x-embed>
<aside>Say hi.</aside>
</section>
`;

describe('deck.json', () => {
  it('parses and keeps unknown keys', () => {
    const d = parseDeck('{"v":4,"title":"Q3","order":["cover","plan","bad id"],"sections":{"s1":{"description":"Numbers","start":"cover"}},"faces":{},"x":1}');
    expect(d.title).toBe('Q3');
    expect(d.order).toEqual(['cover', 'plan']);
    expect(d.x).toBe(1);
    expect(parseDeck('not json').order).toEqual([]);
  });

  it('orders slides: order first, unlisted files last', () => {
    const d = parseDeck('{"order":["b","a","gone"]}');
    expect(deckOrder(d, ['slides/a.html', 'slides/c.html', 'slides/b.html', 'deck.json'])).toEqual(['b', 'a', 'c']);
  });

  it('groups slides into sections', () => {
    const d = parseDeck('{"sections":{"s1":{"description":"Intro","start":"a"},"s2":{"description":"Body","start":"c"}}}');
    expect(sectionsOf(d, ['a', 'b', 'c', 'd']).map((s) => [s.key, s.ids])).toEqual([
      ['s1', ['a', 'b']],
      ['s2', ['c', 'd']],
    ]);
    expect(sectionsOf(parseDeck('{}'), ['a', 'b'])).toEqual([{ key: '', description: '', ids: ['a', 'b'] }]);
  });

  it('knows its files and ids', () => {
    expect(projectKind(['deck.json', 'slides/a.html'])).toBe('slides');
    expect(projectKind(['canvas.json', 'Main.dc.html'])).toBe('design');
    expect(projectKind(['x'])).toBeNull();
    expect(isSlideFile('slides/a-1_b.html')).toBe(true);
    expect(isSlideFile('slides/../a.html')).toBe(false);
    expect(slideIdOf('slides/cover.html')).toBe('cover');
    expect(uniqueSlideId(['slide', 'slide-2'])).toBe('slide-3');
    expect(withSlideId('<section id="a" style="x">', 'b')).toBe('<section id="b" style="x">');
    expect(faceMarkup(parseDeck('{"faces":{"x":{"family":"X","href":"https://fonts.googleapis.com/css2?family=X"},"y":{"family":"Y","href":"https://evil.example/x.css"}}}'))).toBe(
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=X">',
    );
  });
});

describe('slide files', () => {
  it('parse as a bare section, embeds included', () => {
    const d = parseDc(SLIDE);
    expect(d.slide).toBe(true);
    expect(d.errors).toEqual([]);
    expect(d.elements[0].tag).toBe('section');
    expect(d.script).toBeNull();
    expect(d.elements.map((e) => e.tag)).toContain('x-embed');
  });

  it('write back minimally, embeds kept byte for byte', () => {
    const d = parseDc(SLIDE);
    const p = d.elements.find((e) => e.tag === 'p')!;
    const r = applyHumanOps(SLIDE, [{ kind: 'text', tid: p.tid, text: 'Two paths' }, { kind: 'style', tid: p.tid, prop: 'color', value: '#c00' }], doc());
    expect(r.source).toBe(SLIDE.replace('<p style="font-size:32px">One path', '<p style="font-size:32px;color:#c00">Two paths'));
  });

  it('move a pinned element by its offsets only', () => {
    const d = parseDc(SLIDE);
    const e = d.elements.find((x) => x.tag === 'x-embed')!;
    const r = applyHumanOps(SLIDE, [{ kind: 'styles', tid: e.tid, set: { left: '700px', top: '100px' } }], doc());
    expect(r.source).toContain('<x-embed style="position:absolute;left:700px;top:100px;width:992px;height:824px"><style>html{margin:0}</style>');
    expect(r.source.split('\n').filter((l, i) => l !== SLIDE.split('\n')[i])).toHaveLength(1);
  });

  it('a new slide copies the look of its neighbour', () => {
    const s = newSlideSource('next', { like: 'background:#111;color:#eee;margin:0;padding:128px;z-index:2' });
    expect(s).toMatch(/^<section id="next" style="background:#111;color:#eee;padding:128px">/);
    expect(checkSlide(parseDc(s), 'next')).toEqual([]);
  });
});

describe('subset check', () => {
  const issues = (src: string, id = 'a') => checkSlide(parseDc(src), id).map((i) => `${i.level}: ${i.message}`);

  it('accepts the sample slide', () => {
    expect(checkSlide(parseDc(SLIDE), 'plan')).toEqual([]);
  });

  it('flags what the original refuses', () => {
    const out = issues(`<section id="b" style="background:#fff;margin:12px;z-index:3">
<h4>x</h4>
<p style="font-size:1.5em;color:var(--x)" onclick="go()">y</p>
<x-shape kind="star"></x-shape>
<div><x-embed style="width:10px"></x-embed></div>
<aside>notes</aside>
<p>after notes</p>
</section>`);
    expect(out).toEqual(
      expect.arrayContaining([
        'error: The <section> id "b" differs from its file name (a.html).',
        'error: margin is not in the subset (only margin:0px): use padding or gap.',
        'error: z-index is not in the slide subset: later children paint over earlier ones.',
        'error: <h4> is not in the slide subset: use <h3>.',
        'error: onclick= never runs on a slide; scripts live only inside <x-embed>.',
        'error: font-size: 1.5em — lengths are px (no em, rem, vw, vh).',
        'error: color: var() is not in the subset; write the value.',
        expect.stringMatching(/^error: <x-shape kind="star">/),
        'error: <x-embed> must be a direct child of <section>.',
        'error: <x-embed> must be pinned: position:absolute with left/top and width/height.',
        'error: <aside> (speaker notes) is the last child of <section>.',
      ]),
    );
  });

  it('notes small text and missing backgrounds', () => {
    expect(issues('<section id="a" style="padding:128px"><p style="font-size:18px">tiny</p></section>')).toEqual([
      'warning: Set a background on every slide.',
      'note: font-size 18px: nothing on a slide goes under 24px.',
    ]);
  });

  it('rejects files that are not one section', () => {
    expect(issues('<div>x</div>')[0]).toMatch(/^error: A slide file is exactly one <section/);
  });
});

describe('tables in slides', () => {
  it('keeps rows written straight into <table>, with paths and minimal write-back', () => {
    const src = '<section id="t" style="background:#fff"><table style="font-size:28px"><tr><th>a</th></tr><tr><td>b</td></tr></table><p>after</p></section>';
    const d = parseDc(src);
    expect(d.errors).toEqual([]);
    const td = d.elements.find((e) => e.tag === 'td')!;
    expect(td.path).toEqual([0, 0, 1, 0]);
    expect(d.elements.find((e) => e.tag === 'p')!.path).toEqual([0, 1]);
    const r = applyHumanOps(src, [{ kind: 'text', tid: td.tid, text: 'c' }], doc());
    expect(r.source).toBe(src.replace('<td>b</td>', '<td>c</td>'));
  });
});

describe('connectors', () => {
  it('take border-width and border-style', () => {
    const src = '<section id="c" style="background:#fff"><x-connector x1="0" y1="0" x2="100" y2="100" style="color:#000;border-width:4px;border-style:dashed"></x-connector></section>';
    expect(checkSlide(parseDc(src), 'c')).toEqual([]);
  });
});
