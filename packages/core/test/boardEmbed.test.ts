import { describe, expect, it } from 'vitest';
import {
  boardDeps,
  boardFilesFor,
  boardFrameDoc,
  boardImportsOf,
  boardSize,
  boardTime,
  boardTweaks,
  canvasTemplateValues,
  valuesByName,
  boardsOf,
  checkSlide,
  coverFit,
  embedProps,
  importedBoardDir,
  isBoardEmbedPath,
  parseDc,
  timeSpec,
  tweakTextBinding,
} from '../src';

const BOARD = (props: string, body = '<div>x</div>') =>
  `<x-dc>${body}</x-dc><script type="text/x-dc" data-dc-script data-props='${props}'>class Component extends DCLogic {}</script>`;

describe('artboards imported into slides and scenes', () => {
  it('points only at artboards kept under uploads/', () => {
    expect(isBoardEmbedPath('uploads/box-Glow/Glow.dc.html')).toBe(true);
    expect(isBoardEmbedPath('Glow.dc.html')).toBe(false);
    expect(isBoardEmbedPath('uploads/a/page.html')).toBe(false);
  });

  it('reads $time as a loop and a still', () => {
    expect(timeSpec(parseDc(BOARD('{"$time":{"loop":"8s","still":"2s"}}')).props)).toEqual({ loop: 8000, still: 2000 });
    expect(timeSpec(parseDc(BOARD('{"$time":true}')).props)).toEqual({ loop: undefined, still: 0 });
    expect(timeSpec(parseDc(BOARD('{"accent":{"editor":"color","default":"#000"}}')).props)).toBeNull();
    const spec = { loop: 8000, still: 2000 };
    expect(boardTime(spec, null)).toBe(2000);
    expect(boardTime(spec, 9500)).toBe(1500);
    expect(boardTime({ still: 0 }, 9500)).toBe(9500);
  });

  it('knows its size, its tweaks and what an embed sets', () => {
    const props = parseDc(BOARD('{"accent":{"editor":"color","default":"#000"},"n":{"default":3},"$preview":{"width":1920,"height":1080}}')).props;
    expect(boardSize(props)).toEqual([1920, 1080]);
    // a prop with no editor is listed too, edited as its default suggests
    expect(boardTweaks(props).map(([k, s]) => [k, s.editor])).toEqual([['accent', 'color'], ['n', 'float']]);
    expect(embedProps('{"accent":"#fff"}')).toEqual({ accent: '#fff' });
    expect(embedProps('nope')).toEqual({});
    expect(embedProps('[1]')).toEqual({});
  });

  it('sums up every artboard’s values in canvas order', () => {
    const canvas = { boards: { 'A.dc.html': { x: 0, y: 0, w: 1, h: 1, title: 'Cover' }, 'B.dc.html': { x: 0, y: 0, w: 1, h: 1 }, 'C.dc.html': { x: 0, y: 0, w: 1, h: 1 }, 'D.dc.html': { x: 0, y: 0, w: 1, h: 1 } }, order: ['C.dc.html', 'A.dc.html', 'B.dc.html', 'D.dc.html'] };
    const files: Record<string, string> = {
      'A.dc.html': BOARD('{"heading":{"default":"Hi"},"dark":{"default":false},"$time":{"loop":"6s"}}'),
      'B.dc.html': BOARD('{"$preview":{"width":10,"height":10}}'),
      'C.dc.html': BOARD('{"accent":{"editor":"color","default":"#000"}}'),
    };
    const got = canvasTemplateValues(canvas, (f) => files[f]);
    // B declares only reserved keys and D is not loaded: both are left out
    expect(got.map((g) => [g.file, g.title, g.values.map(([k, s]) => [k, s.editor])])).toEqual([
      ['C.dc.html', 'C', [['accent', 'color']]],
      ['A.dc.html', 'Cover', [['heading', 'text'], ['dark', 'boolean']]],
    ]);
    expect(canvasTemplateValues(canvas, () => undefined)).toEqual([]);
  });

  it('regroups values by name across artboards that edit them the same way', () => {
    const files: Record<string, string> = {
      'A.dc.html': BOARD('{"accent":{"editor":"color","default":"#111"},"size":{"editor":"enum","options":["s","m"],"default":"s"}}'),
      'B.dc.html': BOARD('{"accent":{"editor":"color","default":"#222"},"size":{"editor":"enum","options":["a","b"],"default":"a"}}'),
      'C.dc.html': BOARD('{"accent":{"default":"red"}}'),
    };
    const canvas = { order: Object.keys(files), boards: Object.fromEntries(Object.keys(files).map((f) => [f, { x: 0, y: 0, w: 1, h: 1 }])) };
    const got = valuesByName(canvasTemplateValues(canvas, (f) => files[f]));
    // colours join; the text accent and the two different pick lists stay apart
    expect(got.map((n) => [n.name, n.entries.map((e) => e.file)])).toEqual([
      ['accent', ['A.dc.html', 'B.dc.html']],
      ['size', ['A.dc.html']],
      ['size', ['B.dc.html']],
      ['accent', ['C.dc.html']],
    ]);
  });

  it('collects the siblings an artboard mounts and the files it shows', () => {
    const src = '<dc-import name="Card"></dc-import><dc-import name="/Shared/Logo"></dc-import><img src="uploads/a.png"><div style="background:url(assets/b.svg)"></div>';
    expect(boardDeps(src, 'Main.dc.html')).toEqual({ boards: ['Card.dc.html', 'Shared/Logo.dc.html'], files: ['uploads/a.png', 'assets/b.svg'] });
    const files: Record<string, string> = {
      'uploads/c-Main/Main.dc.html': '<dc-import name="Card"></dc-import>',
      'uploads/c-Main/Card.dc.html': '<p>card</p>',
    };
    expect(boardFilesFor(['<section><x-embed src="uploads/c-Main/Main.dc.html" style="x"></x-embed></section>'], (p) => files[p])).toEqual(files);
  });

  it('lists a canvas’s artboards in its order and names where a copy goes', () => {
    const canvas = JSON.stringify({ v: 3, boards: { 'A.dc.html': { x: 0, y: 0, w: 100, h: 50, title: 'Aa' }, 'B.dc.html': { x: 0, y: 0, w: 10, h: 10 } }, order: ['B.dc.html', 'A.dc.html'] });
    expect(boardsOf({ 'canvas.json': canvas, 'A.dc.html': '', 'B.dc.html': '' })).toEqual([
      { file: 'B.dc.html', title: 'B', size: [10, 10] },
      { file: 'A.dc.html', title: 'Aa', size: [100, 50] },
    ]);
    expect(importedBoardDir('box', 'Glow backdrop.dc.html')).toBe('uploads/box-Glow-backdrop');
    expect(boardImportsOf({ imports: [{ path: 'uploads/box-Glow/Glow.dc.html', from: 'projects/box', board: 'Glow.dc.html', copiedAt: '' }, { path: 'x' }] })).toHaveLength(1);
  });

  it('frames the runtime and covers the box', () => {
    expect(boardFrameDoc({ src: '/sandbox/runtime.js' })).toContain('<script src="/sandbox/runtime.js"></script>');
    expect(boardFrameDoc({ inline: 'a("</script>")' })).toContain('a("<\\/script>")');
    expect(coverFit([1920, 1080], [960, 960])).toEqual({ scale: 960 / 1080, x: (960 - 1920 * (960 / 1080)) / 2, y: 0 });
  });

  it('retypes text that shows a text tweak by changing the tweak', () => {
    const doc = parseDc(
      BOARD(
        '{"heading":{"default":"Hi"},"name":{"editor":"text","default":"Ann"},"accent":{"editor":"color","default":"#000"},"n":{"default":3}}',
        '<h2>{{heading}}</h2><p>Hello {{name}}</p><p>{{name}}</p><i>{{accent}}</i><b>{{n}}</b><u>{{other}}</u>',
      ),
    );
    const bound = doc.elements.map((e) => [e.tag, tweakTextBinding(doc, e)]).filter(([, p]) => p);
    expect(bound).toEqual([['h2', 'heading'], ['p', 'name']]);
  });

  it('lets a slide embed an imported artboard and nothing else by src', () => {
    const slide = (embed: string) => checkSlide(parseDc(`<section id="a" style="background:#000">${embed}</section>`), 'a').map((i) => i.message);
    expect(slide(`<x-embed src="uploads/box-Glow/Glow.dc.html" data-props='{"accent":"#fff"}' style="position:absolute;left:0px;top:0px;width:1920px;height:1080px"></x-embed>`)).toEqual([]);
    expect(slide('<x-embed src="https://x.dev/a.html" style="position:absolute;left:0px;top:0px;width:10px;height:10px"></x-embed>').join()).toContain('must name an artboard');
    expect(slide(`<x-embed src="uploads/b/B.dc.html" data-props="oops" style="position:absolute;left:0px;top:0px;width:10px;height:10px"></x-embed>`).join()).toContain('JSON object');
  });
});
