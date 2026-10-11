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
