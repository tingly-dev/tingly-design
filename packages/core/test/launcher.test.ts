import { describe, expect, it } from 'vitest';
import { projectCard } from '../src';

const reader = (files: Record<string, string>) => async (rel: string) => files[rel];

describe('projectCard', () => {
  it('a canvas previews the board it opens on and maps every board', async () => {
    const files = {
      'canvas.json': JSON.stringify({ title: 'Console', boards: { 'A.dc.html': { x: 0, y: 0, w: 400, h: 300, title: 'A' }, 'B.dc.html': { x: 500, y: 0, w: 400, h: 300 } }, launch: { view: 'focused', file: 'B.dc.html' } }),
      'A.dc.html': '<div>a</div>',
      'B.dc.html': '<div>b</div>',
    };
    const c = await projectCard('console', 'design', Object.keys(files), reader(files), '2026-10-01T00:00:00Z');
    expect(c).toMatchObject({ name: 'console', title: 'Console', count: 2, updatedAt: '2026-10-01T00:00:00Z' });
    if (c.preview.kind !== 'design') throw new Error('kind');
    expect(c.preview.boards.map((b) => b.title)).toEqual(['A', 'B.dc.html']);
    expect(c.preview.board).toEqual({ file: 'B.dc.html', w: 400, h: 300, source: '<div>b</div>' });
  });

  it('a board too large to send keeps only the minimap', async () => {
    const files = { 'canvas.json': JSON.stringify({ title: 'Big', boards: { 'A.dc.html': { x: 0, y: 0, w: 10, h: 10 } } }), 'A.dc.html': 'x'.repeat(300_000) };
    const c = await projectCard('big', 'design', Object.keys(files), reader(files));
    expect(c.preview.kind === 'design' && c.preview.board).toBeUndefined();
  });

  it('a deck previews its cover slide with its typefaces', async () => {
    const files = {
      'deck.json': JSON.stringify({ v: 4, title: 'Intro', cover: 'two', order: ['one', 'two'], faces: { inter: { family: 'Inter', href: 'https://fonts.googleapis.com/css2?family=Inter' } } }),
      'slides/one.html': '<section id="one"></section>',
      'slides/two.html': '<section id="two"></section>',
    };
    const c = await projectCard('intro', 'slides', Object.keys(files), reader(files));
    expect(c.count).toBe(2);
    if (c.preview.kind !== 'slides' || !c.preview.cover) throw new Error('no cover');
    expect(c.preview.cover.file).toBe('slides/two.html');
    expect(c.preview.cover.head).toContain('fonts.googleapis.com');
  });

  it('a design system shows its colours, typeface and components', async () => {
    const files = {
      'design-system.json': JSON.stringify({ title: 'Brand DS', namespace: 'Brand' }),
      'tokens.json': JSON.stringify({
        color: { themes: [{ id: 'light', name: 'Light' }], tokens: [{ name: 'ink', value: { light: '#111111' } }, { name: 'brand', value: { light: '#2563eb' } }] },
        type: { families: { sans: "'Inter', Arial, sans-serif" } },
      }),
      'components/Button/preview.html': '<button>',
      'components/Cover/preview.html': '<div>',
    };
    const c = await projectCard('brand', 'design-system', Object.keys(files), reader(files));
    expect(c.title).toBe('Brand DS');
    expect(c.preview).toEqual({ kind: 'design-system', colors: ['#111111', '#2563eb'], components: ['Button'], fonts: ['Inter'] });
  });

  it('a dashboard lists its datasets by title, falling back to the file name', async () => {
    const files = { 'dash.json': JSON.stringify({ title: 'Usage' }), 'datasets/a.json': JSON.stringify({ title: 'Daily traffic' }), 'datasets/b.json': '{not json' };
    const c = await projectCard('usage', 'dashboard', Object.keys(files), reader(files));
    expect(c.preview).toEqual({ kind: 'dashboard', datasets: ['Daily traffic', 'b'] });
    expect(c.count).toBe(2);
  });

  it('a doc shows its tab outline and the first paragraph of prose', async () => {
    const files = {
      'doc.json': JSON.stringify({ title: 'Handbook', tabs: [{ id: 'a', title: 'Overview' }, { id: 'b', title: 'Detail', parent: 'a' }] }),
      'tabs/a.md': '# Handbook\n\nStatus: draft\n\nThis is **the** first [paragraph](https://x.dev).\n\nSecond.',
    };
    const c = await projectCard('hb', 'docs', Object.keys(files), reader(files));
    expect(c.preview).toEqual({ kind: 'docs', tabs: [{ title: 'Overview', depth: 0 }, { title: 'Detail', depth: 1 }], excerpt: 'This is the first paragraph.' });
  });
});
