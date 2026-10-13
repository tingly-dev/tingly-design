#!/usr/bin/env node
// Bundles src/cli.ts (and the workspace's TypeScript it imports) on the fly, then runs it.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(pkg, 'node_modules', '.cache', 'dc-import', 'cli.mjs');
mkdirSync(dirname(out), { recursive: true });
await build({
  entryPoints: [join(pkg, 'src/cli.ts')],
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['esbuild', 'playwright-core', 'pngjs', 'pixelmatch'],
  // keep `here` pointing at src/, where cli.ts finds extract-entry.ts and the repository
  define: { 'import.meta.url': JSON.stringify(pathToFileURL(join(pkg, 'src/cli.ts')).href) },
  logLevel: 'warning',
});
const { main } = await import(pathToFileURL(out).href);
await main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
