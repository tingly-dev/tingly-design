<p align="right"><b>English</b> · <a href="../zh/development.md">简体中文</a></p>

# Development and tests

```bash
pnpm test           # unit tests: core (parsing, write-back, the jQuery session, statement splitting, undo relocation, slides, design systems, dashboards, docs), the importer, and the UI strings (same keys and placeholders in both languages, every key the code uses exists, no hard-coded Chinese in code)
pnpm typecheck
```

The other suites select elements by their Chinese labels, so they run the browser with a `zh-CN` locale; `i18n.py` covers English.

The end-to-end tests need `pnpm dev` running and Python Playwright (`pip install playwright`). Set `DC_CHROME=/path/to/chrome` to use another browser; in a headless environment use Playwright's `chromium_headless_shell`, because full Chromium in headless mode misplaces clicks inside a zoomed artboard.

| Command | Covers |
|---|---|
| `python3 e2e/e2e.py` | Canvas: panel, layers, styles, retyping, structure operations, clipboard, drag and drag-out, canvas tools, pages, export, concurrent editors, undo, play mode (40 checks) |
| `python3 e2e/slides.py` | Slides: thumbnails and sections, retyping, delete and undo, dragging pinned elements, notes, add/duplicate/reorder/delete, format check, jQuery, presenting, export (20 checks) |
| `python3 e2e/ds.py` | Design systems: cover and brand book, editing/renaming colours with aliases, adding and removing, type and radius, component previews, asset upload, outside edits that break the grammar, a new system, installing into a deck and picking tokens and text styles, removal (22 checks) |
| `python3 e2e/dash.py` | Dashboards: query/CSV/JSON loading, mark checking, filters and row-click filters, data mode, editing a query (writes refused), pausing and resuming, outside edits to data and page, failed states, `.runs.json`, the code panel, a new dashboard (24 checks) |
| `python3 e2e/docs.py` | Docs: tabs and outline, reading writes nothing, typing / ticking / editing a cell each change one line, the `/` menu, the format menu, live outside edits that are kept, comments (reply/resolve/new), tab management, layout, AI rewrite (with the mock model), HTML export, a new doc (25 checks) |
| `python3 e2e/motion.py` | Motion: the sample opens on its cover, editable on the stage; play shows the player, and pausing or clicking it brings the stage back; jumping to a scene opens on its start, drawn landed like a page; click to select, double-click to retype, dragging a handle to resize; an edit in the tall format goes to `data-tall` and the override chip takes it back; elements not yet on screen can't be clicked, a selected one is shown landed, layers say when the rest come in; adding, resizing and removing a size; the tall format, changing speed, a new piece (21 checks) |
| `python3 e2e/layers.py` | Layers tree: the same rows with hide and lock in canvas, slides and motion; hide writes `data-hide` and the element leaves the stage, lock writes `data-lock` and a click lands on what holds it; an artboard hides and locks through `canvas.json` (25 checks) |
| `python3 e2e/launcher.py` | Launcher: every kind and project listed, live cover, board and motion previews, kind tabs, search and `/`, Enter to open, continue where you left off, arrow keys, sorting, the new-project dialog (folder follows the title and stays out of the way, a title with no letters still works, taken and bad names refused), the logo and feedback links, a one-click way home and the project menu in every kind's editor, phone width (43 checks) |
| `python3 e2e/theme.py` | Themes: following the system, the appearance menu and remembering a pick, a dark canvas and dashboard, `?theme=` with a preset or JSON, derived tokens, the `tinglyDesign` script API, a Tingly Box palette, unsafe values dropped, a host page setting the theme by postMessage and hearing it back (25 checks) |
| `python3 e2e/i18n.py` | UI language: a browser's language picks English or Chinese (regional tags too, anything else English), every kind's sample editor in English with no Chinese left, the language button naming the language in use and listing languages by their own names, remembering a pick, `?lang=` for the tab, the `tinglyDesign` script API, server errors worded in the request's language with a stable code, a host framing with `?lang=`, switching by postMessage and hearing `language-changed` (26 checks) |
| `python3 e2e/embed.py` | Embedding, after `pnpm bundle`; starts the bundle itself: the manifest and ready line, a fresh projects folder seeded with the samples, everything under `/design`, editing into the host's folder, a host page on another origin opening projects and hearing `ready` and `location`, themes from the host, exiting with stdin and on SIGTERM (27 checks) |
| `python3 e2e/attach.py` | Attachments, after `pnpm build`; starts its own server with the mock model and a stand-in `claude`: pasting, picking and dropping files, refusals and the limit of six, the blocks the model gets, retries keeping them, keeping them in `uploads/` (originals, once each, served back), the paths Claude Code reads, the docs bar, a slide showing a kept image, the server's checks (36 checks) |
| `python3 e2e/run_feed.py` | The run feed above the request, after `pnpm build`; starts its own server with the mock model and a stand-in `claude`: the request echoed, the fast model's statement count and undo, Claude Code's steps (relative paths, what it says), elapsed time, the stop button, Enter while busy keeping what was typed, the artboard badge, the answer and the files changed, folding and unfolding the steps (folded by default, even while running), undoing a whole run, putting a failed request back, an editor opened mid-run seeing the steps so far, stopping, one run in each of the other five kinds, motion's playhead told to Claude Code but not echoed, the motion stage not moving during a run, the request history, a request continuing or not continuing the last Claude Code session, folding the bar to a pill (40 checks) |
| `python3 e2e/import_here.py` | Importing into an open project, after `pnpm build`; starts its own server on a copy of the samples: the import button, a drop anywhere and a paste in every kind, a page folder becoming artboards beside a canvas's own (kept in `uploads/`), pasted SVG, pictures on a canvas and a slide, Markdown with its pictures as a doc tab, a CSV as a dashboard dataset, fonts and an SVG into a design system, refusals, motion taking nothing (29 checks) |
| `python3 e2e/fast.py` | Fast AI: streaming execution, undo on error, retry, write-back |
| `python3 e2e/fast_slides.py` | Fast AI on a slide: retry on error, undo and explain when a reply leaves the slide subset |
| `python3 e2e/fast_motion.py` | Fast AI on a motion scene: the model sees the sizes and the scene under the playhead, retry on error, undo and explain outside the subset, timing attributes kept |
| `python3 e2e/delegate.py` | Calls the local `claude` CLI for real |

The two fast AI tests use a mock model (its first reply deliberately contains a line that throws):

```bash
python3 e2e/mock_anthropic.py &
ANTHROPIC_API_KEY=x ANTHROPIC_BASE_URL=http://127.0.0.1:8790 pnpm dev
```

## Releasing

Pushing a tag `vX.Y.Z` releases that version; the tag has to match `version` in the root `package.json`, so bump it on main first. `.github/workflows/release.yml` runs the unit tests and typecheck, builds the bundle, starts it the way a host does (`.github/scripts/smoke-bundle.sh`), and packs it into `tingly-design-<ver>.tgz`. That one file, with its `.sha256`, is attached to a GitHub release on the tag and published to npm as `@tingly-dev/tingly-design` and as `tingly-design` (the same contents under both names). A tag such as `v0.2.0-rc.1` makes a prerelease on the `next` dist-tag.

npm publishing uses Trusted Publishing only: no token is stored anywhere, and both packages refuse tokens, so outside CI only a maintainer entering a one-time password can publish. Before the very first release a maintainer runs `scripts/npm-bootstrap.sh` once on their own machine (placeholder versions, the trusted publisher, 2FA required), and creates the `production` environment on GitHub.

`.github/workflows/ci.yml` runs the same checks on every pull request, plus `npm pack --dry-run` to list what the package would contain. Why it is built this way, and how npm publishing is authorised: `.design/release.md`.

---

Back to the [README](../../README.md)
