import { describe, expect, it } from 'vitest';
import { DOC_COLORS, DOC_COLORS_ON_DARK, DOC_ROLES, docLookCss, docLookFromSystem, docLookOf, docLookVars, docOwnLook, docRoleGiven, docRoleReport, lookFontCss, lookOf, lookTokens, parseDoc, resolveTokens, settingsProject, type ThemeSystem } from '../src';

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
    expect(l).toMatchObject({ sizes: [24, 20, 18], h4: 16, body: 16, line: 1.8, headingLine: 1.4, headingWeight: 700, column: 677 });
    const t = JSON.parse(lookTokens(lookOf('wechat')!, 'X'));
    const style = (n: string) => t.type.groups[1].styles.find((x: { name: string }) => x.name === n);
    style('doc-h1').fontSize = '400px';
    style('doc-body').lineHeight = '27px';
    t.spacing.tokens.find((x: { name: string }) => x.name === 'doc-column').value = '20px';
    const odd = docLookFromSystem(resolveTokens(JSON.stringify(t)), 'light');
    expect(odd.sizes[0]).toBe(30);
    expect(odd.line).toBeCloseTo(27 / 16);
    expect(odd.column).toBeNull();
  });

  it('reads every role a system gives for documents: quote, code, table head, rule, gap, indent, code size', () => {
    const l = docLookFromSystem(system('wechat').tokens, 'light');
    expect(l).toMatchObject({ heading: '#1a1a1a', rule: '#dddddd', ground: '#f6f8fa', tableHead: '#f6f8fa', gap: 13, indent: 24, codeSize: 13, codeLine: 1.6 });
    expect(l.quote).toEqual({ bar: '#07c160', bg: '#f9f9f9' });
  });

  it('derives what a system leaves out from its generic roles, and leaves the reader’s rhythm alone', () => {
    const l = docLookFromSystem(system('bauhaus').tokens, 'light');
    expect(l).toMatchObject({ gap: null, indent: null, codeSize: null, h4: null, headingLine: 1.3 });
    expect(l.quote.bg).toBe('transparent');
    expect(l.tableHead).toBe(l.ground);
    expect(l.heading).toBe(l.ink);
  });
});

describe('docRoleReport', () => {
  it('says which roles the system gave and which were derived, with the value the doc is drawn by', () => {
    const wx = docRoleReport(system('wechat').tokens, 'light');
    expect(wx).toHaveLength(DOC_ROLES.length);
    const by = (n: string) => wx.find((x) => x.role.name === n)!;
    expect(by('doc-quote-bg')).toMatchObject({ source: 'system', value: '#f9f9f9' });
    expect(by('doc-body')).toMatchObject({ source: 'system', value: '16px / 1.8' });
    expect(by('doc-mark').source).toBe('derived');
    expect(by('doc-code-ink').source).toBe('derived');
    const plain = docRoleReport(system('bauhaus').tokens, 'light');
    expect(plain.every((x) => x.source === 'derived')).toBe(true);
    expect(plain.find((x) => x.role.name === 'doc-gap')!.value).toBe('10px');
  });

  it('names every role once, in a kind the page can read', () => {
    expect(new Set(DOC_ROLES.map((r) => r.name)).size).toBe(DOC_ROLES.length);
    for (const r of DOC_ROLES) expect(r.name).toMatch(/^doc-[a-z0-9-]+$/);
  });

  it('is written into a new system from a look that carries it, and reads back without issues', () => {
    const t = resolveTokens(lookTokens(lookOf('wechat')!, 'X'));
    expect(t.issues).toEqual([]);
    expect(t.colors.some((c) => c.name === 'doc-quote-bg')).toBe(true);
    expect(DOC_ROLES.filter((r) => docRoleGiven(t, r, 'light')).length).toBeGreaterThanOrEqual(15);
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
