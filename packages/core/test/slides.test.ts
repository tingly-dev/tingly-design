import { describe, expect, it } from 'vitest';
import { Window as HappyWindow } from 'happy-dom';
import {
  applyHumanOps,
  deckSlides,
  layerTree,
  newSlideSource,
  parseBuild,
  parseDc,
  parseDeck,
  renameSlideSource,
  sectionRuns,
  setSlideNotes,
  slideNotes,
  slideTitle,
  isSlideFile,
} from '../src';

const doc = () => new HappyWindow({ url: 'http://localhost/' }).document as unknown as Document;

const SLIDE = `<section id="plan" data-transition="fade" style="background:#fbfbf8;color:#1a1a1a;padding:128px;display:flex;flex-direction:column;gap:48px">
<h2 style="font-size:72px;line-height:1.1">Changes</h2>
<div style="display:flex;gap:32px">
<p style="font-size:32px">One &amp; two</p>
<x-shape kind="ellipse" style="width:200px;height:200px;background:#e07a3f"></x-shape>
</div>
<x-embed style="position:absolute;left:800px;top:128px;width:400px;height:300px"><style>body{margin:0}</style><canvas id="c"></canvas><script>const a = 1 < 2;</script></x-embed>
<p data-build-in="rise 2" style="position:absolute;left:128px;bottom:64px;width:600px;font-size:24px">Source: poll</p>
<aside>Say hi.</aside>
</section>
`;

describe('slide files', () => {
  it('parse as one bare <section>', () => {
    const d = parseDc(SLIDE);
    expect(d.kind).toBe('slide');
    expect(d.errors).toEqual([]);
    expect(d.elements[0].tag).toBe('section');
    expect(d.children.filter((c) => c.kind === 'el')).toHaveLength(1);
    expect(parseDc('<x-dc><div></div></x-dc>').kind).toBe('design');
  });

  it('write back minimally, embeds untouched', () => {
    const d = parseDc(SLIDE);
    const h2 = d.elements.find((e) => e.tag === 'h2')!;
    const r = applyHumanOps(SLIDE, [{ kind: 'style', tid: h2.tid, prop: 'color', value: '#c2410c' }], doc());
    expect(r.changed).toBe(true);
    const before = SLIDE.split('\n');
    const changed = r.source.split('\n').filter((l, i) => l !== before[i]);
    expect(changed).toEqual(['<h2 style="font-size:72px;line-height:1.1;color:#c2410c">Changes</h2>']);

    const p = d.elements.find((e) => e.tag === 'p')!;
    const t = applyHumanOps(SLIDE, [{ kind: 'text', tid: p.tid, text: 'Three' }], doc()).source;
    expect(t).toContain('<p style="font-size:32px">Three</p>');
    expect(t).toContain('<script>const a = 1 < 2;</script>');

    const shape = d.elements.find((e) => e.tag === 'x-shape')!;
    const del = applyHumanOps(SLIDE, [{ kind: 'remove', tid: shape.tid }], doc()).source;
    expect(del).not.toContain('x-shape');
    expect(del).toContain('<x-embed style="position:absolute;left:800px;top:128px;width:400px;height:300px"><style>body{margin:0}</style>');
  });

  it('name slide layers by role, notes hidden', () => {
    const tree = layerTree(parseDc(SLIDE));
    expect(tree[0].tag).toBe('section');
    expect(tree[0].children.map((c) => c.role)).toEqual(['Text', 'Row', 'Embed', 'Text']);
    expect(tree[0].children[1].children.map((c) => c.role)).toEqual(['Text', 'Shape']);
  });

  it('read and write speaker notes', () => {
    expect(slideNotes(SLIDE)).toBe('Say hi.');
    const n = setSlideNotes(SLIDE, 'A < B\nnext');
    expect(n).toContain('<aside>A &lt; B\nnext</aside>');
    expect(slideNotes(n)).toBe('A < B\nnext');
    const gone = setSlideNotes(SLIDE, '');
    expect(gone).not.toContain('aside');
    expect(gone.endsWith('</p>\n</section>\n')).toBe(true);
    const added = setSlideNotes(gone, 'Hello');
    expect(added).toContain('</p>\n<aside>Hello</aside>\n</section>');
    expect(slideTitle(SLIDE)).toBe('Changes');
  });

  it('new and copied slides', () => {
    const s = newSlideSource('next', { like: SLIDE });
    expect(s).toMatch(/^<section id="next" style="background:#fbfbf8;color:#1a1a1a;padding:128px/);
    expect(parseDc(s).kind).toBe('slide');
    expect(renameSlideSource(SLIDE, 'copy')).toMatch(/^<section id="copy" data-transition="fade"/);
    expect(parseBuild('rise 2 auto')).toEqual({ kind: 'rise', order: 2, auto: true });
    expect(parseBuild('spin')).toBeNull();
  });
});

describe('deck index', () => {
  const deck = parseDeck(
    JSON.stringify({
      v: 4,
      title: 'Q3',
      order: ['cover', 'plan', 'gone', '../x'],
      sections: { s1: { description: 'Open', start: 'cover' }, s2: { description: 'Numbers', start: 'plan' }, s3: { description: 'Later' } },
    }),
  );

  it('orders slides by order, extra files last', () => {
    const files = ['deck.json', 'slides/plan.html', 'slides/cover.html', 'slides/extra.html'];
    expect(deckSlides(deck, files)).toEqual(['cover', 'plan', 'extra']);
    expect(isSlideFile('slides/a-b_1.html')).toBe(true);
    expect(isSlideFile('slides/../x.html')).toBe(false);
  });

  it('cuts the deck into sections', () => {
    const runs = sectionRuns(deck, ['cover', 'plan', 'extra']);
    expect(runs.map((r) => [r.key, r.slides])).toEqual([
      ['s1', ['cover']],
      ['s2', ['plan', 'extra']],
      ['s3', []],
    ]);
    const plain = sectionRuns(parseDeck('{"order":["a","b"]}'), ['a', 'b']);
    expect(plain).toEqual([{ key: '-', description: '', slides: ['a', 'b'] }]);
  });
});

describe('tables written without <tbody>', () => {
  const T = `<section id="t" style="background:#fff">
<table style="font-size:30px">
<tr><th>A</th><th>B</th></tr>
<tr><td>1</td><td>2</td></tr>
</table>
</section>
`;
  it('keep their rows as the table children and edit in place', () => {
    const d = parseDc(T);
    expect(d.errors).toEqual([]);
    const table = d.elements.find((e) => e.tag === 'table')!;
    expect(table.children.filter((c) => c.kind === 'el').map((c) => (c.kind === 'el' ? c.tag : ''))).toEqual(['tr', 'tr']);
    const td = d.elements.filter((e) => e.tag === 'td')[1];
    const r = applyHumanOps(T, [{ kind: 'text', tid: td.tid, text: '3' }], doc()).source;
    expect(r).toBe(T.replace('<td>2</td>', '<td>3</td>'));
    const tr = d.elements.filter((e) => e.tag === 'tr')[1];
    const dup = applyHumanOps(T, [{ kind: 'duplicate', tid: tr.tid }], doc()).source;
    expect(dup.match(/<tr>/g)).toHaveLength(3);
    expect(dup).not.toContain('tbody');
  });
});
