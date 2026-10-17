<p align="right"><b>English</b> · <a href="../zh/development.md">简体中文</a></p>

# Development and tests

```bash
pnpm test           # unit tests: core (parsing, write-back, the jQuery session, statement splitting, undo relocation, slides, design systems, dashboards, docs), the importer, the exporter (what a browser can write, font inlining), and the UI strings (same keys and placeholders in both languages, every key the code uses exists, no hard-coded Chinese in code)
pnpm typecheck
pnpm tingly-design --help   # the command line from source (docs: cli.md)
```

The other suites select elements by their Chinese labels, so they run the browser with a `zh-CN` locale; `i18n.py` covers English.

`pnpm e2e` runs every suite below but `delegate` with one command: it starts what each group needs (`pnpm dev` with the mock model, `pnpm dev` with no model for `ai_settings`, `pnpm build` for the suites that start their own server, `pnpm bundle` for `embed`), runs the suites one after another and prints one table; `e2e/out/report.md` and `report.json` say which checks failed, with each suite's output in `e2e/out/logs/`. `pnpm e2e slides docs` runs only those, `--smoke` the per-PR subset, `--list` shows the groups, `--real` adds `delegate`. The suites edit the sample projects and put them back with `git checkout`, so it refuses to start while `projects/` has uncommitted changes (`--force` runs anyway). The whole set takes about ten minutes.

Each suite can still be run on its own. The end-to-end tests need `pnpm dev` running and Python Playwright (`pip install -r e2e/requirements.txt`). Set `DC_CHROME=/path/to/chrome` to use another browser (`pnpm e2e` picks Playwright's headless shell when it is installed); in a headless environment use Playwright's `chromium_headless_shell`, because full Chromium in headless mode misplaces clicks inside a zoomed artboard.

| Command | Covers |
|---|---|
| `python3 e2e/e2e.py` | Canvas: panel, layers, styles, retyping, structure operations, clipboard, drag and drag-out, canvas tools, pages, export, concurrent editors, undo, play mode (40 checks) |
| `python3 e2e/slides.py` | Slides: thumbnails and sections, retyping, delete and undo, dragging pinned elements, notes, add/duplicate/reorder/delete, format check, jQuery, presenting, export, text boxes (24 checks) |
| `python3 e2e/ds.py` | Design systems: cover and brand book, editing/renaming colours with aliases, adding and removing, type and radius, component previews, asset upload, outside edits that break the grammar, a new system, installing into a deck and picking tokens and text styles, removal (22 checks) |
| `python3 e2e/dash.py` | Dashboards: query/CSV/JSON loading, mark checking, filters and row-click filters, data mode, editing a query (writes refused), pausing and resuming, outside edits to data and page, failed states, `.runs.json`, the code panel, a new dashboard (24 checks) |
| `python3 e2e/docs.py` | Docs: tabs and outline, reading writes nothing, typing / ticking / editing a cell each change one line, the `/` menu, the format menu, live outside edits that are kept, comments (reply/resolve/new), tab management, layout, AI rewrite (with the mock model), HTML export, a new doc (25 checks) |
| `python3 e2e/export_menu.py` | The one Import / Export menu: every kind has it in its bar and it lists what the kind takes and saves, a PDF made in one click from a deck and a doc (a real PDF with the pages), the print-dialog fallback when the server has no Chrome, the status chip (28 checks) |
| `python3 e2e/archive.py` | A whole project as one .zip: the two items at the end of every kind's Import / Export menu, the whole project carrying its change log and its design system beside it with a manifest, files only carrying neither, no local state in either, importing from the launcher's New menu under a free name (an unchanged system not duplicated), the launcher card's Export, a zip with no project refused, in English light and Chinese dark (23 checks) |
| `python3 e2e/export_image.py` | Saving a picture (PNG) in every kind: docs (this tab), slides (this slide, every slide), dashboard, design system, motion (the frame at the playhead); each file is a real PNG at least the page's size (9 checks) |
| `python3 e2e/motion.py` | Motion: the sample opens on its cover, editable on the stage; play shows the player, and pausing or clicking it brings the stage back; jumping to a scene opens on its start, drawn landed like a page; click to select, double-click to retype, dragging a handle to resize; an edit in the tall format goes to `data-tall` and the override chip takes it back; elements not yet on screen can't be clicked, a selected one is shown landed, layers say when the rest come in; adding, resizing and removing a size; the tall format, changing speed, a new piece (42 checks) |
| `python3 e2e/layers.py` | Layers tree: the same rows with hide and lock in canvas, slides and motion; hide writes `data-hide` and the element leaves the stage, lock writes `data-lock` and a click lands on what holds it; an artboard hides and locks through `canvas.json` (25 checks) |
| `python3 e2e/launcher.py` | Launcher: every kind and project listed, live cover, board and motion previews, kind tabs, search and `/`, Enter to open, continue where you left off, arrow keys, sorting, the new-project dialog (folder follows the title and stays out of the way, a title with no letters still works, taken and bad names refused, the optional design system, board size and data file), the logo and feedback links, a one-click way home and the project menu in every kind's editor, phone width (72 checks) |
| `python3 e2e/dialogs.py` | Every dialog's keyboard: new project, open a folder, import, AI model settings, commit, export video and import from a project, each opened where a person opens it; a modal with focus inside, Tab and Shift+Tab kept inside, Esc closing it, focus back on the page; in English light and Chinese dark (58 checks) |
| `python3 e2e/folders.py` | Projects kept outside the projects folder: a folder of each of the six kinds linked under its own name and opened in its editor, the same folder twice, refused paths, a write landing in the linked folder and an outside edit seen there, Open a folder (what is there, said while typing), a folder with no project leading to New project aimed at it, a new doc written into that folder, a busy folder refused, remove from list and undo, in Chinese light and English dark (42 checks) |
| `python3 e2e/git.py` | Committing to git: a project in no repository is told where one will be created and gets it on the confirmed first commit (never without consent), nothing to commit disables the button, a project inside a code repository names that repository and branch and commits only its own folder, every kind has commit in its change log, the new-project option to create a repository from the start (offered only outside a repository), in Chinese light and English dark (24 checks) |
| `python3 e2e/theme.py` | Themes: following the system, the appearance menu and remembering a pick, a dark canvas and dashboard, `?theme=` with a preset or JSON, derived tokens, the `tinglyDesign` script API, a Tingly Box palette, unsafe values dropped, a host page setting the theme by postMessage and hearing it back (25 checks) |
| `python3 e2e/i18n.py` | UI language: a browser's language picks English or Chinese (regional tags too, anything else English), every kind's sample editor in English with no Chinese left, the language button naming the language in use and listing languages by their own names, remembering a pick, `?lang=` for the tab, the `tinglyDesign` script API, server errors worded in the request's language with a stable code, a host framing with `?lang=`, switching by postMessage and hearing `language-changed` (26 checks) |
| `python3 e2e/export.py` | Exporting from the browser: a motion piece to a video file made in the tab (the button shows progress and a cancel, the file is named for the piece and size, has the piece's size and length and a real frame), the dialog opening on a summary with the options folded, a smaller size, frame rate and quality honoured, GIF and the menu's own GIF… entry, cancelling, a piece with an embed drawn by the server's Chrome as an MP4 or a GIF with the embed on the frame (the dialog says why, and size and frame rate are honoured there too), and with no Chrome the same piece and an imported artboard made in the tab with the embed on the frame (each frame hands over its own picture) |
| `python3 e2e/embed.py` | Embedding, after `pnpm bundle`; starts the bundle itself: the manifest and ready line, a fresh projects folder seeded with the samples, everything under `/design`, editing into the host's folder, a host page on another origin opening projects and hearing `ready` and `location`, themes from the host, exiting with stdin and on SIGTERM (27 checks) |
| `python3 e2e/attach.py` | Attachments, after `pnpm build`; starts its own server with the mock model and a stand-in `claude`: pasting, picking and dropping files, refusals and the limit of six, the blocks the model gets, retries keeping them, keeping them in `uploads/` (originals, once each, served back), the paths Claude Code reads, the docs bar, a slide showing a kept image, the server's checks (36 checks) |
| `python3 e2e/run_feed.py` | The run feed above the request, after `pnpm build`; starts its own server with the mock model and a stand-in `claude`: the request echoed, the fast model's statement count and undo, Claude Code's steps (relative paths, what it says), elapsed time, the stop button, Enter while busy keeping what was typed, the artboard badge, the answer and the files changed, folding and unfolding the steps (folded by default, even while running), undoing a whole run, putting a failed request back, an editor opened mid-run seeing the steps so far, stopping, one run in each of the other five kinds, motion's playhead told to Claude Code but not echoed, the motion stage not moving during a run, the request history, a request continuing or not continuing the last Claude Code session, folding the bar to a pill (40 checks) |
| `python3 e2e/import_board.py` | Importing from a project, after `pnpm build`; starts its own server on a copy of the samples: the sample effect artboard (box-console's Glow) into a deck and a motion piece through "From a project…", copied under `uploads/` and recorded in the index, drawn on the stage and in the player, the same frame for the same moment, its options written to the embed, reset, updated from its canvas, and the canvas's time slider (24 checks) |
| `python3 e2e/dock.py` | Where the prompt lives, after `pnpm build`; starts its own server with the mock model and a stand-in `claude`: the bar at the bottom by default with its run card folding to one line when the person goes back to the work, moving it to the right where it is hidden on the right edge with only its tab, the pointer on the tab opening it and leaving closing it, Ctrl J and Esc, a click on the work letting it go, the tab showing a run going and finished floating and docking back, a narrow window floating, the same dock in the other five kinds and no empty slot in motion (33 checks) |
| `python3 e2e/import_here.py` | Importing into an open project, after `pnpm build`; starts its own server on a copy of the samples: the import button, a drop anywhere and a paste in every kind, a page folder becoming artboards beside a canvas's own (kept in `uploads/`), pasted SVG, pictures on a canvas and a slide, Markdown with its pictures as a doc tab, a CSV as a dashboard dataset, fonts and an SVG into a design system, refusals, motion taking nothing (29 checks) |
| `python3 e2e/check_snapshots.py` | `check --snapshots` looking at the layout, after `pnpm build`; runs the command line on its own projects folder: a copy of the sample deck with text past a slide's edge, text cut off by its box, a faint caption and an empty slide warns about each, the sample deck itself about none, and every slide is still drawn (7 checks) |
| `python3 e2e/ai_settings.py` | AI model settings: needs `pnpm dev` started with no `ANTHROPIC_*` variables and `DC_CONFIG` pointing at a temp file, plus `python3 e2e/mock_anthropic.py`; the prompt bar's hint, the dialog from the launcher and from a project, Tingly Box / custom address, a bad address refused, a test through the mock, saved without the key coming back, Claude Code's sign-in option |
| `python3 e2e/fast.py` | Fast AI: streaming execution, undo on error, retry, write-back |
| `python3 e2e/fast_slides.py` | Fast AI on a slide: retry on error, undo and explain when a reply leaves the slide subset |
| `python3 e2e/fast_motion.py` | Fast AI on a motion scene: the model sees the sizes and the scene under the playhead, retry on error, undo and explain outside the subset, timing attributes kept |
| `python3 e2e/delegate.py` | Calls the local `claude` CLI for real |

The two fast AI tests use a mock model (its first reply deliberately contains a line that throws):

```bash
python3 e2e/mock_anthropic.py &
ANTHROPIC_API_KEY=x ANTHROPIC_BASE_URL=http://127.0.0.1:8790 pnpm dev
```

## E2E in CI

`.github/workflows/e2e.yml` runs `pnpm e2e` on three schedules, because the full set is too slow for every pull request: every night on main and by hand from the Actions tab, through `e2e-patrol.yml` (the full set; a red night opens one issue labelled `e2e-patrol`, or comments on the open one, and a green night closes it; a run by hand only reports), before every release (the full set, blocking), and on a pull request that touches `apps/`, `packages/`, `e2e/` or `projects/` (`--smoke`). The report and the logs are the run's `e2e-report` artifact. Why it is split this way: `.design/harness.md`.

## Releasing

Pushing a tag `vX.Y.Z` releases that version; the tag has to match `version` in the root `package.json`, so bump it on main first. `.github/workflows/release.yml` first runs every end-to-end suite (`e2e.yml`; a red one stops the release), then the unit tests and typecheck, builds the bundle, starts it the way a host does (`.github/scripts/smoke-bundle.sh`), and packs it into `tingly-design-<ver>.tgz`. That one file, with its `.sha256`, is attached to a GitHub release on the tag and published to npm as `@tingly-dev/tingly-design` and as `tingly-design` (the same contents under both names). A tag such as `v0.2.0-rc.1` makes a prerelease on the `next` dist-tag.

npm publishing uses Trusted Publishing only: no token is stored anywhere, and both packages refuse tokens, so outside CI only a maintainer entering a one-time password can publish. Before the very first release a maintainer runs `scripts/npm-bootstrap.sh` once on their own machine (placeholder versions, the trusted publisher, 2FA required), and creates the `production` environment on GitHub.

`.github/workflows/ci.yml` runs the same checks on every pull request, plus `npm pack --dry-run` to list what the package would contain. Why it is built this way, and how npm publishing is authorised: `.design/release.md`.

`.github/workflows/pages.yml` builds the homepage (`site/`) and, on main, deploys it to GitHub Pages. The design-motion promo on it is rendered by that job from `projects/design-motion` (`scripts/build-site.sh`), never committed. A maintainer turns Pages on once: Settings → Pages → Source: GitHub Actions.

## Server log

The server writes one line per event to stderr, so you can see what the fast AI and Claude Code are doing without opening the editor:

```
2026-10-14T09:12:03.120Z INFO  fast.start project=demo kind=design model=claude-haiku-5-5 messages=3
2026-10-14T09:12:04.870Z INFO  fast.done project=demo kind=design model=claude-haiku-5-5 messages=3 ms=1750 chars=212 inputTokens=4120 outputTokens=96
2026-10-14T09:12:30.004Z INFO  delegate.start run=3f9a project=demo kind=slides model=default promptChars=48 attachments=0
2026-10-14T09:12:58.331Z INFO  delegate.finish run=3f9a project=demo kind=slides outcome=done ms=28327 steps=6
```

| Event | Level | Fields |
|---|---|---|
| `fast.start` / `fast.done` / `fast.aborted` / `fast.error` | info (error for `fast.error`) | project, kind, model, messages, ms, chars, token counts, error |
| `fast.unavailable`, `delegate.unavailable` | warn | project, reason (no API key, no `claude` CLI) |
| `delegate.start` / `delegate.finish` | info (warn when `outcome=error`) | run, project, kind, model, promptChars, attachments, outcome (`done`, `stopped`, `error`), ms, steps, error |
| `delegate.step` | debug | run, tool, n |
| `request.failed`, `watcher.failed` | error | method, path, file, error |

Prompts and replies are never logged, only their length. Settings (environment variables):

- `DC_LOG_LEVEL`: `error`, `warn`, `info` (default), `debug` or `silent`.
- `DC_LOG_FORMAT=json`: one JSON object per line (`at`, `level`, `event`, fields), for a host that collects logs.

---

Back to the [README](../../README.md)
