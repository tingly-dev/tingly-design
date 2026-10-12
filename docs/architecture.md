<p align="right"><b>English</b> · <a href="zh-CN/architecture.md">简体中文</a></p>

# How it works

```
            ┌──────── single source of truth: the files under projects/<name>/ (each with a version) ────────┐
            │                                                                                                │
  Direct edits (seconds)     Fast AI (seconds)                       Claude Code (minutes)      Terminal / git
  DOM ops → write-back       jQuery on a sandboxed copy → write-back  edits files                edits files
            │                         └── askClaude() delegates ──→         │                          │
            └──────────── shared journal: who changed what, when ←── file watcher ─────────────────────┘
```

## 1. A constrained source file

A `.dc.html` file is a self-contained HTML page: the template inside `<x-dc>` (`{{path}}`, `<sc-for>`, `<sc-if>`, `<dc-import>`) and a `class Component extends DCLogic` in `<script data-dc-script>`. By convention, visual properties are inline `style`, copy is literal text, and layout is flex or grid with `gap`. These constraints give every on-screen operation one definite place in the source. Slides work the same way with a stricter HTML/CSS subset.

## 2. One write-back engine (`packages/core/src/copy.ts`)

Every editor works on the same thing: parse5 parses the template with source locations, and a DOM copy is built in which each element remembers the span of source it came from and carries a temporary handle id (`#dc12`, numbered depth-first, never written to disk).

When an edit finishes, the copy is compared with the original syntax tree to produce a **minimal text patch**:

- only an attribute changed: replace that one attribute;
- only text changed: replace that text;
- children were added, removed or reordered: rewrite the parent's inside, copying untouched children from the original text instead of re-serializing them;
- styles are edited as text rather than through the CSSOM, so a declaration with a hole such as `background:{{r.bg}}` is never lost.

Human operations (`applyHumanOps`), fast AI jQuery (`FastEditSession`) and replays after a conflict all go through this one engine.

## 3. Fast AI writes edit operations, not new files

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

## 4. Collaboration: versions, replay and a journal

- Each file's version is a hash of its content. A save names the version it was based on; if that no longer matches, the server answers 409 with the current content.
- Every edit in the editor is queued as a function from source to new source and shown optimistically; on a 409 the function runs again on the new version and saves. Two people editing the same file at once both keep their changes.
- Undo locates your own change by its context, so you can undo it even after someone else changed other parts of the same file.
- The journal records every editor's changes (direct, jQuery, fast AI, Claude, outside, undo), pushes them live to every open editor, and is part of fast AI's context, so "one more" or "a bit less" is understood.

## 5. Sandboxing

Artboards and AI code run in `sandbox="allow-scripts"` iframes (a different origin, with no access to the editor's cookies or storage), and a CSP blocks network requests (artboards may load only Google Fonts and images). The editor talks to them only through `postMessage`; the protocol is defined in `packages/core/src/protocol.ts`.

## Repository layout

```
packages/core       format parsing, the DOM copy, minimal write-back, human operations, the jQuery session, statement splitting, prompts;
                    deck.json, the slide subset check, shapes/icons/connectors; design-system tokens grammar and tokens.css;
                    dashboard datasets, CSV parsing, SQL checks and parameter binding, mark checking; docs block merge and replay, comment anchoring
packages/sandbox    the artboard runtime (template → React, selection, in-place text), the dashboard runtime (dash API + d3) and the AI executor, bundled as IIFEs with esbuild
apps/server         Hono: file reads and writes with versions, SSE, journal, file watching, fast AI streaming proxy, delegation to the claude CLI, git commits, dashboard connectors
apps/editor         React + Vite + zustand editors for canvas, slides (components/slides), design systems (components/ds), dashboards (components/dash) and docs (components/docs)
projects/           sample projects: box-console (canvas), tingly-intro (slides), tingly-ds (design system), box-usage (dashboard), design-guide (docs)
scripts/            dash-query.mjs: read-only queries against a dashboard's SQLite databases (for Claude Code)
.claude/skills/     format references for Claude Code: dc-canvas, slides, design-system, dashboard, docs (read before every delegated task)
artifact/           reference material for the original five types (Design, Slides, Dashboard, Docs, Design System), private
docs/               guides and design notes (docs/zh-CN/ is the Chinese edition); docs/images/ holds the screenshots
e2e/                Playwright end-to-end tests and a mock Messages API
```

---

Back to the [README](../README.md)
