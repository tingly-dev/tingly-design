# 项目类型与跨类型功能：接线清单

状态：**现行契约**。加一种项目类型，或做一个各类型都能碰到的功能（提示栏、附件、主题、导出……）之前先读这份；改了接线或矩阵，同时更新这里。

为什么要有这份：编辑器的大部分功能不是"画布功能"。附件一次接进了画布、幻灯片、设计系统、看板、文档，因为它挂在共用的 `PromptBar` 和 `AskClaude` 上；而一种新类型的格式和示例项目都写好了，只要没在 `kindOf` 和启动页登记，启动页就根本看不到它（motion 起初就是这样）。前者是做对了的样子，后者是最容易忘的地方：类型是在十几个文件里分别登记的，没有一处总表，漏一处不会报错，只会悄悄缺一块。

## 1. 现有类型

| 类型（`ProjectKind`） | 中文名 | 索引文件 | 内容单元 | 编辑器 | Claude Code 技能 | 示例项目 |
|---|---|---|---|---|---|--- |
| `design` | 画布 | `canvas.json` | `*.dc.html` 画板 | `App.tsx` + `components/` | `dc-canvas` | `box-console` |
| `slides` | 幻灯片 | `deck.json` | `slides/<id>.html` | `components/slides/` | `slides` | `tingly-intro` |
| `design-system` | 设计系统 | `design-system.json` | `tokens.json`、`components/`、`assets/`、`fonts/` | `components/ds/` | `design-system` | `tingly-ds` |
| `dashboard` | 看板 | `dash.json` | `datasets/<id>.json` + `files/index.html` | `components/dash/` | `dashboard` | `box-usage` |
| `docs` | 文档 | `doc.json` | `tabs/<id>.md` | `components/docs/` | `docs` | `design-guide` |
| `motion` | 动效 | `motion.json` | `scenes/<id>.html` | `components/motion/`（编辑舞台和播放器叠放） | `motion` | `design-motion` |

motion 的设计见 [motion.md](./motion.md)，编辑见 [motion-editing.md](./motion-editing.md)；舞台上点选、改字、缩放和改尺寸已经能做，关键帧还没做；导出视频在编辑器里已能做（[export.md](./export.md)）。

## 2. 一种类型要在哪些地方登记

按代码路径排列。漏掉任何一行，现象写在最后一列。

| 位置 | 做什么 | 漏了会怎样 |
|---|---|--- |
| `packages/core/src/deck.ts` `ProjectKind`、`projectKind(files)` | 类型名；按文件判断类型 | 类型检查不过，或前端认不出 |
| `apps/server/src/store.ts` `kindOf` | 按索引文件判断目录是什么类型（**有先后**：`deck.json` 先于 `canvas.json`） | 启动页不列、接口按画布处理 |
| `apps/server/src/store.ts` `createProject` | 新建时写出最小的索引和第一个内容单元 | 新建出空目录 |
| `apps/server/src/app.ts` `POST /api/projects` | 允许的 `kind` 白名单；动效和画布还收一个可选的 `size`（宽高，核心的 `validSize` 校验；画布是第一块画板的大小；命名的画布尺寸是 core 的 `BOARD_SIZES`，对话框和命令行 `new canvas --size` 都读它） | 新建对话框建出来的是画布；动效总是 16:9，画布总是 1200×760 |
| `apps/server/src/app.ts` `/fast-edit` | 选快速 AI 的系统提示（`FAST_EDIT_*`） | 快速 AI 按画布规则改 |
| `apps/server/src/delegate.ts` `startDelegate` | 交给 Claude Code 时的开场说明、附件路径写法、系统提示、允许的工具 | Claude Code 按画布规则改文件 |
| `packages/core/src/prompt.ts` | 快速 AI 的系统提示正文（`FAST_EDIT_SYSTEM`、`FAST_EDIT_SLIDES`、`FAST_EDIT_DOCS`）；Claude Code 的在 `delegate.ts`（`SLIDES_SYSTEM` 等） | 同上 |
| `packages/core/src/launcher.ts` `projectCard`、`ProjectPreview` | 启动页卡片的标题、数量、预览数据 | 卡片没有预览 |
| `apps/editor/src/components/launcher/`：`kinds.tsx` 的 `KINDS` 和图标、`Preview.tsx` 的 `Preview` | 名称、单位、简介（文字在 `@dc/i18n` 的 `launcher` 区域）、颜色；分类标签；新建入口 | 不能筛选、不能新建 |
| `packages/i18n/src/locales/{en,zh}/<kind>.ts` | 这种类型编辑器的界面文字，两种语言；`starter` 里加它新建时的占位文案 | 类型检查不过，或界面上出现没翻译的文字 |
| `apps/editor/src/App.tsx` | 按 `kind` 进入对应的编辑器 | 打开后是画布编辑器 |
| `apps/editor/src/components/<kind>/` | 这种类型的编辑器和它自己的状态（如 `slides.ts`、`motion.ts`）；各类型共用的部件留在 `components/` 根下，不放进某个类型的目录 | 看目录分不清哪些是共用部件，改共用功能时漏掉某种类型 |
| `apps/editor/src/store.ts` | 读项目时记下 `kind` | 共用部件不知道自己在哪种类型里 |
| `.claude/skills/<kind>/SKILL.md` | 文件格式、能引用什么（`uploads/` 等） | Claude Code 写出编辑器读不了的文件 |
| `projects/<sample>/` | 一个示例项目 | 新用户看不到这种类型能做什么 |
| `docs/en/guide/<kind>.md`、`docs/zh/guide/<kind>.md` | 用户指南，两种语言 | |
| `docs/*/architecture.md` 仓库结构段、`README.md` / `README.zh-CN.md` 类型表 | 结构说明 | |
| `e2e/<kind>.py`、`docs/*/development.md` 测试表 | 端到端测试 | |
| `CLAUDE.md` | 结构段 | 下一个会话不知道这种类型存在 |

## 3. 跨类型功能矩阵

✓ 支持，✗ 不支持（附原因），— 不适用。"共用部件"一列说明它在哪里实现，新类型接上它就有。

| 功能 | 共用部件 | 画布 | 幻灯片 | 设计系统 | 看板 | 文档 | 动效 | 备注 |
|---|---|---|---|---|---|---|---|--- |
| 快速 AI（jQuery 写回） | `PromptBar`、`fastedit.ts`、`/fast-edit` | ✓ | ✓（越出幻灯片子集会撤回并说明） | ✗ | ✗（页面交给 Claude Code 写，服务端拒绝） | ✓ 选中段落改写，走 `FAST_EDIT_DOCS` | ✓ 播放头所在场景，走 `FAST_EDIT_MOTION`，用 `checkScene` 检查；非主尺寸里的样式写成覆盖 | |
| 交给 Claude Code | `AskClaude`（`AskClaude.tsx`）、`PromptBar` 的 `askClaude()`、`delegate.ts` | ✓ | ✓ | ✓ | ✓（可跑 `scripts/dash-query.mjs`） | ✓ | ✓ | |
| 运行反馈（[agent-feedback.md](./agent-feedback.md)） | `RunFeed`（挂在 `PromptBar` 和 `AskClaude` 里）、core 的 `describeTool`、`DELETE …/delegate/:id` | ✓ 改动文件可定位画板；运行中画板有徽标 | ✓ 定位到那一页 | ✓ 文件只列不跳（没有单一视图可定位） | ✓ 打开数据来源或代码面板 | ✓ 切到那个标签页 | ✓ 跳到那个场景 | |
| 请求栏面板（[agent-panel.md](./agent-panel.md)、[chat-panel.md](./chat-panel.md)） | `AgentBar.tsx`（位置菜单、药丸、历史、新对话/接着标记）、`ChatPanel.tsx`（`ChatShell` 外壳、左侧列、`ListColumn`）、`RequestBar.tsx`、`delegate.ts` 的 `--resume` | ✓ | ✓ 左列（页面）成为列里的第一个页签；放映不画列 | ✓ 左列（列表）成为第一个页签 | ✓ | ✓ 左列（标签页）成为第一个页签；批注仍在右边 | ✓ 左侧时不占槽位（`.mprompt` 隐藏），在底部时槽位固定高度 | 位置：底部（默认）或左侧一直打开的对话列，各类型共用，偏好 `dc.barMode`（旧的 `auto` 读作 `left`）；窗口放不下时自动退回底部（各类型下限在 `ChatPanel.tsx` 的 `MIN_WORK`）；"接着"只对 Claude Code，快速 AI 每次从头开始。列在外壳里，类型的布局不改 |
| Claude Code 对话（接着上次，[agent-panel.md](./agent-panel.md)） | `delegate.ts` 的 `readConversation` / `keepConversation`、项目里的 `.claude-session.json`、core 的 `conversation.ts`、`GET/DELETE …/conversation` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 项目一份，不分类型；会话号在服务端，所以刷新、换窗口、命令行和 MCP 都接得上；快速 AI 不参与 |
| 对话记录（每一轮的请求、步骤、回答、改动，[chat-panel.md](./chat-panel.md) §3.4） | `transcript.ts`（core 的轮次类型和裁剪；服务端读写 `.transcript.jsonl`）、`turns.ts`、`Transcript.tsx`、`GET/POST …/transcript` | ✓ 改动文件可定位画板 | ✓ 定位到那一页 | ✓ 文件只列不跳 | ✓ 打开数据来源或代码面板 | ✓ 切到那个标签页 | ✓ 跳到那个场景 | 项目一份，在本机（不提交、不进 .zip）；Claude Code 的轮次由服务端写，所以命令行和 MCP 的请求也在里面，快速 AI 的由编辑器结束时提交；底部时历史列表读同一份，左侧时就是列的内容 |
| 边栏宽度可拖（[side-columns.md](./side-columns.md)） | `SideResizer.tsx`、`sideWidth.ts`、`--w-<列>` | ✓ 检查器 | ✓ 缩略图列、检查器 | ✓ 导航 | ✓ 数据来源、代码 | ✓ 标签页、批注 | ✓ 检查器 | 每一列各自记在本机；对话列的宽度也是这样（`e2e/side_resize.py`、`e2e/chat_panel.py`） |
| 手写 jQuery（“代码”面板，[agent-feedback.md](./agent-feedback.md) §4） | `panel/JQueryBox.tsx`、`runJQuery`，运行卡片的“在 jQuery 里改” | ✓ 元素或画板 | ✓ 没选中时用舞台上那一页 | ✗ 没有 jQuery 执行器 | ✗ 同左 | ✗ 快速 AI 改的是段落文字，不是语句 | ✓ 没选中时用舞台上那个场景 | 高级入口，不在请求栏上 |
| 图片生成（[image-generation.md](./image-generation.md)） | 设置里的“图片生成”一块、`apps/server/src/imagegen.ts`（`POST /api/projects/:p/images`）、`scripts/image-gen.mjs`；`delegate.ts` 配好时才把它交给 Claude Code | ✓ 放进 `uploads/`，画板写 `src="uploads/…"` | ✓ 同左 | ✗ 素材放自己的 `assets/`，不用 `uploads/`；没有设计系统的工具 | ✗ 看板只读 `data/` | ✓ 标签页用 `../uploads/…` | ✓ 场景写 `src="uploads/…"` | 只有交给 Claude Code 时才有（编辑器里的请求栏、命令行 `prompt`、MCP `prompt` 都是这一路）；快速 AI、命令行和 MCP 没有单独的生图入口。没配好、全局关掉或本项目在项目菜单里关掉（本机状态 `.image.json`）时这个工具不出现 |
| 附件（[attachments.md](./attachments.md)） | `attachments.ts`、`Attachments.tsx` | ✓ 发给模型；画板可用 `src="uploads/…"` 显示，画布图片项 `src: "uploads/…"` | ✓ 可用 `src="uploads/…"` 显示 | ✓ | ✓ | ✓ Claude Code 栏可附；段落改写不带附件；标签页用 `../uploads/…` | ✓ 发给模型；场景可用 `src="uploads/…"` 显示 | `design-system`、`dashboard` 技能还没写 `uploads/` |
| 版本、409 重放、协作 | `apps/server`、编辑队列 | ✓ | ✓ | ✓ | ✓ | ✓ 按块合并（`docs.ts` `mergeBlocks`） | ✓ | |
| 外部改动自动刷新（Claude Code、终端、git 改了文件，打开着的编辑器不用重载就显示） | `store.ts` 的 `onEvent`（服务端 SSE 的 `file` 事件） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 六种类型的示例各改一处文字，在屏幕上等到新文字（`e2e/external_edit.py`） |
| 日志（journal） | `JournalPopover`、`Journal` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| 撤销自己的改动 | 编辑队列 + `rebase.ts` 定位 | ✓ | ✓ | ✓ | 未核实 | 编辑器内撤销（tiptap），写回标记 `undoable: false` | ✓ 场景文件和 `motion.json` | |
| 界面语言（[i18n.md](./i18n.md)） | `@dc/i18n`（每个区域一份词条）、编辑器 `i18n.ts`、外观菜单、服务端 `x-dc-lang` | ✓ `canvas`、`panel` | ✓ `slides` | ✓ `ds` | ✓ `dash` | ✓ `docs` | ✓ `motion` | 共用部件的文字在 `common`、`prompt`、`app`、`importer`；新建时的占位文案在 `starter`，按新建者的语言写进文件；新类型要加自己的区域文件，测试会查出漏掉的汉字和缺的键 |
| 编辑器主题（[theming](../docs/zh/theming.md)） | `theme.ts`、CSS 变量 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 只改编辑器外壳，**不改**作品本身的颜色；外观菜单在启动页，编辑器里在顶栏最右的"更多"菜单里（[top-bar.md](./top-bar.md)） |
| 宿主消息（[embedding](../docs/zh/embedding.md)） | `host.ts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `location` 只带 `?p=`，不分类型 |
| 顶栏：项目名、同步状态和改动记录、导入 / 导出、"更多"（反馈、点星、语言、外观）（[top-bar.md](./top-bar.md)） | `TopBar`、`ProjectTitle`、`SyncStatus`（历史图标加状态点，常态下不多一个字） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 六种是同一条栏，同样的位置和顺序；类型自己的动作放在 `TopBar` 的子节点里；画布和幻灯片的浮栏只剩工具；放映 / 播放时幻灯片不画顶栏 |
| 离开项目：回首页、切换、新建（[launcher.md](./launcher.md) §5） | `ProjectMenu`（`TopBar` 最左，自带） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 新类型用 `TopBar` 就有；反馈和点星在顶栏最右的"更多"菜单里，不在项目菜单里 |
| 新建时选尺寸（[motion-editing.md](./motion-editing.md) §3.7） | `SizePicker`（新建对话框里选了动效才出现）、`motionSizes.ts`（浏览器里记上次和自己的尺寸）、核心 `MOTION_SIZES` / `newMotion` | — | — | — | — | — | ✓ 预设、自定义、上次用的 | 动效和画布在新建时选尺寸（动效是按平台命名的格式，画布是 `BoardSizePicker` 里 `BOARD_SIZES` 的命名尺寸和自定义，见 [launcher.md](./launcher.md)）；幻灯片固定 1920×1080，其余随窗口 |
| AI 模型设置（[ai-settings.md](./ai-settings.md)） | `AiSettings.tsx`（启动页按钮、`ProjectMenu`、请求栏“去设置”都打开同一个）、`apps/server/src/aiconfig.ts`、`packages/core/src/aiConfig.ts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 全局设置，不属于某个项目，所以各类型一样；快速 AI 用不上的类型（看板）仍用 Claude Code 那一项 |
| 新建时选起点（[design-system-looks.md](./design-system-looks.md)） | `LookPicker`（新建对话框里选了设计系统才出现）、核心 `LOOKS` / `lookTokens` / `lookKit`、`new design-system --look` | — | — | ✓ 36 个风格，五组，带组件和封面 | — | — | — | 只有设计系统有“风格”这个概念（颜色、字体、圆角、阴影）；其余类型的起点是尺寸（动效、画布）或设计系统（画布、幻灯片），不在这里 |
| 启动页卡片和预览（[launcher.md](./launcher.md)） | `launcher.ts`、`launcher/Preview.tsx` | ✓ 实时画板 | ✓ 实时封面 | ✓ 色板/字体/组件 | ✓ 数据集 | ✓ 大纲/摘要 | ✓ 封面静帧 | |
| 启动页分组、列表视图、重命名（[launcher.md](./launcher.md) §3） | `projects/.groups.json`、`PATCH /api/projects/:p`、`INDEX_FILE`、`launcher/` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 启动页层面的功能，六种一样；只有重命名随类型变（标题在各自的索引文件里，`INDEX_FILE`）。列表视图不画预览 |
| 项目放在别处（[project-folders.md](./project-folders.md)） | `projects/.links.json`、`projectDir`、`/api/folder`、`/api/links`、`launcher/NewDialog.tsx` 的 `OpenFolderDialog` 和新建对话框的路径 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 在 `projectDir` 之下，和类型无关；`e2e/folders.py` 六种都从外部打开过；看板的 `dash-query.mjs` 也认登记的文件夹 |
| 提交到 git（[project-git.md](./project-git.md)） | `JournalPopover` 里的 `CommitDialog`（顶栏同步状态打开）、`apps/server/src/git.ts`、`GET …/git`、`POST …/commit` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 只提交项目文件夹，不提交 `.journal.jsonl`、`.runs.json`、`renders/`；`e2e/git.py` 六种都查了入口 |
| 装入设计系统 | `POST /design-systems` | ✓ | ✓ | — | ✗ 服务端只允许画布和幻灯片 | ✗ 同左 | ✗ 服务端只允许画布和幻灯片 | |
| 导入 / 导出（[export-menu.md](./export-menu.md)；视频底层 [export.md](./export.md)；图片 [export-image.md](./export-image.md)） | `FileMenu`（栏里唯一的“导入 / 导出”按钮，内含 `ImportHere`）、各类型交出 `ExportItem` 列表；PDF 共用 `pdfExport.ts`（服务端 `POST /api/pdf`，没有 Chrome 时回到打印窗口）；图片的画法和提示共用 `imageExport.ts`；视频的编码、取图、字体、下载在 `packages/export`（`@dc/export`） | ✓ PNG、PNG @2x、这一页的每个画板、源文件（`Board.tsx` 的 `canvasExportItems`；画板名称条上的下载图标保留） | ✓ PDF、PNG（这一页、每一页）、HTML、Markdown（核心 `slidesMarkdown.ts`）、备注（`exportDeck.tsx`） | ✓ PNG（当前视图；组件预览是空白） | ✓ PNG（整页） | ✓ PDF（A4）、Markdown（标签页、整篇）、HTML、PNG（当前标签页） | ✓ 视频…、GIF…（对话框：默认一键，选项折起来：格式含 GIF、尺寸、帧率、质量、范围），含 embed、video 的作品自动改由服务端的 Chrome 画（`render.ts`，出 MP4 或 GIF，选项同对话框）；PNG（播放头所在的帧）；命令行 `tingly-design export --as mp4|gif|png|html`（[cli.md](./cli.md)）出视频、封面和单文件播放器 | 画布和看板没有 PDF（画板、页面各在沙箱框架里，分页没有意义）；PPTX 没有 |
| 命令行和 MCP（[cli.md](./cli.md)） | `apps/server/src/commands.ts`（命令做的事，数据）、`wizard.ts` 与核心 `newWizard.ts`（`new -i` 的提问，六种都问类型；画布问尺寸分类和尺寸，动效问画幅）、`cli.ts`（终端输出）、`mcp.ts`（同一份作为 MCP 工具，`/mcp` 和 `tingly-design mcp`；格式说明是资源和提示 `make`、`edit`，读 `.claude/skills/<kind>`）；核心 `outlineProject`、`checkProject`、`journalSince`（`packages/core/src/project.ts`）；文字在 `@dc/i18n` 的 `cli`；`open`、`history`、`prompt`（交给编辑器的 Claude Code，各类型的系统提示词在 `delegate.ts`；`--fast` 只在有请求栏快速 AI 的画布、幻灯片、动效，`PromptBar` 交给 `headless.ts` 的 `offerPrompt`）、找到正在运行的编辑器（`running.ts`）和类型无关，六种都有；成品的 `export` 和 `check --snapshots` 由 Chrome 打开编辑器、跑 `FileMenu` 的项（编辑器 `headless.ts`，服务端 `pageExport.ts`），类型只交出 `pick` | ✓ `new`、`list`（画板、尺寸）、`check`；`export` png（`--board`、`--scale 2`） | ✓ `new`、`list`（幻灯片）、`check`（`checkSlide`）；`export` pdf / png / html / md / notes（`--slide`） | ✓ `new`、`list`（颜色、字体、组件）、`check`（令牌）；`export` png（`--view`；组件预览是空白） | ✓ `new`、`list`（数据集）、`check`（页面、数据集）；`export` png（等数据集加载完） | ✓ `new`、`list`（标签页、字数）、`check`（标签页文件）；`export` pdf / html / md / png（`--tab`） | ✓ `new`、`list`（格式、场景时间）、`check`（`checkScene`、封面）、`export` mp4 / gif / png；`--snapshots` 画每个画幅的封面（`render.ts`） | 每种类型都有 `export --as zip` 和 `import`、`check --snapshots`；新类型要在 `FileMenu` 交出导出项和 `pick`，并在 `commands.ts` 的 `FORMATS`、`pageJobs` 里登记（MCP 的 `export` 跟着有），`SKILLS` 里登记它的 skill；`--snapshots` 还查版面（裁切、出界、对比度、空白，[harness.md](./harness.md)），动效除外 |
| 放映 / 播放 | 各自实现 | ✓ play mode | ✓ 放映 | — | — | — | ✓ 播放器 | 三种各自实现，没有共用的播放部件 |
| 图层树（[layers-tree.md](./layers-tree.md)） | `panel/LayerTree.tsx`（`LayerRow`、`ElementRows`）；隐藏/锁定写进文件，runtime 认 `data-hide`、`data-lock` | ✓ 画板、画布上的项、画板里的元素 | ✓ 当前这一页的元素 | ✗ 没有元素树，是令牌和组件的列表 | ✗ 页面是一份代码，没有可选的元素 | ✗ 用大纲（标题导航）；段落不是图层，隐藏和锁定对文档没有意义 | ✓ 播放头所在场景的元素，另标"何时入场" | 同一棵树、同一行（箭头、图标、名称、“文字”、隐藏、锁定）；幻灯片/场景自己的那一行没有开关（跳过一页是另一个开关）|
| 整个项目导出 / 导入（[project-archive.md](./project-archive.md)） | `FileMenu` 末尾的两项（整个项目、仅项目文件），启动页“⋯”的“导出（.zip）”和“新建”菜单的“导入项目（.zip）”；编辑器 `projectArchive.ts`，服务端 `archive.ts`，规则在 core 的 `projectArchive.ts` | ✓ 带上装进来的设计系统 | ✓ 带上装进来的设计系统 | ✓ | ✓ 含 `data/` | ✓ | ✓ 含 `uploads/` 里导入的画板 | 共用部件里一次做完，各类型不用接；只有画布和幻灯片会装设计系统，所以“带上设计系统”只对它们起作用；命令行 `export --as zip`、`import` 走同一套打包和解包 |
| 和原版 Claude Design 互相搬作品（[claude-design-format.md](./claude-design-format.md)） | `FileMenu` 的 `claudeDesign` 参数（“Claude Design 包（.zip）”，排在“整个项目”前面）；启动页“导入项目”认包和 `.md`；核心 `claudeDesign.ts`，服务端 `archive.ts`；命令行 `export --as claude-design` / `import` | ✓ Design：`project/canvas.json` + 画板 | ✓ Slides：`project/deck.json` + `slides/`；图片要先上传成素材 | ✓ Design System：`project/` | ✓ Dashboard：存储文档一份一个文件，数据放 `blobs/` | ✗ 原版的 Docs 在服务里没有文件：导出走 Markdown，Claude Docs 导出的 `.md` 可在“导入项目”里变成新文档 | ✗ 原版没有对应类型 | 不选类型，从文件认；包里的 `README.md` 交代怎么由 Claude Code 发布 |
| 批注 / 备注（[motion-editing.md](./motion-editing.md) §3.8.1） | 画布的便签项；幻灯片和动效场景的 `<aside>`（共用 `NoteBox` 输入框、`notesOf` / `setNotesIn`）；动效另有作品级的 `motion.json` 的 `note` | ✓ 便签（画布上的项，不是文字批注） | ✓ 演讲者备注，放映时给演讲者看 | ✗ 没有这个粒度：令牌和组件自己有说明 | ✗ 页面是一份代码，说明写在代码注释里 | ✗ 用评论（钉在文字上，见文档指南） | ✓ 作品一层、场景一层，不画进画面、不渲染；给 Claude Code 读 | 动效的批注是写给人和 AI 看的背景，不是指令；渲染和导出的播放器会去掉 |
| 元素缩放手柄 | `runtime.tsx` 的 `resize` 消息 | ✓ | ✓ | — | 待定：元素尺寸多由网格决定 | 待定：只有图片宽度值得做 | ✓ 非主尺寸里写进覆盖 | 八个手柄、吸附、W×H；看板和文档见 [motion-editing.md](./motion-editing.md) §3.7 |
| 新建时导入（[import](./import-external-material.md)） | `packages/import`、`ImportDialog` | ✓ HTML、SVG | ✗ PPT 评估中 | — | ✗ 还不能从 CSV 新建 | ✗ 还不能从 Markdown 新建 | — | 启动页的入口，结果总是新画布 |
| 往打开的项目里导入（[import-into-project](./import-into-project.md)） | `ImportHere`（按钮、拖放、粘贴）+ 各类型的 `ImportTarget` | ✓ 网页、SVG → 新画板；图片 → 画布上的图片 | ✓ 图片、SVG → 当前幻灯片；网页不收 | ✓ 字体 → 字体，图片、SVG → 素材 | ✓ CSV/TSV/JSON → 数据集 | ✓ Markdown（或文档导出的 .zip）→ 新标签页 | ✓ 图片、SVG → 播放头所在场景，从播放头入场 | 原文件放 `uploads/`；看板数据在 `data/`、设计系统的字体和素材在它自己的目录 |
| 从项目导入（[import-from-project](./import-from-project.md)） | `ImportHere` 菜单的"从项目导入…"、`BoardPicker`、`POST …/import-board`、`<x-embed src>`（`XBoard`、播放器的 `mountBoard`）、`BoardEmbedProps` | 来源：画板（会动的带 `$time`）；Tweaks 有时间滑块。不收：画布之间直接复制画板就行，用不着嵌入 | ✓ 当前这一页；放映时循环；HTML 导出带运行时 | ✗ 第一期没做：组件可以是来源，但装入设计系统已经覆盖"用别人的组件" | ✗ 看板页面是一份代码，没有可嵌入的位置 | ✗ 文档正文是 Markdown，没有嵌入块 | ✓ 播放头所在场景，`data-seek` 逐帧；播放器、命令行渲染都画 | 副本在 `uploads/<来源>-<画板>/`，来源记在索引的 `imports`；启动页预览、PNG 导出不画嵌入的画板 |
| 画布的模板值（[canvas-template-values](./canvas-template-values.md)） | `TemplateValues`（`RightPanel` 什么都没选时）、核心 `canvasTemplateValues`，字段和写回用 Tweaks 的 `TweakField` / `setPropDefault` | ✓ 按画板分组，可折叠，30 个以上有过滤 | — 幻灯片没有模板值；嵌入画板的值在元素的属性里（`BoardEmbedProps`） | — 没有模板值 | — 没有模板值 | — 没有模板值 | — 嵌入画板的值在元素的属性里；场景没有模板值 | 有意只做画布：模板值是画布里画板的 `data-props`，别的类型没有"整份稿子的值"这个问题 |
| 画板里模板文字和颜色的原地编辑（[template-text-editing](./template-text-editing.md)） | core 的 `textRetype.ts`（`retypeKind` / `planRetype`）、运行时双击和提交、`retypeText`（store）、属性面板 `ColorField` 的 `bound` | ✓ 带洞的文字、循环里的列表项、数据洞的提示、颜色绑定 | — 幻灯片的文字没有洞（闭合的 HTML 子集） | — 没有模板 | — 没有模板 | — 没有模板 | — 场景没有洞 | 有意只做画布：洞和 `data-props` 是画布画板的模板机制 |

## 4. 做跨类型功能时

1. 先在矩阵里找到最像的一行。已经有共用部件的，在它上面加，不要为某个类型另写一份。
2. 写下这个功能对每种类型的结论：支持、不支持（为什么）、不适用。不支持是一种决定，要写原因，否则下个会话会当成漏了。
3. 这个功能如果改变了 Claude Code 能读写或引用的东西，同步每种类型的技能文件和 `delegate.ts` 里的说明。
4. 在声称支持的每种类型里测过（e2e 或手动），PR 里写明哪种没测。
5. 更新本文的矩阵，必要时更新 `CLAUDE.md`。每个 ✓ 在 `e2e/coverage.json` 里写上测它的套件，或者为什么还没有；`pnpm test` 会查矩阵和这份数据对不对得上（[harness.md](./harness.md)）。

## 5. 已知缺口

不是缺陷单，是现在的取舍或欠账，动手前先确认是否仍然成立。

- motion 在编辑器里还不能新建、复制、删除、排序场景，没有时间条和关键帧，也不能装入设计系统；剩下的分期见 [motion-editing.md](./motion-editing.md) §5。
- `design-system`、`dashboard` 两个技能没有提 `uploads/`。
- 文档的段落改写不带附件；设计系统没有快速 AI。
- 图层树的隐藏和锁定只拦舞台上的操作，属性面板、Delete 键不受锁定限制；多选后批量切换没做（见 [layers-tree.md](./layers-tree.md) §6）。
- 从项目导入只有画布的画板 → 幻灯片、动效；启动页预览和 PNG 导出不画嵌入的画板（见 [import-from-project.md](./import-from-project.md) §5）。
- 导出菜单共用了；只导出一个场景时没有声音；PPTX、画布和看板的 PDF 没有（[export-menu.md](./export-menu.md) §7）。
- 右键菜单的“复制为 PNG”只有画布有；幻灯片、看板、文档、动效各有自己的 PNG 导出，还没有“图到剪贴板”（[export-menu.md](./export-menu.md) §3）。
