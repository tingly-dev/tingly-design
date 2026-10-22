# Architecture

One page on how the pieces fit. The long form is in `docs/en/architecture.md`, and the reasons behind each choice are in `.design/`.

## One idea

Every project is plain files under `projects/<name>/`. Anyone can change them: you on screen, the fast model, Claude Code, a script, git. The editor never keeps a second copy of the truth; it shows the files and writes back to them.

```
 you (seconds)      fast AI (seconds)      Claude Code (minutes)     terminal, CLI, MCP, git
 DOM operations     jQuery statements      edits the files           edits the files
       |                  |                       |                          |
       v                  v                       |                          |
   write-back engine (core/copy.ts): minimal text patch                        |
       |                                          |                          |
       +------------------> project files (versioned) <----------------------+
                                     |
                       journal + file watcher + SSE
                                     |
                       every open editor refreshes
```

## Write-back

A file is parsed with source positions into a DOM copy. After an edit the copy is compared with the original tree and only the changed characters are written: one attribute, one text run, or one parent's children. People, the fast model and conflict replays all use this engine. Claude Code and external tools skip it, so the server watches files, records the change in the journal as external, and tells the editors over SSE.

## Packages and apps

| Where | What it holds |
| --- | --- |
| `packages/core` | Formats, write-back, per-kind logic, prompts, launcher cards, design-system looks, project archives, the Claude Design format, PowerPoint import |
| `packages/export` | Browser-side export: pictures, MP4, WebM, GIF, audio, fonts, PowerPoint |
| `packages/i18n` | Every UI string, in English and Chinese |
| `packages/sandbox` | Artboard, dashboard and motion runtimes and the AI executor, run in sandboxed iframes |
| `packages/import` | HTML and SVG into a canvas |
| `apps/server` | Files and versions, SSE, journal, fast AI proxy, Claude Code delegation, rendering, PDF, git, zip, the `tingly-design` command and MCP |
| `apps/editor` | The React editors: shared parts at the root of `components/`, one folder per kind |

## Two ways to ask an AI

- Fast AI answers in seconds with jQuery statements that run on a sandbox copy. If a line fails, the whole answer is undone and retried. It works on canvas, slides, a docs passage and a motion scene.
- Claude Code works for minutes and edits files directly. It works in every kind, keeps one conversation per project, and shows its steps and the files it changed in the run card, with undo for the whole run.

Both share one connection in the AI settings dialog (Tingly Box suggested), each with its own model name.

## Command line and MCP

Commands are data in `commands.ts`. The terminal prints them and `/mcp` serves the same list as tools: `projects`, `open`, `check`, `look`, `export`, `prompt`, `history`. Format references are MCP resources, and there is no write tool, because the agent edits files itself.

## Moving work in and out

PNG, PDF and video export; PowerPoint in and out for slides; a whole project as one `.zip`; a Claude Design package in the original layout; Markdown for docs; HTML, SVG, images, fonts and CSV into an open project. Anything you bring in is kept under `uploads/` and referenced from there.

## Keeping the kinds in step

A feature that every kind can reach is built once as a shared part and listed in the matrix in `.design/project-kinds.md`. Each supported cell names the e2e suite that checks it, and `pnpm test` fails when the matrix and `e2e/coverage.json` disagree.
