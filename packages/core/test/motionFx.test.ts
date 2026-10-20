import { describe, expect, it } from 'vitest';
import { attrsForFormat, checkSlide, FX_PRESETS, fxIssues, fxMarkup, fxShader, parseDc, parseFx, splitFx } from '../src';

describe('built-in effects (data-fx)', () => {
  it('reads a preset and its values, with defaults for the rest', () => {
    expect(splitFx('edge-glow; box: 760x460 @50% 42%; radius: 36')).toEqual({ preset: 'edge-glow', values: { box: '760x460 @50% 42%', radius: '36' } });
    const s = parseFx('edge-glow; box: 760x460 @50% 42%; colors: #fff #3d7bff')!;
    expect(s.box).toEqual({ w: 760, h: 460, cx: 50, cy: 42 });
    expect(s.colors).toEqual(['#fff', '#3d7bff']);
    expect(s.speed).toBe(1);
    expect(s.quality).toBe(1);
    expect(parseFx('sweep; every: 2500ms')!.every).toBe(2.5);
    expect(parseFx('aurora')!.background).toBe('#07080f');
    expect(parseFx('lava')).toBeNull();
  });

  it('reads the shared values: scale, direction, a point and a region', () => {
    const s = parseFx('particles; scale: 2; direction: 0; region: 0% 50% 100% 50%')!;
    expect(s.scale).toBe(2);
    expect(s.direction).toBe(0);
    expect(s.region).toEqual([0, 50, 100, 50]);
    expect(parseFx('particles')!.direction).toBe(270);
    expect(parseFx('rays; at: 50% 0%')!.center).toEqual([50, 0]);
    expect(parseFx('rays')!.region).toEqual([0, 0, 100, 100]);
    expect(fxIssues('grain; region: 0% 0% 50% 50%')).toEqual([]);
    expect(fxIssues('rays; at: middle')[0]).toMatch(/a point/);
    expect(fxIssues('aurora; region: 0% 0% 0% 50%')[0]).toMatch(/left, top, width and height/);
    expect(fxIssues('grain; at: 50% 50%')[0]).toMatch(/does not use "at"/);
    expect(fxShader(parseFx('aurora; region: 0% 50% 100% 50%')!)).toContain('const vec4 REGION = vec4(0.0, 0.5, 1.0, 0.5);');
  });

  it('says what does not read', () => {
    expect(fxIssues('aurora; colors: #3d7bff #9861ff; speed: 0.5')).toEqual([]);
    expect(fxIssues('lava')[0]).toMatch(/not an effect/);
    expect(fxIssues('aurora; box: 10x10')[0]).toMatch(/does not use "box"/);
    expect(fxIssues('aurora; colour: red')[0]).toMatch(/not a value/);
    expect(fxIssues('aurora; colors: red')[0]).toMatch(/hex colours/);
    expect(fxIssues('edge-glow; box: big')[0]).toMatch(/size in px/);
    expect(fxIssues('sweep; every: soon')[0]).toMatch(/a time/);
  });

  it('writes one shader per preset, with the values as constants and no sin hash', () => {
    for (const p of FX_PRESETS) {
      const src = fxShader(parseFx(p)!);
      expect(src.startsWith('#version 300 es')).toBe(true);
      expect(src).toContain('void main()');
      expect(src).not.toMatch(/43758/);
    }
    expect(fxShader(parseFx('mesh; colors: #ff0000')!)).toContain('const vec3 COL[4] = vec3[4](vec3(1.0, 0.0, 0.0), vec3(1.0, 0.0, 0.0)');
  });

  it('hands the embed its page, and nothing can close the script', () => {
    const html = fxMarkup('aurora; background: #000000</script>')!;
    expect(html).toContain('<canvas');
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(fxMarkup('lava')).toBeNull();
    expect(fxMarkup('grain', { live: true })).toContain('"live":true');
  });

  it('takes a per-format value like the timing attributes', () => {
    const a = attrsForFormat({ 'data-fx': 'edge-glow; box: 760x460', 'data-fx-tall': 'edge-glow; box: 900x600' }, 'tall', ['wide', 'tall']);
    expect(a!['data-fx']).toBe('edge-glow; box: 900x600');
    expect(a!['data-fx-tall']).toBeUndefined();
  });

  it('is checked with the slide subset', () => {
    const issues = (src: string) => checkSlide(parseDc(src)).map((i) => i.message);
    const pin = 'position:absolute;left:0;top:0;width:100%;height:100%';
    expect(issues(`<section id="a"><x-embed data-fx="aurora" data-seek style="${pin}"></x-embed></section>`).filter((m) => /fx|embed/.test(m))).toEqual([]);
    expect(issues(`<section id="a"><x-embed data-fx="lava" data-seek style="${pin}"></x-embed></section>`).some((m) => /not an effect/.test(m))).toBe(true);
    expect(issues(`<section id="a"><x-embed data-fx="aurora" data-seek style="${pin}"><canvas></canvas></x-embed></section>`).some((m) => /no markup/.test(m))).toBe(true);
  });
});
