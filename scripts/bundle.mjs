#!/usr/bin/env node
// Build the folder a host ships and runs: dist/tingly-design/
//
//   server.mjs           the server with every dependency bundled in: `node server.mjs`
//   tingly-design.json   name, version, protocol, entry and the Node it needs
//   editor/  sandbox/    the built editor and the artboard runtime
//   samples/             the sample projects, copied into a projects folder that does not exist yet
//   scripts/  .claude/   what Claude Code reads and runs when work is handed to it
//
// Usage: pnpm bundle   (builds the editor and sandbox first). See docs/en/embedding.md.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as esbuild from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'dist', 'tingly-design');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const protocol = Number(/export const PROTOCOL = (\d+);/.exec(readFileSync(join(root, 'apps/server/src/layout.ts'), 'utf8'))?.[1]);
if (!protocol) throw new Error('PROTOCOL not found in apps/server/src/layout.ts');

if (!process.argv.includes('--no-build')) execFileSync('pnpm', ['build'], { cwd: root, stdio: 'inherit' });
for (const need of ['apps/editor/dist/index.html', 'packages/sandbox/dist/runtime.js']) {
  if (!existsSync(join(root, need))) throw new Error(`${need} is missing: run pnpm build first`);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await esbuild.build({
  entryPoints: [join(root, 'apps/server/src/index.ts')],
  outfile: join(out, 'server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  legalComments: 'none',
  // CommonJS dependencies call require(); give the ES module one
  banner: { js: "import { createRequire as __dcRequire } from 'node:module'; const require = __dcRequire(import.meta.url);" },
  // chokidar's optional macOS watcher is native; it falls back without it
  external: ['fsevents'],
  logLevel: 'warning',
});

const copy = (from, to, filter) => cpSync(join(root, from), join(out, to), { recursive: true, filter });
copy('apps/editor/dist', 'editor');
copy('packages/sandbox/dist', 'sandbox');
copy('projects', 'samples', (src) => !/[/\\]\.(journal\.jsonl|runs\.json)$/.test(src) && !/[/\\]renders([/\\]|$)/.test(src));
// issue-resolve is a maintainer workflow, not a format reference a host's Claude Code needs
copy('.claude/skills', '.claude/skills', (src) => !/[/\\]issue-resolve([/\\]|$)/.test(src));
copy('scripts/dash-query.mjs', 'scripts/dash-query.mjs');

writeFileSync(
  join(out, 'tingly-design.json'),
  JSON.stringify({ name: 'tingly-design', version: pkg.version, protocol, entry: 'server.mjs', node: pkg.engines?.node ?? '>=20.11' }, null, 2) + '\n',
);
// so `node server.mjs` reads it as an ES module whatever folder it lands in
writeFileSync(join(out, 'package.json'), JSON.stringify({ name: 'tingly-design-bundle', private: true, type: 'module' }, null, 2) + '\n');

console.log(`bundled tingly-design ${pkg.version} (protocol ${protocol}) into ${out}`);
