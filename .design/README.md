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

## 项目类型与跨类型功能

| 文档 | 内容 | 状态 / 阅读边界 |
|---|---|---|
| [project-kinds.md](./project-kinds.md) | 一种项目类型要在哪些地方登记；跨类型功能矩阵和已知缺口 | 现行契约 |
| [five-kinds.md](./five-kinds.md) | 从 Design 扩展到幻灯片、设计系统、看板、文档 | 前半是当初的方案，"进度"一节是实施结论 |
| [motion.md](./motion.md) | 第六种类型：宣传视频和动效素材 | 研究 + phase 0 验证；已登记为类型，编辑舞台和播放器已实施 |
| [motion-editing.md](./motion-editing.md) | 动效的细粒度编辑：为什么场景原来点不动，舞台点选、尺寸覆盖、时间轴、关键帧的交互和实现（图：[motion-editing.pencil.md](./motion-editing.pencil.md)） | 第一期已实施（点选、改字、缩放、尺寸、快速 AI）；时间轴、关键帧是方案 |
| [motion-effects.md](./motion-effects.md) | 动效里的着色器特效层：可 seek 的 embed 装一个 GLSL 片元着色器，WebGL2 在页面里画；输入、单位、确定性，以及什么样的特效好看 | 契约和 WebGL2 运行时已实施（示例 `projects/motion-effects/`）；注入运行时、检查器报错、预设库是方案；WebGPU / vgpu 的调研在 `.research/motion-effects.md` |

## 编辑器功能

| 文档 | 内容 | 状态 / 阅读边界 |
|---|---|---|
| [self-design.md](./self-design.md) | 自身设计稿：用一个画布项目（`projects/tingly-design-ui`）画 Tingly Design 自己的界面——整体结构、外壳、启动页、六种类型、顶栏和菜单、请求栏、主题 token；画到什么程度，先画再改代码，代码变了同一个 PR 里重画 | 已实施；§5 是没定的 |
| [top-bar.md](./top-bar.md) | 顶栏：六种类型共用的一条栏——项目名、同步状态、导入 / 导出放哪，反馈、点星、语言、外观为什么在最右；浮栏只留工具 | 已实施 |
| [export-menu.md](./export-menu.md) | 导入 / 导出共用一个菜单：各类型放什么；PDF 一键（服务端 Chrome，没有就回到打印窗口）；视频默认一键、选项折起来；状态条 | 已实施；§7 是没做的 |
| [project-archive.md](./project-archive.md) | 整个项目导出成一个 .zip（项目和它用到的设计系统并排、可选带改动记录），再从首页或命令行导入：带什么不带什么、怎么读手工打包的 zip、重名和安全 | 已实施（编辑器、启动页、命令行）；拖入导入是没做的 |
| [export-image.md](./export-image.md) | 每种类型保存为 PNG 图片：在浏览器里画，各类型的入口和画法，画不到的东西 | 已实施；视频、PDF 和共用菜单未定 |
| [canvas-check.md](./canvas-check.md) | 画布检查器：`checkCanvas` 把 `dc-canvas` 技能里写错了不报错的规则做成纯文本检查，返回规则 id 和参数，措辞留给命令行 / 编辑器 | 核心函数和 `check` 命令已实施；编辑器提示是方案 |
| [layers-tree.md](./layers-tree.md) | 图层树：画布、幻灯片、动效共用一棵树和同一种行；隐藏、锁定写进文件（`data-hide`、`data-lock`、`canvas.json` 的 `hidden`、`locked`）以及它们的含义 | 已实施；没有树的类型见 §5 |
| [export.md](./export.md) | 导出：在浏览器里做、不装东西；独立的 `@dc/export` 包，动效在编辑器里导出视频，浏览器画不了的自动改走服务端的 Chrome，本机没有时嵌入内容自己交出画面；其余类型的格式和共用菜单；速度怎么量、慢在哪、怎么看见 | 动效视频已实施；其余是方案；调研在 `.research/export.md` |
| [launcher.md](./launcher.md) | 启动页：项目卡片、实时预览、新建、分组与列表视图 | 已实施 |
| [project-git.md](./project-git.md) | 项目和 git：只提交项目自己的文件夹、提交前写出仓库和分支、没有仓库时第一次提交顺带新建（或新建项目时勾选） | 已实施 |
| [project-folders.md](./project-folders.md) | 项目放在哪：打开或新建项目文件夹之外任意位置的项目（`.links.json` 登记）、npm 安装时的默认数据目录 `~/.tingly-design/` | 已实施 |
| [cli.md](./cli.md) | 命令行 `tingly-design`：命令用编辑器里同一个词（`open`、`new`、`list`、`check`、`export`）；服务端拆成路由和启动；核心给数据、命令行给措辞；`server.mjs` 就是 `serve` | 第 1 步已实施；§6 是后面几步 |
| [design-system-glance.md](./design-system-glance.md) | 设计系统一眼看懂：样张、概览页和启动页卡片怎么说清"这套系统是什么、和另一套差在哪" | 已实施 |
| [agent-feedback.md](./agent-feedback.md) | 请求栏和 agent 执行反馈：请求回显、步骤、计时、停止、改了什么、撤销整次运行 | 已实施；§7 是没做的 |
| [agent-panel.md](./agent-panel.md) | 请求栏的位置：底部（卡片平时一行）或右侧边栏（自动隐藏）、请求历史、"新对话 / 接着"标记 | 已实施；§5 是没做的 |
| [ai-settings.md](./ai-settings.md) | AI 模型设置：快速 AI 和 Claude Code 共用一个连接、各有模型名；环境变量 > 已保存 > 默认；Tingly Box 为推荐；图片生成将来接在同一处 | 已实施；§6 是没做的 |
| [attachments.md](./attachments.md) | 给 AI 的附件，存进 `uploads/` | 已实施；§5 是没做的 |
| [server-log.md](./server-log.md) | 服务端结构化日志（快速 AI、Claude Code 委托）和改动记录弹层里对撤销 / 记录 / 提交的说明 | 已实施；末尾是没做的 |
| [import-external-material.md](./import-external-material.md) | 导入 HTML、SVG、Markdown、PPT | HTML、SVG → 画布已实施（§10、§11）；其余是评估 |
| [import-into-project.md](./import-into-project.md) | 往打开的项目里导入：一个入口，各类型收什么、放哪 | 已实施 |
| [import-from-project.md](./import-from-project.md) | 从项目导入：把画布的画板复制进幻灯片和动效、嵌入、记来源、可更新；会动的画板（`$time`）就是特效 | 第一期已实施（画布 → 幻灯片、动效）；§5 是没做的 |
| [i18n.md](./i18n.md) | 界面语言：词条放哪、用什么库、语言从哪来，服务端报错、新建文案、模型回复和沙箱各用哪种语言 | 已实施（英文、中文）；§6 是没做的 |

## 工程协作

| 文档 | 内容 | 状态 / 阅读边界 |
|---|---|---|
| [issue-resolve.md](./issue-resolve.md) | Issue 自动跟进：每 5 小时拉取，团队的直接推进到 draft PR，外部的先评估回复、等维护者放行；阶段记在 issue 评论里 | 已实施；skill 在 `.claude/skills/issue-resolve/` |

## 宿主与 Tingly Box

| 文档 | 内容 | 状态 / 阅读边界 |
|---|---|---|
| [tingly-box-integration.md](./tingly-box-integration.md) | 将来在 Tingly Box 里接入编辑器 | 方案，未实施；TB 仓库未改 |
| [release.md](./release.md) | 发版：tag 触发测试、打包，发 GitHub release 和 npm 包 `@tingly-dev/tingly-design` 和 `tingly-design`；同一份 bundle、许可证、npm 鉴权、GitHub Pages 主页（视频由 CI 渲染） | 已实施；还没发过第一个版本 |

Tingly Box 那边相关的说明：[ux-principles.md](https://github.com/tingly-dev/tingly-box/blob/main/.design/ux-principles.md)（UX 判断标准，做功能前必读）、[theme.md](https://github.com/tingly-dev/tingly-box/blob/main/.design/theme.md)（TB 主题调色板的取舍；本仓库的主题由 `scripts/sync-tingly-box-theme.mjs` 从 TB 的 `@tingly/ui` 同步）、[gui-host-bridge.md](https://github.com/tingly-dev/tingly-box/blob/main/.design/gui-host-bridge.md)（宿主桥接）。

`docs/` 里也有设计性质的内容，不在这里重复：[architecture](../docs/zh/architecture.md)（格式、回写引擎、快速 AI、协作、沙箱）、[theming](../docs/zh/theming.md)（主题 token 和预设）、[embedding](../docs/zh/embedding.md)（嵌入约定 protocol 1）。
