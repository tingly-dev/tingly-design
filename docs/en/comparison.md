<p align="right"><b>English</b> · <a href="../zh/comparison.md">简体中文</a></p>

# Compared with the original

| | Done | Not yet |
|---|---|---|
| **Canvas** | The canvas shell (tools, pages, zoom, sync log), the right panel (layers/properties/code/Tweaks), selection and hierarchy navigation, in-place text, drag to reorder and drag out to free position, resizing, group/ungroup/flip/arrange, clipboard, notes, shapes, arrows and pen, multiple pages, artboard rename/resize/full window/PNG export, play mode with links between artboards, `<dc-import>` | Comments, multi-select, PDF export, fast AI edits to the canvas layout (`canvas.json`) |
| **Slides** | deck.json with one file per slide, the thumbnail strip with sections, drag to reorder, add/duplicate/skip/delete, inserting text/images/tables/shapes/connectors/icons, speaker notes, the subset check, presenting (builds, fade/push, notes, full screen), HTML/PDF/PPTX/notes export | Magic move (falls back to fade), Google Slides export, image cropping, editing merged table cells, gradient fills and an eyedropper in the properties panel, a zoomed-out grid view of the deck, a separate presenter-notes window (notes show in a panel inside the present view) |
| **Design system** | Browsing and editing tokens in place, tokens.css generation, grammar checks, colour contrast checks, component previews, theme switching with live previews, asset management, an editable brand book, installing into canvases and decks | Mounting components on a canvas, an in-page model, a start screen offering to begin from code or brand files, a free-space cleanup of unreferenced assets, a right-click menu on tokens, fixing contrast failures with Claude, a files browser (the project is a folder on disk), a per-file merge dialog on conflicts (edits replay by version instead) |
| **Dashboard** | File and SQLite query datasets, the dash API (calc, loader, filters, links), d3, mark checking and states, the sources panel (results, formulas, query editing, test runs, CSV, stale marks, pause/resume), data mode, `.runs.json`, light and dark themes | MCP connectors (BigQuery and others) with per-reader permissions, query history, scheduled refresh, export to other tools |
| **Docs** | Tabs and nested tabs, rich text (toolbar, selection menu, `/` insert), block- and line-level write-back, concurrent replay, comments (anchoring, replies, resolve, hand to Claude), AI rewrite of a selection, layout settings, Markdown/HTML/PDF export, code blocks that draw Mermaid diagrams, KaTeX formulas and CSV tables, earlier versions with restore | Word and Google Docs export, version compare (restore exists), proposals, live cursors, chart blocks and editable-label diagram blocks, @mentions |
| **AI and collaboration** | Fast AI streaming/retries/logs/delegation, Claude Code delegation, conflict replay, the journal, undo and redo, git commits | Fast AI edits one artboard at a time; work across artboards goes to Claude Code |

The original's agent infrastructure (hosting, permissions, publishing) is out of scope.

---

Back to the [README](../../README.md)
