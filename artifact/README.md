# artifact/ — reference material (temporary, do not publish)

Everything here was collected while studying Claude's Design canvas (the
"Design" artifact type on claude.ai / Claude Code) to replicate its editing
experience. It is **Anthropic's material, kept only for reference while the
repository is private**. Remove this whole directory before the repository
goes public.

Source: the published files of the user's own canvas
`https://claude.ai/artifact/Pnpaj7XABoWjMegbsLnSxr` ("Tingly-Box 前端信息架构梳理"),
type `Design`, type release `1791586906-56be`, canvas versions
`1791718275-07b4` and `1791721890-54ef`, fetched 2026-10-11.

## The other types (added 2026-10-11)

Claude's artifact platform has five core types; Design is the one this repo
replicates so far. The account's type listing (`Artifact list scope:types`):

| Type | Type link | Where content lives | Collected here |
|---|---|---|---|
| Design | `QKN21svewxgyPb6SYRqWnd` | files: `project/canvas.json` + `*.dc.html` | `claude-design/` |
| Slides | `8jTsAFQMFDb2oA8MsPJ2eL` (release `1791584864-97b0`) | files: `project/deck.json` + `project/slides/<id>.html` | `claude-slides/` |
| Dashboard | `GZLZthZ2sQjn7T16skfdeF` (release `1791487385-53e8`) | the artifact's db: `dash/meta`, `datasets/<id>`, `files/index.html` | `claude-dashboard/` |
| Docs | `Rp9naXUCj2xozpUkyQy19W` (release `1791658616-c881`) | an external Claude Docs service, via its MCP connector; the viewer reaches it through the Frame shell (`frame-sync:` postMessage lanes) | `claude-docs/` |
| Design System | `5M7UeXXcx16TP3vzVFNDzd` (release `1791558544-c1cf`) | files: `project/design-system.json`, `tokens.json`, components, assets | `claude-design-system/` |

- `claude-slides/`: `type/` = the type's files from the user's deck
  `https://claude.ai/artifact/LJTLFf6JFqr4nf3Axzp5C2` ("数学奇遇记", version
  `1791727153-61e8`): `SKILL.md`, `index.html`, `app.js`/`app.css` (+
  `app.pretty.js`), `reference/*.md` (`format.md` is the whole slide subset),
  `thumbnail/`, `fonts/`. `sample-deck/` = that deck's `deck.json` and 8
  slides (each with a live `<x-embed>` animation).
- `claude-dashboard/`: `type/` = the type's files from the user's dashboard
  `https://claude.ai/artifact/RZsi2NiWzRRCNfVn5yHn4z` ("腾讯控股 0700 走势",
  version `1791729436-b8a0`). `sample-dashboard/` = its store documents
  (`dash/meta`, `datasets/*`) and the page (`index.html`, from
  `files/index.html`). The two attached data files (`/_blob/…`) could not be
  read from the session that collected this, so the sample has no rows.
- `claude-design-system/`: `type/` = the type's files, read from an empty
  instance made for this purpose,
  `https://claude.ai/artifact/EpexG3UkrneVrSdA4gpEYf` (instance version
  `1791729959-7a23`, type release `1791558544-c1cf`, contract `0.2.47`):
  `SKILL.md`, `index.html`, `app.js`/`app.css` (+ `app.pretty.js`), `run.html`
  (the preview runner), `demo.json` (the type's worked example system) and
  `reference/*.md` (+ `sample-seazar-tokens.json`). `NOTES.md` = the earlier
  notes from the type's `SKILL.md`.
- `claude-docs/`: `type/` = the type's files, read from an empty instance
  made for this purpose, `https://claude.ai/artifact/MWUypNpk4Rp4gMT9SLwy1w`
  (instance version `1791729961-a87b`, type release `1791658616-c881`, contract
  `0.2.46`): `SKILL.md`, `index.html` and the viewer's ~80 Vite chunks
  (`app-core-*.js`, `index-*.js`, `app-lazy-*.js`, `lfile-runtime.*.js` the
  editor/widget runtime, `pm-schema-*.js`, …; every chunk over 200 KB also as
  `*.pretty.js`), `fonts/`, `thumbnail/`. The doc content itself lives in the
  Claude Docs service, not in these files. `NOTES.md` = the earlier notes.
- `FINDINGS.md` in `claude-slides/`, `claude-dashboard/`,
  `claude-design-system/` and `claude-docs/`: what the editors do, read from
  their bundles.

## claude-design/

| Path | What it is |
|---|---|
| `type/SKILL.md` | The type's instructions for the model that fills a canvas: file layout, canvas.json shape, artboard skeleton, rules. |
| `type/reference/*.md` | The type's reference pages: `format.md` (full .dc.html syntax), `diagrams.md`, `view-state.md` (selection/view context sent to the model), `craft.md`, `print.md`, `questions.md`, `design-system-components.md`, brand colors and typography. |
| `type/index.html` | The editor page as published (boot scripts, flags, capability declaration). |
| `type/app.js`, `app.css` | The editor itself (minified, ~4 MB). `app.pretty.js` is the same file run through Prettier for reading. |
| `type/dc-runtime.js` | The artboard runtime (`support.js` inside artboards). `dc-runtime.pretty.js` is formatted. |
| `type/fast-edit-worker.js` | Web Worker for the fast in-page editor: happy-dom + jQuery 4 running model-written statements on a copy of the design. |
| `type/thumbnail/thumbnail.json` | How the host builds the canvas thumbnail. |
| `prompts/fast-edit-system.txt` | System prompt of the fast in-page editing agent, extracted from `app.js` (`var AOt`). |
| `prompts/fast-edit-canvas-frame-addendum.txt` | Extra prompt text about moving/resizing artboard frames (`var POt`). |
| `prompts/fast-edit-feedback-messages.js.txt` | The corrective messages the editor sends back to the fast agent (no change, thrown line, wrong artboard…). |
| `sample-canvas/` | The canvas itself: `canvas.json` and 11 `.dc.html` artboards, as Claude wrote them. Good real-world samples of the format. |
| `screenshots/` | Screenshot of the canvas in Claude Code (from the user). |
| `emulator/serve.mjs` | A local stand-in for the claude.ai host so the **original** editor runs editable on this machine (see below). Ours, written for study. |

## Running the original editor locally

```bash
node artifact/claude-design/emulator/serve.mjs /tmp/dc-orig 8801
# open http://127.0.0.1:8801/
```

The script copies `type/` and `sample-canvas/` into the work directory in the
layout the host publishes (`index.html`, `artifact-type/`, `project/`), serves a
generated `_files.json`, and injects a minimal `window.claude` with
`self.publish` (writes to `project/` in the work directory) and a `user` that
may edit. Comments, rooms, the shared db, asset uploads and the in-page model
(`sample`) are not emulated, so those features stay off.

## Notes from reading the code

- Files are listed through `_files.json` (`{ver, files: {path: {sha256, size, contentType}}}`) and saved through `window.claude.self.publish({path: {content, contentType} | null}, {ifMatch})`; the reply carries `{version, shas}`. Conflicts come back as `{code: "conflict", live, paths}`.
- Write access is decided by `user.can("files.write" | "data.write")` / `user.canEdit()`; without `window.claude` the page opens read-only ("Editing isn't available in this view.").
- The fast editor is behind the `design_fast_edit` / `design_fast_edit_sample` flags; model tier `quick` / `default` / `complex`, effort `low` / `medium` / `high`.
- The fast agent's context is assembled as `design` → `view` → `artboard` → `journal` → `pointed at` → `prompt`, with a `[context NN%]` line asking it to `forget([...], "notes")` older turns as the conversation fills.
