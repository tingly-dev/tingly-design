# 设计说明索引

这里放"为什么这样做"：一个子系统的取舍、考虑过的方案、已定的和还开着的问题。怎么用、怎么跑写在 `docs/`（中英两份）；这里每份只写一种语言。

维护约定（也写在根目录 `CLAUDE.md`）：

- 动一个功能或子系统之前，先读这张表里相关的说明。
- 一个 PR 的核心是新功能、新项目类型、新文件格式、协议或不明显的取舍时，同一个 PR 里新写或更新说明，并更新这张表。修 bug、改名、改文案一般不需要，PR 里说一句即可。
- 标题下第一行写状态（方案 / 研究 / 已实施 / 现行契约）和代码事实取自哪个提交。已实施的事实、提案和历史分开写，提案不要写得像已经存在。
- 各类型都能碰到的功能（提示栏、附件、主题、导出……）以 [project-kinds.md](./project-kinds.md) 的矩阵为准，改了功能就改矩阵。

## 说明

| 说明 | 内容 | 状态 |
|---|---|---|
| [project-kinds.md](./project-kinds.md) | 一种项目类型要在哪些地方登记；跨类型功能矩阵和已知缺口 | 现行契约 |
| [five-kinds.md](./five-kinds.md) | 从 Design 扩展到幻灯片、设计系统、看板、文档：方案和实施结论 | 已实施 |
| [launcher.md](./launcher.md) | 启动页：项目卡片、实时预览、新建 | 已实施 |
| [attachments.md](./attachments.md) | 给 AI 的附件，存进 `uploads/` | 已实施 |
| [import-external-material.md](./import-external-material.md) | 导入 HTML、SVG、Markdown、PPT 的评估；HTML、SVG → 画布 | HTML、SVG 已实施，其余评估 |
| [motion.md](./motion.md) | 第六种类型：宣传视频和动效素材 | 研究 + phase 0 验证 |
| [tingly-box-integration.md](./tingly-box-integration.md) | 将来在 Tingly Box 里接入编辑器 | 方案，未实施 |

`docs/` 里也有设计性质的内容，不在这里重复：[architecture](../docs/zh/architecture.md)（格式、回写引擎、快速 AI、协作、沙箱）、[theming](../docs/zh/theming.md)（主题 token 和预设）、[embedding](../docs/zh/embedding.md)（嵌入约定 protocol 1）。

## 每个 PR 对应的说明

| PR | 核心功能 | 设计说明 |
|---|---|---|
| （#2 之前） | 回写引擎、画布、幻灯片、设计系统 | [architecture](../docs/zh/architecture.md)、[five-kinds.md](./five-kinds.md) |
| #2 | 改名 Tingly Design | 不需要 |
| #3 | 看板 | [five-kinds.md](./five-kinds.md) 进度一节 |
| #4 | 文档 | [five-kinds.md](./five-kinds.md) 进度一节 |
| #5、#6 | 示例项目和 README；文档结构、PR 模板 | 不需要 |
| #7 | 启动页 | [launcher.md](./launcher.md)（本 PR 补写） |
| #8 | 主题 | [theming](../docs/zh/theming.md) |
| #9 | 为嵌入 Tingly Box 做准备 | [embedding](../docs/zh/embedding.md)、[tingly-box-integration.md](./tingly-box-integration.md) |
| #10 | 附件 | [attachments.md](./attachments.md)（本 PR 补写） |
| #11、#13 | 导入 HTML、SVG | [import-external-material.md](./import-external-material.md) §10、§11 |
| #12 | motion 研究和验证 | [motion.md](./motion.md) |
| #14（草稿） | motion 的 vgpu / WebGL2 特效 | [motion.md](./motion.md)，由该 PR 更新 |
