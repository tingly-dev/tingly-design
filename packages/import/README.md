# @dc/import

Turns outside material (an HTML page, an SVG drawing) into a tingly-design
canvas project whose elements are editable both by hand in the editor and by
AI.

It is deterministic (no model calls) and self-contained: the rest of the repo
depends on it only through the functions below.

## Layers

```
sources/<kind>  ──►  page model (model.ts)  ──►  generate.ts  ──►  canvas.json + *.dc.html
```

A source only has to produce the page model; the generator, the report, the
asset handling and the fidelity check are shared. Adding a source (Figma, HTML
slides…) means adding a folder under `src/sources/`, nothing else.

| file | runs in | does |
| --- | --- | --- |
| `src/sources/html/extract.ts` | a browser window that has laid the page out | reads the DOM back as the page model: per element, only the properties the author declared (ranked by the cascade, `var()` resolved, UA defaults dropped), `::before`/`::after` as real spans, plus a report of what could not come along |
| `src/sources/svg/read.ts` | any DOM (`DOMParser`) | reads an SVG onto one artboard as inline SVG: text stays `<text>`, paint stays attributes; scripts, `<foreignObject>` and editor namespaces (Inkscape…) are dropped and counted; outlined text and embedded bitmaps are noted |
| `src/sources/pack.ts` | anywhere | uploaded files → one self-contained page or drawing (stylesheets inlined, local files as data urls) |
| `src/model.ts` | — | the page model, plain JSON |
| `src/generate.ts` | anywhere | page model → project files, splitting long pages into one artboard per section and leaving a sticky note with the report |
| `src/assets.ts` | anywhere | big embedded `data:` files (Figma's SVGs embed screenshots) → project assets |
| `src/cli.ts` | Node + Chromium | `dc-import` |

The editor's 导入 HTML 或 SVG (launcher tile, drop, or ⌘V of SVG markup)
uses `packPage` → `extractPage` (in a script-less frame) or `readSvg` →
`toCanvas`. The CLI loads pages in headless Chromium instead, so pages that
need JavaScript to render also import.

## CLI

```bash
pnpm dc-import html ./site/index.html            # → projects/<slug>
pnpm dc-import html https://example.com --check  # import, then pixel-diff against the original
pnpm dc-import svg ./drawing.svg --check           # one artboard; diffed against the SVG as an image
pnpm dc-import check projects/site --against ./site/index.html
```

Options: `--name`, `--title`, `--width 1280`, `--split auto|on|off`,
`--projects <dir>`, `--force`, `--out <dir>` (diff images), `--json`.
`check` renders each artboard through the real sandbox runtime
(`pnpm --filter @dc/sandbox build` first) and reports the share of pixels
that differ from the original page.

## What does not come along

From SVG: scripts, `<foreignObject>`, editor-private metadata. Text a design
tool outlined into paths stays paths (Figma: untick "Outline text" when
exporting), and embedded bitmaps stay pictures.

From HTML: scripts (the import is the rendered, static state), `:hover`/`:focus` rules,
`@media` rules for other widths, `display:none` elements, iframes/video, and
stylesheets the browser cannot read (cross-origin without CORS). Each one is
counted in the report and on the sticky note.

## Tests

`pnpm --filter @dc/import test` covers the pure parts. Fidelity on real pages
is measured with `dc-import html … --check`; see
`.design/import-external-material.md` for the numbers.
