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
| `open [项目]` | 起服务，打开一个项目。项目文件夹之外的文件夹会加到启动页上，和"打开文件夹"一样。 |
| `serve` | 只起服务，给宿主应用或常驻服务用（见[嵌入](./embedding.md)）。bundle 里的 `node server.mjs` 就是它。 |
| `new <类型> <名字或文件夹>` | 新建项目。类型：`canvas`、`slides`、`design-system`、`dashboard`、`doc`、`motion`。`--title` 设标题；`--size 1080x1920` 设第一块画板或动效格式的尺寸。给的是文件夹路径时，项目建在那里并加到启动页上。 |
| `list [项目]` | 启动页上的项目；带项目时列出里面有什么：画板和尺寸、幻灯片、格式和各场景的时间、标签页和字数、数据集、颜色、字体、组件。 |
| `check [项目]` | 带项目时，列出编辑器会报的问题（文件缺失、画板解析不了、幻灯片或场景超出子集、数据集或令牌有误），有错误时退出码为 1。不带项目时，看这台机器能做什么：Chrome、ffmpeg、`claude` 命令和快速 AI。 |
| `export <项目> --as <格式>` | 把动效导出为 `mp4`、`gif` 或 `png`（封面），写进项目的 `renders/` 或 `--out`。`--format wide,tall` 选格式；`--speed`、`--fps`、`--quality low|medium|high`、`--width`、`--height` 和导出对话框一样。导出整段 MP4 时第一帧是封面，并带着封面图；封面 PNG 写在旁边。其他类型以后再加。 |

项目可以是启动页上的名字，也可以是文件夹路径。`list`、`check`、`export` 就地读路径，不会把它加到启动页上。

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
npx tingly-design check pitch --json
npx tingly-design export promo --as mp4 --format wide --out dist/
```

每种类型的文件格式见 `.claude/skills/<类型>/SKILL.md`。命令为什么这样设计、后面还要做什么（接上已经打开的编辑器、所有类型都能导出、MCP、`prompt`），见 `.design/cli.md`。
