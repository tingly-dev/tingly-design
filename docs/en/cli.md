<p align="right"><b>English</b> · <a href="../zh/cli.md">简体中文</a></p>

# Command line

`tingly-design` opens the editor, creates projects, says what is in them and what is wrong with them, and exports motion pieces, from a terminal, a script, CI or an agent's skill. Each command is named after the button that does the same thing in the editor.

```bash
npx tingly-design                 # the editor, at the launcher
npm i -g tingly-design            # or install it, then: tingly-design …
pnpm tingly-design …              # in this repository
```

It needs Node 20 or newer. Exporting video needs Chrome or Edge and ffmpeg on the machine (`tingly-design check` says whether they are there).

## Commands

| Command | What it does |
|---|---|
| `tingly-design` | Start the server and open the launcher in the browser. |
| `open [project]` | Open a project in the browser. When the editor is already running on this projects folder, it opens there; otherwise it starts the server. A folder outside the projects folder is added to the launcher, as "Open folder" does. |
| `serve` | Run the server only, for a host app or a service (see [embedding](./embedding.md)). `node server.mjs` in the bundle is the same thing. |
| `new <kind> <name or folder>` | Create a project. Kinds: `canvas`, `slides`, `design-system`, `dashboard`, `doc`, `motion`. `--title` sets the title; `--size 1080x1920` the first artboard's or the motion format's size. Given a folder path, the project is made there and added to the launcher. |
| `list [project]` | The projects in the launcher; with a project, what is in it: boards and their sizes, slides, formats and scenes with their times, tabs and their length, datasets, colours, fonts and components. |
| `check [project]` | With a project, the problems the editor would show (a missing file, an artboard that does not parse, a slide or scene outside the subset, a bad dataset or token); exits with 1 when there is an error. `--snapshots` also draws every board, slide, tab, design-system view or motion cover, reports any that cannot be drawn, and keeps the pictures in the project's `renders/check/` (or `--out`) to look at. With no project, what this machine can do: Chrome, ffmpeg, the `claude` CLI and the fast model. |
| `export <project> --as <format>` | What the Export menu saves, by its name, written to the project's `renders/` or `--out`: a canvas as `png` (every board, or `--board <file or title>`; `--scale 2` for PNG @2x); slides as `pdf`, `png` (every slide, or `--slide <id or number>`), `html` or `notes`; a doc as `pdf`, `html`, `md` (the whole doc, or `--tab <id or title>`) or `png` (each tab); a design system as `png` (the overview, or `--view colors`…); a dashboard as `png`. These are drawn by the editor itself in Chrome, so the file is the one the menu's button makes (below). A motion piece exports as `mp4`, `gif` or `png` (its cover): `--format wide,tall` picks formats; `--speed`, `--fps`, `--quality low|medium|high`, `--width`, `--height` as in the export dialog; an MP4 of the whole piece starts on the cover and carries it as cover art, and the cover PNG is written beside it. Any project also exports as `zip` (below). |
| `export <project> --as zip` | The whole project as one `.zip` in the current folder or `--out`, the same as “Whole project (.zip)” in the editor: every file, the change log and the design systems it installed, beside it. `--files-only` leaves the change log and the systems out. |
| `prompt <project> <request>` | Hand a request to Claude Code, as the request bar's Hand to Claude Code does. The editor runs it (the one open on the projects folder, or one started for the run), so its edits show live and are credited to Claude in the history. Prints the steps as it works, what it said, the history entries it made, and a session to continue with `--continue <session>`. `--file <file>` names the board, slide, tab or scene the request is about. Ctrl+C stops it. Needs the `claude` CLI. `--fast` (canvas, slides, motion) uses the request bar's fast AI instead: Chrome opens the editor and the fast model edits one file (`--file`, or the first board, slide or scene) in seconds, or hands the request to Claude Code itself when it is too big. |
| `history <project>` | The change history: when, who (by hand, fast AI, Claude, outside, undo), which file and what changed, newest last. The last 20 by default (`--limit <n>`); `--since` takes an entry id from `--json`, a time, or how long ago (`30m`, `2h`, `1d`) and lists everything after it. An id that is not in the history is an error (exit code 1), not "no changes". |
| `import <file.zip>` | A project from such a `.zip` (or a project folder zipped by hand), the same as “Import a project (.zip)…” on the home page. It joins the projects folder under its own name, or with `-2` when that is taken, and prints the name. |

| `skills [add [folder]]` | The format references an agent reads before editing a project, one per kind. `add` copies them into the folder's `.claude/skills/` (default: the current folder), so Claude Code working there knows the files; a copy that differs from this version's is kept unless `--force`. |
| `mcp` | These commands as an MCP server on stdio, for an agent to start (below). |

A project is a name from the launcher or a path to its folder. `list`, `check` and `export` read a path where it is, without adding it to the launcher.

## With the editor open

A running server writes `.server.json` in its projects folder and removes it when it stops. When one is running on the same folder, `open` and `new` go through it: no second server starts, a folder you link or create shows up in the open launcher at once, and its list of linked folders stays whole. `tingly-design check` with no project says whether one is running. `--port` on `open` always starts a server of its own. Under `pnpm dev` the editor's address is Vite's (`DC_EDITOR_URL`, default `http://localhost:5173/`).

Pictures, PDFs, HTML and Markdown (everything but zip and motion) are made by the editor's page: Chrome or Edge opens the editor on the project, in light and in the command's language, waits for its data and pictures to load, and runs the Export menu's own items. It uses the editor already running on the projects folder, or starts one for the export and stops it after (that one does not announce itself, and a folder given by its path is not added to the launcher). Run from this repository, that needs the editor built (`pnpm build`) unless `pnpm dev` is running. `DC_LOG_LEVEL=debug` prints what the page logged.

## As an MCP server

An agent that speaks MCP gets the commands as tools: `list`, `read_skill`, `new`, `check`, `export`, `prompt` and `history`, with the same arguments, and each kind's format reference as a resource (`tingly-design://skills/<kind>`). The agent edits a project's files with its own file tools; `check` with `snapshots: true` hands the pictures back in its result. Exports go to the project's `renders/`.

```bash
claude mcp add tingly-design -- npx -y tingly-design mcp          # started by the agent, on stdio
claude mcp add --transport http tingly-design http://127.0.0.1:8787/mcp   # the editor already running
```

In a client that takes a JSON config (Claude Desktop, an IDE): `{"mcpServers": {"tingly-design": {"command": "npx", "args": ["-y", "tingly-design", "mcp"]}}}`. The stdio server finds the editor running on the same projects folder, as the commands do (`--projects` picks the folder). The running editor's `/mcp` answers only requests from this machine or its own pages, and exports only projects its launcher lists.

## Options for every command

| Option | |
|---|---|
| `--projects <folder>` | The projects folder. Default: `projects/` in this repository, `~/.tingly-design/projects` when installed from npm, or `DC_PROJECTS`. |
| `--json` | Print data instead of a table, for a script or an agent. Progress goes to stderr, results to stdout. |
| `--port <n>`, `--host <addr>` | `open`, `serve`: where to listen. `open` moves to a free port when the one asked for is taken. |
| `-v`, `--version`; `-h`, `--help` | |

Messages follow `DC_LANG`, then `LC_ALL` / `LANG` (`en` or `zh`). Exit codes: `0` done, `1` done with problems or failed, `2` the command was not understood.

## In a skill or a script

```bash
npx tingly-design new slides pitch --title "Q3 pitch"
# … edit projects/pitch/*.dc.html …
npx tingly-design prompt pitch "Tighten the title slide" --json   # or let the editor's Claude Code do it
npx tingly-design check pitch --snapshots --json         # problems, and a picture of every slide in projects/pitch/renders/check/
npx tingly-design export pitch --as pdf --out dist/
npx tingly-design export promo --as mp4 --format wide --out dist/
npx tingly-design export pitch --as zip --out dist/   # hand it over; tingly-design import dist/pitch.zip opens it again
npx tingly-design open pitch                          # show the person; in the editor they already have open
npx tingly-design history pitch --since 3f9a1c20      # what they changed after the entry you saw last
```

The format of each kind is in `.claude/skills/<kind>/SKILL.md` (`tingly-design skills add` copies them into another repository). Why the command looks the way it does, and what comes next, is in `.design/cli.md`.
