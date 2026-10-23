<p align="right"><b>English</b> · <a href="../zh/cli.md">简体中文</a></p>

# Command line

`tingly-design` opens the editor, creates projects, says what is in them and what is wrong with them, and exports motion pieces, from a terminal, a script, CI or an agent's skill. Each command is named after the button that does the same thing in the editor.

```bash
npx tingly-design                 # the editor, at the launcher
npm i -g tingly-design            # or install it, then: tingly-design … (or the short td …)
pnpm tingly-design …              # in this repository
```

It needs Node 20 or newer. Exporting video needs Chrome or Edge and ffmpeg on the machine (`tingly-design check` says whether they are there).

## Commands

| Command | What it does |
|---|---|
| `tingly-design` | Start the server and open the launcher in the browser. |
| `open [project]` | Open a project in the browser. When the editor is already running on this projects folder, it opens there; otherwise it starts the server. A folder outside the projects folder is added to the launcher, as "Open folder" does. |
| `serve` | Run the server only, for a host app or a service (see [embedding](./embedding.md)). `node server.mjs` in the bundle is the same thing. |
| `new <kind> <name or folder>` | Create a project. Kinds: `canvas`, `slides`, `design-system`, `dashboard`, `doc`, `motion`. `--title` sets the title; `--look` (design system only) starts from one of 36 looks (`nord`, `swiss-grid`, `editorial-serif`, `bauhaus`, …; an unknown one is refused with the list); `--size` the first artboard's or the motion format's size: `1080x1920`, or for a canvas a name from the New dialog's list (`tingly-design new canvas cover --size wechat`): `artboard` 1200×760 (the default), `desktop`, `mobile`, `wide` 1920×1080, `standard`, `square`, `portrait` 1080×1350, `tall` 1080×1440, `story` 1080×1920, `wechat` 900×383, `og` 1200×630, `thumbnail`, `pin`, `xheader`, `linkedin`, `fbcover`, `channelart`, the web banner sizes `mpu`, `leaderboard`, `billboard`, `halfpage`, `skyscraper`, and `a4`, `letter`. An unknown size is refused with the full list and each size's width and height. A bare name makes a folder of that name in the current directory, as `git init` and `cargo new` do; a path (`./x`, `~/x`, `/abs`) makes it there; either way the project is added to the launcher, so `open <name>` works from anywhere, and the command prints the full path. `--global` keeps a bare name in the projects folder instead (`~/.tingly-design/projects/` for an install). Where a folder is is what makes a project that project: two projects may have the same folder name in different places, and a project outside the projects folder is addressed by its folder's name and a short code made from its path (`foo-3f9a1c`: what `list` shows, `new` prints and `?p=` carries), the same code every time, and the names earlier versions gave still work; `--global` with a name already in the projects folder is refused. Projects made earlier stay where they are and open by name as before. |
| `new -i` | Create a project by answering questions, in the order of the New dialog: the kind (all six), a title, the folder name (suggested from the title; or a path to keep it elsewhere), and for a canvas the size category (Screen, Slides, Social and covers, Web ads, Print, Custom) then a size in it, for a motion piece its format (or Custom). Answer with a number, the name, or Enter for the default shown. Whatever the command line already gives (`new -i canvas`, `--title`, `--size`, a name) is not asked again. Afterwards it offers to open the project in the editor; say no and it prints `tingly-design open <name>`. Typing `new` with nothing else in a terminal does the same. Ctrl+C or Ctrl+D leaves without creating anything; with no terminal (a pipe, CI) `-i` stops with an error telling you to give the kind and name. |
| `list [project]` | The projects in the launcher; with a project, what is in it: boards and their sizes, slides, formats and scenes with their times, tabs and their length, datasets, colours, fonts and components. |
| `check [project]` | With a project, the problems the editor would show (a missing file, an artboard that does not parse, a slide or scene outside the subset, a bad dataset or token); exits with 1 when there is an error. `--snapshots` also draws every board, slide, tab, design-system view or motion cover, reports any that cannot be drawn, a script in the work that throws, and a picture, font, style or script it asks for that does not load (a project file that is not there is reported as missing) (for motion it also warns, as `seek`, when a format does not show the same picture at the same time whatever came before, so the video would not match the preview), warns about how the drawn work is laid out (text cut off by its box, text past a board's or slide's edge, text too faint on a plain background, a frame with nothing drawn), and keeps the pictures in the project's `renders/check/` (or `--out`) to look at. With no project, what this machine can do: Chrome, ffmpeg, the `claude` CLI and the fast model. |
| `export <project> --as <format>` | What the Export menu saves, by its name, written to the project's `renders/` or `--out`: a canvas as `png` (every board, or `--board <file or title>`; `--scale 2` for PNG @2x); slides as `pdf`, `png` (every slide, or `--slide <id or number>`), `html`, `md`, `notes` or `pptx` (whole visible deck only; `--slide` is rejected for PPTX); a doc as `pdf`, `html`, `md` (the whole doc, or `--tab <id or title>`; a `.zip` with the pictures when it has any) or `png` (each tab); a design system as `png` (the overview, or `--view colors`…); a dashboard as `png`. These are drawn by the editor itself in Chrome, so the file is the one the menu's button makes (below). A motion piece exports as `mp4`, `gif`, `png` (its cover) or `html` (a single-file player anyone can open, with every format, a scrubber and the speeds; it needs no Chrome): `--format wide,tall` picks formats; `--speed`, `--fps`, `--quality low|medium|high`, `--width`, `--height` as in the export dialog (one side alone keeps the piece's proportions); `--scale 2` draws each frame at twice the size and scales it down, for sharper type; an MP4 carries the cover as cover art and the cover PNG is written beside it (`"coverFirstFrame": true` in motion.json also makes a whole-piece MP4 start on the cover). Any project also exports as `zip` (below). |
| `export <project> --as zip` | The whole project as one `.zip` in the current folder or `--out`, the same as “Whole project (.zip)” in the editor: every file, the change log and the design systems it installed, beside it. `--files-only` leaves the change log and the systems out. |
| `prompt <project> <request>` | Hand a request to Claude Code, as the request bar's Hand to Claude Code does. The editor runs it (the one open on the projects folder, or one started for the run), so its edits show live and are credited to Claude in the history. Prints the steps as it works, what it said, the history entries it made, and a session id. A project keeps its Claude Code conversation (in `.claude-session.json`), so the next `prompt`, from any window or the editor, continues it; `--new` starts a fresh one and `--continue <session>` picks a particular one. `--file <file>` names the board, slide, tab or scene the request is about. Ctrl+C stops it. Needs the `claude` CLI. `--fast` (canvas, slides, motion) uses the request bar's fast AI instead: Chrome opens the editor and the fast model edits one file (`--file`, or the first board, slide or scene) in seconds, or hands the request to Claude Code itself when it is too big. |
| `history <project>` | The change history: when, who (by hand, fast AI, Claude, outside, undo), which file and what changed, newest last. The last 20 by default (`--limit <n>`); `--since` takes an entry id from `--json`, a time, or how long ago (`30m`, `2h`, `1d`) and lists everything after it. An id that is not in the history is an error (exit code 1), not "no changes". |
| `export <project> --as claude-design` | A canvas, slides, design system or dashboard in the original Claude type's layout, as one `.zip` with a README for Claude Code, the same as “Claude Design package (.zip)” in the editor ([guide](guide/claude-design.md)). |
| `import <file.zip, file.md, file.pptx or folder>` | A project from such a `.zip` (or a project folder zipped by hand), a Claude Design package (the `.zip`, or the folder Claude Code saved from an original artifact), a Claude Docs `.md` export, or a PowerPoint `.pptx` converted into a new editable slides project, the same as the home page’s PowerPoint, Markdown and project package import actions. It joins the projects folder under its own name, or with `-2` when that is taken, and prints the name. PPTX keeps the original and conversion report in `uploads/`; unsupported content is refused with a location and reason, with no partial project. See the [slides guide](guide/slides.md#powerpoint-pptx) for its conservative subset. |

| `skills [add [folder]]` | The format references an agent reads before editing a project, one per kind. `add` copies them into the folder's `.claude/skills/` (default: the current folder), with the reference pages a skill points to (`reference/*.md`), so Claude Code working there knows the files; a copy that differs from this version's is kept unless `--force`. |
| `mcp` | These commands as an MCP server on stdio, for an agent to start (below). |

A project is its folder: the argument is a path (`./pitch`, `~/work/site`), and with none, for `export`, `prompt` and `history`, the folder you are in. Names can repeat, paths cannot, so a name is only used when you say so with `-n` / `--name` (`tingly-design check pitch --name`); a name that fits more than one project lists every path instead of picking one. A plain word that is not a project folder says where a project of that name is. Claude Code sessions the editor starts read the argument as a name, as they run from the editor's folder, not the project's. `list`, `check` and `export` read a path where it is, without adding it to the launcher.

## With the editor open

A running server writes `.server.json` in its projects folder and removes it when it stops. When one is running on the same folder, `open` and `new` go through it: no second server starts, a folder you link or create shows up in the open launcher at once, and its list of linked folders stays whole. `tingly-design check` with no project says whether one is running. `--port` on `open` always starts a server of its own. Under `pnpm dev` the editor's address is Vite's (`DC_EDITOR_URL`, default `http://localhost:5173/`).

Pictures, PDFs, PPTX, HTML and Markdown (everything but zip and motion) are made by the editor's page: Chrome or Edge opens the editor on the project, in light and in the command's language, waits for its data and pictures to load, and runs the Export menu's own items. It uses the editor already running on the projects folder, or starts one for the export and stops it after (that one does not announce itself, and a folder given by its path is not added to the launcher). Run from this repository, that needs the editor built (`pnpm build`) unless `pnpm dev` is running. `DC_LOG_LEVEL=debug` prints what the page logged.

## As an MCP server

An agent that speaks MCP gets one tool per step of the work: `projects` (what exists), `open` (enter a project, or make one when you give `kind`; returns its folder, outline and the uri of its format reference), `check` (the problems, as text, fast), `look` (draws the work and hands the pictures back, scaled to 1000 pixels on the longer side; `pick` draws one board, slide, tab or view, otherwise the first 6 come back and the rest stay on disk in `renders/check/`), `export` (`pick` names the one board, slide, tab or view), `history` and `prompt`. Each kind's format reference, and the reference pages it names, are resources (`tingly-design://skills/<kind>` and `…/<kind>/<page>`), and the prompts `make` and `edit` start the work with the reference already included. The agent edits a project's files with its own file tools; exports go to the project's `renders/`.

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
