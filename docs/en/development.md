<p align="right"><b>English</b> · <a href="../zh/development.md">简体中文</a></p>

# Development and tests

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
| `python3 e2e/launcher.py` | Launcher: every kind and project listed, live cover and board previews, kind tabs, search and `/`, Enter to open, continue where you left off, arrow keys, sorting, the new-project dialog (folder from title, taken and bad names refused), phone width (26 checks) |
| `python3 e2e/theme.py` | Themes: following the system, the appearance menu and remembering a pick, a dark canvas and dashboard, `?theme=` with a preset or JSON, derived tokens, the `tinglyDesign` script API, a Tingly Box palette, unsafe values dropped, a host page setting the theme by postMessage and hearing it back (25 checks) |
| `python3 e2e/fast.py` | Fast AI: streaming execution, undo on error, retry, write-back |
| `python3 e2e/fast_slides.py` | Fast AI on a slide: retry on error, undo and explain when a reply leaves the slide subset |
| `python3 e2e/delegate.py` | Calls the local `claude` CLI for real |

The two fast AI tests use a mock model (its first reply deliberately contains a line that throws):

```bash
python3 e2e/mock_anthropic.py &
ANTHROPIC_API_KEY=x ANTHROPIC_BASE_URL=http://127.0.0.1:8790 pnpm dev
```

---

Back to the [README](../../README.md)
