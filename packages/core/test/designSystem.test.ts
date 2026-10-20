import { describe, expect, it } from 'vitest';
import {
  colorIn,
  compileTokensCss,
  componentNames,
  dsFolderOf,
  isDsTextFile,
  namespaceOf,
  parseBundleHeader,
  parseCardMarker,
  resolveTokens,
  shadowIn,
  sectionFiles,
  starterTokens,
  styleDeclarations,
  editTokensJson,
} from '../src';

const TOKENS = {
  name: 'Ember',
  color: {
    themes: [
      { id: 'light', name: 'Light' },
      { id: 'dark', name: 'Dark' },
    ],
    tokens: [
      { name: 'surface', value: { light: '#FBF7F1', dark: '#1d1a17' }, usage: 'Page background.' },
      { name: 'ink', value: '#2b2118' },
      { name: 'ember', value: { light: '#c2410c', dark: 'oklch(0.75 0.15 50)' } },
      { name: 'link', value: '{ember}' },
      { name: 'late', value: { dark: '#ffffff' } },
      { name: 'named', value: 'red' },
      { name: 'ghost', value: '{nope}' },
      { name: 'loop-a', value: '{loop-b}' },
      { name: 'loop-b', value: '{loop-a}' },
      { name: 'ink', value: '#000' },
      { name: 'bad name', value: '#000' },
    ],
  },
  type: {
    fonts: [{ family: 'Acme Sans', file: 'AcmeSans.woff2', weight: '400' }],
    families: { sans: '"Acme Sans", system-ui, sans-serif', evil: 'x; background:url(y)' },
    groups: [
      {
        name: 'Text',
        family: 'sans',
        styles: [
          { name: 'body', fontSize: '1rem', lineHeight: 1.5, fontWeight: 'normal' },
          { name: 'title', fontSize: 40, lineHeight: '48px', fontWeight: 700, letterSpacing: '-0.5px' },
          { name: 'broken', fontSize: 'huge' },
        ],
      },
    ],
  },
  spacing: { tokens: [{ name: 'space-1.5', value: 6 }, { name: 'space-4', value: '1rem' }, { name: 'ink', value: '2px' }] },
  radius: { brand: { $value: '4px' } },
  shadow: {
    tokens: [
      { name: 'card', value: { light: '0 1px 2px rgba(0,0,0,.1)', dark: '0 1px 2px #000' } },
      { name: 'glow', value: '0 0 24px var(--ember), 4px 4px 0 var(--link)' },
      { name: 'ghost-glow', value: '0 0 8px var(--nowhere)' },
      { name: 'loose-glow', value: '0 0 8px var(--ember, red)' },
    ],
  },
  zIndex: { tokens: [{ name: 'z-menu', value: 30 }] },
  motion: { tokens: [{ name: 'fast', value: '120ms' }] },
};

describe('tokens.json', () => {
  const t = resolveTokens(JSON.stringify(TOKENS));
  const why = t.issues.map((i) => `${i.at}: ${i.message}`).join('\n');

  it('reads themes, colours, aliases and per-theme values', () => {
    expect(t.themes.map((x) => x.id)).toEqual(['light', 'dark']);
    expect(t.colors.map((c) => c.name)).toEqual(['surface', 'ink', 'ember', 'link', 'late']);
    expect(colorIn(t, 'surface', 'light')).toBe('#fbf7f1');
    expect(colorIn(t, 'ink', 'dark')).toBe('#2b2118'); // a plain string is every theme's
    expect(colorIn(t, 'link', 'dark')).toBe('oklch(0.75 0.15 50)');
    expect(t.colors.find((c) => c.name === 'link')!.alias).toEqual({ light: 'ember', dark: 'ember' });
    expect(colorIn(t, 'late', 'light')).toBe('#ffffff'); // borrowed from a later theme
  });

  it('drops what breaks the grammar, saying why', () => {
    expect(why).toMatch(/"red" is not a colour/);
    expect(why).toMatch(/"ghost" aliases "nope", which does not exist/);
    expect(why).toMatch(/loop-a" aliases "loop-b" in a loop/);
    expect(why).toMatch(/"ink" is used twice/);
    expect(why).toMatch(/"bad name" is not a token name/);
    expect(why).toMatch(/evil/);
    expect(why).toMatch(/"broken": fontSize "huge" is not a length/);
    expect(why).toMatch(/radius is \{"tokens"/);
    expect(why).toMatch(/There is no motion family/);
    expect(why).toMatch(/"ghost-glow": var\(--nowhere\) is not one of the system's colours/);
    expect(why).toMatch(/"loose-glow": var\(--ember, red\) is not one of the system's colours/);
    expect(why).toMatch(/spacing\.tokens\[2\]: "ink" is used twice/);
  });

  it('reads type, spacing, shadow and further families', () => {
    expect(t.families).toEqual({ sans: '"Acme Sans", system-ui, sans-serif' });
    expect(t.fonts).toEqual([{ family: 'Acme Sans', file: 'fonts/AcmeSans.woff2', weight: '400', style: undefined }]);
    expect(t.groups[0].styles.map((s) => [s.name, s.fontSize, s.lineHeight, s.fontWeight])).toEqual([
      ['body', '1rem', '1.5', '400'],
      ['title', '40px', '48px', '700'],
    ]);
    expect(t.others.map((f) => [f.key, f.tokens.map((x) => x.value)])).toEqual([
      ['spacing', ['6px', '1rem']],
      ['shadow', ['0 1px 2px rgba(0,0,0,.1)', '0 0 24px var(--ember), 4px 4px 0 var(--link)']],
      ['zIndex', ['30']],
    ]);
    expect(t.others[2].title).toBe('Z index');
  });

  it('draws a shadow with its colours filled in', () => {
    expect(shadowIn(t, '0 0 24px var(--ember)', 'dark')).toBe('0 0 24px oklch(0.75 0.15 50)');
    expect(shadowIn(t, '0 0 24px var(--nope)', 'dark')).toBe('0 0 24px var(--nope)');
  });

  it('compiles tokens.css like the original', () => {
    const css = compileTokensCss(t, { title: 'Ember' });
    expect(css).toContain(':root, [data-theme="light"] {\n  --surface: #FBF7F1;');
    expect(css).toContain('  --link: var(--ember);');
    expect(css).toContain('[data-theme="dark"] {\n  --surface: #1d1a17;');
    expect(css).toContain('  --glow: 0 0 24px var(--ember), 4px 4px 0 var(--link);');
    expect(css).toContain('  --space-1\\.5: 6px;');
    expect(css).toContain('  --font-sans: "Acme Sans", system-ui, sans-serif;');
    expect(css).toContain('.title {\n  font-family: var(--font-sans);\n  font-size: 40px;');
    expect(css).toContain('src: url("fonts/AcmeSans.woff2") format("woff2")');
    expect(compileTokensCss(t, { fontBase: 'ds/ember/' })).toContain('url("ds/ember/fonts/AcmeSans.woff2")');
    // the dark block only re-declares what differs
    expect(css.split('[data-theme="dark"]')[1]).not.toContain('--ink:');
  });

  it('turns a type style into inline declarations (px for slides)', () => {
    const body = t.groups[0].styles[0];
    expect(styleDeclarations(t, body, t.groups[0], true)).toEqual({
      'font-family': '"Acme Sans", system-ui, sans-serif',
      'font-size': '16px',
      'line-height': '1.5',
      'font-weight': '400',
    });
  });

  it('reads a map-shaped (DTCG) colour family as nothing, with a reason', () => {
    const d = resolveTokens({ color: { tokens: { brand: { $value: '#f00' } } } });
    expect(d.colors).toEqual([]);
    expect(d.issues[0].message).toMatch(/LIST/);
  });

  it('reads hosted Google faces (our extension) and imports them first', () => {
    const h = resolveTokens({ type: { hosted: [{ family: 'Noto Sans SC', href: 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC&display=swap' }, { family: 'X', href: 'https://evil.example/x.css' }] } });
    expect(h.hosted).toEqual([{ family: 'Noto Sans SC', href: 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC&display=swap' }]);
    expect(h.issues).toHaveLength(1);
    expect(compileTokensCss(h).split('\n')[2]).toBe('@import url("https://fonts.googleapis.com/css2?family=Noto+Sans+SC&display=swap");');
  });

  it('keeps font names and paths plain (they land inside url("…") in a stylesheet)', () => {
    const bad = resolveTokens({ type: { fonts: [{ family: 'A', file: 'fonts/a.woff2") } body{background:url(https://x)} x{' }, { family: 'B}{', file: 'fonts/b.woff2' }, { family: 'Good Sans', file: 'good.woff2' }] } });
    expect(bad.fonts.map((f) => f.family)).toEqual(['Good Sans']);
    expect(bad.issues).toHaveLength(2);
  });

    it('the starter system is clean', () => {
    const s = resolveTokens(starterTokens('Acme'));
    expect(s.issues).toEqual([]);
    expect(s.colors.length).toBe(7);
  });

  it('edits keep everything else', () => {
    const out = editTokensJson('{"name":"A","x":{"y":1},"color":{"tokens":[]}}', (j) => {
      (j.color as { tokens: unknown[] }).tokens.push({ name: 'n', value: '#000' });
    });
    expect(JSON.parse(out)).toEqual({ name: 'A', x: { y: 1 }, color: { tokens: [{ name: 'n', value: '#000' }] } });
  });
});

describe('design system files', () => {
  it('names and folders', () => {
    expect(namespaceOf('Math in motion 2')).toBe('MathInMotion2');
    expect(namespaceOf('数学')).toBe('DS');
    expect(namespaceOf('math')).toBe('MathDS');
    expect(dsFolderOf('Brand 2.0')).toBe('brand-2-0');
  });

  it('reads card markers and the bundle header', () => {
    expect(parseCardMarker('<!-- @dsCard group="Actions" height=72 subtitle="Two states" -->\n<div>')).toEqual({ group: 'Actions', height: 72, subtitle: 'Two states' });
    expect(parseCardMarker('<div>')).toEqual({});
    expect(parseBundleHeader('/* @ds-bundle: {"format":4,"namespace":"Ember","components":[{"name":"Button"},{"name":"Badge"}]} */\n(()=>{})()')).toEqual({
      namespace: 'Ember',
      components: ['Button', 'Badge'],
    });
  });

  it('lists components and sections', () => {
    const files = ['components/Card/preview.html', 'components/Badge/README.md', 'components/Cover/preview.html', 'components/bundle.js', 'README.md', 'voice.md', 'components/Card/README.md', 'archived/old.md'];
    expect(componentNames(files, '/* @ds-bundle: {"components":[{"name":"Card"}]} */')).toEqual(['Card', 'Badge']);
    expect(sectionFiles(files)).toEqual(['README.md', 'voice.md']);
  });

  it('knows which files are text', () => {
    for (const ok of ['design-system.json', 'tokens.json', 'tokens.css', 'README.md', 'voice.md', 'components/Card/preview.html', 'components/bundle.js', 'components/lib/react.production.min.js', 'assets/Logos/README.md'])
      expect(isDsTextFile(ok), ok).toBe(true);
    for (const no of ['../x.md', 'components/Card/../../x.html', '.env', 'components/card-x/preview.html', 'assets/Logos/logo.svg', 'package.json'])
      expect(isDsTextFile(no), no).toBe(false);
  });
});
