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
| `open [project]` | Start the server and open a project. A folder outside the projects folder is added to the launcher, as "Open folder" does. |
| `serve` | Run the server only, for a host app or a service (see [embedding](./embedding.md)). `node server.mjs` in the bundle is the same thing. |
| `new <kind> <name or folder>` | Create a project. Kinds: `canvas`, `slides`, `design-system`, `dashboard`, `doc`, `motion`. `--title` sets the title; `--size 1080x1920` the first artboard's or the motion format's size. Given a folder path, the project is made there and added to the launcher. |
| `list [project]` | The projects in the launcher; with a project, what is in it: boards and their sizes, slides, formats and scenes with their times, tabs and their length, datasets, colours, fonts and components. |
| `check [project]` | With a project, the problems the editor would show (a missing file, an artboard that does not parse, a slide or scene outside the subset, a bad dataset or token); exits with 1 when there is an error. With no project, what this machine can do: Chrome, ffmpeg, the `claude` CLI and the fast model. |
| `export <project> --as <format>` | A motion piece as `mp4`, `gif` or `png` (its cover), written to the project's `renders/` or `--out`. `--format wide,tall` picks formats; `--speed`, `--fps`, `--quality low|medium|high`, `--width`, `--height` as in the export dialog. An MP4 of the whole piece starts on the cover and carries it as cover art; the cover PNG is written beside it. Other kinds come later. |

A project is a name from the launcher or a path to its folder. `list`, `check` and `export` read a path where it is, without adding it to the launcher.

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
npx tingly-design check pitch --json
npx tingly-design export promo --as mp4 --format wide --out dist/
```

The format of each kind is in `.claude/skills/<kind>/SKILL.md`. Why the command looks the way it does, and what comes next (attaching to a running editor, exporting every kind, MCP, `prompt`), is in `.design/cli.md`.
