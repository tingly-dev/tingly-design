import * as esbuild from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
const watch = process.argv.includes('--watch');

// the script every <x-embed>'s page carries to answer "a picture of yourself" (@dc/export frameSnap):
// built first, then written into embed.html and handed to the player as __DC_SNAP__
const snap = (
  await esbuild.build({ entryPoints: ['src/snapEntry.ts'], bundle: true, format: 'iife', target: 'es2020', minify: true, write: false, logLevel: 'warning' })
).outputFiles[0].text.trim();
const snapJs = snap.replace(/<\/(script)/gi, '<\\/$1');
writeFileSync('dist/embed.html', readFileSync('embed.html', 'utf8').replace('"__DC_SNAP__"', () => JSON.stringify(snapJs).replace(/</g, '\\u003c')));

const ctx = await esbuild.context({
  entryPoints: { runtime: 'src/runtime.tsx', executor: 'src/executor.ts', dash: 'src/dash.ts', motion: 'src/motion.ts', export: 'src/motionExport.ts' },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production'), __DC_SNAP__: JSON.stringify(snap) },
  logLevel: 'info',
});
if (watch) await ctx.watch();
else {
  await ctx.rebuild();
  await ctx.dispose();
}
