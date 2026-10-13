import { describe, expect, it } from 'vitest';
import { translator } from '@dc/i18n';
import { addToCanvas, describeReport, escapeAttr, escapeText, hexColors, joinPath, packPage, patchStyle, toCanvas, type Extracted, type XElement, type XNode } from '../src';
import { resolveVars, specificity, splitSelectors } from '../src/sources/html/extract';

const enc = new TextEncoder();

describe('selectors', () => {
  it('counts specificity', () => {
    expect(specificity('#a .b c')).toEqual([1, 1, 1]);
    expect(specificity('a:hover::before')).toEqual([0, 1, 2]);
    expect(specificity(':where(.x) p')).toEqual([0, 0, 1]);
    expect(specificity(':is(.x, #y) [data-a="b c"]')).toEqual([1, 2, 0]);
  });
  it('splits selector lists outside parentheses and strings', () => {
    expect(splitSelectors('a, :is(b, c), [x=","]')).toEqual(['a', ':is(b, c)', '[x=","]']);
  });
  it('resolves custom properties with fallbacks', () => {
    const cs = { getPropertyValue: (p: string) => ({ '--a': ' 4px', '--b': 'var(--a)' })[p] ?? '' };
    expect(resolveVars('calc(var(--b) * 2)', cs)).toBe('calc(4px * 2)');
    expect(resolveVars('var(--none, red)', cs)).toBe('red');
    expect(resolveVars('var(--none)', cs)).toBe('');
  });
});

describe('style text', () => {
  it('patches declarations and keeps the rest as written', () => {
    expect(patchStyle('color: red; background: url("a;b.png")', { color: null, padding: '0' })).toBe('background: url("a;b.png"); padding: 0;');
  });
  it('writes opaque colors as hex', () => {
    expect(hexColors('color: rgb(47, 111, 237); border-color: rgba(0, 0, 0, 0); fill: rgba(1, 2, 3, 0.5)')).toBe('color: #2f6fed; border-color: transparent; fill: rgba(1, 2, 3, 0.5)');
  });
  it('escapes template holes in text and attributes', () => {
    expect(escapeText('a < {{b}}')).toBe("a &lt; {{ '{{' }}b}}".replace(' ', escapeText(' ')));
    expect(escapeAttr('"{{x}}"')).toBe("&quot;{{ '{{' }}x}}&quot;");
  });
});

const box = (top = 0, height = 100, display = 'block') => ({ top, height, marginTop: 0, marginBottom: 0, display, whiteSpace: 'normal' });
const el = (tag: string, children: XNode[] = [], style = '', b = box(), attrs: [string, string][] = []): XElement => ({ kind: 'el', tag, ns: 'html', attrs, style, children, box: b });
const text = (t: string): XNode => ({ kind: 'text', text: t });
const page = (root: XElement, height = root.box.height): Extracted => ({
  from: 'html',
  title: 'Acme',
  lang: 'en',
  width: 1280,
  height,
  root,
  headCss: '',
  fontLinks: [],
  urls: [],
  report: { elements: 0, stateRules: 0, otherMediaRules: 0, unreadableSheets: [], scripts: 0, hidden: 0, transparent: 0, pseudoElements: 0, dropped: {}, truncated: false },
});

describe('toCanvas', () => {
  it('writes one artboard with inline styles, mapped assets and a note', () => {
    const root = el('body', [
      el('h1', [text('Hi '), el('b', [text('there')], '', box(0, 20, 'inline'))], 'color: rgb(255, 0, 0);', box(0, 40)),
      el('img', [], '', box(40, 60), [['src', 'https://x.test/a.png']]),
    ], '', box(0, 100));
    const out = toCanvas(page(root), { now: '2026-01-01T00:00:00Z', mapUrl: (u) => (u.endsWith('a.png') ? 'assets/a-1.png' : undefined), missing: ['b.css'] });
    const files = Object.keys(out.files);
    expect(files).toEqual(['Main.dc.html', 'canvas.json']);
    const html = out.files['Main.dc.html'];
    expect(html).toContain('<h1 style="color: #ff0000;">Hi <b>there</b></h1>');
    expect(html).toContain('src="assets/a-1.png"');
    const canvas = JSON.parse(out.files['canvas.json']);
    expect(canvas.boards['Main.dc.html'].imported).toMatchObject({ from: 'html', width: 1280 });
    expect(canvas.notes.imported.text).toContain('b.css');
    expect(describeReport(out.report)[0]).toBe('1 artboard, 0 elements');
    expect(describeReport(out.report, translator('zh'))[0]).toMatch(/^1 个画板/);
  });

  it('adds an import beside what a canvas already has, without touching it', () => {
    const existing = JSON.stringify({
      v: 3, title: 'Mine', order: ['Main.dc.html'], pages: [], launch: { view: 'canvas' }, designSystems: [],
      boards: { 'Main.dc.html': { x: 0, y: 100, w: 800, h: 600, title: 'Home' } },
      notes: { n1: { x: 900, y: 120, text: 'hi', w: 200 } },
    });
    const out = toCanvas(page(el('body', [el('h1', [text('Hi')], '', box(0, 40))], '', box(0, 100))), { now: 'x' });
    const added = addToCanvas(existing, out, { taken: ['Acme.dc.html'] });
    expect(added.boards).toEqual(['Acme2.dc.html']);
    expect(Object.keys(added.files).sort()).toEqual(['Acme2.dc.html', 'canvas.json']);
    const c = JSON.parse(added.files['canvas.json']);
    expect(c.title).toBe('Mine');
    expect(c.boards['Main.dc.html']).toEqual({ x: 0, y: 100, w: 800, h: 600, title: 'Home' });
    expect(c.boards['Acme2.dc.html']).toMatchObject({ x: 1340, y: 100, w: 1280, title: 'Acme', imported: { from: 'html' } });
    expect(c.order).toEqual(['Main.dc.html', 'Acme2.dc.html']);
    expect(c.notes.n1.text).toBe('hi');
    const note = Object.entries(c.notes).find(([k]) => k !== 'n1')!;
    expect(note[1]).toMatchObject({ x: 1340 + 1280 + 80, y: 100 });
    expect(added.area).toMatchObject({ x: 1340, y: 100 });
  });

  it('adds an import to an empty canvas at the origin', () => {
    const out = toCanvas(page(el('body', [], '', box(0, 100))), { now: 'x', note: false });
    const added = addToCanvas(undefined, out);
    expect(added.boards).toEqual(['Acme.dc.html']);
    expect(JSON.parse(added.files['canvas.json']).boards['Acme.dc.html']).toMatchObject({ x: 0, y: 0 });
  });

  it('names the first board of a split page after the page', () => {
    const sections = [0, 1, 2, 3].map((i) => el('section', [text(`S${i}`)], '', box(i * 900, 900)));
    const out = toCanvas(page(el('body', sections, '', box(0, 3600))), { now: 'x', note: false });
    const added = addToCanvas(undefined, out);
    expect(added.boards[0]).toBe('Acme.dc.html');
  });

  it('splits a long page into one artboard per section', () => {
    const sections = [0, 1, 2, 3].map((i) => el('section', [text(`S${i}`)], '', box(i * 900, 900)));
    const out = toCanvas(page(el('body', sections, '', box(0, 3600))), { now: 'x', note: false });
    expect(out.report.boards.length).toBe(4);
    expect(out.report.boards.map((b) => b.top)).toEqual([0, 900, 1800, 2700]);
    expect(JSON.parse(out.files['canvas.json']).notes).toEqual({});
  });

  it('keeps short pages whole with split auto', () => {
    const sections = [0, 1].map((i) => el('section', [text(`S${i}`)], '', box(i * 600, 600)));
    expect(toCanvas(page(el('body', sections, '', box(0, 1200))), { now: 'x' }).report.boards.length).toBe(1);
  });
});

describe('packPage', () => {
  const file = (path: string, body: string | Uint8Array, type = '') => ({ path, type, bytes: typeof body === 'string' ? enc.encode(body) : body });
  it('inlines stylesheets, imports and assets, and lists what is missing', () => {
    const out = packPage(
      [
        file('site/index.html', '<link rel="stylesheet" href="css/a.css"><link rel="stylesheet" href="https://cdn.test/x.css"><img src="img/p.png"><img src="gone.png">'),
        file('site/css/a.css', '@import "b.css"; .a{background:url(../img/p.png)}', 'text/css'),
        file('site/css/b.css', '.b{color:red}', 'text/css'),
        file('site/img/p.png', new Uint8Array([1, 2, 3]), 'image/png'),
      ],
      'site/index.html',
    );
    expect(out.html).toContain('.b{color:red}');
    expect(out.html).not.toContain('href="css/a.css"');
    expect(out.html).toMatch(/url\(data:image\/png;base64,AQID\)/);
    expect(out.html).toContain('src="data:image/png;base64,AQID"');
    expect([...out.paths.values()]).toEqual(['site/img/p.png']);
    expect(out.missing).toEqual(['site/gone.png']);
    expect(out.remoteCss).toEqual(['https://cdn.test/x.css']);
  });
  it('resolves relative paths', () => {
    expect(joinPath('a/b/', '../c/./d.png')).toBe('a/c/d.png');
  });
});
