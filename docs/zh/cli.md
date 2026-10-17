<p align="right"><a href="../en/cli.md">English</a> · <b>简体中文</b></p>

# 命令行

`tingly-design` 可以在终端、脚本、CI 或 agent 的 skill 里打开编辑器、新建项目、列出项目里有什么、检查有什么问题、导出动效。每个命令的名字和编辑器里做同一件事的按钮一样。

```bash
npx tingly-design                 # 打开编辑器的启动页
npm i -g tingly-design            # 或者装上，之后直接 tingly-design …
pnpm tingly-design …              # 在本仓库里
```

需要 Node 20 或更新。导出视频还需要本机有 Chrome 或 Edge，以及 ffmpeg（`tingly-design check` 会告诉你有没有）。

## 命令

| 命令 | 做什么 |
|---|---|
| `tingly-design` | 起服务，在浏览器里打开启动页。 |
| `open [项目]` | 在浏览器里打开一个项目。这个项目文件夹上已经有编辑器在运行时，就在那里打开；否则起服务。项目文件夹之外的文件夹会加到启动页上，和"打开文件夹"一样。 |
| `serve` | 只起服务，给宿主应用或常驻服务用（见[嵌入](./embedding.md)）。bundle 里的 `node server.mjs` 就是它。 |
| `new <类型> <名字或文件夹>` | 新建项目。类型：`canvas`、`slides`、`design-system`、`dashboard`、`doc`、`motion`。`--title` 设标题；`--size 1080x1920` 设第一块画板或动效格式的尺寸。给的是文件夹路径时，项目建在那里并加到启动页上。 |
| `list [项目]` | 启动页上的项目；带项目时列出里面有什么：画板和尺寸、幻灯片、格式和各场景的时间、标签页和字数、数据集、颜色、字体、组件。 |
| `check [项目]` | 带项目时，列出编辑器会报的问题（文件缺失、画板解析不了、幻灯片或场景超出子集、数据集或令牌有误），有错误时退出码为 1。`--snapshots` 再把每个画板、幻灯片、标签页、设计系统视图或动效封面画一遍，报告画不出来的、作品里脚本抛出的错，以及要用的图片、字体、样式、脚本没加载出来的（项目里不存在的文件算作缺失）（动效还会检查同一时刻是否总是同一个画面，不是的话报 `seek` 警告，说明导出的视频会和预览对不上），图留在项目的 `renders/check/`（或 `--out`）里可以看。不带项目时，看这台机器能做什么：Chrome、ffmpeg、`claude` 命令和快速 AI。 |
| `export <项目> --as <格式>` | “导出”菜单能存的格式，用它的名字，写进项目的 `renders/` 或 `--out`：画布 `png`（每个画板，或 `--board <文件名或标题>`；`--scale 2` 是 PNG @2x）；幻灯片 `pdf`、`png`（每一页，或 `--slide <编号或第几页>`）、`html`、`notes`；文档 `pdf`、`html`、`md`（整篇，或 `--tab <编号或标题>`）、`png`（每个标签页）；设计系统 `png`（总览，或 `--view colors`…）；看板 `png`。这些由编辑器自己在 Chrome 里画，和菜单按钮存的是同一个文件（见下）。动效导出为 `mp4`、`gif`、`png`（封面）或 `html`（谁都能打开的单文件播放器，含所有格式、进度条和速度，不需要 Chrome）：`--format wide,tall` 选格式；`--speed`、`--fps`、`--quality low|medium|high`、`--width`、`--height` 和导出对话框一样（只给一边时另一边按作品比例算）；`--scale 2` 每帧按两倍大小画再缩回，文字更清晰；导出整段 MP4 时第一帧是封面，并带着封面图，封面 PNG 写在旁边。任何项目都可以导出 `zip`（见下）。 |
| `export <项目> --as zip` | 整个项目存成一个 `.zip`，放在当前文件夹或 `--out`，和编辑器里的“整个项目（.zip）”一样：所有文件、改动记录，以及装进来的设计系统（并排放着）。`--files-only` 不带改动记录和设计系统。 |
| `prompt <项目> <请求>` | 把请求交给 Claude Code，和请求栏的“交给 Claude Code”一样。由编辑器来跑（项目文件夹上已经打开的那个，或者为这次起一个），所以改动实时显示，改动记录里记成 Claude。工作时列出每一步，最后输出它说的话、改动记录里多出的条目，以及用 `--continue <会话>` 接着说的会话。`--file <文件>` 说明请求针对哪个画板、幻灯片、标签页或场景。Ctrl+C 停止。需要 `claude` 命令。`--fast`（画布、幻灯片、动效）改用请求栏的快速 AI：Chrome 打开编辑器，快速模型几秒内改一个文件（`--file`，或者第一个画板、幻灯片、场景），太大的请求它会自己交给 Claude Code。 |
| `history <项目>` | 改动记录：什么时候、谁（手改、快速 AI、Claude、外部、撤销）、哪个文件、改了什么，最新的在最后。默认列最近 20 条（`--limit <n>`）；`--since` 接 `--json` 里的记录编号、一个时间或多久以前（`30m`、`2h`、`1d`），列出那之后的全部。编号不在记录里时报错（退出码 1），不当成“没有改动”。 |
| `import <文件.zip>` | 从这样的 `.zip`（或自己压缩的项目文件夹）导入项目，和首页的“导入项目（.zip）…”一样。导入到项目文件夹，名字被占用时加 `-2`，并输出新名字。 |

| `skills [add [文件夹]]` | agent 改项目前要读的格式说明，每种类型一份。`add` 把它们复制到文件夹的 `.claude/skills/`（默认：当前文件夹），在那里工作的 Claude Code 就认得这些文件；和这个版本不一样的副本保留，除非加 `--force`。 |
| `mcp` | 以 stdio 上的 MCP 服务提供这些命令，给 agent 启动用（见下）。 |

项目可以是启动页上的名字，也可以是文件夹路径。`list`、`check`、`export` 就地读路径，不会把它加到启动页上。

## 编辑器已经打开时

运行中的服务会在它的项目文件夹里写 `.server.json`，停下时删掉。同一个文件夹上有服务在运行时，`open` 和 `new` 交给它来做：不会再起第二个服务，登记或新建的文件夹马上出现在打开着的启动页上，它记着的链接文件夹也不会被覆盖。不带项目的 `tingly-design check` 会说有没有编辑器在运行。`open` 带了 `--port` 时总是自己起服务。`pnpm dev` 下编辑器地址是 Vite 的（`DC_EDITOR_URL`，默认 `http://localhost:5173/`）。

图片、PDF、HTML 和 Markdown（除了 zip 和动效）由编辑器的页面来做：Chrome 或 Edge 打开编辑器里的项目（浅色、命令的语言），等数据和图片加载完，再跑“导出”菜单自己的项。用的是这个项目文件夹上已经在运行的编辑器；没有就为这次导出起一个、导完就停（它不登记自己，按路径给的文件夹也不会加到启动页上）。在本仓库里运行时，没开 `pnpm dev` 就要先构建编辑器（`pnpm build`）。`DC_LOG_LEVEL=debug` 会打印页面里的日志。

## 作为 MCP 服务

能说 MCP 的 agent 直接拿到这些命令作为工具：`list`、`read_skill`、`new`、`check`、`export`、`prompt`、`history`，参数和命令一样；每种类型的格式说明是资源（`tingly-design://skills/<类型>`）。agent 用自己的文件工具改项目文件；`check` 带 `snapshots: true` 时把图直接放在结果里，长边缩到 1200 像素（最多 12 张；原尺寸的图留在 `renders/check/`）。导出写到项目的 `renders/`。

```bash
claude mcp add tingly-design -- npx -y tingly-design mcp          # 由 agent 启动，走 stdio
claude mcp add --transport http tingly-design http://127.0.0.1:8787/mcp   # 用已经在运行的编辑器
```

用 JSON 配置的客户端（Claude Desktop、IDE）：`{"mcpServers": {"tingly-design": {"command": "npx", "args": ["-y", "tingly-design", "mcp"]}}}`。stdio 服务和命令一样，会找到同一个项目文件夹上正在运行的编辑器（`--projects` 指定文件夹）。正在运行的编辑器的 `/mcp` 只接受本机或它自己页面来的请求，只导出启动页上有的项目。

## 通用选项

| 选项 | |
|---|---|
| `--projects <文件夹>` | 项目文件夹。默认：本仓库里是 `projects/`，从 npm 装的是 `~/.tingly-design/projects`，或者 `DC_PROJECTS`。 |
| `--json` | 输出数据而不是表格，给脚本或 agent 读。进度写到 stderr，结果写到 stdout。 |
| `--port <n>`、`--host <地址>` | `open`、`serve`：监听在哪。`open` 要的端口被占用时换一个空闲端口。 |
| `-v`、`--version`；`-h`、`--help` | |

提示语言按 `DC_LANG`，再看 `LC_ALL` / `LANG`（`en` 或 `zh`）。退出码：`0` 完成，`1` 完成但有问题或失败，`2` 命令没看懂。

## 在 skill 或脚本里用

```bash
npx tingly-design new slides pitch --title "Q3 路演"
# … 编辑 projects/pitch/*.dc.html …
npx tingly-design prompt pitch "把标题页写得更紧凑" --json   # 或者交给编辑器的 Claude Code
npx tingly-design check pitch --snapshots --json         # 有什么问题，每页幻灯片的图在 projects/pitch/renders/check/
npx tingly-design export pitch --as pdf --out dist/
npx tingly-design export promo --as mp4 --format wide --out dist/
npx tingly-design export pitch --as zip --out dist/   # 交给别人；tingly-design import dist/pitch.zip 再打开
npx tingly-design open pitch                          # 给人看；在对方已经打开的编辑器里
npx tingly-design history pitch --since 3f9a1c20      # 上次看到那条记录之后，对方改了什么
```

每种类型的文件格式见 `.claude/skills/<类型>/SKILL.md`（`tingly-design skills add` 把它们复制到别的仓库）。命令为什么这样设计、后面还要做什么，见 `.design/cli.md`。
