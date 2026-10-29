# 设计说明索引

这里放"为什么这样做"：一个子系统的设计、考虑过的方案和取舍、已定的和还开着的问题。写设计本身，不写流水账：不记哪个 PR、哪个提交、什么时候做的，这些在 git 历史和 PR 描述里。怎么用、怎么跑写在 `docs/`（中英两份）；这里每份只写一种语言。

维护约定（和 Tingly Box 的 `.design/README.md` 一致；根目录 `CLAUDE.md` 也写了）：

- 动一个功能或子系统之前，先读这里相关的说明。
- 一个 PR 的核心是新功能、新项目类型、新文件格式、协议或不明显的取舍时，同一个 PR 里新写或更新说明，并更新本索引。修 bug、改名、改文案一般不需要，PR 里说一句即可。
- 文件内的"当前契约 / 实施状态 / 历史基线 / 提案"要明确区分；标题下第一行写状态。提案里的格式、接口和未来能力不能写得像已经存在。
- 现行契约在正文里维护；迁移前的分析标成历史，不回头改历史段里的旧路径。
- 流程、状态或布局图另存为 `主题.pencil.md`，和正文互相链接，职责重叠时指明以哪份为准。
- 重命名或拆分时同步更新正文、本索引、README 和源码注释里的引用。
- 各类型都能碰到的功能（提示栏、附件、主题、导出……）以 [project-kinds.md](./project-kinds.md) 的矩阵为准，改了功能就改矩阵。

## 产品原则

| 文档 | 内容 | 状态 / 阅读边界 |
|---|---|---|
| [ux-principles.md](./ux-principles.md) | 12 条 UX-First 判断标准与评审清单；做功能前必读，本仓库本地维护 | 现行契约 |

## 项目类型与跨类型功能

| 文档 | 内容 | 状态 / 阅读边界 |
|---|---|---|
| [size-adapt.md](./size-adapt.md) | 加尺寸、换尺寸后内容怎么跟着变：问题、五种做法、共用的 `adaptSize` 和必要时交给 Claude 重排 | 画板已实施；幻灯片、动效是方案 |
| [config-awareness.md](./config-awareness.md) | 配置变化与 AI：改尺寸、设计系统、格式等之后给人一条“让 Claude 跟进”的提议（共用部件 + 一张表，不自动跑），并让 AI 在 `open` 和每次委托里查到当前关键配置 | 第 1 期（配置事实）已实施；跟进提议是方案 |
| [project-kinds.md](./project-kinds.md) | 一种项目类型要在哪些地方登记；跨类型功能矩阵和已知缺口 | 现行契约 |
| [kind-registry.md](./kind-registry.md) | 把散落在各处的 `kind === …` 分支改成按层的穷尽表：问题、三种方案、建议的三步 | 方案 |
| [cross-kind-consistency.md](./cross-kind-consistency.md) | 六种类型里同一概念各写一遍的盘点（有序条目的增删复制挪、删除规矩、侧面板、分段选择、作品外观、快捷键、导出条目）、三层收拢方案（交互原语、按类型的条目模型、面板与当前视图）、分期与待定的产品问题 | 方案 |
| [store-slices.md](./store-slices.md) | 编辑器的大 store 为什么、怎么按"谁用它"切片（单个 store、不动消费方）；配图 [store-slices.pencil.md](./store-slices.pencil.md) | 方案 |
| [five-kinds.md](./five-kinds.md) | 从 Design 扩展到幻灯片、设计系统、看板、文档（文件名沿用“五种”；第六种动效见 [motion.md](./motion.md)） | 前半是当初的方案，"进度"一节是实施结论 |
| [motion.md](./motion.md) | 第六种类型：宣传视频和动效素材 | 研究 + phase 0 验证；已登记为类型，编辑舞台和播放器已实施 |
| [motion-editing.md](./motion-editing.md) | 动效的细粒度编辑：为什么场景原来点不动，舞台点选、尺寸覆盖、时间轴、关键帧的交互和实现（图：[motion-editing.pencil.md](./motion-editing.pencil.md)） | 第一期已实施（点选、改字、缩放、尺寸、快速 AI）；时间轴、关键帧是方案 |
| [motion-effects.md](./motion-effects.md) | 动效里的着色器特效层：可 seek 的 embed 装一个 GLSL 片元着色器（或用 `data-fx` 指名一个内置预设），WebGL2 在页面里画；输入、单位、确定性、降级，以及什么样的特效好看 | 契约、WebGL2 运行时和 `data-fx` 内置预设（16 个，scale、direction、at、region 等通用参数可改形态，无 WebGL2 时退回 CSS 版本，幻灯片也可用）已实施（示例 `projects/tingly-design-shader-effects-motion/`；agent 从 motion skill 的预设表学会，单元测试让表和代码保持一致）；手写 GLSL 的检查器报错、编辑器里的预设选择是方案；WebGPU / vgpu 的调研在 `.research/motion-effects.md` |
| [motion-taste.md](./motion-taste.md) | 动效的手艺：时长区间、缓动、主角与停顿写进 skill，检查器加两条警告；哪些网页动效规则不适用于视频 | 方案；调研在 `.research/opendesign.md` |

## 编辑器功能

| 文档 | 内容 | 状态 / 阅读边界 |
|---|---|---|
| [self-design.md](./self-design.md) | 自身设计稿：用一个画布项目（`projects/tingly-design-ui-canvas`）画 Tingly Design 自己的界面——整体结构、外壳、启动页、六种类型、顶栏和菜单、请求栏、主题 token；画到什么程度，先画再改代码，代码变了同一个 PR 里重画 | 已实施；§5 是没定的 |
| [top-bar.md](./top-bar.md) | 顶栏：六种类型共用的一条栏——项目名、同步状态、导入 / 导出放哪，反馈、点星、语言、外观为什么在最右；浮栏只留工具 | 已实施 |
| [dialog.md](./dialog.md) | 对话框：所有模态框共用一个 `Dialog`——遮罩、标题和关闭、焦点进出、Tab 留在框内、Esc 和菜单的先后 | 已实施 |
| [export-menu.md](./export-menu.md) | 导入 / 导出共用一个菜单：各类型放什么；PDF 一键（服务端 Chrome，没有就回到打印窗口）；视频默认一键、选项折起来；状态条 | 已实施；§7 是没做的 |
| [slides-pptx.md](./slides-pptx.md) | 幻灯片 PPTX 双向交换：新项目导入（包级严格、对象级尽力而为，74 种内置表格样式、经典与 Office 2016 图表重绘）、向已开 deck 整批追加、整份/范围可见 deck 导出（原生优先、原生表格、逐元素图片化、旋转/SVG/表格双线对角线竖排原生化）、opaque runtime 捕获、来源/报告与诊断、安全和验证门槛 | 独立模块与 launcher/API/CLI/FileMenu/MCP 接入已实施；聚焦产品 e2e 106/106 通过，导入方向曾以 LibreOffice 图像差分作保真度量，成品另经 python-pptx 独立读回，真实 PowerPoint 渲染未验收；未来提案单列 |
| [slides-variety.md](./slides-variety.md) | 幻灯片的样式多样性：薄 brief 下的方向选择与版式节奏（skill 与 `SLIDES_SYSTEM` 的分工）、新 deck 的识别（起始封面是空白起点）、装入设计系统时起始封面上色、示例 deck 的重排；设计系统承载版式与方向（模板与 prompt 作为素材）单列为方案 | 指导、识别、上色、示例 deck 已实施；版式库与 @ 引用是方案；调研在 `.research/slides-variety.md` |
| [docs-markdown.md](./docs-markdown.md) | 文档导出为 Markdown：文档标题和标签页成章节、标题层级理顺、图片路径跟着走（有图片时出带图片的 .zip）、`==高亮==` 转 `<mark>`、评论不导出；文字颜色存成 `<span data-color>` 的名字而不是色值 | 已实施 |
| [docs-docx.md](./docs-docx.md) | 文档导出为 Word（.docx）：由导出 Markdown 的同一份文本在浏览器里生成，不依赖服务；Google 文档靠传 Drive、Notion 靠贴 Markdown；哪些保留、哪些留作文字 | 已实施 |
| [docs-comments.md](./docs-comments.md) | 文档评论的表情回应（固定六个、存在评论里、不算请求），以及刻意不做的草稿 / @提及 / 多人光标 | 已实施 |
| [docs-history.md](./docs-history.md) | 文档的历史版本：写盘前存下被覆盖的标签页文本（本机、不进 zip 和提交），列表、预览、恢复走普通编辑 | 已实施 |
| [project-archive.md](./project-archive.md) | 整个项目导出成一个 .zip（项目和它用到的设计系统并排、可选带改动记录），再从首页或命令行导入：带什么不带什么、怎么读手工打包的 zip、重名和安全 | 已实施（编辑器、启动页、命令行）；拖入导入是没做的 |
| [claude-design-format.md](./claude-design-format.md) | 和原版 Claude Design 互相搬作品：包就是原版的文件布局（`project/…`，看板是存储文档），导入并进“导入项目”不选类型，导出挨着“整个项目”；图片和数据怎么对应、哪些类型没有 | 已实施（编辑器、启动页、命令行）；Docs 往返、查询数据集的数据是没做的 |
| [export-image.md](./export-image.md) | 每种类型保存为 PNG 图片：在浏览器里画，各类型的入口和画法，画不到的东西 | 已实施；视频、PDF 和共用菜单未定 |
| [drawn-check.md](./drawn-check.md) | 看板画出来的样子自查：`NaN`、空图表、标签重叠或被裁；同一段探针既在打开的页面里写进 `.runs.json` 的 `drawn`，也在 `check --snapshots` 里报成版面警告 | 已实施 |
| [canvas-check.md](./canvas-check.md) | 画布检查器：`checkCanvas` 把 `dc-canvas` 技能里写错了不报错的规则做成纯文本检查，返回规则 id 和参数，措辞留给命令行 / 编辑器 | 核心函数和 `check` 命令已实施；编辑器提示是方案 |
| [layers-tree.md](./layers-tree.md) | 图层树：画布、幻灯片、动效共用一棵树和同一种行；隐藏、锁定写进文件（`data-hide`、`data-lock`、`canvas.json` 的 `hidden`、`locked`）以及它们的含义 | 已实施；没有树的类型见 §5 |
| [template-text-editing.md](./template-text-editing.md) | 画板里模板文字和颜色的编辑：带洞的文字怎么拆段、改动落在哪一段，循环里的列表项、数据洞为什么不能改并怎么说，属性面板里由洞设置的颜色显示真实颜色并改 tweak | 已实施；整段重打、嵌套循环未定 |
| [project-theme.md](./project-theme.md) | 画布和幻灯片的主题：右侧面板的“主题”页签，点一张卡把整个作品换成设计系统的某个主题；按角色换颜色（幻灯片连字体），“原样”和 Undo 回去，范围（所有页 / 这一页），对比度，为什么不是 `var()` | 已实施（画布、幻灯片）；§7 位置、画布字体、命令行未定 |
| [canvas-template-values.md](./canvas-template-values.md) | 画布的模板值：什么都没选时，右侧面板按画板列出整个画布的 `data-props` 值，集中看、集中改；为什么不加页签、不放进图层树 | 已实施；同名值联动和脚本里未声明的值未定 |
| [canvas-fast-edit.md](./canvas-fast-edit.md) | 画布上的快速 AI：提示词里让它用 flex / grid 排版而不是像素偏移；一次回复里把部件复制到另一块画板（`board(file)`、其他画板的句柄前缀、只能复制不能搬、没点名的写法被拒），一次撤销退回整次回复；整块画板的复制仍交给 Claude Code | 已实施；仅画布 |
| [export.md](./export.md) | 导出：独立的 `@dc/export` 包、动效视频与取帧路线、速度度量；其他格式的现行入口链接到专门契约 | 动效视频已实施；PNG/PDF/共用菜单见对应笔记，受限 PPTX 接入已实施，验证范围见 slides-pptx；未做项单列；调研在 `.research/export.md` |
| [launcher.md](./launcher.md) | 启动页：项目卡片、实时预览、新建、画布/幻灯片/动效共用分类尺寸选择、PowerPoint / Markdown / 项目包直接导入、分组与列表视图 | 已实施 |
| [project-git.md](./project-git.md) | 项目和 git：只提交项目自己的文件夹、提交前写出仓库和分支、没有仓库时第一次提交顺带新建（或新建项目时勾选） | 已实施 |
| [project-folders.md](./project-folders.md) | 项目放在哪：打开或新建项目文件夹之外任意位置的项目（`.links.json` 登记）、npm 安装时的默认数据目录 `~/.tingly-design/` | 已实施 |
| [project-identity.md](./project-identity.md) | 项目身份：文件夹决定是哪个项目，名字不要求唯一，句柄只是地址 | 方案 |
| [cli.md](./cli.md) | 命令行 `tingly-design`：命令用编辑器里同一个词（`open`、`new`、`list`、`check`、`export`）；服务端拆成路由和启动；核心给数据、命令行给措辞；`server.mjs` 就是 `serve`；找到正在运行的编辑器（`.server.json`）、`history`；其他类型的导出由本机 Chrome 打开编辑器、跑导出菜单自己的项（`headless.ts`、`pageExport.ts`），`check --snapshots`；命令抽成数据（`commands.ts`），同一份作为 MCP 工具（`/mcp`、`tingly-design mcp`），`skills add`；`prompt` 交给编辑器跑 Claude Code；`new -i` 交互式新建（流程在核心、提问在终端） | 第 1–5 步已实施；§6 是还开着的和暂不做的 |
| [design-system-looks.md](./design-system-looks.md) | 设计系统的起点：从 36 个风格（html-ppt 的主题，MIT）里选一个，按感觉分五组；新建对话框、`new design-system --look`；原始英文名，画布和幻灯片可直接从收起的“内置”组装入；颜色字体圆角阴影之外，还带原主题规则画的组件和封面；DESIGN.md 导入是下一步 | 已实施；§5 是还原度，§6 是没做的 |
| [design-system-guide.md](./design-system-guide.md) | 设计系统的“怎么用”：README 末尾由 tokens.json 生成的使用说明（链接、主题、变量与备用值、色阶、字体族、文字样式），画布和幻灯片为什么只能用值，以及 `.ttc` 字体集合 | 已实施；开放问题是画板链接样式表 |
| [design-system-glance.md](./design-system-glance.md) | 设计系统一眼看懂：样张、概览页和启动页卡片怎么说清"这套系统是什么、和另一套差在哪" | 已实施 |
| [agent-feedback.md](./agent-feedback.md) | 请求栏和 agent 执行反馈：请求回显、步骤、计时、停止、改了什么、撤销整次运行 | 已实施；§7 是没做的 |
| [chat-panel.md](./chat-panel.md) | 对话面板：请求栏的位置收成底部和左侧（左侧一直打开，取代右侧自动隐藏；已有左列的类型用页签），面板里是一份能回头读的对话记录（每轮的请求、步骤、回答、改动），存在服务端，命令行和 MCP 的请求也在里面；窄窗口放不下时退回底部 | 已实施；§7 是没做的 |
| [side-columns.md](./side-columns.md) | 边栏的宽度：检查器、缩略图列、标签页、批注、导航、数据来源、对话列，每一列都能拖动边来调整宽度、方向键微调、双击恢复，各列分别记在本机 | 已实施；§5 是没做的；§6 底部条的固定高度与拖动（动效元素行） |
| [agent-panel.md](./agent-panel.md) | 请求栏的位置：底部（卡片平时一行）或左侧的对话列、请求历史、"新对话 / 接着"标记、项目的 Claude Code 对话由服务端保存 | 已实施；§5 是没做的 |
| [composer.md](./composer.md) | 请求栏的外形：一张卡三行（头、输入、工具条），设置是药丸、整栏的工具是图标，谁来回答放在发送旁边，窄列里设置独占一行；ImageGen 的命名 | 已实施；§5 是没做的 |
| [ai-settings.md](./ai-settings.md) | AI 模型设置：Claude Code（本地登录 / Tingly Box / 自定义地址）、ImageGen、快速 AI 三张卡，各带自己的连接；令牌可在保存时取用另一张卡的；环境变量 > 已保存 > 默认；Tingly Box 为推荐；旧的共用连接文件读成三张卡 | 已实施；§6 是没做的 |
| [image-generation.md](./image-generation.md) | 图像生成：OpenAI 风格的 `/images/generations` 和 `/images/edits`；配好且开着才给 Claude Code 一个生图工具（全局开关 + 每个项目一个开关，默认开），图放进 `uploads/`，没有按钮；地址跟着连接走，Anthropic 没有 | 已实施；§7 是没做的 |
| [attachments.md](./attachments.md) | 给 AI 的附件，存进 `uploads/` | 已实施；§5 是没做的 |
| [server-log.md](./server-log.md) | 服务端结构化日志（快速 AI、Claude Code 委托）和改动记录弹层里对撤销 / 记录 / 提交的说明 | 已实施；末尾是没做的 |
| [import-external-material.md](./import-external-material.md) | 导入 HTML、SVG、Markdown、PPTX；历史评估与现行路径分开 | HTML、SVG → 画布已实施；新项目 PPTX 导入已实施、聚焦产品 e2e 已通过（当前契约与验证范围见 slides-pptx）；旧 PPT 评估不作支持声明 |
| [import-into-project.md](./import-into-project.md) | 往打开的项目里导入：一个入口，各类型收什么、放哪 | 已实施 |
| [import-from-project.md](./import-from-project.md) | 从项目导入：把画布的画板复制进幻灯片和动效、嵌入、记来源、可更新；会动的画板（`$time`）就是特效 | 第一期已实施（画布 → 幻灯片、动效）；§5 是没做的 |
| [i18n.md](./i18n.md) | 界面语言：词条放哪、用什么库、语言从哪来，服务端报错、新建文案、模型回复和沙箱各用哪种语言 | 已实施（英文、中文）；§6 是没做的 |

## 工程协作

| 文档 | 内容 | 状态 / 阅读边界 |
|---|---|---|
| [harness.md](./harness.md) | 怎么确认一切都还好用：`pnpm e2e` 按组起环境跑全部套件、出一张表；全量 e2e 走每晚巡检和发布前，PR 只跑冒烟；`check --snapshots` 的版面检查（裁切、出界、对比度、空白）；编辑器截图基线（旁路分支、人看过再重录）；矩阵每个 ✓ 对上套件或写明没测的原因（`e2e/coverage.json`） | 已实施；调研在 `.research/harness.md` |
| [agent-evals.md](./agent-evals.md) | 怎么量 agent 用 skill 或 MCP 能不能把设计做完：`pnpm eval` 用无头的 Claude Code 在两条路线上各做同一个题目，黑盒打分（确定性检查、过程指标、可选的图像评审），出一张对照表；不进 PR 和 CI，约每周手动跑一次 | 已实施 |
| [issue-resolve.md](./issue-resolve.md) | Issue 自动跟进：每 5 小时拉取，团队的直接推进到 draft PR，外部的先评估回复、等维护者放行；阶段记在 issue 评论里 | 已实施；skill 在 `.claude/skills/issue-resolve/` |

## 宿主与 Tingly Box

| 文档 | 内容 | 状态 / 阅读边界 |
|---|---|---|
| [tingly-box-integration.md](./tingly-box-integration.md) | 将来在 Tingly Box 里接入编辑器 | 方案，未实施；TB 仓库未改 |
| [release.md](./release.md) | 发版：tag 触发测试、打包，发 GitHub release 和 npm 包 `@tingly-dev/tingly-design` 和 `tingly-design`；同一份 bundle、许可证、npm 鉴权、GitHub Pages 主页（视频由 CI 渲染） | 已实施；还没发过第一个版本 |

Tingly Box 那边相关的说明：[theme.md](https://github.com/tingly-dev/tingly-box/blob/main/.design/theme.md)（TB 主题调色板的取舍；本仓库的主题由 `scripts/sync-tingly-box-theme.mjs` 从 TB 的 `@tingly/ui` 同步）、[gui-host-bridge.md](https://github.com/tingly-dev/tingly-box/blob/main/.design/gui-host-bridge.md)（宿主桥接）。

`docs/` 里也有设计性质的内容，不在这里重复：[architecture](../docs/zh/architecture.md)（格式、回写引擎、快速 AI、协作、沙箱）、[theming](../docs/zh/theming.md)（主题 token 和预设）、[embedding](../docs/zh/embedding.md)（嵌入约定 protocol 1）。
