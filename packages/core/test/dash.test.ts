import { describe, expect, it } from 'vitest';
import {
  bindSql,
  checkMark,
  checkSql,
  cleanParams,
  fillArgs,
  isDashFile,
  isDataPath,
  markOf,
  paramsIn,
  parseDash,
  parseDataFile,
  parseDataset,
  parseDelimited,
  readShownNumber,
  resolveMark,
  tableToCsv,
  toTable,
  projectKind,
} from '../src';

describe('dashboard files', () => {
  it('knows its files', () => {
    for (const ok of ['dash.json', 'datasets/px.json', 'files/index.html', 'files/chart.js', 'files/a.css']) expect(isDashFile(ok), ok).toBe(true);
    for (const no of ['datasets/a b.json', 'files/../x.html', 'files/x.exe', 'files/sub/x.html']) expect(isDashFile(no), no).toBe(false);
    expect(isDataPath('data/sales.csv')).toBe(true);
    expect(isDataPath('data/cafe.db')).toBe(true);
    expect(isDataPath('data/../x.csv')).toBe(false);
    expect(projectKind(['dash.json', 'files/index.html'])).toBe('dashboard');
  });

  it('reads dash.json and keeps only filter values the original keeps', () => {
    const d = parseDash('{"title":"Sales","params":{"region":"west","n":3,"list":["a",1],"bad":{"x":1},"two\\nlines":"x","nl":"a\\nb"},"x":1}');
    expect(d.title).toBe('Sales');
    expect(d.params).toEqual({ region: 'west', n: 3, list: ['a', 1] });
    expect(d.x).toBe(1);
    expect(cleanParams([])).toBeNull();
  });

  it('reads datasets, saying what is wrong', () => {
    expect(parseDataset('{"title":"A","source":{"kind":"file","url":"data/a.csv"}}').error).toBeUndefined();
    expect(parseDataset('{"title":"A","source":{"kind":"file","url":"/_blob/abc"}}').error).toMatch(/under data/);
    expect(parseDataset('{"title":"A","source":{"kind":"query","connector":"sqlite","tool":"query","args":{"sql":"SELECT 1"}}}').error).toBeUndefined();
    expect(parseDataset('{"title":"A","source":{"kind":"rows","rows":[]}}').error).toMatch(/old rows/);
    expect(parseDataset('nope').dataset).toBeNull();
  });
});

describe('tables', () => {
  it('parses CSV like the original: BOM, quotes, empty cells are null', () => {
    const t = parseDelimited('﻿day,n,note\r\n2026-01-01,3,"a, ""b"""\n2026-01-02,,\n');
    expect(t.columns).toEqual(['day', 'n', 'note']);
    expect(t.rows).toEqual([
      { day: '2026-01-01', n: '3', note: 'a, "b"' },
      { day: '2026-01-02', n: null, note: null },
    ]);
    expect(parseDelimited('a\tb\n1\t2', '\t').rows).toEqual([{ a: '1', b: '2' }]);
    expect(tableToCsv(t)).toBe('day,n,note\n2026-01-01,3,"a, ""b"""\n2026-01-02,,\n');
  });

  it('reads row objects, bare or under rows/data/results', () => {
    expect(toTable([{ a: 1 }, { b: 2 }])).toEqual({ columns: ['a', 'b'], rows: [{ a: 1 }, { b: 2 }] });
    expect(toTable({ data: [{ a: 1 }], columns: ['a'], meta: [{ label: 'SQL', value: 'select', type: 'code' }] })).toEqual({
      columns: ['a'],
      rows: [{ a: 1 }],
      meta: [{ label: 'SQL', value: 'select', type: 'code' }],
    });
    expect(toTable({ total: 3 })).toBeNull();
    expect(parseDataFile('{"total":3}', 'json')).toEqual({ table: null, value: { total: 3 } });
  });
});

describe('SQL', () => {
  it('lets through one read-only statement', () => {
    expect(checkSql('SELECT day, n FROM t WHERE x = {{x}} ORDER BY day')).toBeNull();
    expect(checkSql('with a as (select 1) select * from a;')).toBeNull();
    expect(checkSql("SELECT 'delete' AS `insert` -- drop\nFROM t")).toBeNull();
    expect(checkSql('DELETE FROM t')).toMatch(/SELECT or WITH/);
    expect(checkSql('SELECT 1; DROP TABLE t')).toMatch(/one statement/);
    expect(checkSql('SELECT * INTO x FROM t')).toMatch(/INTO is not allowed/);
    expect(checkSql("SELECT * FROM t WHERE a LIKE '%{{q}}%'")).toMatch(/one whole literal/);
    expect(checkSql("SELECT 'x")).toMatch(/unclosed/);
    expect(checkSql('PRAGMA table_info(t)')).toMatch(/SELECT or WITH/);
  });

  it('binds filters as literals', () => {
    expect(bindSql('SELECT * FROM t WHERE (CAST({{r}} AS TEXT) IS NULL OR r = {{r}}) AND p IN {{plans}} AND ok = {{ok}}', { plans: ['a', 'b'], ok: true })).toEqual({
      sql: 'SELECT * FROM t WHERE (CAST(? AS TEXT) IS NULL OR r = ?) AND p IN (?, ?) AND ok = ?',
      values: [null, null, 'a', 'b', 1],
    });
    expect(bindSql('SELECT * FROM t WHERE p IN {{plans}}', { plans: [] })).toEqual({ sql: 'SELECT * FROM t WHERE p IN (NULL)', values: [] });
    expect(paramsIn({ sql: 'x {{a}} {{ b }}', n: ['{{c}}'] })).toEqual(['a', 'b', 'c']);
    expect(fillArgs({ sql: '{{a}}', limit: '{{n}}', label: 'top {{n}}' }, { n: 5, a: 'x' })).toEqual({ sql: '{{a}}', limit: 5, label: 'top 5' });
  });
});

describe('marks', () => {
  const t = { columns: ['region', 'day', 'revenue', 'share'], rows: [
    { region: 'west', day: '2026-01-01', revenue: 1234567, share: 0.1234 },
    { region: 'east', day: '2026-01-01', revenue: '980.5', share: null },
  ] };

  it('resolves rows', () => {
    expect(resolveMark(markOf({ source: 'a b', field: 'revenue', where: 'region=west&day=2026-01-01' }), t)).toEqual([0]);
    expect(resolveMark(markOf({ source: 'a', field: 'nope' }), t)).toBe('no column “nope”');
    expect(resolveMark(markOf({ source: 'a', where: 'region=north' }), t)).toBe('no matching row');
    expect(resolveMark(markOf({ source: 'a', row: '7' }), t)).toBe('no row 7');
    expect(resolveMark(markOf({ source: 'a', where: 'oops' }), t)).toBe('data-where isn’t col=value');
  });

  it('reads numbers as people write them', () => {
    expect(readShownNumber('1,234,567')).toEqual({ value: 1234567, step: 1, percent: false });
    expect(readShownNumber('1.234.567,5')?.value).toBe(1234567.5);
    expect(readShownNumber('−12.3%')).toEqual({ value: -12.3, step: 0.1, percent: true });
    expect(readShownNumber('1.2M')).toEqual({ value: 1200000, step: 100000, percent: false });
    expect(readShownNumber('123.5 万')?.value).toBe(1235000);
    expect(readShownNumber('2026-01-01')).toBeNull();
  });

  it('checks a shown number against its cell at the shown precision', () => {
    const v = (field: string, where: string, shown: string) => checkMark(markOf({ source: 'a', field, where }), t, shown).status;
    expect(v('revenue', 'region=west', '1,234,567')).toBe('match');
    expect(v('revenue', 'region=west', '1.2M')).toBe('match');
    expect(v('revenue', 'region=west', '$1.23M')).toBe('match');
    expect(v('revenue', 'region=west', '1.3M')).toBe('mismatch');
    expect(v('revenue', 'region=east', '980.5')).toBe('match');
    expect(v('share', 'region=west', '12.3%')).toBe('match');
    expect(v('share', 'region=west', '+12.4%')).toBe('mismatch');
    expect(v('share', 'region=east', '—')).toBe('resolves');
    expect(v('day', 'region=east', '2026-01-01')).toBe('match');
    expect(v('day', 'region=east', 'Jan 1')).toBe('plain');
    const bad = checkMark(markOf({ source: 'a', field: 'revenue', where: 'region=west' }), t, '999');
    expect(bad).toEqual({ status: 'mismatch', rows: [0], shown: '999', inData: '1234567' });
  });
});
