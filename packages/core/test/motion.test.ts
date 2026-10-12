import { describe, expect, it } from 'vitest';
import {
  attrsForFormat,
  countText,
  mergeStyle,
  motionTimeline,
  parseAnim,
  parseKeys,
  parseMotion,
  parseTime,
  planScene,
  sceneBaseCss,
  sceneIdOf,
  SLIDE_BASE_CSS,
} from '../src';

describe('motion: time and timing words', () => {
  it('reads times in ms and seconds', () => {
    expect(parseTime('500ms')).toBe(500);
    expect(parseTime('0.4s')).toBe(400);
    expect(parseTime('2')).toBe(2000);
    expect(parseTime('.25s')).toBe(250);
    expect(parseTime('soon')).toBeNull();
  });

  it('parses a preset with duration, start and easing in any order', () => {
    expect(parseAnim('rise 600ms @0.4s ease-in-out', 'in')).toEqual({ preset: 'rise', duration: 600, start: 400, easing: 'ease-in-out' });
    expect(parseAnim('fade @1s 300ms', 'out')).toEqual({ preset: 'fade', duration: 300, start: 1000, easing: 'ease-in' });
    expect(parseAnim('pop', 'in')).toMatchObject({ duration: 500, start: null, easing: 'cubic-bezier(.3,1.6,.5,1)' });
    expect(parseAnim('wobble', 'in')).toEqual({ error: 'unknown preset "wobble"' });
    expect(parseAnim('fade later', 'in')).toEqual({ error: 'unknown word "later"' });
    expect(parseAnim('', 'in')).toBeNull();
  });

  it('parses keyframe tracks', () => {
    expect(parseKeys('x: 0@0 120@2s ease-in-out; scale: 1@2s 1.2@3s')).toEqual([
      { prop: 'x', keys: [{ t: 0, v: 0 }, { t: 2000, v: 120, easing: 'ease-in-out' }] },
      { prop: 'scale', keys: [{ t: 2000, v: 1 }, { t: 3000, v: 1.2 }] },
    ]);
    expect(parseKeys('rotate: 0deg@0 90deg@1s')).toEqual([{ prop: 'rotate', keys: [{ t: 0, v: 0 }, { t: 1000, v: 90 }] }]);
    expect(parseKeys('skew: 0@0 1@1s')).toEqual({ error: 'unknown property "skew"' });
    expect(parseKeys('x: 0@1s')).toEqual({ error: 'track "x" needs at least two keys' });
    expect(parseKeys('x: 0@2s 10@1s')).toEqual({ error: 'track "x" goes back in time' });
  });
});

describe('motion: planning a scene', () => {
  const section = { tag: 'section', attrs: { 'data-duration': '4s' } };

  it('staggers automatic entrances and places explicit ones', () => {
    const { plans } = planScene(
      [section, { tag: 'h1', text: 'Hello', attrs: { 'data-in': 'rise' } }, { tag: 'p', text: 'World', attrs: { 'data-in': 'fade' } }, { tag: 'p', text: 'Later', attrs: { 'data-in': 'fade @2s' } }],
      4000,
    );
    expect(plans.map((p) => [p.index, p.kind, p.delay])).toEqual([
      [1, 'in', 200],
      [2, 'in', 350],
      [3, 'in', 2000],
    ]);
    expect(plans[0].keyframes).toEqual([
      { opacity: '0', translate: '0px 48px' },
      { opacity: '1', translate: '0px 0px' },
    ]);
  });

  it('defaults an exit to the end of the scene and flags one that leaves before it enters', () => {
    const ok = planScene([section, { tag: 'p', text: 'Bye now', attrs: { 'data-in': 'fade @0s', 'data-out': 'fade 400ms' } }], 4000);
    expect(ok.plans[1]).toMatchObject({ kind: 'out', delay: 3600, duration: 400 });
    expect(ok.issues).toEqual([]);
    const bad = planScene([section, { tag: 'p', text: 'Bye now', attrs: { 'data-in': 'fade @2s', 'data-out': 'fade @1s' } }], 4000);
    expect(bad.issues[0]).toMatchObject({ level: 'error', message: 'leaves at 1s, before it enters at 2s' });
  });

  it('warns about text nobody can read and embeds that cannot be exported', () => {
    const { issues } = planScene(
      [section, { tag: 'p', text: 'Blink', attrs: { 'data-in': 'fade @1s', 'data-out': 'fade 200ms @1.3s' } }, { tag: 'x-embed', attrs: { style: '' } }],
      4000,
    );
    expect(issues.map((i) => i.message)).toEqual(['text is on screen for 500ms, under 800ms', 'embed has no data-seek: it plays in preview but cannot be exported']);
  });

  it('types one character per step', () => {
    const { plans } = planScene([section, { tag: 'p', text: 'localhost', attrs: { 'data-in': 'type 900ms @1s' } }], 4000);
    expect(plans[0]).toMatchObject({ easing: 'steps(9, end)', duration: 900 });
    expect(plans[0].keyframes[0]).toEqual({ clipPath: 'inset(0px 100% 0px 0px)' });
  });

  it('turns keys into offsets, easing the segment that arrives at a key', () => {
    const { plans } = planScene([{ ...section, attrs: { 'data-keys': 'scale: 1@0 1.1@4s ease-in-out' } }], 4000);
    expect(plans[0]).toMatchObject({ kind: 'keys', delay: 0, duration: 4000, composite: 'add' });
    expect(plans[0].keyframes).toEqual([
      { scale: '1', offset: 0, easing: 'ease-in-out' },
      { scale: '1.1', offset: 1 },
    ]);
  });

  it('folds x and y into one translate track', () => {
    const { plans } = planScene([section, { tag: 'div', attrs: { 'data-keys': 'x: 0@0 100@2s; y: 0@1s 50@2s' } }], 4000);
    expect(plans).toHaveLength(1);
    expect(plans[0].keyframes).toEqual([
      { translate: '0px 0px', offset: 0 },
      { translate: '50px 0px', offset: 0.5 },
      { translate: '100px 50px', offset: 1 },
    ]);
  });
});

describe('motion: formats', () => {
  const formats = ['wide', 'tall'];

  it('merges a format override over style and drops other formats’ attributes', () => {
    const attrs = { style: 'display:flex;flex-direction:row;gap:24px', 'data-tall': 'flex-direction:column', 'data-in': 'fade', 'data-in-tall': 'rise' };
    expect(attrsForFormat(attrs, 'wide', formats)).toEqual({ style: 'display:flex;flex-direction:row;gap:24px', 'data-in': 'fade' });
    expect(attrsForFormat(attrs, 'tall', formats)).toEqual({ style: 'display:flex;gap:24px;flex-direction:column', 'data-in': 'rise' });
  });

  it('leaves an element out of formats data-only does not name', () => {
    expect(attrsForFormat({ 'data-only': 'wide' }, 'tall', formats)).toBeNull();
    expect(attrsForFormat({ 'data-only': 'wide' }, 'wide', formats)).toEqual({ 'data-only': 'wide' });
  });

  it('merges styles declaration by declaration', () => {
    expect(mergeStyle('color:red;font-size:32px', 'font-size:48px;left:10%')).toBe('color:red;font-size:48px;left:10%');
  });

  it('sizes the base stylesheet to the format', () => {
    expect(sceneBaseCss(1080, 1920, SLIDE_BASE_CSS)).toContain('width:1080px;height:1920px');
    expect(sceneBaseCss(1080, 1920, SLIDE_BASE_CSS)).not.toContain('1920px;height:1080px');
  });
});

describe('motion: project and timeline', () => {
  it('reads motion.json with defaults', () => {
    const m = parseMotion('{"title":"T","formats":{"wide":{"size":[1920,1080]},"Bad":{"size":[1,1]},"tall":{"size":[1080,1920]}},"order":["a"]}');
    expect(Object.keys(m.formats)).toEqual(['wide', 'tall']);
    expect(m.fps).toBe(30);
    expect(parseMotion(undefined).formats).toEqual({ wide: { size: [1920, 1080] } });
    expect(sceneIdOf('scenes/hook.html')).toBe('hook');
  });

  it('overlaps scenes by their transitions', () => {
    const t = motionTimeline([
      { id: 'a', duration: '4s', transition: 'fade 500ms' },
      { id: 'b', duration: '3s', transition: 'push' },
      { id: 'c', duration: '2s', transition: 'fade' },
    ]);
    expect(t.scenes.map((s) => [s.id, s.start, s.transition.kind, s.transition.duration])).toEqual([
      ['a', 0, 'fade', 500],
      ['b', 3500, 'push', 500],
      ['c', 6000, 'cut', 0],
    ]);
    expect(t.duration).toBe(8000);
  });

  it('counts up keeping grouping, decimals and units', () => {
    expect(countText('1,284 requests', 0.5)).toBe('642 requests');
    expect(countText('1,284 requests', 1)).toBe('1,284 requests');
    expect(countText('$3.5M', 0.5)).toBe('$1.8M');
    expect(countText('99.9%', 0)).toBe('0.0%');
    expect(countText('none', 0.5)).toBe('none');
  });
});
