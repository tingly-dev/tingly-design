/**
 * Golden cases for the Go port of packages/core/src/docs.ts: every input
 * the spike checks, with what the TypeScript code returns for it.
 *
 *   node --experimental-strip-types gen/fixtures.ts > testdata/docs.json
 *
 * The corpus is the repository's own Markdown (docs/, .design/, skills,
 * sample projects; never artifact/), the core unit tests' sample, and a
 * set of edge cases. Edits are seeded mutations, so the file is stable.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  findQuote,
  mergeBlocks,
  outlineOf,
  parseComments,
  parseDoc,
  quoteAt,
  rebaseBlocks,
  refineBlock,
  splitBlocks,
  stringifyComments,
  stringifyDoc,
  tabOrder,
  uniqueTabId,
  wordCount,
  blockKey,
} from '../../../packages/core/src/docs.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'artifact' || n === '.git' || n === '.research') continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (n.endsWith('.md')) out.push(p);
  }
  return out;
}

const SAMPLE = `# 上手手册

欢迎！这份文档写给*新同事*。

* 第一步
* 第二步

| 名称 | 说明 |
|:-----|-----:|
| a    | 1    |



\`\`\`sh
pnpm dev
\`\`\`

- [ ] 装好环境
- [x] 拿到账号
`;

const EDGE = [
  '',
  '\n',
  '\n\n\n',
  'one line, no newline',
  '# h1\n## h2\n### h3 ###\n',
  'Setext\n======\n\nSub\n---\n',
  '> quote\n> more\n\n> another\n',
  '1. one\n2. two\n\n3. three\n',
  '- a\n  - nested\n    - deeper\n- b\n',
  '* a\n\n* loose\n',
  '---\n\n***\n\n___\n',
  '    indented code\n    more\n',
  '~~~\ntilde fence\n~~~\n',
  '```js\nconst a = 1;\n\n\nconst b = 2;\n```\n',
  '<div>\nhtml block\n</div>\n\npara\n',
  '| a | b |\n|---|:-:|\n| 1 | 2 |\n| 3 \\| x | 4 |\n',
  'text with **bold** and `code` and [link](http://x) and ![img](a.png)\n',
  '~~strike~~ and https://autolink.example.com\n',
  '[ref]: http://example.com\n\nuse [ref]\n',
  'line one\nline two\n\n\n\n\nfar away\n',
  '中文段落，带标点。\n\n日本語の文。한국어 문장.\n',
  'emoji 👍🏽 and 𝒳 outside BMP\n',
  'trailing spaces   \nhard break\n',
  '- [ ] todo\n- [x] done\n- [X] Done\n',
  '\n\n# leading blank lines\n',
  'para\n# heading right after\n',
  '| only | header |\n|---|---|\n',
  '+ plus\n+ list\n',
  'a\\\nb\n',
  '<!-- comment -->\n\ntext\n',
];

let seed = 42;
function rnd(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];

/** One editor-like change to a tab. */
function mutate(src: string): string {
  const b = splitBlocks(src);
  if (!b.blocks.length) return src + 'new paragraph\n';
  const texts = b.blocks.map((x) => x.text);
  const i = Math.floor(rnd() * texts.length);
  const kind = pick(['word', 'delete', 'insert', 'swap', 'task', 'respell', 'cell', 'line']);
  switch (kind) {
    case 'word': {
      const words = texts[i].split(/(\s+)/);
      const k = Math.floor(rnd() * words.length);
      words[k] = words[k].trim() ? words[k] + '改' : words[k];
      texts[i] = words.join('');
      break;
    }
    case 'delete':
      texts.splice(i, 1);
      break;
    case 'insert':
      texts.splice(i, 0, pick(['新的一段。', '## New heading', '- new item', '> new quote']));
      break;
    case 'swap':
      if (texts.length > 1) {
        const j = (i + 1) % texts.length;
        [texts[i], texts[j]] = [texts[j], texts[i]];
      }
      break;
    case 'task':
      texts[i] = texts[i].includes('[ ]') ? texts[i].replace('[ ]', '[x]') : texts[i].replace('[x]', '[ ]');
      break;
    case 'respell':
      texts[i] = texts[i].replace(/^(\s*)\* /gm, '$1- ').replace(/\*([^*\n]+)\*/g, '_$1_');
      break;
    case 'cell':
      texts[i] = texts[i].replace(/\| ([^|\n]+?) \|/, '| $1x |');
      break;
    case 'line': {
      const lines = texts[i].split('\n');
      lines.splice(Math.floor(rnd() * lines.length) + 1, 0, lines[0].replace(/[A-Za-z一-龥]/, 'Q'));
      texts[i] = lines.join('\n');
      break;
    }
  }
  // the editor writes one blank line between blocks
  return texts.join('\n\n') + '\n';
}

const files = walk(ROOT).sort();
const corpus: { name: string; src: string }[] = [
  { name: 'core-test-sample', src: SAMPLE },
  ...EDGE.map((src, n) => ({ name: `edge-${n}`, src })),
  ...files.map((f) => ({ name: relative(ROOT, f), src: readFileSync(f, 'utf8') })),
];

const split = corpus.map(({ name, src }) => {
  const b = splitBlocks(src);
  return { name, src, lead: b.lead, blocks: b.blocks.map((x) => ({ type: x.type, text: x.text, start: x.start, end: x.end })), gaps: b.gaps };
});

// blockKey equality is what merging relies on; the keys themselves may differ between implementations
const keyPairs: { a: string; b: string; same: boolean }[] = [];
for (const { src } of corpus) {
  for (const x of splitBlocks(src).blocks) {
    const y = mutate(x.text + '\n').replace(/\n$/, '');
    keyPairs.push({ a: x.text, b: y, same: blockKey(x.text) === blockKey(y) });
    const re = x.text.replace(/^(\s*)\* /gm, '$1- ').replace(/\*([^*\n]+)\*/g, '_$1_').replace(/ +\|/g, ' |');
    keyPairs.push({ a: x.text, b: re, same: blockKey(x.text) === blockKey(re) });
  }
}

const merge: { name: string; original: string; edited: string; out: string }[] = [];
const rebase: { name: string; basis: string; mine: string; theirs: string; out: string }[] = [];
for (const { name, src } of corpus) {
  for (let n = 0; n < Number(process.env.EDITS ?? 12); n++) {
    let edited = mutate(src);
    if (rnd() < 0.5) edited = mutate(edited);
    merge.push({ name: `${name}#${n}`, original: src, edited, out: mergeBlocks(src, edited) });
    const mine = mergeBlocks(src, mutate(src));
    const theirs = mergeBlocks(src, mutate(src));
    rebase.push({ name: `${name}#${n}`, basis: src, mine, theirs, out: rebaseBlocks(src, mine, theirs) });
  }
}

const refine: { orig: string; next: string; type: string; out: string }[] = [];
for (const { src } of corpus) {
  for (const x of splitBlocks(src).blocks) {
    if (!['table', 'list', 'code'].includes(x.type)) continue;
    const next = mutate(x.text + '\n').replace(/\n$/, '');
    refine.push({ orig: x.text, next, type: x.type, out: refineBlock(x.text, next, x.type) });
  }
}

const reading = corpus.map(({ name, src }) => ({ name, outline: outlineOf(src), words: wordCount(src) }));

const quotes: { text: string; quote: string; prefix?: string; suffix?: string; found: { from: number; to: number } | null; at: { from: number; to: number; quote: string; prefix: string; suffix: string } }[] = [];
for (const { src } of corpus.slice(0, 60)) {
  if (src.length < 10) continue;
  const from = Math.floor(rnd() * (src.length - 8));
  const to = from + 1 + Math.floor(rnd() * 7);
  const q = quoteAt(src, from, to);
  quotes.push({ text: src, ...q, found: findQuote(src, q), at: { from, to, ...q } });
}

const DOC_JSON = [
  ...readdirSync(join(ROOT, 'projects'))
    .map((p) => join(ROOT, 'projects', p, 'doc.json'))
    .filter((p) => { try { return statSync(p).isFile(); } catch { return false; } })
    .map((p) => readFileSync(p, 'utf8')),
  '{"title":"T","tabs":[{"id":"a","title":"A"},{"id":"b","title":"B","parent":"a"},{"id":"c","parent":"b"},{"id":"a"},{"id":"bad id"}],"settings":{"width":"wide"},"x":1}',
  '',
  'not json',
  '[]',
  '{"title":"  ","tabs":"no"}',
  '{"z":1,"title":"keeps <order> & \\u2028","a":{"n":1.5,"big":1e21,"neg":-0,"u":"é"},"settings":{"lang":"en","headingFont":"serif"}}',
  '{"tabs":[{"id":"x","title":"X","parent":"x"}],"title":"self parent"}',
];
const docs = DOC_JSON.map((input) => {
  const d = parseDoc(input);
  return { input, out: stringifyDoc(d), order: tabOrder(d).map((t) => t.id), unique: uniqueTabId(d, 'Intro Tab!') };
});

const COMMENTS = [
  ...[join(ROOT, 'projects/design-guide/comments.json')].map((p) => readFileSync(p, 'utf8')),
  '',
  '{"threads":[{"id":"t","tab":"a","quote":"q","comments":[{"text":"hi"},{"id":"c2","author":"A","text":"yo","at":"2026"},{"bad":1}],"resolved":true,"prefix":"p"},{"id":1}],"extra":[1,2]}',
];
const comments = COMMENTS.map((input) => ({ input, out: stringifyComments(parseComments(input)) }));

process.stdout.write(JSON.stringify({ split, keyPairs, merge, rebase, refine, reading, quotes, docs, comments }));
