# Claude Code 看得见页面

状态：**已实施**：编辑器、命令行 `prompt`、MCP `prompt` 启动的每一次 Claude Code 执行，在机器上有 Chrome 时都多一个“看”的工具；测试是 `e2e/look.py`（请求、路由、脚本）。没做的见 §6。

## 1. 要解决的问题

人说“把首屏的标题放大一点”，Claude Code 改完文件，**谁也没看过结果**。画页面的零件早就有：`export --as png --board|--slide|--tab|--view`、`check --snapshots`、MCP 的 `look`，都经本机 Chrome 打开编辑器、跑导出菜单自己的项，各类型的 SKILL.md 也都叫 agent 去用。但编辑器起的那一次执行只允许 `Read,Edit,Write,Glob,Grep`（看板多一个 `dash-query`，配好时多一个生图），系统提示末尾还写着“不要运行构建、服务或浏览器”，也没把 MCP 交给它：SKILL 里让它跑的命令它跑不了。看不见，就只能凭文件猜版面：文字压出画板、图没加载、对比度不够，都要等人发现。

## 2. 比较过的做法

| 做法 | 好处 | 为什么不选 |
|---|---|---|
| A. 打开着的编辑器标签页截图，再上传给服务端 | 是人眼前的那一页，连选中状态都在 | 要有标签页、要在前台（后台标签页不上色）；命令行 `prompt` 和 MCP 起的执行没有标签页；执行中要往返浏览器 |
| **B. 服务端用本机 Chrome 无头画（复用导出的路径）** | 有没有标签页都行，三个入口一样；和 `check --snapshots` 同一张图（浅色、固定宽度、同样的字体），其中查出的东西（脚本抛错、文件没加载、版面警告）一并带回；零件已经在，已被 `check_snapshots` 套件盯着 | 看不到人的选中和滚动位置——agent 要看的是页面，不是编辑器的壳 |
| C. 把整个 `tingly-design` 命令行或 MCP 交给执行 | 一步到位 | `Bash(node cli.mjs:*)` 也能 `export zip`、`new`、`prompt`（执行里再起执行）；要找对命令行（bundle 里是 `cli.mjs`，仓库里是 `pnpm tingly-design`）；工具面太宽 |

选 B，形状照图像生成（[image-generation.md](./image-generation.md)）：一个只给 Claude Code 的小工具，路由 + 脚本 + 提示里的一段话。

## 3. 现行契约

- **路由** `POST /api/projects/:p/look`，体 `{ pick? }`（`routes/export.ts`）：调 `commands.ts` 的 `look`，也就是 `check` 带 `snapshots`，图写到项目的 `renders/look/`（每次先清空，所以只有这一次的图；和 `renders/check/` 分开，两者不互相清）。回 `{ dir, files, problems }`：`files` 是 PNG 的绝对路径，`problems` 是 `{file, level, text}`，`text` 用英文写（读它的是模型，不是人）。同一个项目的两次 `look` 排队，不并发（共用一个文件夹）。画不出来（没有 Chrome、Chrome 起不来）回 501 / 500 和原话。
- **脚本** `scripts/look.mjs <项目> [pick]`：经 `DC_SERVER_URL` 调上面的路由，每行打印一张 PNG 的路径，再打印发现的问题（至多 40 条）；什么都没画出来（`pick` 写错）退出码 1 并说明。随 bundle 一起发。
- **`pick`** 是各类型 `--board` / `--slide` / `--tab` / `--view` 收的那个值（`pickFor`）：画布一块画板（文件名或标题）、幻灯片一页（id 或序号）、文档一个标签页（id 或标题）、设计系统一个视图（overview、colors、type、space、components、assets）；动效是格式名，画每个格式的封面帧；看板只有一页，没有 `pick`。不给 `pick` 就画全部，慢，提示里叫它给改动的那一个。
- **交给 Claude Code**（`delegate.ts`）：机器上找得到 Chrome 时，允许 `Bash(node scripts/look.mjs:*)`，并在系统提示里加一段（`lookNote`）：改完会影响外观的东西就跑一次，用 Read 读 PNG，和请求比，不对就改、再看，至多三次；这是“不要运行浏览器”的唯一例外，代替 SKILL 里提到、但它跑不了的 `tingly-design` 命令；超时给 120000 ms；不影响外观的改动（备注、改名）不用看；失败就在回答里说，不卡住。**人此刻打开的那一页是默认的 `pick`**：`DELEGATE[kind].seeing.pick` 把请求带来的 `file`（`slides/<id>.html`、`tabs/<id>.md`、画板文件）换成 `pick`；没有对应关系的类型（设计系统的视图在 `context` 里，动效、看板）不预填，由 `seeing.hint` 说怎么选。找不到 Chrome 时工具和这段话都不出现，免得白花一轮去吃一个拒绝。
- **运行反馈**：Bash 里的 `scripts/look.mjs` 在步骤里写成“看一眼页面”（`AgentStep.op = 'look'`，词在 `prompt.step.look`），人看得见它在检查。

## 4. 为什么这样

- 复用 `check --snapshots` 而不是另写一条画图路径：同一张图意味着 agent 看到的就是 `check` 和导出菜单认的样子，修好的版面警告也和 CI 的 `check_snapshots` 一致。
- 不放进 MCP 给执行用：执行只需要“看”，`look` 脚本的工具面是一个命令；MCP 和命令行已经有 `look` / `check --snapshots`，给外面的 agent 用。
- 图写进项目的 `renders/`（本机状态，不进 zip、不进提交，`.gitignore` 的 `projects/*/renders/`），不放 `/tmp`，Claude Code 的 `--add-dir` 本来就覆盖项目文件夹，Read 可以直接读。

## 5. 各类型

六种类型都接，见 [project-kinds.md](./project-kinds.md) 矩阵“Claude Code 看得见页面”一行。

## 6. 没做的

- 动效任意时刻 `t` 的一帧：现在只画封面帧（精确渲染器的 PNG 路径没有时间参数）。
- 人的选中和滚动位置不在图里。
- 编辑器里没有“让它看”的开关：配了 Chrome 就给；如果有人不想让 Claude Code 开浏览器，目前只能靠没有 Chrome。
- 没有 Chrome 的机器上，请求栏不提示“装一个 Chrome 才看得见”；只是工具不出现。
