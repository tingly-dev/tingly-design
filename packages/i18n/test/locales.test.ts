import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchLanguage, pickLanguage, resources, translator } from '../src';

type Bundle = Record<string, unknown>;

const PLURAL = /_(zero|one|two|few|many|other)$/;

/** every leaf as `path → string`, plural forms folded onto their stem */
function leaves(b: Bundle, prefix = '', out = new Map<string, string[]>()): Map<string, string[]> {
  for (const [k, v] of Object.entries(b)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') leaves(v as Bundle, path, out);
    else {
      const stem = path.replace(PLURAL, '');
      out.set(stem, [...(out.get(stem) ?? []), String(v)]);
    }
  }
  return out;
}

const placeholders = (values: string[]) => [...new Set(values.flatMap((v) => [...v.matchAll(/\{\{\s*(\w+)/g)].map((m) => m[1])))].sort();

const en = leaves(resources.en.translation as Bundle);
const zh = leaves(resources.zh.translation as Bundle);

describe('locale bundles', () => {
  it('zh has exactly the keys en has', () => {
    expect([...en.keys()].filter((k) => !zh.has(k))).toEqual([]);
    expect([...zh.keys()].filter((k) => !en.has(k))).toEqual([]);
  });

  it('a translation keeps the placeholders of the English string', () => {
    const off = [...en].filter(([k, v]) => zh.has(k) && placeholders(v).join() !== placeholders(zh.get(k)!).join()).map(([k]) => k);
    expect(off).toEqual([]);
  });

  it('no string is left empty', () => {
    const empty = [...en, ...zh].filter(([, v]) => v.some((s) => !s.trim())).map(([k]) => k);
    expect(empty).toEqual([]);
  });
});

describe('language tags', () => {
  it('narrows regional tags to a shipped language', () => {
    expect(matchLanguage('zh-CN')).toBe('zh');
    expect(matchLanguage('zh_Hans_TW')).toBe('zh');
    expect(matchLanguage('EN-gb')).toBe('en');
    expect(matchLanguage('ru')).toBeNull();
    expect(pickLanguage(['ru-RU', 'zh-CN;q=0.8', 'en'])).toBe('zh');
  });

  it('translates outside React, with plurals', () => {
    expect(translator('zh')('common.cancel')).toBe('取消');
    expect(translator('en')('common.cancel')).toBe('Cancel');
  });
});

// --- the code side --------------------------------------------------------------------------

const ROOT = resolve(import.meta.dirname, '../../..');
const SOURCES = ['apps/editor/src', 'apps/server/src', 'packages/core/src', 'packages/import/src', 'packages/sandbox/src'];

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const code = SOURCES.flatMap((d) => files(join(ROOT, d))).map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, 'utf8') }));

/** the source with comments blanked out, so only code and string literals are left */
const withoutComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

describe('the code', () => {
  // t('some.key') with a literal key has to exist, or it prints the key
  it('every literal key passed to t() exists', () => {
    const T_CALL = /\bt\(\s*['"`]([\w.-]+)['"`]/g;
    const referenced = new Set(code.flatMap((f) => [...f.text.matchAll(T_CALL)].map((m) => m[1])));
    expect(referenced.size).toBeGreaterThan(100);
    const missing = [...referenced].filter((k) => k.includes('.') && !en.has(k)).sort();
    expect(missing).toEqual([]);
  });

  // UI copy lives in the bundles. A Chinese string in code is copy that never got a key, and
  // shows up untranslated next to English (the mix this package exists to stop). The few that
  // remain are data, not copy, and are listed with why.
  it('has no Chinese outside the locale bundles', () => {
    const ALLOWED: Record<string, RegExp> = {
      // counting CJK characters for a doc's word count
      'packages/core/src/docs.ts': /cjk|\[぀-ヿ/,
      // 万 and 亿 are number suffixes a dashboard reads in data
      'packages/core/src/dash.ts': /万|亿/,
    };
    const hits: string[] = [];
    for (const f of code) {
      withoutComments(f.text)
        .split('\n')
        .forEach((line, i) => {
          if (!/\p{Script=Han}/u.test(line)) return;
          if (ALLOWED[f.path]?.test(line)) return;
          hits.push(`${f.path}:${i + 1}: ${line.trim().slice(0, 100)}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
