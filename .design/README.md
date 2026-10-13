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
| [motion.md](./motion.md) | 第六种类型：宣传视频和动效素材 | 研究 + phase 0 验证；phase 1 未做 |

## 编辑器功能

| 文档 | 内容 | 状态 / 阅读边界 |
|---|---|---|
| [launcher.md](./launcher.md) | 启动页：项目卡片、实时预览、新建 | 已实施 |
| [attachments.md](./attachments.md) | 给 AI 的附件，存进 `uploads/` | 已实施；§5 是没做的 |
| [import-external-material.md](./import-external-material.md) | 导入 HTML、SVG、Markdown、PPT | HTML、SVG → 画布已实施（§10、§11）；其余是评估 |

## 宿主与 Tingly Box

| 文档 | 内容 | 状态 / 阅读边界 |
|---|---|---|
| [tingly-box-integration.md](./tingly-box-integration.md) | 将来在 Tingly Box 里接入编辑器 | 方案，未实施；TB 仓库未改 |

Tingly Box 那边相关的说明：[ux-principles.md](https://github.com/tingly-dev/tingly-box/blob/main/.design/ux-principles.md)（UX 判断标准，做功能前必读）、[theme.md](https://github.com/tingly-dev/tingly-box/blob/main/.design/theme.md)（TB 主题调色板的取舍；本仓库的主题由 `scripts/sync-tingly-box-theme.mjs` 从 TB 的 `@tingly/ui` 同步）、[gui-host-bridge.md](https://github.com/tingly-dev/tingly-box/blob/main/.design/gui-host-bridge.md)（宿主桥接）。

`docs/` 里也有设计性质的内容，不在这里重复：[architecture](../docs/zh/architecture.md)（格式、回写引擎、快速 AI、协作、沙箱）、[theming](../docs/zh/theming.md)（主题 token 和预设）、[embedding](../docs/zh/embedding.md)（嵌入约定 protocol 1）。
