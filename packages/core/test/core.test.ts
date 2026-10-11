import { describe, expect, it } from 'vitest';
import { Window as HappyWindow } from 'happy-dom';
// @ts-expect-error jquery/factory ships no types
import { jQueryFactory } from 'jquery/factory';
import {
  parseDc,
  DesignCopy,
  applyHumanOps,
  setPropDefault,
  FastEditSession,
  StatementSplitter,
  splitStatements,
  setStyle,
  isTextEditable,
} from '../src';
import { BOARD } from './fixture';

function env() {
  const win = new HappyWindow({ url: 'http://localhost/' });
  const $ = jQueryFactory(win);
  return { win: win as unknown as Window & typeof globalThis, $, document: win.document as unknown as Document };
}

/** Lines of `after` that are not in `before` (a cheap way to assert a minimal diff). */
function changedLines(before: string, after: string): string[] {
  const b = before.split('\n');
  const a = after.split('\n');
  return a.filter((l, i) => l !== b[i]);
}

const find = (src: string, tag: string, n = 0) => parseDc(src).elements.filter((e) => e.tag === tag)[n];

describe('parse', () => {
  it('numbers elements depth-first and keeps source ranges', () => {
    const d = parseDc(BOARD);
    expect(d.errors).toEqual([]);
    expect(d.elements[0].tag).toBe('helmet');
    expect(d.elements[1].tag).toBe('style');
    expect(d.elements[2].tag).toBe('div');
    expect(d.elements[2].path).toEqual([1]);
    const h1 = find(BOARD, 'h1');
    expect(BOARD.slice(h1.range.start, h1.range.end)).toBe(
      `<h1 style="font-size:20px;font-weight:700" class='title'>Claude Code</h1>`,
    );
    expect(isTextEditable(h1)).toBe(true);
    expect(isTextEditable(find(BOARD, 'div', 2))).toBe(false); // the sc-for row holds a hole
    expect(d.props.accent.default).toBe('#3b6df0');
    expect(d.props.note.default).toBe("it's");
    expect(find(BOARD, 'svg').attrs.find((a) => a.name === 'viewBox')?.range).toBeTruthy();
  });

  it('a copy nobody touched writes back the identical file', () => {
    const { document } = env();
    const c = new DesignCopy(BOARD, document);
    expect(c.patches()).toEqual([]);
    expect(c.toSource()).toBe(BOARD);
  });
});

describe('human ops write minimal patches', () => {
  it('style keeps other declarations, quotes and holes', () => {
    const { document } = env();
    const h1 = find(BOARD, 'h1');
    const r = applyHumanOps(BOARD, [{ kind: 'style', tid: h1.tid, prop: 'color', value: '#14532d' }], document);
    expect(changedLines(BOARD, r.source)).toEqual([
      `    <h1 style="font-size:20px;font-weight:700;color:#14532d" class='title'>Claude Code</h1>`,
    ]);
    expect(r.summary).toBe(`#dc${h1.tid} color #14532d`);
  });

  it('style on a hole declaration appends instead of replacing it', () => {
    expect(setStyle('height:54px;background:{{r.bg}}', 'background', 'red')).toBe('height:54px;background:{{r.bg}};background:red');
    expect(setStyle('a: 1; b: 2', 'b', '3')).toBe('a: 1; b: 3');
    expect(setStyle('a: 1; b: 2', 'b', null)).toBe('a: 1');
    expect(setStyle('', 'color', 'red')).toBe('color: red');
  });

  it('text replaces only the text and escapes it', () => {
    const { document } = env();
    const p = find(BOARD, 'p');
    const r = applyHumanOps(BOARD, [{ kind: 'text', tid: p.tid, text: 'X < Y & Z' }], document);
    expect(changedLines(BOARD, r.source)).toEqual([`    <p style="color:#5b6475">X &lt; Y &amp; Z</p>`]);
  });

  it('remove / duplicate / move rewrite only the parent and keep siblings verbatim', () => {
    const { document } = env();
    const li = find(BOARD, 'li', 0);
    const dup = applyHumanOps(BOARD, [{ kind: 'duplicate', tid: li.tid }], document).source;
    expect(dup).toContain('<li>One</li>\n      <li>One</li>');
    expect(dup).not.toMatch(/id="dc\d+"/);
    const moved = applyHumanOps(BOARD, [{ kind: 'move', tid: li.tid, dir: 1 }], document).source;
    expect(moved).toMatch(/<li>Two<\/li>\s*<li>One<\/li>/);
    const removed = applyHumanOps(BOARD, [{ kind: 'remove', tid: find(BOARD, 'ul').tid }], document).source;
    expect(removed).not.toContain('<ul');
    // everything outside the edited parent is byte-identical
    expect(removed.slice(0, removed.indexOf('<h1'))).toBe(BOARD.slice(0, BOARD.indexOf('<h1')));
    expect(removed.slice(removed.indexOf('</x-dc>'))).toBe(BOARD.slice(BOARD.indexOf('</x-dc>')));
  });

  it('attributes: change one, add one, remove one', () => {
    const { document } = env();
    const svg = find(BOARD, 'svg');
    const r = applyHumanOps(
      BOARD,
      [
        { kind: 'attr', tid: svg.tid, name: 'width', value: '24' },
        { kind: 'attr', tid: svg.tid, name: 'height', value: null },
        { kind: 'attr', tid: svg.tid, name: 'aria-hidden', value: 'true' },
      ],
      document,
    );
    expect(r.source).toContain('<svg width="24" viewBox="0 0 20 20" aria-hidden="true"><path d="M2 2 L18 18" stroke-width="2"/></svg>');
  });

  it('tweak defaults are rewritten inside data-props with the right escaping', () => {
    const r = setPropDefault(BOARD, 'accent', "#ff0000'");
    expect(r.source).toContain(`"default":"#ff0000&#39;"`);
    expect(parseDc(r.source).props.accent.default).toBe("#ff0000'");
    expect(parseDc(r.source).props.note.default).toBe("it's");
  });
});

describe('fast edit session (jQuery on the copy)', () => {
  it('runs statements line by line and writes back after each', () => {
    const { win, $ } = env();
    const s = new FastEditSession(BOARD, win, $);
    const h1 = find(BOARD, 'h1');
    const r1 = s.run(`$('#dc${h1.tid}').css('color', '#14532d')`);
    expect(r1.ok).toBe(true);
    expect(r1.changed).toBe(true);
    const r2 = s.run(`.text('Codex')`);
    expect(r2.ok).toBe(true);
    expect(r2.source).toContain(`<h1 style="font-size:20px;font-weight:700;color:#14532d" class='title'>Codex</h1>`);
  });

  it('builds new content from the outside in, with repeat()', () => {
    const { win, $ } = env();
    const s = new FastEditSession(BOARD, win, $);
    const ul = find(BOARD, 'ul');
    for (const line of splitStatements(`
$('#dc${ul.tid}').after(\`<ol style="margin: 0; padding: 0"></ol>\`)
$('#dc${ul.tid}').next().append(\`<li style="color: #333333"></li>\`)
$('#dc${ul.tid}').next().children().first().repeat(3)
.text((i) => ['Plan', 'Build', 'Ship'][i])
`)) {
      const r = s.run(line);
      expect(r.error).toBeUndefined();
    }
    expect(s.source).toContain(
      '<ol style="margin: 0; padding: 0"><li style="color: #333333">Plan</li><li style="color: #333333">Build</li><li style="color: #333333">Ship</li></ol>',
    );
    expect(s.source).not.toMatch(/id="dc\d+"/);
    // the untouched list and the template loop survive byte for byte
    expect(s.source).toContain(`<sc-for list="{{rail}}" as="r" hint-placeholder-count="7">`);
    expect(s.source).toContain('<li>One</li>\n      <li>Two</li>');
  });

  it('reports errors, logs and delegation', () => {
    const { win, $ } = env();
    const s = new FastEditSession(BOARD, win, $);
    const bad = s.run(`$('#dc1').nope()`);
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/nope/);
    const p = find(BOARD, 'p');
    const log = s.run(`log($('#dc${p.tid}'))`);
    expect(log.log).toBe(`<p style="color:#5b6475" id="dc${p.tid}">A &amp; B — 切换器</p>`);
    expect(s.run('askClaude()').delegate).toBe(true);
  });

  it('a hole-bearing style survives a .css() edit', () => {
    const { win, $ } = env();
    const s = new FastEditSession(BOARD, win, $);
    const row = find(BOARD, 'div', 2);
    const r = s.run(`$('#dc${row.tid}').css('border-radius', 8)`);
    expect(r.source).toContain('<div style="height:54px;background:{{r.bg}};border-radius:8px">{{r.label}}</div>');
  });
});

describe('statement splitter', () => {
  it('waits for brackets and template literals to close across chunks', () => {
    const sp = new StatementSplitter();
    const got: string[] = [];
    for (const chunk of ["$('#a').css('co", "lor', 'red')\n$('#b').append(`<div>\n", '  <p>x</p>\n', '</div>`)\n```\n.text(\'y\')']) {
      got.push(...sp.push(chunk));
    }
    got.push(...sp.flush());
    expect(got).toEqual([
      "$('#a').css('color', 'red')",
      "$('#b').append(`<div>\n  <p>x</p>\n</div>`)",
      ".text('y')",
    ]);
  });
});

describe('rebaseSwap (undo after someone else edited the file)', () => {
  it('reverts a local change located by its context', async () => {
    const { rebaseSwap } = await import('../src');
    const before = 'a\n<h1 style="font-size:26px">T</h1>\n<p style="font-size:15px">x</p>\n';
    const after = before.replace('26px', '30px');
    const theirs = after.replace('15px', '17px');
    expect(rebaseSwap(theirs, after, before)).toBe(before.replace('15px', '17px'));
    expect(() => rebaseSwap(after.replace('30px', '31px'), after, before)).toThrow();
  });
});

describe('structural ops', () => {
  it('moveTo, order, wrap, unwrap and insert keep untouched source verbatim', async () => {
    const { applyHumanOps, parseDc: p } = await import('../src');
    const { document } = env();
    const d = p(BOARD);
    const lis = d.elements.filter((e) => e.tag === 'li');
    const h1 = d.elements.find((e) => e.tag === 'h1')!;
    const ul = d.elements.find((e) => e.tag === 'ul')!;
    const moved = applyHumanOps(BOARD, [{ kind: 'order', tid: lis[1].tid, to: 'first' }], document).source;
    expect(moved).toMatch(/<li>Two<\/li>\s*<li>One<\/li>/);
    const into = applyHumanOps(BOARD, [{ kind: 'moveTo', tid: h1.tid, target: ul.tid, where: 'last' }], document).source;
    expect(into).toContain(`<h1 style="font-size:20px;font-weight:700" class='title'>Claude Code</h1>`);
    expect(p(into).elements.find((e) => e.tag === 'h1')!.parent!.tag).toBe('ul');
    const wrapped = applyHumanOps(BOARD, [{ kind: 'wrap', tid: h1.tid, style: 'display:flex;gap:8px' }], document).source;
    expect(wrapped).toMatch(/<div style="display:flex;gap:8px"><h1 style="font-size:20px;font-weight:700" class='title'>Claude Code<\/h1><\/div>/);
    const wd = p(wrapped);
    const box = wd.elements.find((e) => e.tag === 'h1')!.parent!;
    const unwrapped = applyHumanOps(wrapped, [{ kind: 'unwrap', tid: box.tid }], document).source;
    expect(unwrapped).toBe(BOARD);
    const ins = applyHumanOps(BOARD, [{ kind: 'insert', target: h1.tid, where: 'after', html: '<p style="margin:0">New</p>' }], document).source;
    expect(ins).toMatch(/Claude Code<\/h1>\n\s+<p style="margin:0">New<\/p>/);
    const multi = applyHumanOps(BOARD, [{ kind: 'styles', tid: h1.tid, set: { color: 'red', 'font-size': null } }], document).source;
    expect(multi).toContain(`<h1 style="font-weight:700;color:red" class='title'>`);
  });

  it('names layers by role', async () => {
    const { layerTree, parseDc: p } = await import('../src');
    const tree = layerTree(p(BOARD));
    expect(tree[0].role).toBe('Row');
    const right = tree[0].children[1];
    expect(right.role).toBe('Column');
    expect(right.children.map((c) => c.role)).toEqual(['Text', 'Text', 'Group', 'Vector']);
    const rep = tree[0].children[0].children[0];
    expect(rep.role).toBe('Repeating group');
    expect(rep.children[0].repeated).toBe(true);
  });
});
