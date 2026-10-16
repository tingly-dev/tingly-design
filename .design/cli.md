# 命令行 `tingly-design`

已实施（第 1 步：`open`、`serve`、`new`、`list`、`check`、动效的 `export`；整个项目的 `export --as zip` 和 `import`。第 2 步：找到正在运行的编辑器、`history`）；§6 是没做的。调研和同类产品对比在 `.research/cli-service.md`。

## 1. 问题

原来能跑的只有 `pnpm dev` / `pnpm start` 和 bundle 里的 `node server.mjs`：一个起服务的脚本，别的什么都不能做。想让 skill、脚本、CI 或者另一个 agent 用 Tingly Design，就只能先起服务，再拼 HTTP 请求；npm 包装上了也没有命令可敲。仓库自己的脚本（主页视频、README 素材）各自调 `scripts/motion-render.mjs`，再自己找 Playwright 的浏览器。

要的是：装上就有一个命令，`npx tingly-design` 能用；人和 agent 都能用；输出能给人看，也能给脚本读；我们自己的脚本先用上（dogfood）。

## 2. 命名：用编辑器里同一件事的那个词

一个命令叫什么，看编辑器里同一个动作的按钮叫什么。编辑器说"新建""打开""导出""导入"，命令就是 `new`、`open`、`export`、`import`；启动页说"画布""幻灯片""设计系统""看板""文档""动效"，`new` 收的类型就是 `canvas`、`slides`、`design-system`、`dashboard`、`doc`、`motion`（不是内部的 `design`、`docs`；内部名也收）。

考虑过、没用的：

- `timeline`、`snapshot`、`doctor`、`edit` 这些各家 CLI 常见的词。编辑器里没有这些词，人要再学一遍。`snapshot` 就是导出 PNG，并入 `export --as png`；`doctor` 就是检查这台机器，并入不带项目的 `check`；`edit` 就是请求栏，将来叫 `prompt`。
- 短别名 `td`。和已有的命令撞名的机会大，省下的字不值得。

## 3. 命令

| 命令 | 做什么 | 状态 |
|---|---|---|
| （无） | 起服务、打开启动页 | 已实施 |
| `open [project]` | 在浏览器里打开项目：这个项目文件夹上已经有编辑器在运行就交给它，否则自己起服务；给的是路径时先登记成链接项目（[project-folders.md](./project-folders.md)） | 已实施 |
| `serve` | 只起服务，给宿主或常驻服务用；bundle 的 `server.mjs` 就是它 | 已实施 |
| `new <kind> <name 或文件夹>` | 和新建对话框一样（`createProject`），`--title`、`--size WxH`；给的是路径时建在那里并登记；编辑器在运行时交给它建 | 已实施 |
| `list [project]` | 不带项目：启动页上的项目；带项目：里面有什么（画板、幻灯片、场景、标签页、数据集、令牌） | 已实施 |
| `check [project]` | 带项目：编辑器会报的问题，有错时退出码 1；不带：这台机器能做什么（Chrome、ffmpeg、`claude`、快速 AI） | 已实施；还不画页面（§6） |
| `export <project> --as <fmt>` | 和导出菜单同名；每种类型都有 `zip`（整个项目，`--files-only` 不带改动记录和设计系统，见 [project-archive.md](./project-archive.md)）；动效另有 `mp4`、`gif`、`png`（封面） | zip 和动效已实施；其他类型的其他格式等无头页面（§6） |
| `import <file.zip>` | 和启动页的“导入项目（.zip）”同名同做法 | 已实施；导入 HTML、SVG 还没有 |
| `history <project>` | 改动记录：时间、谁改的、哪个文件、改了什么；`--since` 接一条记录的编号、一个时间或多久以前 | 已实施 |
| `prompt`、`skills`、`mcp` | 见 §6 | 方案 |

一个项目可以是启动页上的名字，也可以是文件夹路径。`list`、`check`、`export` 读路径时就地读，不登记链接，免得一次检查在启动页上多出一张卡。

除了 `serve`，每个命令都有 `--json`：人看表格，脚本和 agent 读 JSON。进度写 stderr（只在终端里），结果写 stdout。退出码：0 成功，1 做了但有问题（`check` 找到错、渲染失败），2 用法不对。

## 4. 怎么接到现有代码上

**服务端拆成三份。** 原来 `index.ts` 一个文件，顶层就起 watcher、监听端口、装信号处理，别处没法在进程里复用它的路由。现在：

- `app.ts`：所有路由，导入时除了注册路由没有副作用；
- `serve.ts`：`startServer`（种示例、起 watcher、处理 `DC_BASE_PATH`、监听，端口被占时 reject）和 `runServer`（再加就绪行和信号处理）；
- `index.ts`：仓库里的 `pnpm dev` 入口，只调 `runServer`；
- `cli.ts`：命令行。`layout.ts` 等模块在导入时就读 `DC_PROJECTS`，所以 `cli.ts` 先解析参数（`--projects` 写进环境），再懒加载它们。

**`server.mjs` 就是 `tingly-design serve`。** bundle 只打一个入口 `cli.mjs`（带 shebang，`package.json` 的 `bin`）；`server.mjs` 是三行的包装，把参数换成 `serve` 再导入 `cli.mjs`。考虑过打两个 bundle，体积翻倍、两份可能不同步；也考虑过 esbuild 拆包，`layout.ts` 的路径计算依赖文件所在位置，拆开后要处处改。包装最省，宿主的约定（环境变量、就绪行、`DC_EXIT_WITH_STDIN`）一字不变（[embedding](../docs/zh/embedding.md)）。

**核心给数据，命令行给措辞。** `outlineProject`、`checkProject` 在 `packages/core/src/project.ts`，输入是项目文件（路径 → 内容），输出是数据：大纲项、问题码加参数。各类型自己的检查器（`checkSlide`、`checkScene`、`resolveTokens`）已经写好的英文原样带上。文字在 `@dc/i18n` 的 `cli` 区域，中英两份；语言取 `DC_LANG`，再看 `LC_ALL`、`LANG`。将来服务端、MCP 也读同一份数据。

**导出复用服务端渲染。** `export` 走 `render.ts`（本机的 Chrome 调试管道 + ffmpeg），不再要 Playwright。为此 `render.ts` 加了：容器 `png`、输出目录、封面（`motion.json` 的 `cover`：某一时刻或某个场景的结尾），MP4 导整段时封面作第一帧并作为封面图附进文件（`attached_pic`），封面 PNG 写在旁边。主页视频（`scripts/build-site.sh`）和 README 素材（`scripts/readme-assets.sh`）都改用 `pnpm tingly-design export`。

**示例照常种下。** 除了 `serve` 以外的命令都先 `seedSamples()`，所以 `npx tingly-design list` 第一次就能看到示例，和第一次打开启动页一样。

**日志。** `serve`、`open` 照常写 `log.ts`；其他命令把默认级别降到 `warn`，免得服务端的信息行混进输出。

**找到正在运行的编辑器。** 服务开始监听后在项目文件夹里写 `.server.json`（pid、API 地址、编辑器地址、版本、启动时间），停下时（信号、`process.exit`）撤掉，只撤自己写的那份（`running.ts`）。命令读到它，还要进程活着、`api/health` 一秒半内答应，才算数；进程已经没了的文件顺手删掉。放在项目文件夹而不是 `~/.tingly-design/`：一台机器上可以有几个项目文件夹（仓库的 `projects/`、npm 装的、宿主的 `DC_PROJECTS`），命令要找的是管这个文件夹的那一个，`--projects` 一换就对上；文件以点开头，启动页、监听和打包都不看它。同一个文件夹上起了两个服务时，后起的那个写的算数。`pnpm dev` 下服务端不发编辑器页面，所以记下的编辑器地址是 Vite 的（`DC_EDITOR_URL`，默认 `http://localhost:5173/`）。

找到以后谁走它：

- **`open`** 直接在浏览器里打开那个编辑器的地址，不再起第二个服务；给的是路径时让它登记（`POST /api/links`）。显式给了 `--port` 就是要自己的服务，不去找。
- **`new`** 交给它建（`POST /api/projects`）。这不只是为了启动页马上出现：链接表（`.links.json`）每个服务进程在内存里各存一份、改了整份写回，命令行自己登记一个链接，正在运行的编辑器既看不见它，下次登记别的文件夹时还会把它覆盖掉。
- **其余命令**（`list`、`check`、`export`、`import`、`history`）照旧直接读写文件，不经过它：读不改变什么；`import` 写进项目文件夹，监听会把新项目报给编辑器；`history` 读 `.journal.jsonl`，服务端是追加写，两边读到的一样。

考虑过、没做的：所有命令都走正在运行的服务，没有就悄悄起一个、用完关掉。现在的命令没有一个需要页面，起服务只多花一两秒、没换来什么；等导出要用编辑器的页面画图（§6 第 2 条）和 `prompt` 时，再让它们按需起服务。

**`history`。** 编辑器里叫“改动记录”，同步状态的提示说“打开改动历史”；命令行用 `history`，和调研里定的一致。默认列最近 20 条，最新的在最后，和终端里往上翻的习惯一致；`--json` 每条带编号。agent 把最后一条的编号记下，下次 `history <p> --since <编号>` 就是“我走开以后这个人改了什么”，这是双向编辑里交接的那一半。编号找不到（改动记录只留最近 500 条）时报错、退出码 1，不当成“没有改动”，免得 agent 以为什么都没变。时间解析在核心（`parseSince`、`journalSince`），措辞和谁改的叫法（`app.actor`）在 `@dc/i18n`。

## 5. 对 agent 和 skill

一个 skill 只要写 `npx tingly-design …`：`new` 建项目，改文件，`check --json` 看有没有问题，`export` 出成品，`open` 交给人看，`history --since` 看人改了什么。不用先起服务，也不用知道接口。动效 skill（`.claude/skills/motion/SKILL.md`）已经这样写。

## 6. 没做的

按 `.research/cli-service.md` 的顺序：

1. **命令行做的改动记成自己的身份。** 现在命令行写的文件由监听记成“外部”；经过正在运行的编辑器时可以带上 `cli` 这个身份，撤销和改动记录里分得出来。
2. **无头导出和页面检查**（第 3 步）。一个服务端路由打开编辑器里的页面再截图，画布、幻灯片、看板、文档、设计系统的 `export --as png|pdf` 都走它；`check --snapshots` 用同一个页面找画不出来的东西（图片没加载、嵌入报错）。
3. **MCP**（第 4 步）。服务端 `/mcp`，命令行 `mcp` 做 stdio 桥；`skills add` 把格式 skill 装进别的项目。
4. **`prompt`**（第 5 步）。和请求栏一样，默认交给 Claude Code，`--fast` 用快速 AI。
5. `scripts/motion-render.mjs` 还留着它独有的 `--player`（单文件播放器）、`--verify`（倒着 seek 逐字节对比）和 `--scale`；搬进 `render.ts` 后删掉它。
