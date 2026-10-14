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
| `apps/server/src/index.ts` `POST /api/projects` | 允许的 `kind` 白名单 | 新建对话框建出来的是画布 |
| `apps/server/src/index.ts` `/fast-edit` | 选快速 AI 的系统提示（`FAST_EDIT_*`） | 快速 AI 按画布规则改 |
| `apps/server/src/delegate.ts` `startDelegate` | 交给 Claude Code 时的开场说明、附件路径写法、系统提示、允许的工具 | Claude Code 按画布规则改文件 |
| `packages/core/src/prompt.ts` | 快速 AI 的系统提示正文（`FAST_EDIT_SYSTEM`、`FAST_EDIT_SLIDES`、`FAST_EDIT_DOCS`）；Claude Code 的在 `delegate.ts`（`SLIDES_SYSTEM` 等） | 同上 |
| `packages/core/src/launcher.ts` `projectCard`、`ProjectPreview` | 启动页卡片的标题、数量、预览数据 | 卡片没有预览 |
| `apps/editor/src/components/Launcher.tsx` `KINDS`、图标、`Preview` | 名称、单位、简介（文字在 `@dc/i18n` 的 `launcher` 区域）、颜色；分类标签；新建入口 | 不能筛选、不能新建 |
| `packages/i18n/src/locales/{en,zh}/<kind>.ts` | 这种类型编辑器的界面文字，两种语言；`starter` 里加它新建时的占位文案 | 类型检查不过，或界面上出现没翻译的文字 |
| `apps/editor/src/App.tsx` | 按 `kind` 进入对应的编辑器 | 打开后是画布编辑器 |
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
| 请求栏面板（[agent-panel.md](./agent-panel.md)） | `AgentBar.tsx`（收起、药丸、历史、新对话/接着标记）、`delegate.ts` 的 `--resume` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ 槽位固定高度，卡片浮在舞台上 | 六种都走同一份部件；"接着"只对 Claude Code，快速 AI 每次从头开始 |
| 手写 jQuery（“代码”面板，[agent-feedback.md](./agent-feedback.md) §4） | `panel/JQueryBox.tsx`、`runJQuery`，运行卡片的“在 jQuery 里改” | ✓ 元素或画板 | ✓ 没选中时用舞台上那一页 | ✗ 没有 jQuery 执行器 | ✗ 同左 | ✗ 快速 AI 改的是段落文字，不是语句 | ✓ 没选中时用舞台上那个场景 | 高级入口，不在请求栏上 |
| 附件（[attachments.md](./attachments.md)） | `attachments.ts`、`Attachments.tsx` | ✓ 发给模型；画板可用 `src="uploads/…"` 显示，画布图片项 `src: "uploads/…"` | ✓ 可用 `src="uploads/…"` 显示 | ✓ | ✓ | ✓ Claude Code 栏可附；段落改写不带附件；标签页用 `../uploads/…` | ✓ 发给模型；场景可用 `src="uploads/…"` 显示 | `design-system`、`dashboard` 技能还没写 `uploads/` |
| 版本、409 重放、协作 | `apps/server`、编辑队列 | ✓ | ✓ | ✓ | ✓ | ✓ 按块合并（`docs.ts` `mergeBlocks`） | ✓ | |
| 日志（journal） | `JournalPopover`、`Journal` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| 撤销自己的改动 | 编辑队列 + `rebase.ts` 定位 | ✓ | ✓ | ✓ | 未核实 | 编辑器内撤销（tiptap），写回标记 `undoable: false` | ✓ 场景文件和 `motion.json` | |
| 界面语言（[i18n.md](./i18n.md)） | `@dc/i18n`（每个区域一份词条）、编辑器 `i18n.ts`、外观菜单、服务端 `x-dc-lang` | ✓ `canvas`、`panel` | ✓ `slides` | ✓ `ds` | ✓ `dash` | ✓ `docs` | ✓ `motion` | 共用部件的文字在 `common`、`prompt`、`app`、`importer`；新建时的占位文案在 `starter`，按新建者的语言写进文件；新类型要加自己的区域文件，测试会查出漏掉的汉字和缺的键 |
| 编辑器主题（[theming](../docs/zh/theming.md)） | `theme.ts`、CSS 变量 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 只改编辑器外壳，**不改**作品本身的颜色；外观菜单只在启动页 |
| 宿主消息（[embedding](../docs/zh/embedding.md)） | `host.ts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `location` 只带 `?p=`，不分类型 |
| 离开项目：回首页、切换、新建、反馈（[launcher.md](./launcher.md) §4） | `ProjectMenu`（各类型自己的栏里放一份） | ✓ 左浮栏 | ✓ 缩略图栏顶部 | ✓ 侧栏顶部 | ✓ 顶栏 | ✓ 顶栏 | ✓ 顶栏 | 没有共用顶栏，所以组件共用、位置各自；新类型要自己放进去 |
| 启动页卡片和预览（[launcher.md](./launcher.md)） | `launcher.ts`、`Launcher.tsx` | ✓ 实时画板 | ✓ 实时封面 | ✓ 色板/字体/组件 | ✓ 数据集 | ✓ 大纲/摘要 | ✓ 封面静帧 | |
| 装入设计系统 | `POST /design-systems` | ✓ | ✓ | — | ✗ 服务端只允许画布和幻灯片 | ✗ 同左 | ✗ 服务端只允许画布和幻灯片 | |
| 导出（[export.md](./export.md)） | 各自的菜单；共用的编码、取图、字体、下载在 `packages/export`（`@dc/export`） | ✓ `Board.tsx`（PNG） | ✓ `exportDeck.ts`（HTML、打印 PDF、备注） | ✗ | ✗ 只有查询结果的 CSV | ✓ Markdown、HTML、打印 PDF | ✓ 顶栏“导出视频”：浏览器里生成 MP4 或 WebM；`scripts/motion-render.mjs` 命令行渲染含 embed 的作品 | 菜单还是各做各的；PNG、PDF、PPTX 给其他类型是方案 |
| 放映 / 播放 | 各自实现 | ✓ play mode | ✓ 放映 | — | — | — | ✓ 播放器 | 三种各自实现，没有共用的播放部件 |
| 图层树（[layers-tree.md](./layers-tree.md)） | `panel/LayerTree.tsx`（`LayerRow`、`ElementRows`）；隐藏/锁定写进文件，runtime 认 `data-hide`、`data-lock` | ✓ 画板、画布上的项、画板里的元素 | ✓ 当前这一页的元素 | ✗ 没有元素树，是令牌和组件的列表 | ✗ 页面是一份代码，没有可选的元素 | ✗ 用大纲（标题导航）；段落不是图层，隐藏和锁定对文档没有意义 | ✓ 播放头所在场景的元素，另标"何时入场" | 同一棵树、同一行（箭头、图标、名称、“文字”、隐藏、锁定）；幻灯片/场景自己的那一行没有开关（跳过一页是另一个开关）|
| 元素缩放手柄 | `runtime.tsx` 的 `resize` 消息 | ✓ | ✓ | — | 待定：元素尺寸多由网格决定 | 待定：只有图片宽度值得做 | ✓ 非主尺寸里写进覆盖 | 八个手柄、吸附、W×H；看板和文档见 [motion-editing.md](./motion-editing.md) §3.7 |
| 新建时导入（[import](./import-external-material.md)） | `packages/import`、`ImportDialog` | ✓ HTML、SVG | ✗ PPT 评估中 | — | ✗ 还不能从 CSV 新建 | ✗ 还不能从 Markdown 新建 | — | 启动页的入口，结果总是新画布 |
| 往打开的项目里导入（[import-into-project](./import-into-project.md)） | `ImportHere`（按钮、拖放、粘贴）+ 各类型的 `ImportTarget` | ✓ 网页、SVG → 新画板；图片 → 画布上的图片 | ✓ 图片、SVG → 当前幻灯片（只拖放和粘贴，按钮仍是"插入图片"）；网页不收 | ✓ 字体 → 字体，图片、SVG → 素材 | ✓ CSV/TSV/JSON → 数据集 | ✓ Markdown → 新标签页 | ✓ 图片、SVG → 播放头所在场景，从播放头入场 | 原文件放 `uploads/`；看板数据在 `data/`、设计系统的字体和素材在它自己的目录 |

## 4. 做跨类型功能时

1. 先在矩阵里找到最像的一行。已经有共用部件的，在它上面加，不要为某个类型另写一份。
2. 写下这个功能对每种类型的结论：支持、不支持（为什么）、不适用。不支持是一种决定，要写原因，否则下个会话会当成漏了。
3. 这个功能如果改变了 Claude Code 能读写或引用的东西，同步每种类型的技能文件和 `delegate.ts` 里的说明。
4. 在声称支持的每种类型里测过（e2e 或手动），PR 里写明哪种没测。
5. 更新本文的矩阵，必要时更新 `CLAUDE.md`。

## 5. 已知缺口

不是缺陷单，是现在的取舍或欠账，动手前先确认是否仍然成立。

- motion 在编辑器里还不能新建、复制、删除、排序场景，没有时间条和关键帧，不能导出，也不能装入设计系统；剩下的分期见 [motion-editing.md](./motion-editing.md) §5。
- `design-system`、`dashboard` 两个技能没有提 `uploads/`。
- 文档的段落改写不带附件；设计系统没有快速 AI。
- 图层树的隐藏和锁定只拦舞台上的操作，属性面板、Delete 键不受锁定限制；多选后批量切换没做（见 [layers-tree.md](./layers-tree.md) §6）。
- 导出各写各的，设计系统和看板没有导出。
- 外观菜单和语言按钮只在启动页，进入编辑器后改主题或语言要回启动页（或由宿主、URL 传入）。
