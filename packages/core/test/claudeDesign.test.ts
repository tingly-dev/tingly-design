import { describe, expect, it } from 'vitest';
import { detectClaudeDesign, docFromMarkdown, fromClaudeDesign, toClaudeDesign, type Files } from '../src';

const b = (s: string) => new TextEncoder().encode(s);
const t = (d: Uint8Array) => new TextDecoder().decode(d);

describe('detectClaudeDesign', () => {
  it('finds each kind by the index under project/, or the dashboard documents', () => {
    expect(detectClaudeDesign(['project/canvas.json', 'project/Main.dc.html'])).toEqual({ kind: 'design', root: '' });
    expect(detectClaudeDesign(['abc/project/deck.json'])).toEqual({ kind: 'slides', root: 'abc/' });
    expect(detectClaudeDesign(['project/design-system.json'])?.kind).toBe('design-system');
    expect(detectClaudeDesign(['dash/meta', 'datasets/a'])).toEqual({ kind: 'dashboard', root: '' });
    expect(detectClaudeDesign(['x/dash/meta.json'])).toEqual({ kind: 'dashboard', root: 'x/' });
    expect(detectClaudeDesign(['datasets/a.json', 'index.html'])?.kind).toBe('dashboard');
  });

  it('does not take a Tingly Design project folder for a package', () => {
    expect(detectClaudeDesign(['canvas.json', 'Main.dc.html'])).toBeNull();
    expect(detectClaudeDesign(['my/canvas.json'])).toBeNull();
    expect(detectClaudeDesign(['notes.md'])).toBeNull();
    // a Tingly dashboard folder (zipped by hand or imported as a folder) stays one of ours
    expect(detectClaudeDesign(['dash.json', 'datasets/a.json', 'files/index.html'])).toBeNull();
    expect(detectClaudeDesign(['box/dash.json', 'box/datasets/a.json', 'box/files/index.html'])).toBeNull();
    // a page and datasets in different folders are not one dashboard
    expect(detectClaudeDesign(['a/index.html', 'b/datasets/x.json'])).toBeNull();
    // the shallowest folder with a page and datasets is the dashboard, whatever comes first
    expect(detectClaudeDesign(['old/datasets/x.json', 'datasets/a.json', 'index.html'])).toEqual({ kind: 'dashboard', root: '' });
  });
});

describe('fromClaudeDesign', () => {
  it('takes project/ as the project and brings /_blob pictures in as uploads', () => {
    const id = 'a'.repeat(32);
    const all: Files = {
      'wrap/project/deck.json': b('{"v":4,"order":["a"]}'),
      'wrap/project/slides/a.html': b(`<section><img src="/_blob/${id}"></section>`),
      'wrap/index.html': b('<html>'),
      'wrap/artifact-type/app.js': b('x'),
      [`wrap/assets/${id}.png`]: b('PNG'),
    };
    const m = detectClaudeDesign(Object.keys(all))!;
    const r = fromClaudeDesign(all, m);
    expect(r.kind).toBe('slides');
    expect(Object.keys(r.files).sort()).toEqual(['deck.json', 'slides/a.html', `uploads/${id}.png`]);
    expect(t(r.files['slides/a.html'])).toContain(`src="uploads/${id}.png"`);
    expect(r.notes).toEqual([]);
  });

  it('points a design system page at its picture from its own folder, and leaves URLs elsewhere alone', () => {
    const id = 'c'.repeat(32);
    const far = `https://claude.ai/api/x/_blob/${id}`;
    const all: Files = {
      'project/design-system.json': b('{}'),
      'project/components/button/preview.html': b(`<img src="/_blob/${id}"><img src="${far}">`),
      'project/components/bundle.css': b(`.x{background:url(./_blob/${id})}`),
      'project/README.md': b(`![](_blob/${id})`),
      [`${id}.png`]: b('PNG'),
    };
    const r = fromClaudeDesign(all, detectClaudeDesign(Object.keys(all))!);
    expect(t(r.files['components/button/preview.html'])).toBe(`<img src="../../uploads/${id}.png"><img src="${far}">`);
    expect(t(r.files['components/bundle.css'])).toBe(`.x{background:url(../../uploads/${id}.png)}`);
    expect(t(r.files['README.md'])).toBe(`![](uploads/${id}.png)`);
    expect(r.files[`uploads/${id}.png`]).toBeDefined();
  });

  it('says how many pictures the package did not carry', () => {
    const all: Files = { 'project/canvas.json': b('{}'), 'project/Main.dc.html': b(`<img src="/_blob/${'b'.repeat(32)}">`) };
    const r = fromClaudeDesign(all, detectClaudeDesign(Object.keys(all))!);
    expect(r.notes).toEqual([{ key: 'missingPictures', params: { count: 1 } }]);
  });

  it('turns dashboard documents into the project files, data included', () => {
    const id = 'c'.repeat(32);
    const all: Files = {
      'dash/meta': b('{"title":"Sales"}'),
      'dash/params': b('{"region":null}'),
      'datasets/rows': b(JSON.stringify({ title: 'Rows', source: { kind: 'file', url: `/_blob/${id}`, name: 'rows.csv' } })),
      'datasets/bq': b(JSON.stringify({ title: 'Live', source: { kind: 'query', connector: 'BigQuery', tool: 'q', args: {} } })),
      'files/index.html': b(JSON.stringify({ text: '<div data-source="rows">—</div>' })),
      [`${id}.csv`]: b('a,b\n1,2\n'),
    };
    const r = fromClaudeDesign(all, detectClaudeDesign(Object.keys(all))!);
    expect(JSON.parse(t(r.files['dash.json']))).toEqual({ title: 'Sales', params: { region: null } });
    expect(t(r.files['files/index.html'])).toBe('<div data-source="rows">—</div>');
    expect(JSON.parse(t(r.files['datasets/rows.json'])).source.url).toBe('data/rows.csv');
    expect(t(r.files['data/rows.csv'])).toContain('1,2');
    expect(r.notes).toEqual([{ key: 'connector', params: { names: 'BigQuery' } }]);
  });

  it('brings in a file dataset whose blob has no name', () => {
    const id = 'd'.repeat(32);
    const all: Files = {
      'dash/meta': b('{"title":"S"}'),
      'datasets/rows': b(JSON.stringify({ title: 'Rows', source: { kind: 'file', url: `/_blob/${id}`, format: 'csv' } })),
      [`${id}.csv`]: b('a\n1\n'),
    };
    const r = fromClaudeDesign(all, detectClaudeDesign(Object.keys(all))!);
    expect(JSON.parse(t(r.files['datasets/rows.json'])).source.url).toBe('data/rows.csv');
    expect(r.notes).toEqual([]);
    // a name without an extension gets the blob's
    all['datasets/rows'] = b(JSON.stringify({ title: 'Rows', source: { kind: 'file', url: `/_blob/${id}`, name: 'rows' } }));
    expect(JSON.parse(t(fromClaudeDesign(all, detectClaudeDesign(Object.keys(all))!).files['datasets/rows.json'])).source.url).toBe('data/rows.csv');
  });

  it('reads a dashboard saved as a page and datasets only', () => {
    const all: Files = { 'index.html': b('<p>hi</p>'), 'datasets/a.json': b('{"title":"A","source":{"kind":"file","url":"/_blob/zz"}}') };
    const r = fromClaudeDesign(all, detectClaudeDesign(Object.keys(all))!);
    expect(t(r.files['files/index.html'])).toBe('<p>hi</p>');
    expect(JSON.parse(t(r.files['dash.json'])).title).toBe('Dashboard');
    expect(r.notes[0]).toEqual({ key: 'missingData', params: { count: 1 } });
  });
});

describe('toClaudeDesign', () => {
  it('puts a canvas under project/ with a README and no machine files', () => {
    const r = toClaudeDesign('design', { 'canvas.json': b('{"designSystems":[{"artifact":"projects/brand"}]}'), 'Main.dc.html': b('x'), '.journal.jsonl': b('y') }, 'My canvas');
    expect(Object.keys(r.files).sort()).toEqual(['README.md', 'project/Main.dc.html', 'project/canvas.json']);
    expect(r.notes).toEqual([{ key: 'localSystem', params: { count: 1 } }]);
    expect(t(r.files['README.md'])).toContain('Design');
  });

  it('warns about slide pictures kept as uploads', () => {
    const r = toClaudeDesign('slides', { 'deck.json': b('{}'), 'slides/a.html': b('<img src="uploads/p.png">'), 'uploads/p.png': b('x') }, 'Deck');
    expect(r.notes).toEqual([{ key: 'slidePictures', params: { count: 1 } }]);
  });

  it('writes a dashboard as store documents with its data as blobs', () => {
    const files: Files = {
      'dash.json': b('{"title":"Sales","params":{"r":"a"}}'),
      'datasets/rows.json': b(JSON.stringify({ title: 'Rows', source: { kind: 'file', url: 'data/rows.csv', name: 'rows.csv' } })),
      'files/index.html': b('<p>'),
      'data/rows.csv': b('a\n1\n'),
      'data/box.db': b('sqlite'),
    };
    const r = toClaudeDesign('dashboard', files, 'Sales');
    expect(Object.keys(r.files).sort()).toEqual(['README.md', 'blobs/rows.csv', 'dash/meta.json', 'dash/params.json', 'datasets/rows.json', 'files/index.html']);
    expect(JSON.parse(t(r.files['datasets/rows.json'])).source.url).toBe('blobs/rows.csv');
    expect(r.notes).toEqual([{ key: 'sqlite' }]);
  });

  it('round-trips a canvas and a dashboard', () => {
    const canvas: Files = { 'canvas.json': b('{"v":3}'), 'Main.dc.html': b('<x-dc>') };
    const out = toClaudeDesign('design', canvas, 'C').files;
    const back = fromClaudeDesign(out, detectClaudeDesign(Object.keys(out))!);
    expect(Object.fromEntries(Object.entries(back.files).map(([k, v]) => [k, t(v)]))).toEqual({ 'canvas.json': '{"v":3}', 'Main.dc.html': '<x-dc>' });

    const dash: Files = {
      'dash.json': b('{"title":"S","params":{}}\n'),
      'datasets/r.json': b(JSON.stringify({ title: 'R', source: { kind: 'file', url: 'data/r.csv', name: 'r.csv' } })),
      'files/index.html': b('<p>'),
      'data/r.csv': b('a\n1\n'),
    };
    const pkg = toClaudeDesign('dashboard', dash, 'S').files;
    const again = fromClaudeDesign(pkg, detectClaudeDesign(Object.keys(pkg))!);
    expect(Object.keys(again.files).sort()).toEqual(['dash.json', 'data/r.csv', 'datasets/r.json', 'files/index.html']);
    expect(JSON.parse(t(again.files['datasets/r.json'])).source.url).toBe('data/r.csv');
  });
});

describe('docFromMarkdown', () => {
  it('makes a one-tab doc titled by the first heading', () => {
    const f = docFromMarkdown('# Plan\n\nText', 'file');
    expect(JSON.parse(t(f['doc.json'])).title).toBe('Plan');
    expect(t(f['tabs/main.md'])).toBe('# Plan\n\nText\n');
    expect(JSON.parse(t(docFromMarkdown('no heading', 'notes')['doc.json'])).title).toBe('notes');
    expect(JSON.parse(t(docFromMarkdown('# C#\n', 'x')['doc.json'])).title).toBe('C#');
    expect(JSON.parse(t(docFromMarkdown('# Plan ##\n', 'x')['doc.json'])).title).toBe('Plan');
  });
});
