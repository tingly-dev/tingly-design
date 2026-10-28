import { describe, expect, it } from 'vitest';
import {
  applyThemePlan,
  colourGroup,
  colourRoles,
  contrastRatio,
  detectTheme,
  normColour,
  planOriginal,
  planTheme,
  resolveTokens,
  scanSources,
  themeContrast,
  themeRecordOf,
  type ThemeSystem,
} from '../src';

const sys = (namespace: string, title: string, json: unknown): ThemeSystem => ({ namespace, title, tokens: resolveTokens(JSON.stringify(json)) });

const TINGLY = sys('tingly', 'Tingly', {
  color: {
    themes: [
      { id: 'light', name: 'Light' },
      { id: 'dark', name: 'Dark' },
    ],
    tokens: [
      { name: 'paper', value: { light: '#f7f7f4', dark: '#111317' } },
      { name: 'surface', value: { light: '#ffffff', dark: '#1a1d23' } },
      { name: 'line', value: { light: '#e5e5e0', dark: '#2b2f37' } },
      { name: 'ink', value: { light: '#16181d', dark: '#eceef2' } },
      { name: 'ink-muted', value: { light: '#4a4f5a', dark: '#a3a8b3' } },
      { name: 'accent', value: { light: '#0f766e', dark: '#2dd4bf' } },
    ],
  },
  type: { families: { sans: 'Inter, sans-serif' } },
});

// a look: its page is called `surface`, its cards `surface-raised`
const WARM = sys('look-warm', 'Warm', {
  color: {
    themes: [{ id: 'light', name: 'Light' }],
    tokens: [
      { name: 'surface', value: '#fff8ee' },
      { name: 'surface-raised', value: '#ffffff' },
      { name: 'ink', value: '#2b1d0e' },
      { name: 'accent', value: '#c2410c' },
    ],
  },
  type: { families: { sans: 'Georgia, serif', display: "'Playfair Display', serif" } },
});

const BOARD = `<x-dc><div style="width:880px;background:#f7f7f4;color:#16181d;font-family:Inter, sans-serif">
<div style="background:#FFFFFF;border:1px solid #e5e5e0;color:#16181d">Hi</div>
<svg><rect fill="#0f766e"/><a href="#add"/></svg><div style="background:url(#abc)"></div>
<script>const x = '#16181d'</script></div></x-dc>`;

describe('normColour', () => {
  it('writes one colour one way', () => {
    expect(normColour('#FFF')).toBe('#ffffff');
    expect(normColour('#ffffffff')).toBe('#ffffff');
    expect(normColour('rgb(255, 0, 0)')).toBe('#ff0000');
    expect(normColour('rgba(0, 0, 0, .5)')).toBe('rgba(0,0,0,.5)');
    expect(normColour('red')).toBeNull();
  });
});

describe('contrast', () => {
  it('measures the ratio and checks the pairs of a theme', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21);
    const checks = themeContrast(TINGLY.tokens, 'light');
    expect(checks.find((c) => c.text === 'ink' && c.on === 'paper')?.ok).toBe(true);
    expect(checks.every((c) => c.ratio > 1)).toBe(true);
  });
});

describe('roles and groups', () => {
  it('reads which token plays which role', () => {
    expect(colourRoles(TINGLY.tokens).page?.name).toBe('paper');
    expect(colourRoles(TINGLY.tokens).card?.name).toBe('surface');
    expect(colourRoles(WARM.tokens).page?.name).toBe('surface');
    expect(colourRoles(WARM.tokens).card?.name).toBe('surface-raised');
    expect(colourGroup('ink-muted')).toBe('text');
    expect(colourGroup('accent-2')).toBe('accents');
    expect(colourGroup('bad')).toBe('status');
  });
});

describe('scanSources', () => {
  it('counts colours in styles and paint attributes only', () => {
    const s = scanSources([BOARD]);
    expect(s.colours.get('#ffffff')?.count).toBe(1);
    expect(s.colours.get('#16181d')?.count).toBe(2); // the script's is left alone
    expect(s.colours.get('#0f766e')?.props.fill).toBe(1);
    expect(s.colours.has('#add')).toBe(false);
    expect(s.pages.get('#f7f7f4')).toBe(1);
    expect(s.fonts.get('inter, sans-serif')?.count).toBe(1);
  });
  it('finds the theme the files wear', () => {
    expect(detectTheme(scanSources([BOARD]), [TINGLY, WARM])).toMatchObject({ system: 'tingly', theme: 'light' });
    expect(detectTheme(scanSources(['<div style="color:#123456">']), [TINGLY, WARM])).toBeNull();
  });
});

describe('switching a themed project', () => {
  it('maps light to dark by role and leaves other colours and scripts alone', () => {
    const plan = planTheme([BOARD], [TINGLY, WARM], { system: 'tingly', theme: 'dark' }, null)!;
    expect(plan.from).toMatchObject({ system: 'tingly', theme: 'light' });
    const out = applyThemePlan(BOARD, plan.files[0]);
    expect(out).toContain('background:#111317;color:#eceef2');
    expect(out).toContain('background:#1a1d23;border:1px solid #2b2f37');
    expect(out).toContain('fill="#2dd4bf"');
    expect(out).toContain("const x = '#16181d'");
    expect(out).toContain('href="#add"');
    expect(plan.record).toMatchObject({ system: 'tingly', theme: 'dark' });
  });

  it('maps across systems by role, not by name (page is paper here and surface there)', () => {
    const plan = planTheme([BOARD], [TINGLY, WARM], { system: 'look-warm', theme: 'light' }, null)!;
    const out = applyThemePlan(BOARD, plan.files[0]);
    expect(out).toContain('background:#fff8ee;color:#2b1d0e');
    // tingly's cards (surface) become the look's cards (surface-raised), which is white as well
    expect(out).toContain('border:1px solid #e5e5e0');
    expect(out).toContain('fill="#c2410c"');
  });

  it('is a no-op into the theme it already wears', () => {
    const plan = planTheme([BOARD], [TINGLY], { system: 'tingly', theme: 'light' }, null)!;
    expect(plan.changes).toBe(0);
    expect(applyThemePlan(BOARD, plan.files[0])).toBe(BOARD);
  });

  it('switches type families when asked', () => {
    const plan = planTheme([BOARD], [TINGLY, WARM], { system: 'look-warm', theme: 'light' }, null, { fonts: true })!;
    expect(applyThemePlan(BOARD, plan.files[0])).toContain('font-family:Georgia, serif');
    expect(applyThemePlan(BOARD, planTheme([BOARD], [TINGLY, WARM], { system: 'look-warm', theme: 'light' }, null)!.files[0])).toContain('font-family:Inter, sans-serif');
  });
});

describe('a work that is half one theme and half another', () => {
  const DARK = BOARD.replace('#f7f7f4', '#111317').replace('#16181d', '#eceef2').replace('#FFFFFF', '#1a1d23').replace('#e5e5e0', '#2b2f37').replace('#0f766e', '#2dd4bf');
  it('reads each file on its own, so the one already in the theme stays and the other follows', () => {
    const plan = planTheme([BOARD, DARK], [TINGLY], { system: 'tingly', theme: 'dark' }, null)!;
    expect(plan.files[0].colours.length).toBeGreaterThan(0);
    expect(plan.files[1].colours).toEqual([]);
    expect(applyThemePlan(DARK, plan.files[1])).toBe(DARK);
    expect(applyThemePlan(BOARD, plan.files[0])).toContain('#111317');
    const toLight = planTheme([BOARD, DARK], [TINGLY], { system: 'tingly', theme: 'light' }, null)!;
    expect(toLight.files[0].colours).toEqual([]);
    expect(applyThemePlan(DARK, toLight.files[1])).toContain('#f7f7f4');
  });
});

describe('the original look', () => {
  const ORIGINAL = `<div style="background:#eeeeee;color:#222222;font-family:Verdana, sans-serif"><b style="color:#222222">a</b><i style="color:#e11d48">b</i><u style="background:#cccccc">c</u></div>`;

  it('takes the page, text and accent as the roles, and remembers what they were', () => {
    const plan = planTheme([ORIGINAL], [TINGLY], { system: 'tingly', theme: 'dark' }, null, { fonts: true })!;
    expect(plan.from).toBeNull();
    expect(plan.files[0].colours.map((c) => [c.role, c.token, c.to])).toEqual([
      ['page', 'paper', '#111317'],
      ['ink', 'ink', '#eceef2'],
      ['accent', 'accent', '#2dd4bf'],
    ]);
    expect(plan.stay).toBe(1); // the second background is not one of the three
    expect(plan.record?.base?.colors).toEqual({ page: '#eeeeee', ink: '#222222', accent: '#e11d48' });
    expect(plan.record?.base?.fonts).toEqual({ sans: 'Verdana, sans-serif' });
  });

  it('comes back, even after a switch to another theme', () => {
    const systems = [TINGLY];
    const first = planTheme([ORIGINAL], systems, { system: 'tingly', theme: 'light' }, null, { fonts: true })!;
    const themed = applyThemePlan(ORIGINAL, first.files[0]);
    expect(themed).toContain('background:#f7f7f4');
    const dark = planTheme([themed], systems, { system: 'tingly', theme: 'dark' }, first.record, { fonts: true })!;
    expect(dark.record?.base).toEqual(first.record?.base);
    const darkText = applyThemePlan(themed, dark.files[0]);
    const back = planOriginal([darkText], systems, dark.record, { fonts: true })!;
    expect(back.to).toBe('original');
    expect(back.record).toBeNull();
    expect(applyThemePlan(darkText, back.files[0])).toBe(ORIGINAL);
  });

  it('has nothing to go back to for a project that wore the system already', () => {
    const plan = planTheme([BOARD], [TINGLY], { system: 'tingly', theme: 'dark' }, null)!;
    expect(plan.record?.base).toBeUndefined();
    expect(planOriginal([BOARD], [TINGLY], plan.record)).toBeNull();
  });
});

describe('themeRecordOf', () => {
  it('reads the record out of an index and ignores junk', () => {
    expect(themeRecordOf({ theme: { system: 'a', theme: 'dark', base: { colors: { page: '#fff', x: 3 }, fonts: {} } } })).toEqual({
      system: 'a',
      theme: 'dark',
      base: { colors: { page: '#fff' }, fonts: {} },
    });
    expect(themeRecordOf({ theme: 'dark' })).toBeNull();
    expect(themeRecordOf(undefined)).toBeNull();
  });
});

describe('what the review of the first version found', () => {
  const BARE = '<div style="background:#ffffff;color:#222222"><b style="background:#0000ff;color:#ffffff">go</b></div>';

  it('rewrites a page colour only as a background, so white button text keeps reading', () => {
    const plan = planTheme([BARE], [TINGLY], { system: 'tingly', theme: 'dark' }, null)!;
    const out = applyThemePlan(BARE, plan.files[0]);
    expect(out).toContain('background:#111317');
    expect(out).toContain('color:#ffffff'); // the button's text is not the page
  });

  it('does not lose the original when a file added later is themed in a second pass', () => {
    const first = planTheme([ORIGINAL_A], [TINGLY], { system: 'tingly', theme: 'light' }, null)!;
    const themed = applyThemePlan(ORIGINAL_A, first.files[0]);
    const second = planTheme([themed, ORIGINAL_B], [TINGLY], { system: 'tingly', theme: 'light' }, first.record)!;
    expect(second.record?.base?.colors.page).toBe(first.record?.base?.colors.page);
  });

  it('does not take a page for a themed one because a few of its colours match', () => {
    const page = '<div style="background:#123456;color:#654321;border-color:#aa5500"><i style="color:#ffffff">a</i><i style="color:#ffffff">b</i></div>';
    expect(detectTheme(scanSources([page]), [TINGLY])).toBeNull();
  });

  it('leaves urls alone, in an import and in a background', () => {
    const css = '<style>@import url("https://fonts.example/css#abc");a{background:url(data:image/png;base64,#abc) #f7f7f4}</style>';
    const plan = planTheme([css], [TINGLY], { system: 'tingly', theme: 'dark' }, null)!;
    const out = applyThemePlan(css, plan.files[0]);
    expect(out).toContain('url("https://fonts.example/css#abc")');
    expect(out).toContain('base64,#abc');
  });

  it('counts only colours no system owns as the ones that stay', () => {
    const plan = planTheme([BOARD], [TINGLY], { system: 'tingly', theme: 'dark' }, null)!;
    expect(plan.stay).toBe(0);
    expect(plan.changes).toBeGreaterThan(0);
  });
});

const ORIGINAL_A = '<div style="background:#eeeeee;color:#222222"><i style="color:#e11d48">a</i></div>';
const ORIGINAL_B = '<div style="background:#000000;color:#dddddd"><i style="color:#00ff00">b</i></div>';
