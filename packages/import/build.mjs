import * as esbuild from 'esbuild';

// The extractor runs inside the page being imported (a sandboxed frame in the
// editor, a headless browser in the CLI), so it ships as one IIFE that sets
// `window.dcExtract`.
await esbuild.build({
  entryPoints: { extract: 'src/extract-entry.ts' },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: false,
  logLevel: 'info',
});
