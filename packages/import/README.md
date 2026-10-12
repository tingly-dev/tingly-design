# @dc/import

Turns an existing HTML page into a tingly-design canvas project: every element
becomes an element on an artboard, with the style its author gave it written
inline, so the result is editable both by hand in the editor and by AI.

It is deterministic (no model calls) and self-contained: the rest of the repo
depends on it only through `toCanvas`, `packPage` and `extractPage`.

## Pieces

| file | runs in | does |
| --- | --- | --- |
| `src/extract.ts` | a browser window that has laid the page out | reads the DOM back as `Extracted`: per element, only the properties the author declared (ranked by the cascade, `var()` resolved, UA defaults dropped), `::before`/`::after` as real spans, plus a report of what could not come along |
| `src/generate.ts` | anywhere | `Extracted` → project files (`*.dc.html`, `canvas.json`), splitting long pages into one artboard per section and leaving a sticky note with the report |
| `src/pack.ts` | anywhere | uploaded files → one self-contained page (stylesheets inlined, assets as data urls) for an offline layout |
| `src/cli.ts` | Node + Chromium | `dc-import` |

The editor uses `packPage` → `extractPage` (in a script-less frame) → `toCanvas`
for the launcher's 导入 HTML. The CLI loads the page in headless Chromium
instead, so pages that need JavaScript to render also import.

## CLI

```bash
pnpm dc-import html ./site/index.html            # → projects/<slug>
pnpm dc-import html https://example.com --check  # import, then pixel-diff against the original
pnpm dc-import check projects/site --against ./site/index.html
```

Options: `--name`, `--title`, `--width 1280`, `--split auto|on|off`,
`--projects <dir>`, `--force`, `--out <dir>` (diff images), `--json`.
`check` renders each artboard through the real sandbox runtime
(`pnpm --filter @dc/sandbox build` first) and reports the share of pixels
that differ from the original page.

## What does not come along

Scripts (the import is the rendered, static state), `:hover`/`:focus` rules,
`@media` rules for other widths, `display:none` elements, iframes/video, and
stylesheets the browser cannot read (cross-origin without CORS). Each one is
counted in the report and on the sticky note.

## Tests

`pnpm --filter @dc/import test` covers the pure parts. Fidelity on real pages
is measured with `dc-import html … --check`; see
`.design/import-external-material.md` for the numbers.
