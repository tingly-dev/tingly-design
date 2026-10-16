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

## 2. What similar products do

Read from each product's own docs (October 2026), except where marked.

| Product | Shape | Headless or attach to the running app | Agent surface | Export |
|---|---|---|---|---|
| [HyperFrames](https://github.com/heygen-com/hyperframes) (HeyGen; closest peer for motion: HTML compositions rendered to video, built for agents) | `npx hyperframes`: `init`, `add`/`catalog` (blocks), `lint`, `check`, `timeline --json`, `snapshot`, `preview --background`, `render --quality draft…`, `doctor`, `browser`, `skills update` ([CLI skill](https://skills.sh/heygen-com/hyperframes/hyperframes-cli)) | headless by default; **`open [dir] --json` hands the project to the desktop app and `catch-up` lists what the person changed there since the hand-off** | skills via `npx skills add heygen-com/hyperframes` or a Claude Code plugin; the CLI skill tells the agent: `lint` after structural edits, `check` as the final gate, `timeline --json` instead of reading every file, render draft while iterating | MP4/WebM; headless Chrome seeks each frame, FFmpeg encodes; local or Docker |
| [Pencil / pen.dev](https://docs.pencil.dev/for-developers/pen-cli) (closest peer: design files edited by agents) | `pen` CLI, "the same editor engine as the desktop app, fully headless" | both: headless by default, `pen interactive -a desktop` connects to the running app and changes apply live | MCP with four tools: `execute`, `get_app_state`, `read_skill` (format and workflow docs), `get_style`; the app's MCP adds `get_screenshot`, `snapshot_layout` ([AI integration](https://docs.pencil.dev/ai-integration)); `pen -p "prompt" -i in.pen -o out.pen` runs an agent in one command | `--export` PNG/JPEG/WEBP/PDF; `--enable-preview` writes a PNG after every change |
| [Excalidraw MCP](https://mcpservers.org/fr/servers/yctimlin/mcp_excalidraw) (community) | canvas server + CLI + stdio MCP sharing one core library | CLI and MCP start the canvas server if it is not running, then drive it; the open browser tab syncs live | 26 MCP tools, plus a REST API | screenshots and PNG rendered in the server (jsdom + resvg) |
| [Slidev](https://sli.dev/builtin/cli) | `slidev` (dev server), `slidev build`, `slidev export`, `slidev mcp` | headless export opens the deck's own print page in a browser | `slidev mcp`: stdio MCP to inspect and edit slides | PDF, PNG, PPTX, editable PPTX, Markdown; `--range`, `--dark`, `--with-clicks` |
| [Marp CLI](https://github.com/marp-team/marp-cli/blob/main/README.md) | one command; `-w` watch, `-s` server, `-p` preview | finds Chrome/Edge/Firefox on the machine (`--browser auto`, `--browser-path`); Docker image when nothing is installed | programmatic `marpCli(args)` returning an exit status | HTML, PDF, PPTX, PNG/JPEG; **server mode converts on request**: `GET /deck.md?pdf` |
| [Remotion](https://remotion.dev/docs/cli/) | `remotion studio / render / still / compositions / bundle / browser` | render bundles the project and drives a headless browser; `browser` makes sure one is there | `remotion skills add` installs agent skills into the project (`.agents/skills`, symlinked for Claude Code) ([docs](https://www.remotion.dev/docs/cli/skills)) | video, audio, stills |
| [Figma desktop MCP](https://developers.figma.com/docs/figma-mcp-server/local-server-installation) | MCP served by the running desktop app at `127.0.0.1:3845/mcp` | attach only; the app must be open | `get_screenshot`, `get_design_context`, `get_metadata`, `get_variable_defs` … | through tools |
| [Penpot MCP](https://help.penpot.app/mcp/) | `npx @penpot/mcp` local server + a plugin in the open Penpot tab | attach only; acts on the focused page of the tab that owns MCP | `execute_code`, `high_level_overview`, `penpot_api_info`, `export_shape`, `import_image` | `export_shape` |
| [Storybook MCP](https://storybook.js.org/docs/ai/mcp/overview) | addon serving MCP from the dev server at `/mcp` | attach to the dev server | `stories-preview`, `test-run` (with accessibility), docs tools: a "fix, re-run, confirm" loop | links/previews |
| Jupyter (from memory) | `jupyter server` writes a runtime file per server (port, token, root dir, pid); `jupyter server list` reads them | other tools find a running server through those files | — | `nbconvert` runs alone |

What this says for us:

1. **One command with `serve` plus headless export is the norm** (Slidev, Marp, Remotion, pen.dev). Every one of them exports by opening its own app's page in a headless browser, which is exactly the "export route in the editor" plan; nobody rewrites rendering for the CLI.
2. **Headless and attach are both needed, chosen automatically.** pen.dev has both modes; Excalidraw's CLI starts the server when none is running and otherwise drives the running one. Our option B with Excalidraw's auto-start is the same thing, and it is what keeps an open editor live.
3. **Agents need to see their work.** pen.dev writes a preview after each change, Pencil and Figma expose `get_screenshot`, Storybook pairs preview with tests. `snapshot` and `check` are the core of the agent loop, not extras: they move up the order.
4. **MCP tools stay few and wide.** pen.dev ships four tools, Penpot one `execute_code`; both put the format knowledge behind a `read_skill`-style tool. Our `.claude/skills/` already is that knowledge.
5. **MCP is served by the running server over HTTP** (Figma `/mcp`, Storybook `/mcp`, Penpot localhost) or as stdio for clients that launch it (Slidev, Excalidraw). We can do both from one place: `/mcp` on the server and `tingly-design mcp` as a stdio bridge to it.
6. **A service tool can be just a URL.** Marp's server converts on request (`?pdf`). `GET /api/projects/:p/export?as=pdf` would let any script or host fetch an export without the CLI.
7. **Ship the skills, don't just document them.** `remotion skills add` installs the agent's format references into the user's project; `tingly-design skills add` can do the same with ours.
8. **Exit codes matter.** pen.dev's docs warn an export failure can exit 0; a CLI meant for scripts must fail loudly.
9. **Hand-off both ways, and say what changed.** HyperFrames' `open` gives the project to the person's app and `catch-up` tells the agent what the person did meanwhile. Two-way editing is our whole premise and the journal already records every change with its actor, so `open` and `changes --since` are cheap and very on-brand.
10. **A compact read for agents.** `timeline --json` exists so an agent does not read every file. Our equivalent is `inspect --json`: boards, slides, scenes with timing, tokens, datasets, depending on the kind.
11. **One gate that includes looking.** HyperFrames' `check` reruns lint and then opens the browser, with `--snapshots` for annotated frames. Our `check` should do the same: parse and check, then render and report what broke, with `--snapshots`.
12. **Environment checks are a command.** `doctor` and `browser` answer "why can't I render" before the agent tries; we have the same need (Chrome, ffmpeg, the `claude` CLI, the model settings).

## 3. Options

### A. A `tingly-design` command in the package (CLI)

Add `bin` to the bundle's `package.json` pointing at a small `cli.mjs`, so `npx tingly-design …` or a global install works. Subcommands, all with `--projects <dir>` and `--json`:

```
tingly-design serve [--port 0] [--open]          today's server (default command)
tingly-design new <name> --kind slides           create from the starter
tingly-design list                               projects, kind, title
tingly-design check <project> [--snapshots]     parse and check every file, then render and report; exit 1 on problems
tingly-design inspect <project> --json           compact structure (boards, slides, scenes and timing, tokens, datasets)
tingly-design open <project> [--json]            hand it to the editor (running server, or start one) and print the URL
tingly-design changes <project> [--since v]      what changed since a version, and who (from the journal)
tingly-design doctor                             Chrome, ffmpeg, claude CLI, model settings
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

## 4. Recommendation

**A + B together, with MCP and skills as thin layers on the same core.** The peers above change the order more than the shape: seeing the result (`snapshot`, `check`) comes before `edit`, the server learns to auto-start, and HyperFrames' hand-off (`open`, `catch-up`) and compact read (`timeline --json`) carry over directly.

1. Split `index.ts` into `createApp()` and `startServer()` with no behaviour change; add `bin` and `cli.mjs` with `serve` (default), `new`, `list`, `inspect --json`, `check`, `doctor`, and motion `export` (move `motion-render.mjs` onto `render.ts` so there is one renderer).
2. Service lookup (`server.json`) with auto-start: a command uses the running server for its projects folder, or starts one quietly and stops it when done. `open` and `changes --since` come with it, as the hand-off between an agent and the person.
3. The editor's headless export route, then `snapshot`, `check --snapshots` and `export --as png|pdf|html` for every kind, and the same through `GET …/export?as=` on the server.
4. `/mcp` on the server with a few wide tools (`project`, `check`, `snapshot`, `export`, `read_skill`) and `tingly-design mcp` as the stdio bridge; `tingly-design skills add` to copy the format references into a user's project.
5. `edit "prompt"`: Claude Code first (it runs on the server already), fast AI once its apply loop runs in the headless page.

Steps 1–2 make it usable from a skill (create, check, render motion, live edits); step 3 is the biggest piece and the one that lets an agent look at what it made.

## 5. Open questions

- Projects outside the projects folder: the server is gaining `POST /api/links {path}` (open a folder anywhere, returns its name), `GET /api/folder?path=` and `path` on `POST /api/projects`. CLI commands should take a path as well as a name and go through those, not a second copy of the logic.
- The first npm release needs `bin` with at least `serve`; step 1 covers it.
- Command name: `tingly-design` (matches the npm package) or a short alias such as `td`.
- Does Tingly Box want to call the CLI, or keep launching `server.mjs` and use the HTTP API? Either works with B.
- `snapshot` for a dashboard needs its data; run the page's queries or show the last saved runs?
- `edit` with fast AI headless needs the editor's apply loop in a page; is a Claude-Code-only `edit` enough for a first version?
- MCP tool shape: one `execute` that takes code (pen.dev, Penpot) is powerful but hard to keep safe; named tools over files are easier to reason about. Leaning named tools.
- Cross-kind: every command must say what it does for each of the six kinds; add a CLI column to `.design/project-kinds.md` when this lands.
