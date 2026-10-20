import { describe, expect, it } from 'vitest';
import { resources } from '../../i18n/src';
import { LOOKS, LOOK_GROUPS, LOOK_KIT_WORDS, compileTokensCss, componentNames, dsGlance, lookKit, lookOf, lookTokens, parseBundleHeader, parseCardMarker, resolveTokens } from '../src';

type Bundle = { ds: { look: Record<string, string>; lookGroup: Record<string, string> }; starter: { lookKit: Record<string, string> } };
const en = resources.en.translation as unknown as Bundle;
const zh = resources.zh.translation as unknown as Bundle;

describe('LOOKS', () => {
  it('has unique ids, each in a listed group, and every group has one', () => {
    expect(new Set(LOOKS.map((l) => l.id)).size).toBe(LOOKS.length);
    for (const l of LOOKS) expect(LOOK_GROUPS).toContain(l.group);
    for (const g of LOOK_GROUPS) expect(LOOKS.some((l) => l.group === g), g).toBe(true);
  });

  it('names every look and group in English and Chinese, and nothing else', () => {
    for (const lang of [en, zh]) {
      expect(Object.keys(lang.ds.look).sort()).toEqual(LOOKS.map((l) => l.id).sort());
      expect(Object.keys(lang.ds.lookGroup).sort()).toEqual([...LOOK_GROUPS].sort());
    }
  });

  it('turns every look into tokens the page reads without dropping anything', () => {
    for (const l of LOOKS) {
      const t = resolveTokens(lookTokens(l, 'X'));
      expect(t.issues, l.id).toEqual([]);
      const names = t.colors.map((c) => c.name);
      for (const need of ['surface', 'ink', 'accent', 'on-accent']) expect(names, `${l.id} ${need}`).toContain(need);
      expect(compileTokensCss(t)).toContain('--accent');
    }
  });

  it('writes no empty shadow, loads only fonts html-ppt loads, and keeps text on the accent readable', () => {
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const l of LOOKS) {
      const t = JSON.parse(lookTokens(l, 'X'));
      for (const s of t.shadow.tokens) expect(s.value, l.id).not.toBe('none');
      for (const h of t.type.hosted) expect(h.href, l.id).toMatch(/^https:\/\/fonts\.googleapis\.com\/css2\?family=/);
      const [a, b] = [lum(l.colors.accent), lum(l.colors['on-accent'])].sort((x, y) => y - x);
      expect((a + 0.05) / (b + 0.05), `${l.id} on-accent`).toBeGreaterThan(3);
    }
  });

  it('finds a look by id', () => {
    expect(lookOf('nord')?.group).toBe('palette');
    expect(lookOf('nope')).toBeUndefined();
  });

  it('gives the specimen the page, card, hairline and shadow a look really has', () => {
    const g = dsGlance(resolveTokens(lookTokens(lookOf('bauhaus')!, 'B')));
    expect(g.paper).toBe('#f4efe3');
    expect(g.surface).toBe('#ffffff');
    expect(g.line).toBe('#111111');
    expect(g.shadowValue).toBe('4px 4px 0 #111');
    expect(g.radius).toBe('0px');
  });

  it('words every component text in English and Chinese, and nothing else', () => {
    for (const lang of [en, zh]) expect(Object.keys(lang.starter.lookKit).sort()).toEqual([...LOOK_KIT_WORDS].sort());
  });

  it('turns a look into components the design system page reads', () => {
    const words = Object.fromEntries(LOOK_KIT_WORDS.map((k) => [k, `${k} "</script> <b>`])) as Record<(typeof LOOK_KIT_WORDS)[number], string>;
    for (const l of LOOKS) {
      const files = lookKit(l, 'Kit', 'Kit <x>', words);
      const head = parseBundleHeader(files['components/bundle.js']);
      expect(head.namespace, l.id).toBe('Kit');
      expect(head.components).toEqual(['Title', 'Kicker', 'Card', 'Pill', 'Divider']);
      expect(componentNames(Object.keys(files), files['components/bundle.js'])).toEqual(head.components);
      expect(files['components/bundle.js']).toContain('window.Kit = {');
      expect(files['components/bundle.css'], l.id).not.toMatch(/\.(slide|deck|notes|progress)\b|<\/style/);
      for (const [path, text] of Object.entries(files)) {
        if (!path.endsWith('preview.html')) continue;
        // a word can neither close the script it sits in nor open markup of its own
        expect(text.match(/<\/script/g)?.length ?? 0, path).toBe(text.includes('<script>') ? 1 : 0);
        expect(text, path).not.toContain('<b>');
        if (path !== 'components/Cover/preview.html') expect(parseCardMarker(text).group, path).toBeTruthy();
      }
    }
  });

  it("carries the theme's own rules over, renamed to the kit's classes", () => {
    const css = lookKit(lookOf('bauhaus')!, 'Kit', 'Kit', Object.fromEntries(LOOK_KIT_WORDS.map((k) => [k, k])) as never)['components/bundle.css'];
    // its literal #111 is the look's line colour, so it follows that token
    expect(css).toMatch(/\.lk-card\{[^}]*border:2px solid var\(--line-strong\)/);
    expect(css).toContain('--grad:');
    // a theme's slide rules are its page: swiss-grid's grid lines, news-broadcast's side bar
    const kit = (id: string) => lookKit(lookOf(id)!, 'Kit', 'Kit', Object.fromEntries(LOOK_KIT_WORDS.map((k) => [k, k])) as never)['components/bundle.css'];
    expect(kit('swiss-grid')).toMatch(/\.lk-page\{background-image:linear-gradient/);
    expect(kit('news-broadcast')).toContain('.lk-page::before{');
    expect(lookOf('aurora')!.vars.grad).toContain('var(--accent-3)');
  });
});
