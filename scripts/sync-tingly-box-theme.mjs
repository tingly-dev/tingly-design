#!/usr/bin/env node
// Copy Tingly Box's theme palettes and font stacks into apps/editor/src/tingly-box/,
// unchanged apart from where the type comes from, so the editor's presets are
// Tingly Box's own values (apps/editor/src/theme.ts maps them to tokens).
//
//   node scripts/sync-tingly-box-theme.mjs ../tingly-box
//
// Then run pnpm typecheck and e2e/theme.py, and commit the copy with the
// Tingly Box commit it came from (printed below, and kept in SOURCE.json).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const box = resolve(process.argv[2] ?? process.env.TINGLY_BOX_DIR ?? '../tingly-box');
const from = join(box, 'frontend/packages/ui/src/theme');
const to = resolve(import.meta.dirname, '../apps/editor/src/tingly-box');
const FILES = ['fonts.ts', 'palettes/light.ts', 'palettes/dark.ts', 'palettes/claude.ts', 'palettes/ds.ts', 'palettes/sunlit.ts'];

let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: box, encoding: 'utf8' }).trim();
} catch {
  // not a git checkout: the copy is still fine
}

mkdirSync(join(to, 'palettes'), { recursive: true });
for (const f of FILES) {
  const src = readFileSync(join(from, f), 'utf8');
  const header = `// Copied from tingly-box frontend/packages/ui/src/theme/${f} (${commit}) by scripts/sync-tingly-box-theme.mjs. Do not edit here.\n`;
  writeFileSync(join(to, f), header + src);
}
writeFileSync(join(to, 'SOURCE.json'), JSON.stringify({ repo: 'tingly-dev/tingly-box', path: 'frontend/packages/ui/src/theme', commit, files: FILES }, null, 2) + '\n');
console.log(`copied ${FILES.length} files from tingly-box ${commit} into ${to}`);
