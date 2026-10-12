/**
 * @dc/import: outside material → tingly-design projects that edit both ways.
 *
 *   extract.ts   reads a page a browser has laid out (DOM only, runs in the page's window)
 *   generate.ts  extracted page → canvas.json + .dc.html artboards (pure)
 *   pack.ts      uploaded files → one offline page to lay out (pure)
 *   cli.ts       the same pipeline from a terminal, in headless Chromium, with a fidelity check
 *
 * The extractor is exported separately (`@dc/import/extract`) because it is
 * the only part that needs a live DOM.
 */
export * from './model';
export * from './generate';
export * from './pack';
