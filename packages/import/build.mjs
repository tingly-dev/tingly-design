import * as esbuild from 'esbuild';

// What needs a live DOM (the HTML extractor) ships as one IIFE a page can
// load: it sets `window.dcExtract`.
await esbuild.build({
  entryPoints: { browser: 'src/browser-entry.ts' },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: false,
  logLevel: 'info',
});
