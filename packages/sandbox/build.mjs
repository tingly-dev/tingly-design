import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
copyFileSync('embed.html', 'dist/embed.html');

const watch = process.argv.includes('--watch');
const ctx = await esbuild.context({
  entryPoints: { runtime: 'src/runtime.tsx', executor: 'src/executor.ts', dash: 'src/dash.ts', motion: 'src/motion.ts', export: 'src/motionExport.ts' },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  logLevel: 'info',
});
if (watch) await ctx.watch();
else {
  await ctx.rebuild();
  await ctx.dispose();
}
