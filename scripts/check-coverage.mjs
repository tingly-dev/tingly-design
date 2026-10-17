// Every ✓ in the cross-kind matrix (.design/project-kinds.md §3) names the e2e suites that check it, or says
// why none does, in e2e/coverage.json; every suite named there is one e2e/run.py runs. Part of `pnpm test`.
// See .design/harness.md.
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const KINDS = ['design', 'slides', 'design-system', 'dashboard', 'docs', 'motion'];

// the matrix: the rows between the §3 heading and the next one; a feature is its first cell up to the "（…）" link
const section = read('.design/project-kinds.md').split(/^## 3\..*$/m)[1].split(/^## /m)[0];
const rows = section.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| 功能') && !l.startsWith('|---'));
const cells = (l) => l.slice(1, -1).split('|').map((c) => c.trim());
const supported = new Map();
for (const row of rows) {
  const c = cells(row);
  const feature = c[0].split('（')[0].trim();
  supported.set(feature, KINDS.filter((_, i) => c[2 + i]?.startsWith('✓')));
}

const table = read('e2e/run.py').match(/^SUITES = \{([\s\S]*?)^\}/m)[1];
const suites = new Set([...table.matchAll(/'(\w+)': '[\w-]+'/g)].map((m) => m[1]));
const coverage = JSON.parse(read('e2e/coverage.json'));
const problems = [];

for (const [feature, kinds] of supported) {
  for (const kind of kinds) {
    const v = coverage[feature]?.[kind];
    if (v === undefined) problems.push(`${feature} / ${kind}: ✓ in the matrix, but e2e/coverage.json names no suite and no reason`);
    else if (Array.isArray(v) && !v.length) problems.push(`${feature} / ${kind}: an empty suite list; name a suite or write why none checks it`);
    else if (typeof v === 'string' && !v.trim()) problems.push(`${feature} / ${kind}: an empty reason`);
  }
}
for (const [feature, kinds] of Object.entries(coverage)) {
  if (!supported.has(feature)) {
    problems.push(`${feature}: in e2e/coverage.json but no such row in the matrix`);
    continue;
  }
  for (const [kind, v] of Object.entries(kinds)) {
    if (!KINDS.includes(kind)) problems.push(`${feature} / ${kind}: not a kind`);
    else if (!supported.get(feature).includes(kind)) problems.push(`${feature} / ${kind}: listed, but the matrix has no ✓ there`);
    for (const s of Array.isArray(v) ? v : []) if (!suites.has(s)) problems.push(`${feature} / ${kind}: no suite "${s}" in e2e/run.py`);
  }
}

const cellsTotal = [...supported.values()].reduce((n, k) => n + k.length, 0);
const untested = Object.values(coverage).flatMap((k) => Object.values(k)).filter((v) => typeof v === 'string').length;
if (problems.length) {
  console.error(`e2e coverage of the cross-kind matrix:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`e2e coverage: ${cellsTotal} supported cells, ${cellsTotal - untested} checked by a suite, ${untested} not yet (each with its reason)`);
