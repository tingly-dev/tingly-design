import { describe, expect, it } from 'vitest';
import { boardFilesFor, failedDataset, fitBundle, isDashBundlePath, loaderIds, parseDashBundle, queryDataset, readyState, stringifyBundle, DASH_BUNDLE_VERSION, type DashBundle } from '../src';

const bundle = (datasets: DashBundle['datasets'] = {}): DashBundle => ({ v: DASH_BUNDLE_VERSION, title: 'Usage', files: { 'index.html': '<h1>Usage</h1>' }, datasets, params: {}, theme: 'light', frozenAt: '2026-11-18T00:00:00Z' });

describe('a frozen dashboard', () => {
  it('lives in a linked folder under a name that says what it is', () => {
    expect(isDashBundlePath('uploads/linked/k3f9a/Usage.dash.json')).toBe(true);
    for (const p of ['uploads/linked/k3f9a/Usage.json', 'uploads/Usage.dash.json', 'uploads/linked/../x.dash.json', 'data/x.dash.json']) expect(isDashBundlePath(p)).toBe(false);
  });
  it('reads back what was written, and nothing else', () => {
    const b = bundle({ rows: { state: readyState({ columns: ['a'], rows: [{ a: 1 }] }, null, 1) } });
    expect(parseDashBundle(stringifyBundle(b))).toEqual(b);
    expect(parseDashBundle('{"v":9}')).toBeNull();
    expect(parseDashBundle('nope')).toBeNull();
    expect(parseDashBundle(undefined)).toBeNull();
  });
  it('makes a table of a query answer and keeps the raw answer only when a loader may want it', () => {
    const answer = { rows: [{ x: 1 }, { x: 2 }] };
    const kept = queryDataset(answer, { sql: 's' }, 5, true);
    expect(kept.state).toMatchObject({ status: 'ok', columns: ['x'], rows: [{ x: 1 }, { x: 2 }] });
    expect(kept.raw).toEqual({ answer, args: { sql: 's' } });
    expect(queryDataset(answer, {}, 5, false).raw).toBeUndefined();
    expect(queryDataset({ total: 3 }, {}, 5, false).state).toMatchObject({ status: 'ok', data: { total: 3 }, rows: [] });
  });
  it('draws a dataset that could not be read the way the page draws a failed source', () => {
    expect(failedDataset('no connector', 'connect').state).toMatchObject({ status: 'connect', message: 'no connector', rows: [] });
  });
  it('finds the datasets a page hands a loader', () => {
    expect(loaderIds({ 'index.html': "dash.loader('orders', {fn(a){return a}}); dash.loader(\"users\", {fn(){}})" })).toEqual({ ids: ['orders', 'users'], dynamic: false });
    expect(loaderIds({ 'index.html': 'for (const id of ids) dash.loader(id, {fn(){}})' })).toEqual({ ids: [], dynamic: true });
    expect(loaderIds({ 'index.html': '<p>no loaders</p>' })).toEqual({ ids: [], dynamic: false });
  });
  it('cuts the largest dataset (and says so) until the bundle fits', () => {
    const rows = Array.from({ length: 400 }, (_, i) => ({ n: i, text: 'x'.repeat(40) }));
    const b = bundle({ big: { state: readyState({ columns: ['n', 'text'], rows }, null, 1), raw: { answer: rows, args: {} } }, small: { state: readyState({ columns: ['n'], rows: [{ n: 1 }] }, null, 1) } });
    const cut = fitBundle(b, 4000);
    expect(cut).toEqual(['big']);
    expect(b.datasets.big.state.cut).toBe(true);
    expect(b.datasets.big.state.rows.length).toBeLessThan(400);
    expect(b.datasets.big.raw).toBeUndefined();
    expect(b.datasets.small.state.cut).toBeUndefined();
    expect(JSON.stringify(b).length).toBeLessThanOrEqual(4000);
  });
  it('hands a slide the bundle it shows, with no siblings to follow', () => {
    const path = 'uploads/linked/k3f9a/Usage.dash.json';
    const files: Record<string, string> = { [path]: stringifyBundle(bundle()) };
    expect(boardFilesFor([`<section><x-embed src="${path}" style="x"></x-embed></section>`], (p) => files[p])).toEqual(files);
  });
});
