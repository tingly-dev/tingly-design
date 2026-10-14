import { describe, expect, it } from 'vitest';
import { Window as HappyWindow } from 'happy-dom';
import {
  attrsForFormat,
  applyHumanOps,
  countText,
  editsForFormat,
  mergeStyle,
  parseDc,
  setOverride,
  styleInFormat,
  motionTimeline,
  parseAnim,
  parseKeys,
  newCoverScene,
  parseCover,
  parseMotion,
  MOTION_SIZES,
  newMotion,
  sizeName,
  validSize,
  parseTime,
  planScene,
  sceneBaseCss,
  sceneIdOf,
  snapSceneMs,
  speedOf,
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
    expect(parseAnim('slam', 'in')).toMatchObject({ duration: 350, easing: 'cubic-bezier(.3,1.6,.5,1)' });
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

  it('reads the speed, clamped', () => {
    expect(parseMotion('{"speed":1.5}').speed).toBe(1.5);
    expect(parseMotion('{"speed":10}').speed).toBe(4);
    expect(parseMotion('{"speed":"fast"}').speed).toBeUndefined();
    expect(parseMotion('{}').speed).toBeUndefined();
    expect(speedOf(0.1)).toBe(0.25);
    expect(speedOf(undefined)).toBe(1);
  });

  it('reads the cover as a frame or a scene', () => {
    expect(parseCover('2.2s')).toEqual({ at: 2200 });
    expect(parseCover('poster')).toEqual({ scene: 'poster' });
    expect(parseCover('../etc')).toBeUndefined();
    expect(parseCover(3)).toBeUndefined();
    expect(parseMotion('{"cover":"poster","coverFirstFrame":false}')).toMatchObject({ cover: { scene: 'poster' }, coverFirstFrame: false });
    expect(parseMotion('{}').cover).toBeUndefined();
  });

  it('snaps a dragged or typed scene length to 0.1 s, within a sane range', () => {
    expect(snapSceneMs(4040)).toBe(4000);
    expect(snapSceneMs(4060)).toBe(4100);
    expect(snapSceneMs(12)).toBe(500);
    expect(snapSceneMs(10_000_000)).toBe(600_000);
    expect(snapSceneMs(NaN)).toBe(4000);
    expect(snapSceneMs(1234, 1)).toBe(1234);
  });

  it('writes a cover scene that is one still page, with no timing', () => {
    const src = newCoverScene('poster', 'A <b>&', 'Hint');
    expect(src).toContain('<section id="poster"');
    expect(src).not.toMatch(/data-(in|out|duration|keys)/);
    expect(src).toContain('A b');
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

describe('motion: edits in a format', () => {
  const src = '<section id="s" data-duration="3s" style="display:flex"><h2 style="font-size:96px;color:#fff" data-tall="font-size:120px">Hi</h2></section>';

  it('sets and drops declarations in an override', () => {
    expect(setOverride('font-size:120px', { width: '300px' })).toBe('font-size:120px;width:300px');
    expect(setOverride('font-size:120px', { 'font-size': '140px' })).toBe('font-size:140px');
    expect(setOverride('font-size:120px', { 'font-size': null })).toBeNull();
  });

  it('sends style changes to the format and keeps text shared', () => {
    const doc = parseDc(src);
    const ops = editsForFormat(
      [
        { kind: 'styles', tid: 1, set: { 'font-size': '140px', color: '#f00' } },
        { kind: 'text', tid: 1, text: 'Hello' },
      ],
      doc,
      'tall',
    );
    const out = applyHumanOps(src, ops, new HappyWindow().document as unknown as Document).source;
    expect(out).toContain('data-tall="font-size:140px;color:#f00"');
    expect(out).toContain('style="font-size:96px;color:#fff"');
    expect(out).toContain('>Hello</h2>');
  });

  it('removes the override once nothing differs', () => {
    const doc = parseDc(src);
    const out = applyHumanOps(src, editsForFormat([{ kind: 'style', tid: 1, prop: 'font-size', value: null }], doc, 'tall'), new HappyWindow().document as unknown as Document).source;
    expect(out).not.toContain('data-tall');
  });

  it('shows the merged style', () => {
    expect(styleInFormat({ style: 'font-size:96px;color:#fff', 'data-tall': 'font-size:120px' }, 'tall')).toBe('color:#fff;font-size:120px');
    expect(styleInFormat({ style: 'font-size:96px' }, null)).toBe('font-size:96px');
  });
});

describe('a new piece in a chosen size', () => {
  it('names the format by its shape and keeps the 16:9 default', () => {
    expect(newMotion('T').motion.formats).toEqual({ wide: { size: [1920, 1080] } });
    expect(newMotion('T', undefined, { size: [1080, 1920] }).motion.formats).toEqual({ tall: { size: [1080, 1920] } });
    for (const p of MOTION_SIZES) expect(Object.keys(newMotion('T', undefined, { size: [...p.size] }).motion.formats)).toEqual([p.name]);
  });

  it('gives a custom size a name the format rules accept, or the one asked for', () => {
    const m = parseMotion(JSON.stringify(newMotion('T', undefined, { size: [1280, 720] }).motion));
    expect(Object.keys(m.formats)).toEqual([sizeName([1280, 720])]);
    expect(Object.keys(newMotion('T', undefined, { size: [1280, 720], format: 'x720' }).motion.formats)).toEqual(['x720']);
  });

  it('refuses sizes outside 1 to 7680 and falls back to 16:9', () => {
    expect(validSize([0, 100])).toBeNull();
    expect(validSize([7681, 100])).toBeNull();
    expect(validSize(['1080', '1920'])).toEqual([1080, 1920]);
    expect(newMotion('T', undefined, { size: [0, 5] }).motion.formats.wide.size).toEqual([1920, 1080]);
  });

  it('draws the starter scene to the size: the type follows the short side', () => {
    const wide = newMotion('T').scenes.title;
    const small = newMotion('T', undefined, { size: [540, 960] }).scenes.title;
    expect(wide).toContain('font-size:112px');
    expect(small).toContain('font-size:56px');
    expect(small).toContain('padding:64px');
  });
});
