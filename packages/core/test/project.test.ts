import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { changeScope, checkProject, describeChange, mergeChange, withoutSent, followUpFor, journalSince, outlineProject, parseSince, projectKind, settingsProject, type ProjectFiles } from '../src';

const SAMPLES = join(__dirname, '../../../projects');

/** A sample project's text files, as the server reads them. */
function read(dir: string): ProjectFiles {
  const out: ProjectFiles = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (e.startsWith('.') || e === 'renders' || e === 'node_modules') continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(json|html|md|css)$/.test(e)) out[relative(dir, p).split('\\').join('/')] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

/** Samples that still break the subset; `tingly-design check` lists what to fix. */
const KNOWN_PROBLEMS = new Set<string>();

const samples = readdirSync(SAMPLES).filter((d) => statSync(join(SAMPLES, d)).isDirectory());

describe('outlineProject and checkProject on the samples', () => {
  it('covers every kind', () => {
    const kinds = new Set(samples.map((s) => projectKind(Object.keys(read(join(SAMPLES, s))))));
    expect([...kinds].sort()).toEqual(['dashboard', 'design', 'design-system', 'docs', 'motion', 'slides']);
  });
  for (const s of samples) {
    it(s, () => {
      const files = read(join(SAMPLES, s));
      const kind = projectKind(Object.keys(files))!;
      const outline = outlineProject(kind, files);
      expect(outline.title).toBeTruthy();
      expect(outline.items.length).toBeGreaterThan(0);
      const errors = checkProject(kind, files).filter((p) => p.level === 'error');
      if (KNOWN_PROBLEMS.has(s)) expect(errors.length).toBeGreaterThan(0);
      else expect(errors).toEqual([]);
    });
  }
});

describe('outlineProject', () => {
  it('lays a motion piece out on its timeline at its speed', () => {
    const files = {
      'motion.json': JSON.stringify({ v: 1, title: 'T', formats: { wide: { size: [1920, 1080] } }, fps: 30, order: ['a', 'b'], speed: 2 }),
      'scenes/a.html': '<section data-duration="4s" data-transition="fade 1s"><h1>Hello</h1></section>',
      'scenes/b.html': '<section data-duration="2s"><h2>Bye</h2></section>',
    };
    const o = outlineProject('motion', files);
    expect(o.duration).toBe(2500);
    expect(o.items).toEqual([
      { type: 'format', id: 'wide', size: [1920, 1080] },
      { type: 'scene', id: 'a', file: 'scenes/a.html', title: 'Hello', start: 0, duration: 2000, transition: 'fade 500ms' },
      { type: 'scene', id: 'b', file: 'scenes/b.html', title: 'Bye', start: 1500, duration: 1000 },
    ]);
  });
});

describe('checkProject', () => {
  it('says when the index does not read', () => {
    expect(checkProject('slides', { 'deck.json': '{' })).toEqual([{ level: 'error', file: 'deck.json', code: 'badIndex' }]);
  });
  it('finds a listed file that is missing and an artboard nobody lists', () => {
    const files = {
      'canvas.json': JSON.stringify({ v: 3, title: 'C', boards: { 'A.dc.html': { x: 0, y: 0, w: 10, h: 10 } }, order: ['A.dc.html'] }),
      'B.dc.html': '<x-dc><div></div></x-dc>',
    };
    expect(checkProject('design', files)).toEqual([
      { level: 'error', file: 'canvas.json', code: 'missingFile', ref: 'A.dc.html' },
      { level: 'warning', file: 'B.dc.html', code: 'unlisted', ref: 'canvas.json' },
    ]);
  });
  it('adds the canvas rules, once per problem', () => {
    const files = {
      'canvas.json': JSON.stringify({ v: 3, title: 'C', boards: { 'A.dc.html': { x: 0, y: 0, w: 400, h: 300 } }, order: ['A.dc.html'] }),
      'A.dc.html': '<script src="./support.js"></script><x-dc><div style="width:10px;height:10px"></div></x-dc>',
    };
    expect(checkProject('design', files)).toEqual([
      { level: 'error', file: 'A.dc.html', code: 'canvas', rule: 'root-size', params: { line: 1, width: 10, height: 10, boardWidth: 400, boardHeight: 300 } },
    ]);
  });
  it('passes on what the slide checker says', () => {
    const files = { 'deck.json': JSON.stringify({ v: 4, title: 'D', order: ['s'] }), 'slides/s.html': '<section><blink>x</blink></section>' };
    const p = checkProject('slides', files);
    expect(p.length).toBeGreaterThan(0);
    expect(p[0]).toMatchObject({ file: 'slides/s.html', code: 'issue' });
  });
});

describe('history --since', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  const entries = [
    { id: 'aaaa0001', at: '2026-10-16T09:00:00Z' },
    { id: 'aaaa0002', at: '2026-10-16T11:30:00Z' },
    { id: 'aaaa0003', at: '2026-10-16T11:59:00Z' },
  ];

  it('reads an entry id, an ISO time and a time ago', () => {
    expect(parseSince('AAAA0002')).toEqual({ id: 'aaaa0002' });
    expect(parseSince('2026-10-16T11:00:00Z')).toEqual({ after: Date.parse('2026-10-16T11:00:00Z') });
    expect(parseSince('45m', now)).toEqual({ after: now - 45 * 60_000 });
    expect(parseSince('1d', now)).toEqual({ after: now - 86_400_000 });
    expect(parseSince('yesterday')).toBeNull();
  });

  it('keeps what came after', () => {
    expect(journalSince(entries, { id: 'aaaa0001' })!.map((e) => e.id)).toEqual(['aaaa0002', 'aaaa0003']);
    expect(journalSince(entries, { id: 'aaaa0003' })).toEqual([]);
    expect(journalSince(entries, parseSince('1h', now))!.map((e) => e.id)).toEqual(['aaaa0002', 'aaaa0003']);
    expect(journalSince(entries, null)).toHaveLength(3);
  });

  it('says when the entry is not there', () => {
    expect(journalSince(entries, { id: 'ffffffff' })).toBeNull();
  });
});

describe('settingsProject', () => {
  it('reads each kind\'s settings as data', () => {
    const files = {
      'motion.json': JSON.stringify({ v: 1, title: 'T', formats: { wide: { size: [1920, 1080] }, tall: { size: [1080, 1920] } }, fps: 24, order: [], speed: 2 }),
    };
    expect(settingsProject('motion', files)).toEqual({ formats: [{ id: 'wide', size: [1920, 1080] }, { id: 'tall', size: [1080, 1920] }], fps: 24, speed: 2 });
    expect(settingsProject('slides', { 'deck.json': JSON.stringify({ title: 'D', size: [1080, 1920], designSystems: [{ namespace: 'acme' }, 'junk'] }) })).toMatchObject({ size: [1080, 1920], designSystems: ['acme'] });
    expect(settingsProject('docs', { 'doc.json': JSON.stringify({ title: 'D', tabs: [], settings: { width: 'wide' } }) }).look?.width).toBe('wide');
  });
  it('reads real values from the samples', () => {
    for (const s of samples) {
      const files = read(join(SAMPLES, s));
      const kind = projectKind(Object.keys(files))!;
      const st = settingsProject(kind, files);
      const o = outlineProject(kind, files);
      if (kind === 'design') expect(st.boards).toEqual(o.items.map((i) => ({ id: i.id, size: i.size })));
      if (kind === 'slides') expect(st.size![0]).toBeGreaterThan(0);
      if (kind === 'motion') expect(st.formats).toEqual(o.items.filter((i) => i.type === 'format').map((i) => ({ id: i.id, size: i.size })));
      if (kind === 'design-system') expect(st.themes!.length + st.colors!.length).toBeGreaterThan(0);
      if (kind === 'dashboard') expect(st.datasets!.length).toBeGreaterThan(0);
      if (kind === 'docs') expect(st.look!.lang).toBeTruthy();
    }
  });
  it('reads a broken index as no settings', () => {
    expect(() => settingsProject('design', { 'canvas.json': '{"boards":{"a.dc.html":null},"designSystems":{}}' })).not.toThrow();
    expect(settingsProject('design', { 'canvas.json': '{"designSystems":{}}' }).designSystems).toEqual([]);
    expect(settingsProject('slides', { 'deck.json': '{"designSystems":"x"}' }).designSystems).toEqual([]);
  });
});

describe('followUpFor', () => {
  it('offers a re-layout only when the shape changed a lot', () => {
    expect(followUpFor({ type: 'size', file: 'a.dc.html', from: [1200, 760], to: [1100, 760] })).toBeNull();
    const offer = followUpFor({ type: 'size', file: 'a.dc.html', from: [1200, 760], to: [390, 844] });
    expect(offer?.reason.id).toBe('size');
    expect(offer?.prompt).toContain('a.dc.html');
    expect(followUpFor({ type: 'size', from: [1920, 1080], to: [1080, 1920] })?.prompt).toContain('every slide');
    expect(followUpFor({ type: 'format', format: 'tall', from: [1920, 1080], to: [1080, 1920] })?.prompt).toContain('data-tall');
  });
  it('describes a change for Claude Code', () => {
    expect(describeChange({ type: 'size', from: [1920, 1080], to: [1080, 1920] })).toBe('The deck page was resized from 1920×1080 to 1080×1920.');
  });
});

describe('mergeChange', () => {
  it('lets a format added and removed again cancel out, and keeps a removal otherwise', () => {
    const added = { type: 'format' as const, format: 'tall', from: [1920, 1080] as [number, number], to: [1080, 1920] as [number, number] };
    const removed = { type: 'formatRemoved' as const, format: 'tall' };
    expect(mergeChange(added, removed)).toBeNull();
    expect(mergeChange(undefined, removed)).toEqual(removed);
    expect(followUpFor(removed)).toBeNull();
    expect(describeChange(removed)).toContain('"tall" was removed');
  });
  it('tells Claude about a speed change, offers nothing, and joins steps from where they started', () => {
    const a = { type: 'speed' as const, from: 1, to: 1.25 };
    expect(followUpFor(a)).toBeNull();
    expect(describeChange(a)).toContain('from 1× to 1.25×');
    expect(mergeChange(a, { type: 'speed', from: 1.25, to: 1.5 })).toEqual({ type: 'speed', from: 1, to: 1.5 });
    expect(mergeChange(a, { type: 'speed', from: 1.25, to: 1 })).toBeNull();
    expect(mergeChange(a, { type: 'speed', from: 1.5, to: 1 })).toBeNull();
  });
  const size = (from: [number, number], to: [number, number]) => ({ type: 'size' as const, file: 'a.dc.html', from, to });
  it('joins changes to one thing from where it started, and drops one put back', () => {
    const first = mergeChange(undefined, size([1920, 1080], [1500, 1080]))!;
    const second = mergeChange(first, size([1500, 1080], [1080, 1080]));
    expect(second).toMatchObject({ from: [1920, 1080], to: [1080, 1080] });
    expect(followUpFor(second!)).not.toBeNull();
    expect(mergeChange(second!, size([1080, 1080], [1920, 1080]))).toBeNull();
  });
  it('keeps scopes apart and joins token edits', () => {
    expect(changeScope(size([1, 1], [2, 2]))).not.toBe(changeScope({ type: 'size', from: [1, 1], to: [2, 2] }));
    const t = mergeChange({ type: 'tokens', edits: ['a'] }, { type: 'tokens', edits: ['b'] });
    expect(t).toEqual({ type: 'tokens', edits: ['a', 'b'] });
    expect(mergeChange({ type: 'tokens', edits: ['a', 'b'] }, { type: 'tokens', edits: ['a'] })).toEqual({ type: 'tokens', edits: ['b', 'a'] });
    expect(withoutSent({ type: 'tokens', edits: ['a', 'b'] }, [{ type: 'tokens', edits: ['a'] }])).toEqual({ type: 'tokens', edits: ['b'] });
    expect(withoutSent({ type: 'tokens', edits: ['a'] }, [{ type: 'tokens', edits: ['a'] }])).toBeNull();
    const told = size([1920, 1080], [1080, 1920]);
    expect(withoutSent(told, [told])).toBeNull();
    expect(withoutSent({ ...told, to: [1080, 1080] }, [told])).toMatchObject({ from: [1080, 1920], to: [1080, 1080] });
  });
  it('offers a restyle for a design system and a check for tokens', () => {
    expect(followUpFor({ type: 'designSystem', namespace: 'look-nord', title: 'Nord' })?.prompt).toContain('ds/look-nord/');
    expect(followUpFor({ type: 'tokens', edits: ['color brand'] })?.reason.id).toBe('tokens');
    expect(describeChange({ type: 'tokens', edits: ['color brand'] })).toContain('color brand');
  });
});

describe('theme changes', () => {
  it('offers the rest to Claude only when colours are left behind', () => {
    expect(followUpFor({ type: 'theme', namespace: 'tingly', title: 'Tingly', theme: 'dark', stay: 1 })).toBeNull();
    expect(followUpFor({ type: 'theme', namespace: 'tingly', title: null, theme: 'original', stay: 9 })).toBeNull();
    const offer = followUpFor({ type: 'theme', namespace: 'tingly', title: 'Tingly', theme: 'dark', stay: 5 });
    expect(offer?.reason.id).toBe('theme');
    expect(offer?.prompt).toContain('ds/tingly/tokens.json');
    expect(offer?.prompt).toContain('5 other colours are');
  });
  it('is one change per scope and says what happened', () => {
    const a = { type: 'theme', namespace: 'x', title: 'X', theme: 'dark', stay: 4 } as const;
    expect(changeScope(a)).toBe('theme:');
    expect(changeScope({ ...a, file: 'slides/a.html' })).toBe('theme:slides/a.html');
    expect(mergeChange(a, { ...a, theme: 'light' })).toMatchObject({ theme: 'light' });
    expect(describeChange(a)).toContain('switched to the "dark" theme');
    expect(describeChange({ ...a, title: null })).toContain('original look');
  });
  it('is reported with the project settings', () => {
    expect(settingsProject('design', { 'canvas.json': JSON.stringify({ theme: { system: 'tingly', theme: 'dark', base: { colors: {}, fonts: {} } } }) })).toMatchObject({ theme: { system: 'tingly', theme: 'dark' } });
    expect(settingsProject('slides', { 'deck.json': '{}' }).theme).toBeUndefined();
  });
});
