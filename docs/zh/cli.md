<p align="right"><a href="../en/cli.md">English</a> · <b>简体中文</b></p>

# 命令行

`tingly-design` 可以在终端、脚本、CI 或 agent 的 skill 里打开编辑器、新建项目、列出项目里有什么、检查有什么问题、导出动效。每个命令的名字和编辑器里做同一件事的按钮一样。

```bash
npx tingly-design                 # 打开编辑器的启动页
npm i -g tingly-design            # 或者装上，之后直接 tingly-design …（或简写 td …）
pnpm tingly-design …              # 在本仓库里
```

需要 Node 20 或更新。导出视频还需要本机有 Chrome 或 Edge，以及 ffmpeg（`tingly-design check` 会告诉你有没有）。

## 命令

| 命令 | 做什么 |
|---|---|
| `tingly-design` | 起服务，在浏览器里打开启动页。 |
| `open [项目]` | 在浏览器里打开一个项目。这个项目文件夹上已经有编辑器在运行时，就在那里打开；否则起服务。项目文件夹之外的文件夹会加到启动页上，和"打开文件夹"一样。 |
| `serve` | 只起服务，给宿主应用或常驻服务用（见[嵌入](./embedding.md)）。bundle 里的 `node server.mjs` 就是它。 |
| `new <类型> <名字或文件夹>` | 新建项目。类型：`canvas`、`slides`、`design-system`、`dashboard`、`doc`、`motion`。`--title` 设标题；`--look`（只用于设计系统）从 36 个风格之一开始（`nord`、`swiss-grid`、`editorial-serif`、`bauhaus`……；不认识的会拒绝并列出全部）；只给名字时在当前目录建一个同名文件夹（和 `git init`、`cargo new` 一样），给路径（`./x`、`~/x`、绝对路径）就建在那里，两种都会登记到启动页，所以任何目录下 `open <名字>` 都能打开，命令会打印完整路径；`--global` 让只有名字的项目建在项目目录里（安装版是 `~/.tingly-design/projects/`）；项目由所在位置确定，不同位置可以有同名文件夹，项目文件夹之外的项目用文件夹名加一个由路径算出的短码当地址（`foo-3f9a1c`，`list` 显示、`new` 打印、`?p=` 里带的就是它），每次都一样，旧版本给的名字仍然有效；`--global` 的名字在项目目录里已有才拒绝；之前建的项目不动，仍按名字打开；`--size` 设第一块画板或动效格式的尺寸：`1080x1920`，画布还可以写新建对话框里的尺寸名（`tingly-design new canvas cover --size wechat`）：`artboard` 1200×760（默认）、`desktop`、`mobile`、`wide` 1920×1080、`standard`、`square`、`portrait` 1080×1350、`tall` 1080×1440、`story` 1080×1920、`wechat` 900×383、`og` 1200×630、`thumbnail`、`pin`、`xheader`、`linkedin`、`fbcover`、`channelart`，网页广告 `mpu`、`leaderboard`、`billboard`、`halfpage`、`skyscraper`，以及 `a4`、`letter`。写了不认识的尺寸会报错并列出全部名字和各自的宽高。给的是文件夹路径时，项目建在那里并加到启动页上。 |
| `new -i` | 一问一答地新建项目，顺序和新建对话框一样：类型（六种）、标题、文件夹名（按标题给出建议；也可以写路径放到别处），画布、幻灯片和动效再选尺寸分类（屏幕、演示、图文与视频、微信、国内平台、海外平台、网页广告、打印、更多比例、自定义）和分类里的尺寸。回答可以是编号、名字，或直接回车用显示的默认值。命令行上已经给了的（`new -i canvas`、`--title`、`--size`、名字）不再问。建好后问要不要在编辑器里打开；选否就打印 `tingly-design open <名字>`。在终端里只打 `new` 效果相同。Ctrl+C 或 Ctrl+D 退出，什么都不建；没有终端（管道、CI）时 `-i` 会报错，请直接给出类型和名字。 |
| `list [项目]` | 启动页上的项目；带项目时列出里面有什么：画板和尺寸、幻灯片、格式和各场景的时间、标签页和字数、数据集、颜色、字体、组件；`--json` 另带项目当前的 `settings`。 |
| `check [项目]` | 带项目时，列出编辑器会报的问题（文件缺失、画板解析不了、幻灯片或场景超出子集、数据集或令牌有误），有错误时退出码为 1。`--snapshots` 再把每个画板、幻灯片、标签页、设计系统视图或动效封面画一遍，报告画不出来的、作品里脚本抛出的错，以及要用的图片、字体、样式、脚本没加载出来的（项目里不存在的文件算作缺失）（动效还会检查同一时刻是否总是同一个画面，不是的话报 `seek` 警告，说明导出的视频会和预览对不上），并对画出来的版面给出警告（文字被框裁掉、文字超出画板或幻灯片的边缘、文字在纯色背景上对比度太低、框架里什么也没画），图留在项目的 `renders/check/`（或 `--out`）里可以看。不带项目时，看这台机器能做什么：Chrome、ffmpeg、`claude` 命令和快速 AI。 |
| `export <项目> --as <格式>` | “导出”菜单能存的格式，用它的名字，写进项目的 `renders/` 或 `--out`：画布 `pdf`（打开的这一页的每个画板，每个一页）或 `png`（每个画板，或 `--board <文件名或标题>`；`--scale 2` 是 PNG @2x）；幻灯片 `pdf`、`png`（每一页，或 `--slide <编号或第几页>`）、`html`、`md`、`notes`、`pptx`（整份可见牌组，或 `--slide 2`、`2-4`、`1,3-4` 这样的范围——从 1 起的可见位置，或页 id）；文档 `pdf`、`html`、`md`（整篇，或 `--tab <编号或标题>`；有图片时是带图片的 `.zip`）、`png`（每个标签页）；设计系统 `png`（总览，或 `--view colors`…）；看板 `png`。这些由编辑器自己在 Chrome 里画，和菜单按钮存的是同一个文件（见下）。动效导出为 `mp4`、`gif`、`png`（封面）或 `html`（谁都能打开的单文件播放器，含所有格式、进度条和速度，不需要 Chrome）：`--format wide,tall` 选格式；`--speed`、`--fps`、`--quality low|medium|high`、`--width`、`--height` 和导出对话框一样（只给一边时另一边按作品比例算）；`--scale 2` 每帧按两倍大小画再缩回，文字更清晰；MP4 带着封面图（`motion.json` 里写 `"coverFirstFrame": true` 时，整段 MP4 的第一帧也是封面），封面 PNG 写在旁边。任何项目都可以导出 `zip`（见下）。 |
| `export <项目> --as zip` | 整个项目存成一个 `.zip`，放在当前文件夹或 `--out`，和编辑器里的“整个项目（.zip）”一样：所有文件、改动记录，以及装进来的设计系统（并排放着）。`--files-only` 不带改动记录和设计系统。 |
| `prompt <项目> <请求>` | 把请求交给 Claude Code，和请求栏的“交给 Claude Code”一样。由编辑器来跑（项目文件夹上已经打开的那个，或者为这次起一个），所以改动实时显示，改动记录里记成 Claude。工作时列出每一步，最后输出它说的话、改动记录里多出的条目，以及会话号。项目会记住它的 Claude Code 对话（存在 `.claude-session.json`），所以下一条 `prompt`、无论来自哪个窗口或编辑器，都会接着说；`--new` 开一段新的，`--continue <会话>` 接某一段指定的。`--file <文件>` 说明请求针对哪个画板、幻灯片、标签页或场景。Ctrl+C 停止。需要 `claude` 命令。`--fast`（画布、幻灯片、动效）改用请求栏的快速 AI：Chrome 打开编辑器，快速模型几秒内改一个文件（`--file`，或者第一个画板、幻灯片、场景），太大的请求它会自己交给 Claude Code。 |
| `history <项目>` | 改动记录：什么时候、谁（手改、快速 AI、Claude、外部、撤销）、哪个文件、改了什么，最新的在最后。默认列最近 20 条（`--limit <n>`）；`--since` 接 `--json` 里的记录编号、一个时间或多久以前（`30m`、`2h`、`1d`），列出那之后的全部。编号不在记录里时报错（退出码 1），不当成“没有改动”。 |
| `export <项目> --as claude-design` | 画布、幻灯片、设计系统或看板，按原版 Claude 类型的文件布局存成一个 `.zip`，附一份给 Claude Code 的 README，和编辑器里的“Claude Design 包（.zip）”一样（[指南](guide/claude-design.md)）。 |
| `import <文件.zip、文件.md、文件.pptx或文件夹>` | 从这样的 `.zip`（或自己压缩的项目文件夹）、Claude Design 包（`.zip`，或 Claude Code 从原版作品存下来的文件夹）、Claude Docs 导出的 `.md` 导入项目；也能将 PowerPoint `.pptx` 转成新的可编辑幻灯片项目，和首页的 PowerPoint、Markdown、项目包三个导入入口一样。导入到项目文件夹，名字被占用时加 `-2`，并输出新名字。PPTX 的原件和转换报告保留在 `uploads/`；不支持的内容会说明位置和原因，不留下半个项目。保守支持子集见[幻灯片指南](guide/slides.md#powerpointpptx)。 |

| `skills [add [文件夹]]` | agent 改项目前要读的格式说明，每种类型一份。`add` 把它们复制到文件夹的 `.claude/skills/`（默认：当前文件夹），连同格式说明指向的参考页（`reference/*.md`），在那里工作的 Claude Code 就认得这些文件；和这个版本不一样的副本保留，除非加 `--force`。 |
| `mcp` | 以 stdio 上的 MCP 服务提供这些命令，给 agent 启动用（见下）。 |

项目由它的文件夹决定：参数默认是路径（`./pitch`、`~/work/site`），`export`、`prompt`、`history` 不给参数就是当前所在的文件夹。名字可以重复、路径不会，所以只有加 `-n` / `--name` 才按名字找（`tingly-design check pitch --name`）；名字对应多个项目时列出每个路径，不替你挑。只写一个词、又不是项目文件夹时，会告诉你那个名字的项目在哪里。编辑器启动的 Claude Code 会话不在项目文件夹里运行，参数按名字读。`list`、`check`、`export` 就地读路径，不会把它加到启动页上。

## 编辑器已经打开时

运行中的服务会在它的项目文件夹里写 `.server.json`，停下时删掉。同一个文件夹上有服务在运行时，`open` 和 `new` 交给它来做：不会再起第二个服务，登记或新建的文件夹马上出现在打开着的启动页上，它记着的链接文件夹也不会被覆盖。不带项目的 `tingly-design check` 会说有没有编辑器在运行。`open` 带了 `--port` 时总是自己起服务。`pnpm dev` 下编辑器地址是 Vite 的（`DC_EDITOR_URL`，默认 `http://localhost:5173/`）。

图片、PDF、PPTX、HTML 和 Markdown（除了 zip 和动效）由编辑器的页面来做：Chrome 或 Edge 打开编辑器里的项目（浅色、命令的语言），等数据和图片加载完，再跑“导出”菜单自己的项。用的是这个项目文件夹上已经在运行的编辑器；没有就为这次导出起一个、导完就停（它不登记自己，按路径给的文件夹也不会加到启动页上）。在本仓库里运行时，没开 `pnpm dev` 就要先构建编辑器（`pnpm build`）。`DC_LOG_LEVEL=debug` 会打印页面里的日志。

## 作为 MCP 服务

能说 MCP 的 agent 拿到的是工作流程里每一步一个工具：`projects`（有哪些项目）、`open`（进入项目，给了 `kind` 就是新建；返回文件夹、大纲、当前设置（尺寸、已装的设计系统、格式、帧率和速度、文档外观、数据集来源、设计系统的主题和 tokens）和格式说明的 uri）、`check`（只查问题，文字，很快）、`look`（把作品画出来，图缩到长边 1000 像素放在结果里；`pick` 只画一个画板、幻灯片、标签页或视图，不给时前 6 张放进结果，其余留在 `renders/check/`）、`export`（`pick` 指定要哪一个画板、幻灯片、标签页或视图）、`history` 和 `prompt`。每种类型的格式说明和它点名的参考页是资源（`tingly-design://skills/<类型>`、`…/<类型>/<页>`），提示 `make`、`edit` 带着格式说明开始干活。agent 用自己的文件工具改项目文件；导出写到项目的 `renders/`。

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
