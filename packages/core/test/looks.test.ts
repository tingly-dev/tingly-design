import { describe, expect, it } from 'vitest';
import { resources } from '../../i18n/src';
import { LOOKS, LOOK_GROUPS, compileTokensCss, lookOf, lookTokens, resolveTokens } from '../src';

type Bundle = { ds: { look: Record<string, string>; lookGroup: Record<string, string> } };
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

  it('finds a look by id', () => {
    expect(lookOf('nord')?.group).toBe('palette');
    expect(lookOf('nope')).toBeUndefined();
  });
});
