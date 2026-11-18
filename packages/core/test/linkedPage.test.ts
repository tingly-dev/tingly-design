import { describe, expect, it } from 'vitest';
import { describeChange, dropLinked, followUpFor, mergeChange, settingsProject, isLinkedPicture, linkModes, linkedDir, linkedPagesOf, linkedStem, newLinkId, pageDeps, pagesOf, pngSize, putLinked, takesPages, type LinkedPage } from '../src';

const CANVAS = JSON.stringify({ v: 3, title: 'Site', boards: { 'Hero.dc.html': { x: 0, y: 0, w: 1280, h: 720, title: 'Hero' }, 'Card.dc.html': { x: 0, y: 800, w: 400, h: 300 } }, order: ['Hero.dc.html', 'Card.dc.html'] });

describe('what can be linked into what', () => {
  it('takes a canvas artboard live into slides and motion, and as a picture everywhere that takes pages', () => {
    expect(linkModes('design', 'slides')).toEqual(['live', 'image']);
    expect(linkModes('design', 'motion')).toEqual(['live', 'image']);
    expect(linkModes('design', 'docs')).toEqual(['image']);
    expect(linkModes('design', 'design')).toEqual(['image']);
  });
  it('gives a dashboard and a motion piece only as pictures, wherever they go', () => {
    for (const into of ['design', 'slides', 'docs', 'motion'] as const) {
      expect(linkModes('dashboard', into)).toEqual(['image']);
      expect(linkModes('motion', into)).toEqual(['image']);
    }
  });
  it('refuses a dashboard and a design system as the place a page goes, and a design system as a source', () => {
    for (const from of ['design', 'slides', 'docs', 'dashboard', 'motion', 'design-system'] as const) {
      expect(linkModes(from, 'dashboard')).toEqual([]);
      expect(linkModes(from, 'design-system')).toEqual([]);
    }
    expect(linkModes('design-system', 'slides')).toEqual([]);
    expect(takesPages('dashboard')).toBe(false);
    expect(takesPages('docs')).toBe(true);
  });
});

describe('the pages a project hands out', () => {
  it('lists a canvas by artboard file, a deck by slide id, a doc by tab id', () => {
    expect(pagesOf('design', { 'canvas.json': CANVAS, 'Hero.dc.html': '', 'Card.dc.html': '' }).map((p) => p.page)).toEqual(['Hero.dc.html', 'Card.dc.html']);
    expect(pagesOf('design', { 'canvas.json': CANVAS, 'Hero.dc.html': '', 'Card.dc.html': '' })[0]).toMatchObject({ title: 'Hero', size: [1280, 720] });
    const deck = JSON.stringify({ title: 'Deck', order: ['a', 'b'] });
    expect(pagesOf('slides', { 'deck.json': deck, 'slides/a.html': '<section><h1>One</h1></section>', 'slides/b.html': '<section></section>' }).map((p) => p.page)).toEqual(['a', 'b']);
    const doc = JSON.stringify({ title: 'Doc', tabs: [{ id: 'intro', title: 'Intro' }, { id: 'more', title: 'More' }] });
    expect(pagesOf('docs', { 'doc.json': doc, 'tabs/intro.md': '# Intro', 'tabs/more.md': '# More' }).map((p) => [p.page, p.title])).toEqual([['intro', 'Intro'], ['more', 'More']]);
  });
  it('gives a dashboard and a motion piece one page, and a design system none', () => {
    expect(pagesOf('dashboard', { 'dash.json': JSON.stringify({ title: 'Usage' }) })).toEqual([{ page: 'index', title: 'Usage' }]);
    expect(pagesOf('motion', { 'motion.json': JSON.stringify({ title: 'Promo', order: [], formats: {} }) })).toHaveLength(1);
    expect(pagesOf('design-system', { 'design-system.json': '{}' })).toEqual([]);
  });
});

describe('what a page depends on', () => {
  it('follows an artboard to the boards it mounts and the pictures it shows', () => {
    const files = {
      'canvas.json': CANVAS,
      'Hero.dc.html': '<x-dc><dc-import name="Card"></dc-import><img src="uploads/a.png"></x-dc>',
      'Card.dc.html': '<x-dc><div style="background:url(assets/b.png)"></div></x-dc>',
    };
    const d = pageDeps('design', 'Hero.dc.html', files);
    expect(d.files.sort()).toEqual(['Card.dc.html', 'Hero.dc.html', 'assets/b.png', 'uploads/a.png']);
    expect(d.extra).toBe('[1280,720]');
  });
  it('takes a slide, its pictures and the deck size', () => {
    const d = pageDeps('slides', 'a', { 'deck.json': JSON.stringify({ size: [1280, 720] }), 'slides/a.html': '<section><img src="uploads/x.png"></section>' });
    expect(d.files).toEqual(['slides/a.html', 'uploads/x.png']);
    expect(JSON.parse(d.extra).size).toEqual([1280, 720]);
  });
  it('takes a tab, the pictures it names and what the doc wears', () => {
    const d = pageDeps('docs', 'intro', { 'doc.json': JSON.stringify({ settings: { width: 'wide' }, theme: { system: 'brand', theme: 'light' } }), 'tabs/intro.md': '# Hi\n\n![x](../uploads/p.png)\n', 'ds/brand/tokens.json': '{}' });
    expect(d.files).toEqual(['tabs/intro.md', 'uploads/p.png', 'ds/brand/tokens.json']);
    expect(d.extra).toContain('wide');
  });
  it('counts every file of a one-page kind', () => {
    expect(pageDeps('dashboard', 'index', {}).whole).toBe(true);
    expect(pageDeps('motion', 'index', {}).whole).toBe(true);
  });
});

describe('the record', () => {
  it('reads a record written by the artboard import as a live canvas artboard', () => {
    const [r] = linkedPagesOf({ imports: [{ path: 'uploads/box-Glow/Glow.dc.html', from: 'projects/box', board: 'Glow.dc.html', copiedAt: '2026-01-01T00:00:00Z' }] });
    expect(r).toMatchObject({ kind: 'design', page: 'Glow.dc.html', mode: 'live', from: 'projects/box' });
  });
  it('reads a picture record, keeping rel and the hash, and skips what is not a record', () => {
    const list = linkedPagesOf({ imports: [{ path: 'uploads/linked/k3f9a/hero.png', from: 'projects/brand', rel: 'sub/brand', kind: 'design', page: 'Hero.dc.html', mode: 'image', at: 'sha1:abc', copiedAt: 'x' }, null, { path: 1 }, { path: 'uploads/p.png', from: 'projects/x' }] });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ rel: 'sub/brand', at: 'sha1:abc', mode: 'image' });
  });
  it('puts a record in place of the one with the same path, and drops one by path', () => {
    const a: LinkedPage = { path: 'uploads/linked/aaaaa/x.png', from: 'projects/p', kind: 'slides', page: 's1', mode: 'image', copiedAt: '1' };
    const once = putLinked(undefined, a);
    const twice = putLinked(once, { ...a, at: 'sha1:new', copiedAt: '2' });
    expect(twice).toHaveLength(1);
    expect(twice[0]).toMatchObject({ at: 'sha1:new', copiedAt: '2' });
    const live = putLinked(twice, { path: 'uploads/p-Glow/Glow.dc.html', from: 'projects/p', kind: 'design', page: 'Glow.dc.html', mode: 'live', copiedAt: '3' });
    expect((live[1] as { board?: string }).board).toBe('Glow.dc.html');
    expect(dropLinked(live, a.path)).toHaveLength(1);
  });
});

describe('a picture\'s copy', () => {
  it('names a folder and a file that are safe and recognisable', () => {
    expect(linkedDir('k3f9a')).toBe('uploads/linked/k3f9a');
    expect(linkedStem('Hero Section.dc.html')).toBe('Hero-Section');
    expect(linkedStem('---')).toBe('page');
    expect(isLinkedPicture('uploads/linked/k3f9a/hero.png')).toBe(true);
    expect(isLinkedPicture('uploads/linked/k3f9a/../x.png')).toBe(false);
    expect(isLinkedPicture('uploads/x.png')).toBe(false);
  });
  it('picks an id that is not taken', () => {
    const seq = [0, 0, 0.5];
    let i = 0;
    const id = newLinkId(['00000'], () => seq[i++]);
    expect(id).not.toBe('00000');
    expect(id).toMatch(/^[a-z0-9]{5}$/);
  });
  it('reads a PNG\'s size from its header', () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(png.buffer).setUint32(16, 2560);
    new DataView(png.buffer).setUint32(20, 1440);
    expect(pngSize(png)).toEqual([2560, 1440]);
    expect(pngSize(new Uint8Array(30))).toBeNull();
  });
});

describe('what Claude Code is told', () => {
  it('lists the linked pages among a project\'s settings, an old artboard import as a live one', () => {
    const index = JSON.stringify({ title: 'Deck', order: [], imports: [{ path: 'uploads/box-Glow/Glow.dc.html', from: 'projects/box', board: 'Glow.dc.html' }, { path: 'uploads/linked/aaaaa/s.png', from: 'projects/p', kind: 'slides', page: 's1', mode: 'image' }] });
    const s = settingsProject('slides', { 'deck.json': index });
    expect(s.linked).toEqual([
      { path: 'uploads/box-Glow/Glow.dc.html', from: 'projects/box', page: 'Glow.dc.html', kind: 'design', mode: 'live' },
      { path: 'uploads/linked/aaaaa/s.png', from: 'projects/p', page: 's1', kind: 'slides', mode: 'image' },
    ]);
    expect(settingsProject('slides', { 'deck.json': JSON.stringify({ title: 'Deck', order: [] }) }).linked).toBeUndefined();
  });
  it('tells it a page was linked, updated or let go of, says not to edit the copy, and offers nothing', () => {
    const c = { type: 'link' as const, action: 'updated' as const, path: 'uploads/linked/aaaaa/s.png', page: 'Cover', project: 'Intro' };
    expect(followUpFor(c)).toBeNull();
    expect(describeChange(c)).toContain('updated from its original');
    expect(describeChange(c)).toContain('do not edit it');
    expect(describeChange({ ...c, action: 'unlinked' })).toContain('unlinked');
    // one copy, one change: the latest word on it
    expect(mergeChange({ ...c, action: 'added' }, c)).toEqual(c);
  });
});
