import { describe, expect, it } from 'vitest';
import { changedSpan, cleanParticipant, isElementFile, parseDc, participantOf, PEOPLE_COLORS, pointerColor, pointerTid } from '../src';

const board = (body: string, head = '') =>
  `<!doctype html><html><head><title>B</title></head><body><x-dc>${head}<div id="root">\n${body}</div>\n</x-dc>\n<script type="text/x-dc" data-dc-script data-props='{"name":{"editor":"text","default":"x"}}'>class Component extends DCLogic {}</script></body></html>`;
const tagOf = (before: string, after: string) => {
  const doc = parseDc(after);
  const tid = pointerTid(doc, changedSpan(before, after)!);
  return tid === null ? null : doc.elements[tid].tag + (doc.elements[tid].attrs.find((a) => a.name === 'id') ? '#' + doc.elements[tid].attrs.find((a) => a.name === 'id')!.value : '');
};

describe('live pointers: where a write landed', () => {
  it('points at the element whose words changed', () => {
    const a = board('<h1 id="t">Hello</h1>\n<p id="p">Plans <b id="b">for</b> teams</p>\n');
    expect(tagOf(a, a.replace('Hello', 'World'))).toBe('h1#t');
    expect(tagOf(a, a.replace('for', 'with'))).toBe('b#b');
    expect(tagOf(a, a.replace('teams', 'people'))).toBe('p#p');
  });

  it('points at an element put in, not at a slice across it and its neighbour', () => {
    const a = board('<p id="a">a</p>\n');
    expect(tagOf(a, a.replace('<p id="a">a</p>\n', '<p id="a">a</p>\n<p id="n">b</p>\n'))).toBe('p#n');
    // on the same line, just before the parent's end tag
    const b = `<x-dc><div id="root"><p id="a">a</p></div></x-dc>`;
    expect(tagOf(b, b.replace('</p></div>', '</p><p id="n">b</p></div>'))).toBe('p#n');
  });

  it('points at the parent where something was taken out', () => {
    const a = board('<p id="a">a</p>\n<p id="b">b</p>\n');
    expect(tagOf(a, a.replace('<p id="b">b</p>\n', ''))).toBe('div#root');
  });

  it('an attribute or a style change points at its element', () => {
    const a = board('<h1 id="t" style="color:#111">Hi</h1>\n');
    expect(tagOf(a, a.replace('#111', '#e11'))).toBe('h1#t');
    expect(tagOf(a, a.replace('<h1 id="t"', '<h1 id="t" class="big"'))).toBe('h1#t');
  });

  it('a change outside the drawn elements stands for the whole artboard', () => {
    const a = board('<p>a</p>\n', '<helmet><style>p{color:red}</style></helmet>');
    expect(tagOf(a, a.replace('"default":"x"', '"default":"y"'))).toBe('div#root');
    expect(tagOf(a, a.replace('color:red', 'color:blue'))).toBe('div#root');
  });

  it('a slide points inside its section', () => {
    const s = '<section class="slide">\n  <h1>Meet</h1>\n  <p>Tingly</p>\n</section>\n';
    expect(tagOf(s, s.replace('Tingly', 'Design'))).toBe('p');
  });

  it('nothing changed, no span', () => {
    expect(changedSpan('same', 'same')).toBeNull();
  });
});

describe('live pointers: participants', () => {
  it('skips this window and unknown hands, keeps agents and other windows', () => {
    expect(participantOf('human', 'me', 'me')).toBeNull();
    expect(participantOf('human', undefined, 'me')).toBeNull();
    expect(participantOf('claude', undefined, 'me')).toEqual({ id: 'claude', actor: 'claude' });
    expect(participantOf('external', undefined, 'me')).toEqual({ id: 'external', actor: 'external' });
    expect(participantOf('human', 'them', 'me')).toEqual({ id: 'client:them', actor: 'human' });
  });

  it('an agent keeps its colour, a person takes one from the palette, an own colour wins', () => {
    expect(pointerColor({ id: 'claude', actor: 'claude' })).toBe('#7c3aed');
    expect(PEOPLE_COLORS).toContain(pointerColor({ id: 'client:a', actor: 'human' }));
    expect(pointerColor({ id: 'client:a', actor: 'human' })).toBe(pointerColor({ id: 'client:a', actor: 'human' }));
    expect(pointerColor({ id: 'x', actor: 'claude', color: '#123456' })).toBe('#123456');
  });

  it('reads an announced participant and refuses what is not one', () => {
    expect(cleanParticipant({ id: 'agent:writer', name: '  Writer  bot ', color: '#00aa00', actor: 'claude' })).toEqual({ id: 'agent:writer', actor: 'claude', name: 'Writer bot', color: '#00aa00' });
    expect(cleanParticipant({ id: 'a b' })).toBeNull();
    expect(cleanParticipant({ id: 'a', color: 'red', actor: 'nobody' })).toEqual({ id: 'a', actor: 'external' });
    expect(cleanParticipant(null)).toBeNull();
  });

  it('knows which files point at elements', () => {
    expect(isElementFile('Flow.dc.html')).toBe(true);
    expect(isElementFile('slides/cover.html')).toBe(true);
    expect(isElementFile('scenes/cover.html')).toBe(true);
    expect(isElementFile('files/index.html')).toBe(false);
    expect(isElementFile('tabs/a.md')).toBe(false);
  });
});
