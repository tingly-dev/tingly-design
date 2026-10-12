<p align="right"><b>English</b> · <a href="README.zh-CN.md">简体中文</a></p>

# Tingly Design

**An open-source design tool where people and AI edit the same files.**

Canvases, slide decks, design systems, dashboards and documents are plain files under `projects/`. You click, drag and retype on screen; a fast model rewrites what you point at in a few seconds, line by line; Claude Code edits the files directly. All three work on the same source, and every edit writes back only the characters that changed, so the files stay reviewable in git and pleasant to write by hand.

![Canvas: four artboards of the Meridian product UI, with the layers and properties panel on the right](docs/images/canvas.png)

- **One source, three editors.** Direct manipulation (instant), fast AI (seconds; jQuery statements that run as they stream in) and Claude Code (minutes; whole files, several at once). Every open editor sees every change live, and all of them write to one shared change log.
- **Minimal write-back.** Template holes like `{{price}}`, loops and your own formatting survive every edit. Tick a checkbox or change a colour, and the git diff is one line.
- **Five project kinds.** The file formats follow Claude's Design, Slides, Design System, Dashboard and Docs artifact types; Tingly Design is an open-source re-creation of their two-way editing.
- **Numbers you can check.** Every figure on a dashboard names the cell it comes from, and anything that disagrees with its data is reported.

> The editor's interface is currently in Simplified Chinese. The sample projects, file formats and this guide are in English.

## Contents

- [Sample workspace](#sample-workspace)
- [Quick start](#quick-start)
- [Guide](#guide)
  - [Canvas](#canvas)
  - [Slides](#slides)
  - [Design system](#design-system)
  - [Dashboard](#dashboard)
  - [Docs](#docs)
- [How it works](#how-it-works)
- [Repository layout](#repository-layout)
- [Development and tests](#development-and-tests)
- [Compared with the original](#compared-with-the-original)

## Sample workspace

The five sample projects belong to one fictional company, **Meridian**, a revenue analytics product for finance and RevOps teams, and they quote the same numbers: the Q3 revenue the dashboard computes is the one on the board deck, and the deck's colours and type sizes are tokens of the design system. Every company, person and figure in them is sample data.

| Kind | Sample | What it shows | Files |
|---|---|---|---|
| **Canvas** | [`?p=product-ui`](http://localhost:5173/?p=product-ui) | A product UI review: revenue overview, workspace settings, an interactive pricing page and a data-flow diagram | `canvas.json` + one `.dc.html` per artboard |
| **Slides** | [`?p=q3-review`](http://localhost:5173/?p=q3-review) | An eight-slide quarterly board review; the ARR slide carries a live chart | `deck.json` + `slides/<id>.html` |
| **Design system** | [`?p=meridian-ds`](http://localhost:5173/?p=meridian-ds) | Light and dark themes, two typefaces, a six-step type scale, four components and the brand marks | `design-system.json` + `tokens.json` + `components/` |
| **Dashboard** | [`?p=revenue-dash`](http://localhost:5173/?p=revenue-dash) | Q3 revenue: two live SQLite queries, a CSV, a JSON file and a region filter | `dash.json` + `datasets/` + `files/index.html` + `data/` |
| **Docs** | [`?p=launch-plan`](http://localhost:5173/?p=launch-plan) | The launch plan for Meridian Forecast: four tabs, a milestone table, a launch checklist and comments | `doc.json` + `tabs/<id>.md` + `comments.json` |

<table>
  <tr>
    <td width="50%"><a href="docs/images/slides.png"><img src="docs/images/slides.png" alt="Slide editor"></a></td>
    <td width="50%"><a href="docs/images/dashboard.png"><img src="docs/images/dashboard.png" alt="Dashboard in data mode"></a></td>
  </tr>
  <tr>
    <td align="center">Slides: thumbnails and sections, the stage, speaker notes</td>
    <td align="center">Dashboard: click a number to open its source</td>
  </tr>
  <tr>
    <td width="50%"><a href="docs/images/design-system.png"><img src="docs/images/design-system.png" alt="Design system overview"></a></td>
    <td width="50%"><a href="docs/images/docs.png"><img src="docs/images/docs.png" alt="Document editor"></a></td>
  </tr>
  <tr>
    <td align="center">Design system: the cover and the brand book</td>
    <td align="center">Docs: the format and AI rewrite menu, comments</td>
  </tr>
</table>

A design system can be installed into a canvas or a deck; after that, colour fields and the text-style menu offer its tokens.

## Quick start

```bash
pnpm install
pnpm dev            # editor at http://localhost:5173, server on :8787
```

Open http://localhost:5173 to pick a project, or go straight to http://localhost:5173/?p=product-ui for the sample canvas. For a production-style run, `pnpm start` builds the editor and serves it together with the API on port 8787.

### Configuration

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Turns on fast AI (the server calls the model through the Anthropic SDK). `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` work too. |
| `DC_FAST_MODEL` | The fast AI model; defaults to `claude-haiku-5-5`. |
| `DC_DELEGATE_MODEL` | The model for "hand to Claude Code" (the CLI's default when unset). |
| `DC_PROJECTS` | The projects folder; defaults to `projects/` in this repository. |
| `PORT` | The server port; defaults to 8787. |

- No API key is needed to start: jQuery mode lets you type statements yourself, through exactly the same execution and write-back path fast AI uses.
- "Hand to Claude Code" needs the `claude` command on this machine.

## Guide

### Canvas

The top left holds the page menu and the tools; the top right holds play, the panel toggle, zoom and the sync log; the bottom bar is the prompt for AI; the right panel folds away with `⌘\`.

- **Tools**: select V, hand H, text T, artboard A, sticky note N, pen P, rectangle R, ellipse O, line L, arrow ⇧L. Notes and shapes live in `canvas.json`, with size (s/m/l/xl/xxl), colour, fill, rotation and flips.
- **Artboards**: rename, run full window or export PNG from the name strip; resize from the corner; several pages, each with its own artboards.
- **Right panel**: the layer tree, named by role (row, column, grid, text, image…, with loops marked); properties (text style, hug/fixed/fill sizing, direction and gap, fill, stroke, radius, shadow, opacity); code (the element's own declarations are editable, inherited values listed read-only); Tweaks (edits the `data-props` defaults).
- **Direct manipulation**: drag a selected element to reorder it among its siblings; drag it out of its parent to position it freely (the parent becomes `position:relative` and keeps its height); resize from the handles; double-click to retype; right-click for the context menu.
- **Play mode**: artboards run their own logic, and links between artboards navigate.

<details>
<summary><b>Shortcuts</b></summary>

| Keys | Action |
|---|---|
| Esc | Close a menu → leave play mode → back to the select tool → clear the selection |
| ⇧↵ / ↵ | Select the parent / the first child |
| ⌫ | Delete |
| ⌘C ⌘X ⌘V ⌘D | Copy, cut, paste, duplicate |
| ⌘G / ⌘⇧G / ⇧A | Group / ungroup / wrap in a flex container |
| [ ] | Bring to front / send to back |
| ⇧H ⇧V | Flip horizontally / vertically |
| ⌘Z ⌘⇧Z | Undo / redo |
| ⌘= ⌘- ⌘0 ⇧1 ⇧2 | Zoom in, zoom out, 100%, fit all, zoom to selection |

</details>

Format reference: [`.claude/skills/dc-canvas/SKILL.md`](.claude/skills/dc-canvas/SKILL.md)

### Slides

Choose "幻灯片" (slides) when creating a project. The sample [`?p=q3-review`](http://localhost:5173/?p=q3-review) is a quarterly board review; the ARR slide carries a live `<x-embed>` chart.

![Slide editor: thumbnails and sections on the left, the stage and speaker notes in the middle, layers and properties on the right](docs/images/slides.png)

```
projects/<name>/
  deck.json            title, slide order, sections, typefaces
  slides/<id>.html     one file per slide: exactly one <section id="<id>">, 1920×1080, a closed HTML/CSS subset
  assets/              uploaded images and fonts
```

- **Thumbnail strip**: grouped by section (double-click a section to edit its description); drag to reorder; right-click to add, duplicate, skip, start a section or delete. Live embeds stay still in thumbnails.
- **Stage**: the current slide, scaled to fit. Selection, double-click to retype, drag to reorder or pin, and the layers / properties / code panel all work as on the canvas, through the same minimal write-back. Speaker notes sit below the stage (written to `<aside>`).
- **Insert**: text, images (uploaded to `assets/`), tables, shapes (rectangle, rounded, ellipse, diamond, four arrows, line), connectors and icons.
- **Format check**: every slide is checked against the subset of the original `format.md` (unknown tags, `margin`, `z-index`, `em`, `var()`, an unpinned `<x-embed>`…). Counts show above the stage and on thumbnails, and clicking an issue selects the element. If a fast AI edit introduces a new violation, it is undone and the model is told why and asked again.
- **Present**: F5 from the start, ⇧F5 from the current slide; → / Space / click plays the slide's builds (`data-build-in`) and then advances; `fade` and `push` transitions (`magic` falls back to fade); N toggles speaker notes; F for full screen; Esc to leave.
- **Download**: a single HTML file (images inlined, embeds sandboxed and running, arrow keys to page), print to PDF, or the speaker notes as text.

Rendering follows the original's rules: a `<div>` with no `display` is a flex column; children paint in source order, with all flow content painted as one layer where the first flow child sits (so a full-bleed backdrop written first stays behind the text); `<x-embed>` runs in its own sandboxed page with no network and a different origin.

Format reference: [`.claude/skills/slides/SKILL.md`](.claude/skills/slides/SKILL.md)

### Design system

The sample [`?p=meridian-ds`](http://localhost:5173/?p=meridian-ds) is Meridian's design system: the colours (light and dark), typefaces, type sizes, spacing and components the product UI and the board deck share.

| Overview: cover and brand book | Colours: usage and contrast |
|---|---|
| ![Design system overview](docs/images/design-system.png) | ![Design system colours](docs/images/design-system-colors.png) |

```
projects/<name>/
  design-system.json      the index: title, namespace, asset groups
  tokens.json             colours (per theme), type, spacing, radius, shadow…, each a list of {name, value, usage}
  tokens.css              generated from tokens.json (rebuilt whenever the editor, Claude Code or a terminal changes it)
  README.md, *.md         the brand book
  components/<C>/         README.md (guidelines) and preview.html (a live preview); Cover is the cover
  components/bundle.js    the components, assigned to window.<namespace>; bundle.css, index.d.ts
  assets/<group>/, fonts/ logos, icons, images and font files
```

- **Pages**: overview (cover and brand book, with the Markdown editable in place), colours (switch themes; a usage note that says "on surface" shows the contrast on that surface; aliases show what they point to), type (each style rendered in its own face and size), spacing, radius and shadow, components (each preview loads tokens.css, bundle.css and bundle.js in a sandbox), and assets (upload, download and delete per group).
- **Edit tokens in place**: open a row to change its value, rename it (aliases follow), write its usage, add or remove it. The edit is saved as data in tokens.json, and tokens.css is rebuilt with only the lines that changed.
- **Checks**: anything in tokens.json outside the original grammar (colour names, `var()`, missing or circular aliases, DTCG maps…) is dropped and listed under 问题 (issues) with the reason.
- **Install into a canvas or deck**: in that project's panel, with nothing selected, pick the system under 设计系统 and install it. tokens.json is copied to `ds/<folder>/` in that project and recorded in its `designSystems`; from then on every colour field has a ◆ to pick its colours and shows which token the current value is, and the text-style menu lists its styles. A deck also gets the system's typefaces. Slides store the colour value itself, since the subset has no `var()`.
- **Hosted fonts**: `type.hosted: [{family, href}]` in tokens.json is an extension of this repository (the original only reads font files) that loads Google Fonts css2 links, in previews and in decks that install the system.
- **AI**: like the original, the design system page has no in-page model; changes go to Claude Code.

Format reference: [`.claude/skills/design-system/SKILL.md`](.claude/skills/design-system/SKILL.md)

### Dashboard

The sample [`?p=revenue-dash`](http://localhost:5173/?p=revenue-dash) is Meridian's Q3 revenue (generated sample data): two live SQLite queries, a CSV and a JSON file, four calculations and a region filter.

![Dashboard in data mode: a table cell clicked, its source open on the right](docs/images/dashboard.png)

```
projects/<name>/
  dash.json               the title and filter defaults
  datasets/<id>.json      where each dataset comes from: a file under data/, or a live query (connector + arguments)
  files/index.html        the page: plain HTML, CSS and script, reading data through the dash API and drawing with d3
  data/                   CSV, TSV and JSON files and SQLite databases
  .runs.json              what the open page reported: datasets that failed, code that threw, numbers that disagree with their data (not in git)
```

- **Data**: file datasets are read directly; query datasets run through a server connector (today `sqlite`, which opens databases under `data/` read-only; see `apps/server/src/connectors.ts` to add others). SQL follows the original's rules: one SELECT or WITH statement, no writing keywords, and each `{{name}}` filter bound as a single literal.
- **Page**: runs in a `sandbox="allow-scripts"` iframe with no network. `dash.data / onData / calc / loader / params / setParams / setLink / colors / refresh` match the original, plus light and dark theme tokens.
- **Checked marks**: every number marked with `data-source` / `data-field` / `data-where` is compared with the cell it points to (understanding thousands separators, K/M/B and 万/亿, percentages and the precision shown), and tables are checked row by row through `data-row-key`. Disagreements are listed under 数据来源 → 问题 (sources → issues) and written to `.runs.json` for Claude Code. Loading, refreshing, failed and empty states are stamped on the elements, so the page can style them.
- **Sources panel**: each dataset's state, row count, update time and whether anything uses it; open one for its description, its query (with `{{params}}` shown at their current values), the result table and the formulas of calculations; edit a query, test it and save it, download CSV, pause a query (its rows are kept as `data/<id>.json`) and resume it.
- **Data mode**: click any number, chart or table cell on the page to open its source with that cell highlighted.
- **Code**: the page and the dataset descriptions are editable in the editor too (the original lets only Claude write them); the page reloads on save.
- **AI**: hand it to Claude Code. It can query the databases read-only with `node scripts/dash-query.mjs`, and reads `.runs.json` first.

Format reference: [`.claude/skills/dashboard/SKILL.md`](.claude/skills/dashboard/SKILL.md)

### Docs

The sample [`?p=launch-plan`](http://localhost:5173/?p=launch-plan) is the launch plan for Meridian Forecast: four tabs (one nested), a milestone table, a launch checklist, a quote and two comment threads.

![Docs: the format and AI rewrite menu on a selection, comments on the right](docs/images/docs.png)

```
projects/<name>/
  doc.json          the title, tabs (order and nesting) and layout settings
  tabs/<id>.md      one Markdown file per tab (GFM: tables, task lists)
  comments.json     comment threads, anchored to the words they quote
  assets/           uploaded images
```

- **Rich text**: a TipTap editor with a toolbar, a menu on selected text, and `/` on an empty line to insert headings, lists, tasks, quotes, code, tables, dividers, images and dates; tabs on the left (add, nest, rename, reorder, delete) and the outline.
- **Block-level write-back**: the editor produces the tab's Markdown, and `mergeBlocks` in `packages/core/src/docs.ts` merges it back into the file: blocks whose meaning did not change are kept byte for byte, and inside a changed block the unchanged lines (list items, table rows) are kept too. Tick a task or edit a cell and the git diff is one line. If someone else (or Claude Code) changed the file meanwhile, your edits are replayed block by block; outside changes appear in the open tab live, without losing your cursor.
- **Comments**: select text and comment; a thread is anchored to the quoted words (plus context) and highlighted while they exist; reply, resolve, delete, or hand the thread to Claude, which reads it, edits the document accordingly and replies in the thread.
- **AI rewrite**: on a selection, "shorter", "polish", "more formal" or your own instruction; the model streams a new passage that replaces the selection or goes below it (needs `ANTHROPIC_API_KEY`). Whole-document work goes to Claude Code.
- **Layout and export**: heading and body typefaces (serif or sans), page width; export the current tab or the whole document as Markdown or HTML, or print to PDF.

Format reference: [`.claude/skills/docs/SKILL.md`](.claude/skills/docs/SKILL.md)

## How it works

```
            ┌──────── single source of truth: the files under projects/<name>/ (each with a version) ────────┐
            │                                                                                                │
  Direct edits (seconds)     Fast AI (seconds)                       Claude Code (minutes)      Terminal / git
  DOM ops → write-back       jQuery on a sandboxed copy → write-back  edits files                edits files
            │                         └── askClaude() delegates ──→         │                          │
            └──────────── shared journal: who changed what, when ←── file watcher ─────────────────────┘
```

### 1. A constrained source file

A `.dc.html` file is a self-contained HTML page: the template inside `<x-dc>` (`{{path}}`, `<sc-for>`, `<sc-if>`, `<dc-import>`) and a `class Component extends DCLogic` in `<script data-dc-script>`. By convention, visual properties are inline `style`, copy is literal text, and layout is flex or grid with `gap`. These constraints give every on-screen operation one definite place in the source. Slides work the same way with a stricter HTML/CSS subset.

### 2. One write-back engine (`packages/core/src/copy.ts`)

Every editor works on the same thing: parse5 parses the template with source locations, and a DOM copy is built in which each element remembers the span of source it came from and carries a temporary handle id (`#dc12`, numbered depth-first, never written to disk).

When an edit finishes, the copy is compared with the original syntax tree to produce a **minimal text patch**:

- only an attribute changed: replace that one attribute;
- only text changed: replace that text;
- children were added, removed or reordered: rewrite the parent's inside, copying untouched children from the original text instead of re-serializing them;
- styles are edited as text rather than through the CSSOM, so a declaration with a hole such as `background:{{r.bg}}` is never lost.

Human operations (`applyHumanOps`), fast AI jQuery (`FastEditSession`) and replays after a conflict all go through this one engine.

### 3. Fast AI writes edit operations, not new files

The model's context is, in order: an overview of the canvas, the artboard you are looking at, the target artboard's markup with handles, the journal, the element you are pointing at, and your words. Its reply can only be jQuery statements, one per line:

```js
$('#dc12').css('color', '#7c3aed')
$('#dc12').after(`<ul style="margin: 0; padding-left: 18px"></ul>`)
$('#dc12').next().append(`<li style="font-size: 14px"></li>`)
$('#dc12').next().children().first().repeat(3)
.text((i) => ['Plan', 'Build', 'Ship'][i])
```

- **Streaming execution**: each line runs in the sandbox as soon as it is complete, and the artboard shows the draft (dashed outline) right away.
- **Retry on error**: if any line throws, the whole reply is undone and the model is told the error and asked again, up to two retries.
- **Tools**: `log(x)` lets the model inspect an element's current state first; `askClaude()` hands the request to Claude Code unchanged.
- **Save**: the result is saved as an ordinary edit; if the file changed meanwhile, the statements are replayed on the new version.

### 4. Collaboration: versions, replay and a journal

- Each file's version is a hash of its content. A save names the version it was based on; if that no longer matches, the server answers 409 with the current content.
- Every edit in the editor is queued as a function from source to new source and shown optimistically; on a 409 the function runs again on the new version and saves. Two people editing the same file at once both keep their changes.
- Undo locates your own change by its context, so you can undo it even after someone else changed other parts of the same file.
- The journal records every editor's changes (direct, jQuery, fast AI, Claude, outside, undo), pushes them live to every open editor, and is part of fast AI's context, so "one more" or "a bit less" is understood.

### 5. Sandboxing

Artboards and AI code run in `sandbox="allow-scripts"` iframes (a different origin, with no access to the editor's cookies or storage), and a CSP blocks network requests (artboards may load only Google Fonts and images). The editor talks to them only through `postMessage`; the protocol is defined in `packages/core/src/protocol.ts`.

## Repository layout

```
packages/core       format parsing, the DOM copy, minimal write-back, human operations, the jQuery session, statement splitting, prompts;
                    deck.json, the slide subset check, shapes/icons/connectors; design-system tokens grammar and tokens.css;
                    dashboard datasets, CSV parsing, SQL checks and parameter binding, mark checking; docs block merge and replay, comment anchoring
packages/sandbox    the artboard runtime (template → React, selection, in-place text), the dashboard runtime (dash API + d3) and the AI executor, bundled as IIFEs with esbuild
apps/server         Hono: file reads and writes with versions, SSE, journal, file watching, fast AI streaming proxy, delegation to the claude CLI, git commits, dashboard connectors
apps/editor         React + Vite + zustand editors for canvas, slides (components/slides), design systems (components/ds), dashboards (components/dash) and docs (components/docs)
projects/           sample projects: product-ui (canvas), q3-review (slides), meridian-ds (design system), revenue-dash (dashboard), launch-plan (docs)
scripts/            dash-query.mjs: read-only queries against a dashboard's SQLite databases (for Claude Code)
.claude/skills/     format references for Claude Code: dc-canvas, slides, design-system, dashboard, docs (read before every delegated task)
artifact/           reference material for the original five types (Design, Slides, Dashboard, Docs, Design System), private
docs/               the plan for the other kinds; docs/images/ holds the README screenshots
e2e/                Playwright end-to-end tests and a mock Messages API
```

## Development and tests

```bash
pnpm test           # core unit tests: parsing, write-back, the jQuery session, statement splitting, undo relocation, slides, design systems, dashboards, docs
pnpm typecheck
```

The end-to-end tests need `pnpm dev` running and Python Playwright (`pip install playwright`). Set `DC_CHROME=/path/to/chrome` to use another browser; in a headless environment use Playwright's `chromium_headless_shell`, because full Chromium in headless mode misplaces clicks inside a zoomed artboard.

| Command | Covers |
|---|---|
| `python3 e2e/e2e.py` | Canvas: panel, layers, styles, retyping, structure operations, clipboard, drag and drag-out, canvas tools, pages, export, concurrent editors, undo, play mode (40 checks) |
| `python3 e2e/slides.py` | Slides: thumbnails and sections, retyping, delete and undo, dragging pinned elements, notes, add/duplicate/reorder/delete, format check, jQuery, presenting, export (20 checks) |
| `python3 e2e/ds.py` | Design systems: cover and brand book, editing/renaming colours with aliases, adding and removing, type and radius, component previews, asset upload, outside edits that break the grammar, a new system, installing into a deck and picking tokens and text styles, removal (22 checks) |
| `python3 e2e/dash.py` | Dashboards: query/CSV/JSON loading, mark checking, filters and row-click filters, data mode, editing a query (writes refused), pausing and resuming, outside edits to data and page, failed states, `.runs.json`, the code panel, a new dashboard (24 checks) |
| `python3 e2e/docs.py` | Docs: tabs and outline, reading writes nothing, typing / ticking / editing a cell each change one line, the `/` menu, the format menu, live outside edits that are kept, comments (reply/resolve/new), tab management, layout, AI rewrite (with the mock model), HTML export, a new doc (25 checks) |
| `python3 e2e/fast.py` | Fast AI: streaming execution, undo on error, retry, write-back |
| `python3 e2e/fast_slides.py` | Fast AI on a slide: retry on error, undo and explain when a reply leaves the slide subset |
| `python3 e2e/delegate.py` | Calls the local `claude` CLI for real |

The two fast AI tests use a mock model (its first reply deliberately contains a line that throws):

```bash
python3 e2e/mock_anthropic.py &
ANTHROPIC_API_KEY=x ANTHROPIC_BASE_URL=http://127.0.0.1:8790 pnpm dev
```

## Compared with the original

| | Done | Not yet |
|---|---|---|
| **Canvas** | The canvas shell (tools, pages, zoom, sync log), the right panel (layers/properties/code/Tweaks), selection and hierarchy navigation, in-place text, drag to reorder and drag out to free position, resizing, group/ungroup/flip/arrange, clipboard, notes, shapes, arrows and pen, multiple pages, artboard rename/resize/full window/PNG export, play mode with links between artboards, `<dc-import>` | Comments, multi-select, PDF export, fast AI edits to the canvas layout (`canvas.json`) |
| **Slides** | deck.json with one file per slide, the thumbnail strip with sections, drag to reorder, add/duplicate/skip/delete, inserting text/images/tables/shapes/connectors/icons, speaker notes, the subset check, presenting (builds, fade/push, notes, full screen), HTML/PDF/notes export | Magic move (falls back to fade), PPTX and Google Slides export, image cropping, editing merged table cells |
| **Design system** | Browsing and editing tokens in place, tokens.css generation, grammar checks, component previews, asset management, installing into canvases and decks | Mounting components on a canvas, an in-page model |
| **Dashboard** | File and SQLite query datasets, the dash API (calc, loader, filters, links), d3, mark checking and states, the sources panel (results, formulas, query editing, test runs, CSV, pause/resume), data mode, `.runs.json`, light and dark themes | MCP connectors (BigQuery and others) with per-reader permissions, query history, scheduled refresh, export to other tools |
| **Docs** | Tabs and nested tabs, rich text (toolbar, selection menu, `/` insert), block- and line-level write-back, concurrent replay, comments (anchoring, replies, resolve, hand to Claude), AI rewrite of a selection, layout settings, Markdown/HTML/PDF export | Word and Google Docs export, version compare and restore, proposals, live cursors, chart and diagram blocks, @mentions |
| **AI and collaboration** | Fast AI streaming/retries/logs/delegation, Claude Code delegation, conflict replay, the journal, undo and redo, git commits | Fast AI edits one artboard at a time; work across artboards goes to Claude Code |

The original's agent infrastructure (hosting, permissions, publishing) is out of scope.
