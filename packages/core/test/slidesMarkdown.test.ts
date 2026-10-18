import { describe, expect, it } from 'vitest';
import { deckToMarkdown, parseDeck } from '../src';

const slide = (id: string, inner: string, attrs = '') =>
  ({ id, source: `<section id="${id}"${attrs} style="background:#fff;padding:128px">\n${inner}\n</section>` });

const deck = parseDeck(
  JSON.stringify({
    v: 4,
    title: 'Q3 review',
    order: ['cover', 'numbers', 'plan', 'secret'],
    sections: { s1: { description: 'Where we are', start: 'numbers' } },
  }),
);

const slides = [
  slide('cover', '<h1 style="font-size:96px">Q3 review</h1><p>Growth &amp; <b>costs</b></p>'),
  slide(
    'numbers',
    `<h2>Numbers</h2>
<x-shape kind="rect" style="width:10px"></x-shape><x-icon name="Star"></x-icon>
<div data-text><p>Revenue grew <i>12%</i> over <a href="https://x.dev/q">the plan</a>.</p><ul><li>EMEA</li><li>APAC<br>and more</li></ul></div>
<table><tr><th>Region</th><th>Delta</th></tr><tr><td>EU | UK</td><td>+4</td></tr></table>
<img src="assets/hq.jpg" alt="HQ">
<aside>Mention the | outage.\nThen pause.</aside>`,
  ),
  slide('plan', '<h2>Plan</h2><div><h3>One path</h3><p>Ship from main.</p></div><ol><li>Cut</li><li>Ship</li></ol>'),
  slide('secret', '<h2>Hidden</h2>', ' hidden'),
];

describe('deckToMarkdown', () => {
  const md = deckToMarkdown(deck, slides, { notesLabel: 'Notes' });

  it('heads the document with the deck title and folds the cover into an introduction', () => {
    expect(md.startsWith('# Q3 review\n\nGrowth & **costs**\n')).toBe(true);
    expect(md.match(/Q3 review/g)).toHaveLength(1);
  });

  it('turns sections into h2 and slide titles into h3', () => {
    expect(md).toContain('## Where we are\n\n### Numbers');
  });

  it('keeps inline marks, links, lists, tables, pictures and drops decoration', () => {
    expect(md).toContain('Revenue grew *12%* over [the plan](https://x.dev/q).');
    expect(md).toContain('- EMEA\n- APAC  \n  and more');
    expect(md).toContain('| Region | Delta |\n| --- | --- |\n| EU \\| UK | +4 |');
    expect(md).toContain('![HQ](assets/hq.jpg)');
    expect(md).not.toMatch(/Star|rect/);
  });

  it('prints notes as a quote after their slide', () => {
    expect(md).toContain("> **Notes** Mention the | outage.");
  });

  it('nests card headings below it', () => {
    expect(md).toContain('### Plan\n\n#### One path\n\nShip from main.\n\n1. Cut\n2. Ship');
  });

  it('leaves hidden slides out', () => {
    expect(md).not.toContain('Hidden');
  });

  it('numbers slides at h2 when the deck has no sections', () => {
    const flat = deckToMarkdown(parseDeck(JSON.stringify({ title: 'T', order: ['a', 'b'] })), [slide('a', '<h1>T</h1>'), slide('b', '<h2>Two</h2><p>x</p>')], { notesLabel: 'Notes' });
    expect(flat).toBe('# T\n\n## Two\n\nx\n');
  });
});

describe('deckToMarkdown titles', () => {
  it('uses the first paragraph as the title when a slide has no heading', () => {
    const md = deckToMarkdown(parseDeck(JSON.stringify({ title: 'T', order: ['a', 'b'] })), [slide('a', '<h1>T</h1>'), slide('b', '<p>Just text</p><p>More</p>')], { notesLabel: 'Notes' });
    expect(md).toBe('# T\n\n## Just text\n\nMore\n');
  });
});

describe('deckToMarkdown running text', () => {
  it('drops a footer repeated on the slides and keeps real content', () => {
    const foot = (n: number) => `<p>Acme · Review · 0${n}</p>`;
    const md = deckToMarkdown(
      parseDeck(JSON.stringify({ title: 'T', order: ['a', 'b', 'c', 'd'] })),
      [slide('a', '<h1>T</h1>'), slide('b', `<h2>B</h2><p>keep \u003c 1 ms</p>${foot(2)}`), slide('c', `<h2>C</h2>${foot(3)}`), slide('d', `<h2>D</h2>${foot(4)}`)],
      { notesLabel: 'Notes' },
    );
    expect(md).not.toContain('Acme');
    expect(md).toContain('keep < 1 ms');
  });
});
