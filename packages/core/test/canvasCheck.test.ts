import { describe, expect, it } from 'vitest';
import { checkCanvas } from '../src';

const board = (root: string, extra = '') => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<style>body{margin:0}</style>
</helmet>
${root}
</x-dc>
${extra}
</body>
</html>
`;
const ROOT = `<div style="width:400px;height:300px"><p style="margin:0">Hi</p></div>`;
const canvas = (over: object = {}) =>
  JSON.stringify({ v: 3, title: 't', boards: { 'Main.dc.html': { x: 0, y: 0, w: 400, h: 300 } }, order: ['Main.dc.html'], ...over });
const run = (c: string | undefined, boards: Record<string, string>) => checkCanvas({ canvas: c, boards }).map((i) => `${i.file}:${i.line} ${i.rule}`);

describe('checkCanvas', () => {
  it('passes a well-formed canvas', () => {
    expect(run(canvas(), { 'Main.dc.html': board(ROOT) })).toEqual([]);
  });

  it('reports a canvas.json that is not JSON and stops', () => {
    expect(run('{ nope', { 'Main.dc.html': board('<div>') })).toEqual(['canvas.json:1 canvas-json']);
  });

  it('matches order and boards', () => {
    const c = canvas({ boards: { 'Main.dc.html': { x: 0, y: 0, w: 400, h: 300 }, 'B.dc.html': { x: 0, y: 0, w: 400, h: 300 } }, order: ['Main.dc.html', 'Main.dc.html', 'Gone.dc.html'] });
    const files = { 'Main.dc.html': board(ROOT), 'B.dc.html': board(ROOT), 'Stray.dc.html': board(ROOT) };
    expect(run(c, files).sort()).toEqual(
      ['canvas.json:1 order-duplicate', 'canvas.json:1 order-missing', 'canvas.json:1 order-unknown', 'Stray.dc.html:1 board-unlisted'].sort(),
    );
  });

  it('reports a board entry with no file, with the entry line', () => {
    const c = JSON.stringify({ boards: { 'Main.dc.html': { w: 1, h: 1 } }, order: ['Main.dc.html'] }, null, 2);
    expect(checkCanvas({ canvas: c, boards: {} })).toEqual([
      { file: 'canvas.json', line: 3, rule: 'board-file-missing', level: 'error', params: { file: 'Main.dc.html' } },
    ]);
  });

  it('compares the root size with canvas.json', () => {
    const issues = checkCanvas({ canvas: canvas(), boards: { 'Main.dc.html': board(`<div style="width:880px;height:560px;padding:8px"></div>`) } });
    expect(issues).toEqual([
      { file: 'Main.dc.html', line: 12, rule: 'root-size', level: 'error', params: { width: 880, height: 560, boardWidth: 400, boardHeight: 300 } },
    ]);
  });

  it('warns when $preview disagrees with the root, and keeps quiet when they match', () => {
    const props = (w: number, h: number) => `<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":${w},"height":${h}}}'></script>`;
    expect(run(canvas(), { 'Main.dc.html': board(ROOT, props(400, 300)) })).toEqual([]);
    const issues = checkCanvas({ canvas: canvas(), boards: { 'Main.dc.html': board(ROOT, props(400, 500)) } });
    expect(issues).toEqual([
      { file: 'Main.dc.html', line: 14, rule: 'preview-size', level: 'warning', params: { previewWidth: 400, previewHeight: 500, width: 400, height: 300 } },
    ]);
  });

  it('needs a root with a fixed size, unless the board fills', () => {
    expect(run(canvas(), { 'Main.dc.html': board(`<div style="padding:8px"></div>`) })).toEqual(['Main.dc.html:12 root-size-missing']);
    expect(run(canvas(), { 'Main.dc.html': board(`<!-- note -->`) })).toEqual(['Main.dc.html:1 root-missing']);
    const fill = canvas({ boards: { 'Main.dc.html': { x: 0, y: 0, w: 400, h: 300, expand: 'fill' } } });
    expect(run(fill, { 'Main.dc.html': board(`<div style="width:100px;height:100px"></div>`) })).toEqual([]);
  });

  it('rejects a board that is one svg, accepts small svg arrows', () => {
    const whole = `<div style="width:400px;height:300px"><svg width="400" height="300"><rect width="10" height="10"/></svg></div>`;
    expect(run(canvas(), { 'Main.dc.html': board(whole) })).toEqual(['Main.dc.html:12 whole-svg']);
    const big = `<div style="width:400px;height:300px"><p>a</p><svg style="width:390px;height:290px"></svg></div>`;
    expect(run(canvas(), { 'Main.dc.html': board(big) })).toEqual(['Main.dc.html:12 whole-svg']);
    const arrows = `<div style="position:relative;width:400px;height:300px"><div>box</div><svg width="40" height="8"><path d="M0 4h40"/></svg></div>`;
    expect(run(canvas(), { 'Main.dc.html': board(arrows) })).toEqual([]);
  });

  it('finds unquoted attributes, unclosed and stray tags with their lines', () => {
    const src = board(`<div style="width:400px;height:300px">
<button onClick={{go}}>Go</button>
<span>open
</div>
</section>`);
    expect(checkCanvas({ canvas: canvas(), boards: { 'Main.dc.html': src } })).toEqual([
      { file: 'Main.dc.html', line: 13, rule: 'unquoted-attr', level: 'error', params: { tag: 'button', attr: 'onClick' } },
      { file: 'Main.dc.html', line: 14, rule: 'unclosed-tag', level: 'error', params: { tag: 'span' } },
      { file: 'Main.dc.html', line: 16, rule: 'stray-close', level: 'error', params: { tag: 'section' } },
    ]);
  });

  it('ignores script and style bodies, comments and quoted > in attributes', () => {
    const logic = `<script type="text/x-dc" data-dc-script data-props='{"a":{"default":"x > y"}}'>class Component extends DCLogic { renderVals() { return { a: 1 < 2 }; } }</script>`;
    const src = board(`<!-- <div> --><div style="width:400px;height:300px"><input value="a>b"><br></div>`, logic);
    expect(run(canvas(), { 'Main.dc.html': src })).toEqual([]);
  });

  it('needs the x-dc block and the support script', () => {
    expect(run(canvas(), { 'Main.dc.html': '<html><body><div style="width:400px;height:300px"></div></body></html>' })).toEqual(['Main.dc.html:1 no-x-dc']);
    expect(run(canvas(), { 'Main.dc.html': board(ROOT).replace('<script src="./support.js"></script>', '') })).toEqual(['Main.dc.html:1 no-support-script']);
  });
});
