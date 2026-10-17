# 命令行 `tingly-design`

已实施（第 1 步：`open`、`serve`、`new`、`list`、`check`、动效的 `export`；整个项目的 `export --as zip` 和 `import`。第 2 步：找到正在运行的编辑器、`history`。第 3 步：每种类型通过编辑器页面的 `export`，`check --snapshots`。第 4 步：MCP（服务端 `/mcp`、`tingly-design mcp`）和 `skills`。第 5 步：`prompt`，默认交给 Claude Code，`--fast` 用快速 AI）；§6 是还开着的和考虑过暂不做的。调研和同类产品对比在 `.research/cli-service.md`。

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
| `check [project]` | 带项目：编辑器会报的问题，有错时退出码 1；`--snapshots` 再把每个画板、幻灯片、标签页、视图或封面画一遍，画不出来的算错，图留下来看；不带：这台机器能做什么（Chrome、ffmpeg、`claude`、快速 AI） | 已实施 |
| `export <project> --as <fmt>` | 和导出菜单同名同做法；每种类型都有 `zip`（整个项目，`--files-only` 不带改动记录和设计系统，见 [project-archive.md](./project-archive.md)）；画布 `png`，幻灯片 `pdf`、`png`、`html`、`notes`，文档 `pdf`、`html`、`md`、`png`，设计系统和看板 `png`（由编辑器的页面画，见 §4）；动效 `mp4`、`gif`、`png`（封面，由 `render.ts` 画）、`html`（单文件播放器，不用 Chrome）；`--scale 2` 画布出 @2x，动效每帧按 2 倍画再由 ffmpeg 缩回；`--board`、`--slide`、`--tab`、`--view` 只要一个 | 已实施 |
| `import <file.zip>` | 和启动页的“导入项目（.zip）”同名同做法 | 已实施；导入 HTML、SVG 还没有 |
| `history <project>` | 改动记录：时间、谁改的、哪个文件、改了什么；`--since` 接一条记录的编号、一个时间或多久以前 | 已实施 |
| `skills [add [folder]]` | 列出每种类型的格式 skill；`add` 复制到一个文件夹的 `.claude/skills/`，内容不同的副本留着，`--force` 才换 | 已实施 |
| `mcp` | 上面这些命令作为 stdio 上的 MCP 服务（正在运行的编辑器在 `/mcp` 也提供同一份），见 §4 | 已实施 |
| `prompt <project> <请求>` | 请求栏的“交给 Claude Code”：编辑器跑 Claude Code 改文件，命令等它跑完，输出它最后说的话、改动记录里多出的条目和接着说用的会话（`--continue`）；`--file` 说请求针对哪个文件；Ctrl+C 和停止按钮一样；`--fast` 用请求栏的快速 AI（画布、幻灯片、动效） | 已实施 |

一个项目可以是启动页上的名字，也可以是文件夹路径。`list`、`check`、`export` 读路径时就地读，不登记链接，免得一次检查在启动页上多出一张卡。

除了 `serve`，每个命令都有 `--json`：人看表格，脚本和 agent 读 JSON。进度写 stderr（只在终端里），结果写 stdout。退出码：0 成功，1 做了但有问题（`check` 找到错、渲染失败），2 用法不对。

## 4. 怎么接到现有代码上

**服务端拆成三份。** 原来 `index.ts` 一个文件，顶层就起 watcher、监听端口、装信号处理，别处没法在进程里复用它的路由。现在：

- `app.ts`：所有路由，导入时除了注册路由没有副作用；
- `serve.ts`：`startServer`（种示例、起 watcher、处理 `DC_BASE_PATH`、监听，端口被占时 reject）和 `runServer`（再加就绪行和信号处理）；
- `index.ts`：仓库里的 `pnpm dev` 入口，只调 `runServer`；
- `cli.ts`：命令行。`layout.ts` 等模块在导入时就读 `DC_PROJECTS`，所以 `cli.ts` 先解析参数（`--projects` 写进环境），再懒加载它们。

**`server.mjs` 就是 `tingly-design serve`。** bundle 只打一个入口 `cli.mjs`（带 shebang，`package.json` 的 `bin`）；`server.mjs` 是三行的包装，把参数换成 `serve` 再导入 `cli.mjs`。考虑过打两个 bundle，体积翻倍、两份可能不同步；也考虑过 esbuild 拆包，`layout.ts` 的路径计算依赖文件所在位置，拆开后要处处改。包装最省，宿主的约定（环境变量、就绪行、`DC_EXIT_WITH_STDIN`）一字不变（[embedding](../docs/zh/embedding.md)）。

**核心给数据，命令行给措辞。** `outlineProject`、`checkProject` 在 `packages/core/src/project.ts`，输入是项目文件（路径 → 内容），输出是数据：大纲项、问题码加参数。各类型自己的检查器（`checkSlide`、`checkScene`、`resolveTokens`）已经写好的英文原样带上。文字在 `@dc/i18n` 的 `cli` 区域，中英两份；语言取 `DC_LANG`，再看 `LC_ALL`、`LANG`。MCP 也读同一份数据。

**命令是数据，命令行和 MCP 各自给形状。** `commands.ts` 是每个命令真正做的事：收普通参数，返回找到或做出来的东西，出错时抛 `CommandError`（措辞已经是调用方的语言，带退出码）。`cli.ts` 把结果排成表格、`--json` 和退出码，`mcp.ts` 把它变成工具结果；两边不会各写一套、慢慢走样。

**导出复用服务端渲染。** `export` 走 `render.ts`（本机的 Chrome 调试管道 + ffmpeg），不再要 Playwright。为此 `render.ts` 加了：容器 `png`、输出目录、封面（`motion.json` 的 `cover`：某一时刻或某个场景的结尾），MP4 导整段时封面作第一帧并作为封面图附进文件（`attached_pic`），封面 PNG 写在旁边。主页视频（`scripts/build-site.sh`）和 README 素材（`scripts/readme-assets.sh`）都改用 `pnpm tingly-design export`。原来的 `scripts/motion-render.mjs` 剩下的三样也搬了过来，脚本和根目录的 `playwright-core` 一起删掉：单文件播放器是 `--as html`（`motionPlayer`，作品的 `note` 是给做的人看的，不放进去），`--scale` 是导出选项，`--verify` 成了 `check --snapshots` 的 seek 检查（下面）。`--width` 或 `--height` 只给一个时，另一个按作品比例算。

**示例照常种下。** 除了 `serve` 以外的命令都先 `seedSamples()`，所以 `npx tingly-design list` 第一次就能看到示例，和第一次打开启动页一样。

**日志。** `serve`、`open` 照常写 `log.ts`；其他命令把默认级别降到 `warn`，免得服务端的信息行混进输出。

**找到正在运行的编辑器。** 服务开始监听后在项目文件夹里写 `.server.json`（pid、API 地址、编辑器地址、版本、启动时间），停下时（信号、`process.exit`）撤掉，只撤自己写的那份（`running.ts`）。命令读到它，还要进程活着、`api/health` 一秒半内答应，才算数；进程已经没了的文件顺手删掉。放在项目文件夹而不是 `~/.tingly-design/`：一台机器上可以有几个项目文件夹（仓库的 `projects/`、npm 装的、宿主的 `DC_PROJECTS`），命令要找的是管这个文件夹的那一个，`--projects` 一换就对上；文件以点开头，启动页、监听和打包都不看它。同一个文件夹上起了两个服务时，后起的那个写的算数。`pnpm dev` 下服务端不发编辑器页面，所以记下的编辑器地址是 Vite 的（`DC_EDITOR_URL`，默认 `http://localhost:5173/`）。

找到以后谁走它：

- **`open`** 直接在浏览器里打开那个编辑器的地址，不再起第二个服务；给的是路径时让它登记（`POST /api/links`）。显式给了 `--port` 就是要自己的服务，不去找。
- **`new`** 交给它建（`POST /api/projects`）。这不只是为了启动页马上出现：链接表（`.links.json`）每个服务进程在内存里各存一份、改了整份写回，命令行自己登记一个链接，正在运行的编辑器既看不见它，下次登记别的文件夹时还会把它覆盖掉。
- **其余命令**（`list`、`check`、`export`、`import`、`history`）照旧直接读写文件，不经过它：读不改变什么；`import` 写进项目文件夹，监听会把新项目报给编辑器；`history` 读 `.journal.jsonl`，服务端是追加写，两边读到的一样。

考虑过、没做的：所有命令都走正在运行的服务，没有就悄悄起一个、用完关掉。读文件的命令不需要页面，起服务只多花一两秒、没换来什么；只有要编辑器页面画图的导出（下一段）按需起服务。

**导出走编辑器的页面。** 画板、幻灯片、文档、看板、设计系统的图和 PDF 都是编辑器在浏览器里画的（沙箱框架、`htmlToPng`、排好版的 HTML 交给服务端打印），命令行要的是和菜单按钮一模一样的文件，所以不在服务端另写一套，而是让本机的 Chrome 打开编辑器、跑导出菜单自己的项：

- 编辑器这边是 `headless.ts`：每种类型的 `FileMenu` 渲染时把自己的导出项（和"先显示哪一个"的 `pick`：画板、幻灯片、标签页、设计系统视图）登记给它，页面上挂 `window.tinglyDesign`（`exports`、`pick`、`run`）。项运行时，交给人的文件（`local.ts` 的 `download`，编辑器里所有存文件都走它）和报错的提示被截下来，不点链接、不弹提示，原样返回。
- 服务端是 `pageExport.ts`：和 PDF、视频同一个 Chrome 和调试管道，打开 `?p=<项目>&lang=<语言>&theme=light`（浅色、命令的语言：谁运行都是同一个文件），等页面的网络静下来（数据集、字体、图片、框架；一直开着的改动流不算）再跑每一项。页面里的 `console` 和异常写进 debug 日志，查空文件时看。
- 用哪个编辑器：项目文件夹上已经有编辑器在运行就用它（`pnpm dev` 下是 Vite 的页面）；没有就在命令自己的进程里起一个、用完关掉，它不写 `.server.json`，免得盖掉或撤掉别人的。给的是没登记的文件夹路径时，这个临时服务只在内存里给它一个名字（`visitFolder`），启动页上不会多一张卡。从源码运行而编辑器还没构建时，直说要先 `pnpm build`。
- 命令行只决定跑哪几项：画布不带 `--board` 时是每个没隐藏的画板（跨页），幻灯片是"PNG 多张"，文档的图是每个标签页一张（同名的加标签页编号），设计系统默认总览。

考虑过、没选的：在服务端用核心的格式代码自己画（要把沙箱、字体、嵌入重写一遍，和编辑器画的会走样）；用 CDP 的下载行为接文件（拿不到项报的错，下载名和完成时机也要猜）。

**`check --snapshots`。** 同类工具里最有用的一道关卡是"检查完再看一眼"（HyperFrames 的 `check --snapshots`）。这里就是用上面的路把每个画板、幻灯片、标签页、设计系统视图画一遍（动效是每个画幅的封面，走 `render.ts`），画不出来的作为 `snapshot` 问题报出来。画的同时听着作品本身：画板、幻灯片、看板、预览都是沙箱框架（Chrome 可能把它们放进单独的进程，所以自动附着到每个框架，并让框架等到被听上才开始跑，第一行脚本的错也不漏），框架里抛出的错和渲染器接住后打印的错记成 `pageError`（错误），框架要的图片、字体、样式、脚本没到的记成 `notLoaded`（警告）；编辑器自己的请求和报错不算，它们不是人写的东西。指向项目里的文件（`…/raw/<path>`）而文件不在的，算作 `missingFile`，和文件之间的引用缺失是同一种问题。出处用框架元素的 `title` 找回文件（画板名、幻灯片编号；看板只有一页），同一张幻灯片的缩略图和大图报的同一个问题只算一次。动效还多一道 seek 检查（`checkSeek`）：每个画幅取 16 帧，顺着 seek 一遍再倒着 seek 一遍，在页面里逐像素比；精确渲染是逐帧 seek 的，场景读了时钟、随机绘制或自己在动，视频就和预览对不上，所以不一致记成 `seek` 警告。只差抗锯齿（最大差 ≤ 16、不到画面 0.1% 的像素）算一致，免得字体渲染的细微抖动误报。图放在 `renders/check/`（每次先清空；`--out` 给的文件夹不清），agent 把图读回去就是看到了自己做的东西。

**MCP。** 能说 MCP 的 agent（Claude Code、Claude Desktop、IDE）不用敲命令，直接拿到工具：`list`、`read_skill`、`new`、`check`、`export`、`history`，和命令同名同参数；资源是每种类型的格式 skill（`tingly-design://skills/<kind>`）。`initialize` 带一段说明：先 `read_skill`，再用 agent 自己的文件工具改项目文件夹，改完 `check`（`snapshots: true` 画出来看）。不另做"写文件"的工具：项目就是文件，agent 本来就会改文件，监听会把改动记进改动记录、推给编辑器。

- 两条路，一个处理函数（`handleMcp`）：正在运行的编辑器在 `POST /mcp` 答（Streamable HTTP，回 JSON，不开 SSE、不要会话；通知回 202，`GET`、`DELETE` 回 405）；`tingly-design mcp` 在 stdio 上答，一行一条 JSON-RPC，stdout 只放协议（`console.log` 改写到 stderr，日志本来就在 stderr）。考虑过让 `mcp` 做转发到 `/mcp` 的桥：要先有编辑器在运行，而直接在进程里调同一个函数时，要画图的工具照样能用上正在运行的编辑器（`withEditor`），所以不做桥。
- 协议手写：`initialize`、`ping`、`tools/list`、`tools/call`、`resources/list`、`resources/read`，回客户端要的协议版本（认得的话）。官方 SDK 要带上 zod 等依赖、进 bundle，换来的只是这几个方法。
- `check` 带 `snapshots: true` 时把图直接放进结果，模型不用再调一次就能看。图先缩到长边 1200 像素（`shrinkPictures`，用同一个 Chrome 解码缩放）：原尺寸的画板一张就几 MB，模型看到的细节却和缩小后差不多，缩了以后一次能放 12 张（共不超过 4 MB），其余给路径；盘上的图仍是原尺寸，要细看就读文件。工具执行出错放在结果里（`isError`），模型能看到原因自己改；协议层的错（没有这个工具、方法）才是 JSON-RPC 错误。
- 写文件只写在项目里：MCP 的 `export` 没有 `--out`，`zip` 也写进项目的 `renders/`，不写到服务进程碰巧所在的目录。
- 在编辑器自己的 `/mcp` 里（`inServer`），要画图时用的就是这个编辑器（`ownEditor()`：服务开始监听就记下自己的地址，不管写没写 `.server.json`），不另起一个；启动页上没有的文件夹路径直接拒绝（`cli.notListed`），因为在这个进程里给它起名字就会出现在启动页上。
- 安全：带 `Origin` 的请求只收本机或编辑器自己地址来的，别的网站不能借人的浏览器调它。服务默认只听 127.0.0.1；监听到网络上时，`/mcp` 和其余 `/api` 一样，谁能连上谁就能用。
- 工具的说明写给模型，用英文，和其他提示词一样；工具报的错跟调用方的语言（HTTP 看 `x-dc-lang`、`Accept-Language`，stdio 看命令行的语言）。

**`skills`。** 格式 skill 是给 agent 读的说明，原来只在这个仓库和 bundle 里。`skills` 列出它们（类型、名字、什么时候读），`skills add [文件夹]` 复制到那个文件夹的 `.claude/skills/<名字>/SKILL.md`，别的仓库里的 Claude Code 就认得 Tingly Design 的文件。已有的同名副本内容不同时留着、提示 `--force`，免得盖掉别人改过的版本；一样的报"已是最新"。skill 里"怎么运行"的那段写全三种情形：bundle 里 `node cli.mjs`，仓库里 `pnpm tingly-design`，别处是装好的 `tingly-design`，连着 MCP 时用它的 `check`、`export`。

**`prompt`。** 交给 Claude Code 的活由编辑器来跑（`POST …/delegate`），命令不自己起 `claude`：这样改动在改动记录里记成 Claude（监听靠 `activeDelegates` 认），打开着的编辑器实时看到，运行列表、停止按钮也都是同一个。命令先订阅项目的改动流（短的运行可能在启动请求返回前就结束），再发请求，按编号跟着这次运行的步骤，终端里一步一行（措辞用请求栏的 `prompt.step`），结束后稍等监听记完最后的写入，再读改动记录里这之后 Claude 的条目。用哪个编辑器和导出一样（`withEditor`，只是不需要页面）；没有在运行的就在进程里起一个，跑完关掉。MCP 也有同名的 `prompt` 工具，说明里让 agent 能自己改文件时就自己改。默认交给 Claude Code 而不是快速 AI：脚本和 agent 要的是把事做完，不是即时回答；它本来就在服务端跑，不需要页面；看板也只收 Claude Code。

`--fast` 是请求栏的快速 AI。它的编辑在页面里落到文件上（模型回的是 jQuery 语句，页面逐句执行、出错重试、检查幻灯片子集，再像人的编辑一样存回去），所以和导出一样让 Chrome 打开编辑器：`PromptBar` 把"没指定时请求发给哪个文件"交给 `headless.ts`（`offerPrompt`），`window.tinglyDesign.fast` 跑 `runFastEdit`，等它存完再返回执行过的语句。没有请求栏快速 AI 的类型（文档、设计系统、看板）直接说不支持，不悄悄改成 Claude Code。模型自己判断要交给 Claude Code 时（`askClaude()`），编辑器照常起那次运行，命令从改动流里按请求原文认出它，接着跟到结束；结果里 `by` 说是谁改的。考虑过在服务端重写一遍快速 AI 的执行（要搬沙箱和 jQuery 执行器，和请求栏会走样），没选。

一个顺带修的问题：监听第一次扫描时，文件的 `add` 事件先读文件再看 `ready`，读得慢的文件会在 `ready` 之后才判断，被记成"外部新建文件"。命令每次在进程里起服务都会触发，现在在事件到达时就记下是不是第一次扫描。

**`history`。** 编辑器里叫“改动记录”，同步状态的提示说“打开改动历史”；命令行用 `history`，和调研里定的一致。默认列最近 20 条，最新的在最后，和终端里往上翻的习惯一致；`--json` 每条带编号。agent 把最后一条的编号记下，下次 `history <p> --since <编号>` 就是“我走开以后这个人改了什么”，这是双向编辑里交接的那一半。编号找不到（改动记录只留最近 500 条）时报错、退出码 1，不当成“没有改动”，免得 agent 以为什么都没变。时间解析在核心（`parseSince`、`journalSince`），措辞和谁改的叫法（`app.actor`）在 `@dc/i18n`。

## 5. 对 agent 和 skill

一个 skill 只要写 `npx tingly-design …`（或者连上 `tingly-design mcp`，用同名的工具）：`new` 建项目，改文件（或 `prompt` 交给编辑器的 Claude Code），`check --snapshots` 看有没有问题、画出来什么样，`export` 出成品，`open` 交给人看，`history --since` 看人改了什么。不用先起服务，也不用知道接口。每种类型的 skill（`.claude/skills/<kind>/SKILL.md`）都写了怎么看自己做的东西；被编辑器启动的 Claude Code 用同一个版本（`node cli.mjs` 或 `pnpm tingly-design`），不用 `npx`。

## 6. 没做的

**还开着的：页面检查的边角。** 框架里的内容（设计系统的组件预览、幻灯片里的嵌入）在 `check --snapshots` 和导出的图里是空的，这是菜单里的图本来就有的限制（`nodeToPng` 画不了框架）。服务端的 `GET …/export?as=` 也还没有，现在只有命令行和 MCP 能这样导出。

**考虑过、暂不做：**

1. **命令行或 agent 的改动记成自己的身份。** 命令行本身不改项目文件：`new`、`import` 建项目，`export` 只写 `renders/`。记成“外部”的是通过 MCP 连上的 agent 用它自己的文件工具改的文件；要分出来只能按时间窗猜（agent 调过工具之后一段时间的外部改动都算它的），同一时间人在别的编辑器里手改也会被算进去。改动记录宁可说“外部”，也不该把人说成 agent。agent 要分清自己和人改了什么，用 `history --since`。
2. **MCP 的服务端推送和 `prompts`。** 推送（资源变化通知）在 stdio 下好做，HTTP 下要另开 SSE 流；主流客户端基本不订阅资源变化，agent 想知道人改了什么，`history --since` 已经够用。`prompts` 只是给客户端预置几条请求模板，作用有限，还要维护两种语言的文案。等有客户端真的用上再做。
