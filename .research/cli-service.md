# Tingly Design as a CLI and a service tool

Status: **research**. Answers issue #119: today the only way in is to start the server and open the editor, so a skill, a script or another agent cannot call Tingly Design and get an answer back. Once a direction is picked, the conclusion moves into `.design/`.

## 1. Where we are

| Entry | What it does | Ships in the npm package? |
|---|---|---|
| `pnpm dev` / `pnpm start` | server + editor from the repository | no (repo only) |
| `node server.mjs` | the bundle's server; `PORT=0`, `TINGLY_DESIGN_READY` line, `DC_EXIT_WITH_STDIN` (`docs/en/embedding.md`) | yes, but no `bin`, so `npx tingly-design` does nothing |
| `scripts/motion-render.mjs` | motion → MP4/GIF/cover with Playwright + ffmpeg | no |
| `pnpm dc-import` | HTML/SVG → canvas (`packages/import/src/cli.ts`) | no |
| `scripts/dash-query.mjs` | read-only SQL on a dashboard's data | yes (for Claude Code) |

What a caller actually wants from a skill, and where the code for it lives today:

| Job | Code | Runs without a browser page? |
|---|---|---|
| create / list projects | `store.ts` `createProject`, `listProjects` | yes |
| write a file so an open editor sees it, with journal and undo | `PUT /api/projects/:p/file`, `hub.ts` | yes, but only inside the running server |
| check a project is valid | `@dc/core` `parseCanvas`, `parseDeck`, `checkSlide`, `checkScene`, `parseDash`, `parseDoc` … | yes, but nothing ties them into one "check" |
| motion → video | `render.ts` `renderMotion` (machine's Chrome over CDP + ffmpeg) | yes |
| PDF | `pdf.ts` `printPdf`, but the HTML is built by the editor (`slides/exportDeck.ts`, `DocsApp.tsx`) | no |
| canvas / slide PNG | sandbox `exportPng` in the page | no |
| "change this" with fast AI | server only proxies the model; the editor builds the messages and applies the answer | no |
| hand to Claude Code | `delegate.ts` `startDelegate` | yes |
| import HTML/SVG | `packages/import` | yes |

Two facts shape the options.

1. **`apps/server/src/index.ts` is one script with side effects at the top level** (watcher, `serve`, signal handlers). Nothing can reuse its routes in-process; a CLI today can only talk to it over HTTP or copy code out of it.
2. **Half of the useful jobs run in the editor's page** (picture export, PDF layout, fast-AI apply). A headless command for them has to open that page in a browser. We already drive the machine's own Chrome over CDP without Playwright (`render.ts`, `pdf.ts`), so the cost is code, not a new install.

## 2. Options

### A. A `tingly-design` command in the package (CLI)

Add `bin` to the bundle's `package.json` pointing at a small `cli.mjs`, so `npx tingly-design …` or a global install works. Subcommands, all with `--projects <dir>` and `--json`:

```
tingly-design serve [--port 0] [--open]          today's server (default command)
tingly-design new <name> --kind slides           create from the starter
tingly-design list                               projects, kind, title
tingly-design check <project>                    run every core parser/checker, exit 1 on problems
tingly-design export <project> --as png|pdf|mp4|gif|html [--board id] [--out file]
tingly-design snapshot <project> [--board id]    PNG of what the editor shows, for an agent to look at its work
tingly-design import <file.html|svg> <project>   the existing importer
tingly-design edit <project> "prompt" [--claude] fast AI or Claude Code, prints what changed
tingly-design skills [--path]                    print where the format references are
```

- Pure-file commands (`new`, `list`, `check`, `import`, motion `export`) run in-process with no server.
- Page commands (`export` png/pdf, `snapshot`, fast `edit`) start the server on a free port in-process, open the editor in headless Chrome at an export route, reuse the editor's own export code, and exit. Output equals what the menu button makes.

Good: one word to learn, works in any skill or CI, nothing running beforehand. Cost: refactor `index.ts` into `createApp()` + `startServer()`; an export route in the editor; Chrome needed for page commands (same as one-click PDF today).

### B. Service mode: one long-running server the CLI attaches to

`tingly-design serve` writes `server.json` (port, pid, projects dir, version) in the data root the bundle already defaults to, `~/.tingly-design/`. Every other command looks for it first: if a server for the same projects folder is up, the command goes through its HTTP API, so the open editor updates live, the journal records the change under its own actor and undo works. If none is up, the command runs alone as in A.

Good: edits from a skill land in the person's open editor instead of fighting it (two writers on the same files is the real risk of A alone). Cost: a lockfile, stale-pid handling, a documented and versioned HTTP API (the `PROTOCOL` number already exists).

Without B, a CLI that writes files while the editor is open still works (the watcher picks up outside writes as `external`), but there is no lock and no clean attribution.

### C. MCP server

`tingly-design mcp` speaks MCP over stdio and exposes the same commands as tools (`create_project`, `check_project`, `export`, `snapshot`, `edit`), plus the format skills as resources. Any MCP client (Claude Code, Claude Desktop, Tingly Box) can then use it without shell access.

Good: typed tools, the client sees the format references. Cost: one more surface to keep in step. Only worth it as a thin layer over A/B, never with its own logic.

### D. A skill only

Ship a `tingly-design` skill that tells an agent to edit the plain files directly and call the existing scripts.

Good: nothing to build. Bad: no export of pictures/PDF, no check, no live editor, and the scripts are not in the package. This is what we effectively have now and is why the issue was filed.

## 3. Recommendation

**A + B together, C afterwards as a thin wrapper.** Concretely, in order:

1. Split `index.ts` into `createApp()` and `startServer()`, with no behaviour change; add `bin` and `cli.mjs` with `serve` (default), `new`, `list`, `check`, `skills`, and motion `export` (move `motion-render.mjs` onto `render.ts` so there is one renderer).
2. Service lookup (`server.json`), so every write command goes through a running server when there is one.
3. The editor's headless export route, then `export --as png|pdf|html` and `snapshot` for every kind.
4. `edit` (fast AI headless, `--claude` for delegation, streaming the run feed as lines).
5. `mcp`, mapping one tool to one command, and a `tingly-design` skill that points at the CLI.

Steps 1–2 already make it usable from a skill (create, check, render motion, live edits); 3 is the biggest piece and the one that makes "look at what I made" possible for an agent.

## 4. Open questions

- Projects outside the projects folder: the server is gaining `POST /api/links {path}` (open a folder anywhere, returns its name), `GET /api/folder?path=` and `path` on `POST /api/projects`. CLI commands should take a path as well as a name and go through those, not a second copy of the logic.
- The first npm release needs `bin` with at least `serve`; step 1 covers it.
- Command name: `tingly-design` (matches the npm package) or a short alias such as `td`.
- Does Tingly Box want to call the CLI, or keep launching `server.mjs` and use the HTTP API? Either works with B.
- `snapshot` for a dashboard needs its data; run the page's queries or show the last saved runs?
- `edit` with fast AI headless needs the editor's apply loop in a page; is a Claude-Code-only `edit` enough for a first version?
- Cross-kind: every command must say what it does for each of the six kinds; add a CLI column to `.design/project-kinds.md` when this lands.
