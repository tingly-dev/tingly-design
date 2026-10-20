<p align="right"><b>English</b> · <a href="../zh/embedding.md">简体中文</a></p>

# Embedding

Tingly Design can run inside another app, the way Tingly Box mounts it as a page of its own console. The host ships a bundle, starts it as a child process, forwards a path prefix to it, and frames the editor. Nothing in the editor knows which host it is in: everything goes through the contract below.

```
 host (e.g. Tingly Box, :12580)                         tingly-design bundle (node server.mjs)
 ┌───────────────────────────────┐   /design/*  ──→    ┌───────────────────────────────────┐
 │ its own page with an <iframe  │                     │ editor, API and sandbox, all       │
 │ src="/design/?theme=…">       │ ←── postMessage ──→ │ under DC_BASE_PATH=/design         │
 └───────────────────────────────┘                     │ files in DC_PROJECTS               │
         model gateway  ←──── ANTHROPIC_BASE_URL ───── │ fast AI and Claude Code            │
                                                       └───────────────────────────────────┘
```

## 1. The bundle

```bash
pnpm bundle        # builds, then writes dist/tingly-design/
```

| Path | What it is |
|---|---|
| `cli.mjs` | The `tingly-design` command with every dependency bundled in (the npm package's `bin`; see [command line](./cli.md)). Needs only Node (see `node` in the manifest). |
| `server.mjs` | `tingly-design serve`: the server alone, for a host. |
| `tingly-design.json` | `{ name, version, protocol, entry, node }`: check `protocol` before launching. |
| `editor/`, `sandbox/` | The built editor and the artboard runtime. |
| `samples/` | The sample projects, copied into a projects folder that does not exist yet, filed together in a launcher group named `tingly-design`. Only the projects' files go in; whatever a machine keeps beside them (journal, run reports, Claude Code session, transcript) does not. |
| `scripts/`, `.claude/skills/` | What Claude Code reads and runs when work is handed to it. |

Copy the folder anywhere; it does not need this repository or `node_modules`.

Released versions come ready-made: `tingly-design-<ver>.tgz` and its `.sha256` on the GitHub release, or the same contents as the npm package `@tingly-dev/tingly-design` (also published as `tingly-design`). It unpacks into `package/`, which is this folder, plus `LICENSE` (Apache-2.0), `NOTICE` and `THIRD_PARTY_LICENSES.txt` (the notices of the dependencies bundled in).

## 2. Launching it

Run `node <bundle>/server.mjs` with these variables:

| Variable | Host sets it to |
|---|---|
| `PORT` | `0` to let the server pick a free port (read it from the ready line), or a fixed port. |
| `DC_HOST` | Leave unset: the server listens on `127.0.0.1`. The host is what people reach. |
| `DC_BASE_PATH` | The prefix it is mounted under, such as `/design`. Every route, the editor and its assets move below it; the bare prefix redirects to `prefix/`. Forward the path unchanged. |
| `DC_PROJECTS` | A folder in the host's data directory, such as `~/.tingly-box/design/projects`. If it does not exist, it starts with the samples (`DC_SAMPLES=0` to start empty). Unset, the bundle keeps projects in `~/.tingly-design/projects`, never inside its own folder, which an upgrade replaces. While it runs, the server keeps a `.server.json` there, so `tingly-design open` and `new` on the same folder go through it ([command line](./cli.md#with-the-editor-open)). |
| `DC_LINKS` | `0` to keep every project in `DC_PROJECTS`. Otherwise people can open a project folder anywhere on the machine, or create one there, from the launcher; such folders are listed in `DC_PROJECTS/.links.json` and stay where they are. |
| `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` | The host's model gateway and a token for it. Fast AI calls it; "hand to Claude Code" runs `claude` with the same environment, so both go through the host. |
| `DC_FAST_MODEL`, `DC_DELEGATE_MODEL` | Model names the gateway understands. |
| `DC_IMAGE_BASE_URL`, `DC_IMAGE_MODEL`, `DC_IMAGE_API_KEY`, `DC_IMAGE_ENABLED` | Optional: an OpenAI-style image gateway (`<base>/images/generations`, `<base>/images/edits`), its model name and key. Tingly Box's is `http://localhost:12580/tingly/imagegen/v1`. Unset, the address follows the connection when that is Tingly Box; the key defaults to `ANTHROPIC_AUTH_TOKEN`. `DC_IMAGE_ENABLED=0` switches image generation off for every project while keeping the settings. |
| `DC_LOG_LEVEL`, `DC_LOG_FORMAT` | Server log: `error`, `warn`, `info` (default), `debug` or `silent`; `json` for one object per line on stderr. See [development](./development.md#server-log). |
| `DC_CONFIG` | Where the editor's AI model settings are saved (default: `.tingly-design/ai.json` beside `DC_PROJECTS`, or `~/.tingly-design/ai.json` when `DC_PROJECTS` is unset). Anything the host sets above wins over it, and the settings dialog shows that field as set by the host and read-only. |
| `DC_THEME` | The default look when the person has not picked one (a preset name or JSON, see [Themes](theming.md)). |
| `DC_LANG` | The UI language when neither the link nor the person chose one (`en` or `zh`; tags such as `zh-CN` work too). Unset, it follows the browser, then English. |
| `DC_EXIT_WITH_STDIN` | `1`, with stdin a pipe the host holds open: the server exits when the pipe closes, so it never outlives a host that crashed. |

When it is listening it prints one line:

```
TINGLY_DESIGN_READY {"port":41873,"basePath":"/design","version":"0.1.0","protocol":1}
```

`GET <prefix>/api/health` answers with the same `version`, `protocol` and `basePath`, plus whether fast AI and the `claude` CLI are available. `SIGTERM` (or closing stdin) stops it and any Claude Code run it started.

Claude Code runs in the bundle folder, where it finds its format references, and gets `--add-dir` for a projects folder outside it, and for a project opened from elsewhere. Committing works when the projects folder is inside a git repository and says why not otherwise.

## 3. Forwarding requests

Forward `<prefix>/*` to `http://127.0.0.1:<port><prefix>/*` with the path, query and body unchanged, and without buffering responses: `<prefix>/api/projects/<p>/events` is a server-sent event stream and `<prefix>/api/projects/<p>/fast-edit` streams text.

The server has no login of its own. If the host has one, check it in the forwarding layer. Artboards run in sandboxed frames with an opaque origin, so their requests carry no cookies: let `GET <prefix>/sandbox/*` (the open-source runtime) and `GET <prefix>/api/projects/<p>/raw/*` (a project's images and fonts) through without it, or the canvas cannot draw.

## 4. Talking to the framed editor

Frame `<prefix>/` (or `<prefix>/?p=<project>` to open one). Messages are plain objects with a `type`; the editor only listens to its parent (or the window that opened it).

From the host:

| Message | Does |
|---|---|
| `{ type: 'tingly-design:open', project: 'box-console' }` | Opens a project; `project: null` goes back to the launcher. |
| `{ type: 'tingly-design:open', search: '?p=tingly-intro&s=box' }` | Restores a full address the host mirrored (see `location` below). |
| `{ type: 'tingly-design:set-theme', theme }` | Applies a theme until the page reloads; `theme` is a preset name, tokens or a Tingly Box palette ([Themes](theming.md)). |
| `{ type: 'tingly-design:set-language', language: 'zh' }` | Switches the UI language until the page reloads; tags such as `zh-CN` or `en-US` work, unknown languages are ignored. `?lang=zh` on the framed address does the same at load. |

From the editor:

| Message | When |
|---|---|
| `{ type: 'tingly-design:ready', version, protocol, project, search, language }` | Every page load: the launcher (`project: null`) or a project; `language` is the UI language. |
| `{ type: 'tingly-design:location', project, search }` | The address changed inside a project (a slide, a tab, a view). |
| `{ type: 'tingly-design:theme-changed', theme: { id, mode, scheme, name } }` | Any theme change, including the person's own pick. |
| `{ type: 'tingly-design:language-changed', language }` | Any language change, including the person's pick in the appearance menu. |

A host that keeps `search` in its own URL (`/design?p=tingly-intro&s=box`) gives people working back buttons, reloads and links: on load, frame `<prefix>/` + that search.

Opening a project is a page load inside the frame, so a `ready` follows every `open`.

## Versioning

`protocol` (in the manifest, the ready line and `/api/health`) goes up when the launch variables, the ready line, `/api/health` or the messages above change incompatibly. A host should refuse a bundle whose protocol it does not know. Additions that old hosts can ignore keep the number.

---

Back to the [README](../../README.md)
