/**
 * @dc/import: outside material → tingly-design projects that edit both ways.
 *
 * Three layers, so a new source never touches the others:
 *
 *   sources/*    read one kind of material into the page model (model.ts)
 *     html/      extract.ts reads a page a browser has laid out (needs its window)
 *     pack.ts    uploaded files → one self-contained page (pure)
 *   model.ts     the page model every source produces, plain JSON
 *   generate.ts  page model → canvas.json + .dc.html artboards (pure)
 *   assets.ts    embedded data: files → project assets (pure)
 *   cli.ts       the same pipeline from a terminal, in headless Chromium, with a fidelity check
 *
 * The HTML extractor is exported separately (`@dc/import/extract`) because it
 * reads the cascade of a live window.
 */
export * from './model';
export * from './generate';
export * from './assets';
export * from './sources/pack';
