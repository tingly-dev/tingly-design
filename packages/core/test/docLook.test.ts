import { describe, expect, it } from 'vitest';
import { DOC_COLORS, DOC_COLORS_ON_DARK, docLookCss, docLookFromSystem, docLookOf, docLookVars, docOwnLook, lookFontCss, lookOf, lookTokens, parseDoc, resolveTokens, settingsProject, type ThemeSystem } from '../src';

const system = (id: string): ThemeSystem => ({ namespace: `look-${id}`, title: id, tokens: resolveTokens(lookTokens(lookOf(id)!, id)) });
const doc = (extra: object = {}) => parseDoc(JSON.stringify({ title: 'D', tabs: [{ id: 'a', title: 'A' }], ...extra }));

describe('the doc’s own look', () => {
  it('is what the editor and the HTML export draw without a design system', () => {
    const l = docOwnLook();
    expect([l.page, l.ink, l.link, l.rule, l.ground, l.sizes]).toEqual(['', '#1d1d1b', '#1d4ed8', '#d6d4ce', '#f5f5f3', [30, 22, 18]]);
    expect(l.colors).toBe(DOC_COLORS);
    expect(docOwnLook({ headingFont: 'serif', bodyFont: 'sans' }).headingFont).toContain('Source Serif');
    expect(docOwnLook({ headingFont: 'sans', bodyFont: 'serif' }).bodyFont).toContain('Source Serif');
  });
});

describe('the look a design system gives a doc', () => {
  it('fills the roles from the theme: page, text, line, card, brand, faces and corners', () => {
    const l = docLookFromSystem(system('wechat').tokens, 'light');
    expect(l).toMatchObject({ page: '#ffffff', dark: false, ink: '#333333', muted: '#666666', faint: '#888888', rule: '#dddddd', ground: '#f6f8fa', link: '#07c160', radius: 6 });
    expect(l.quote.bar).toBe('#07c160');
    expect(l.headingFont).toContain('PingFang');
    expect(l.headingFont).not.toContain('"');
    expect(l.colors).toBe(DOC_COLORS);
  });

  it('keeps the doc’s sizes and rhythm: a system sized for slides does not size a document', () => {
    const l = docLookFromSystem(system('bauhaus').tokens, 'light');
    expect(l).toMatchObject({ sizes: [30, 22, 18], body: 16, line: 1.75, column: null });
  });

  it('takes sizes, line height and column from the system’s own doc styles, and ignores a value out of range', () => {
    const l = docLookFromSystem(system('wechat').tokens, 'light');
    expect(l).toMatchObject({ sizes: [24, 20, 18], body: 16, line: 1.8, column: 677 });
    const t = JSON.parse(lookTokens(lookOf('wechat')!, 'X'));
    t.type.groups[1].styles[0].fontSize = '400px';
    t.type.groups[1].styles[3].lineHeight = '27px';
    t.spacing.tokens.find((x: { name: string }) => x.name === 'doc-column').value = '20px';
    const odd = docLookFromSystem(resolveTokens(JSON.stringify(t)), 'light');
    expect(odd.sizes[0]).toBe(30);
    expect(odd.line).toBeCloseTo(27 / 16);
    expect(odd.column).toBeNull();
  });

  it('knows a dark page, and gives it text colours and a highlight made for it', () => {
    const l = docLookFromSystem(system('nord').tokens, 'dark');
    expect(l.dark).toBe(true);
    expect(l.page).toBe(system('nord').tokens.colors.find((c) => c.name === 'surface')!.values.dark);
    expect(l.colors).toBe(DOC_COLORS_ON_DARK);
    expect(l.mark).toContain('rgba');
  });
});

describe('docLookOf', () => {
  const systems = [system('wechat'), system('nord')];

  it('is the doc’s own look until the doc wears a system', () => {
    const r = docLookOf(doc(), systems);
    expect(r.worn).toBeNull();
    expect(r.look.page).toBe('');
  });

  it('wears the system and theme doc.json chose, when that system is installed', () => {
    const r = docLookOf(doc({ theme: { system: 'look-wechat', theme: 'light' } }), systems);
    expect(r.worn).toEqual({ system: 'look-wechat', theme: 'light', title: 'wechat' });
    expect(r.look.link).toBe('#07c160');
    expect(r.tokens).toBe(systems[0].tokens);
  });

  it('falls back: a system that is gone is the own look, a theme that is gone is the system’s first', () => {
    expect(docLookOf(doc({ theme: { system: 'look-nope', theme: 'light' } }), systems).worn).toBeNull();
    expect(docLookOf(doc({ theme: { system: 'look-nord', theme: 'nope' } }), systems).worn?.theme).toBe('dark');
  });
});

describe('what the look becomes', () => {
  const l = docLookFromSystem(system('wechat').tokens, 'light');

  it('is the editor’s custom properties, with the text colour names for the page', () => {
    const v = docLookVars(l);
    expect(v['--look-page']).toBe('#ffffff');
    expect(v['--look-link']).toBe('#07c160');
    expect(v['--look-h1']).toBe('24px');
    expect(v['--look-size']).toBe('16px');
    expect(v['--look-line']).toBe('1.8');
    expect(v['--look-column']).toBe('677px');
    expect(docLookVars(docOwnLook())['--look-column']).toBeUndefined();
    expect(v['--doc-red']).toBe(DOC_COLORS.red);
    expect(docLookVars(docLookFromSystem(system('nord').tokens, 'dark'))['--doc-red']).toBe(DOC_COLORS_ON_DARK.red);
  });

  it('is the export’s stylesheet: the page, text, headings, table, code and quote of the look', () => {
    const css = docLookCss(l);
    expect(css).toContain('html,body{background:#ffffff;}');
    expect(css).toContain('a{color:#07c160}');
    expect(css).toContain('th{background:#f6f8fa');
    expect(docLookCss(docOwnLook())).toContain('html,body{}');
    expect(docLookCss(docOwnLook())).toContain('a{color:#1d4ed8}');
  });

  it('loads a system’s hosted faces first and its font files by @font-face', () => {
    const css = lookFontCss(resolveTokens({ type: { hosted: [{ family: 'X', href: 'https://fonts.googleapis.com/css2?family=X' }], fonts: [{ family: 'Y', file: 'fonts/y.woff2', weight: '400' }], families: { sans: 'X' } }, color: { themes: [{ id: 'light', name: 'Light' }], tokens: [] } }), '/raw/p/ds/s/');
    expect(css.split('\n')[0]).toBe('@import url("https://fonts.googleapis.com/css2?family=X");');
    expect(css).toContain('url("/raw/p/ds/s/fonts/y.woff2") format("woff2")');
  });
});

describe('what a doc tells Claude Code', () => {
  it('names the systems it has installed and the theme it wears', () => {
    const index = JSON.stringify({ title: 'D', tabs: [], designSystems: [{ namespace: 'look-wechat', title: 'WeChat' }], theme: { system: 'look-wechat', theme: 'light' } });
    const s = settingsProject('docs', { 'doc.json': index });
    expect(s.designSystems).toEqual(['look-wechat']);
    expect(s.theme).toEqual({ system: 'look-wechat', theme: 'light' });
    expect(s.look).toBeDefined();
  });
});
