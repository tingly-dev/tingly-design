// Times the TypeScript core and the Go port (as WebAssembly) on the same
// edits, in Node (V8, the engine Chromium runs the editor on).
//   GOOS=js GOARCH=wasm go build -o testdata/docs.wasm ./cmd/wasm
//   node --experimental-strip-types cmd/bench/bench.mjs
// (TinyGo: tinygo build -o testdata/docs-tinygo.wasm -target wasm -opt z -no-debug ./cmd/wasm)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { mergeBlocks, rebaseBlocks, outlineOf } from '../../../../packages/core/src/docs.ts';

const HERE = join(import.meta.dirname, '..', '..');
const ROOT = join(HERE, '..', '..');
// WASM_EXEC and WASM pick another build, e.g. TinyGo's targets/wasm_exec.js and its .wasm
const goroot = execSync('go env GOROOT').toString().trim();
await import(process.env.WASM_EXEC ?? join(goroot, 'lib', 'wasm', 'wasm_exec.js'));

const t0 = performance.now();
const go = new globalThis.Go();
const { instance } = await WebAssembly.instantiate(readFileSync(process.env.WASM ?? join(HERE, 'testdata', 'docs.wasm')), go.importObject);
go.run(instance);
const startup = performance.now() - t0;
const G = globalThis.goDocs;

// the WebAssembly build gives the same bytes as the TypeScript on every golden merge and rebase
const golden = JSON.parse(readFileSync(join(HERE, 'testdata', 'docs.json'), 'utf8'));
let same = 0;
for (const c of golden.merge) same += G.merge(c.original, c.edited) === c.out ? 1 : 0;
for (const c of golden.rebase) same += G.rebase(c.basis, c.mine, c.theirs) === c.out ? 1 : 0;
console.log(`golden through wasm: ${same} / ${golden.merge.length + golden.rebase.length}`);

function time(fn, n) {
  for (let i = 0; i < 3; i++) fn();
  const s = performance.now();
  for (let i = 0; i < n; i++) fn();
  return (performance.now() - s) / n;
}

const base = readFileSync(join(ROOT, 'docs', 'en', 'architecture.md'), 'utf8');
const sizes = [1, 4, 16];
const rows = [];
for (const k of sizes) {
  const src = Array(k).fill(base).join('\n\n');
  // the editor's save after one word changed somewhere in the middle
  const at = src.indexOf('\n\n', Math.floor(src.length / 2)) + 2;
  const edited = src.slice(0, at) + 'Changed. ' + src.slice(at);
  const theirs = 'New first paragraph.\n\n' + src;
  const n = k === 16 ? 10 : 40;
  if (G.merge(src, edited) !== mergeBlocks(src, edited)) throw new Error('merge differs');
  if (G.rebase(src, edited, theirs) !== rebaseBlocks(src, edited, theirs)) throw new Error('rebase differs');
  rows.push({
    doc: `${(src.length / 1024).toFixed(0)} KB, ${src.split('\n').length} lines`,
    'merge ts ms': time(() => mergeBlocks(src, edited), n).toFixed(2),
    'merge wasm ms': time(() => G.merge(src, edited), n).toFixed(2),
    'rebase ts ms': time(() => rebaseBlocks(src, edited, theirs), n).toFixed(2),
    'rebase wasm ms': time(() => G.rebase(src, edited, theirs), n).toFixed(2),
    'outline ts ms': time(() => outlineOf(src), n).toFixed(2),
    'outline wasm ms': time(() => G.outline(src), n).toFixed(2),
  });
}
console.log(`wasm startup ${startup.toFixed(0)} ms`);
console.table(rows);
process.exit(0);
