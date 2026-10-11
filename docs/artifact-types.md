# 从 Design 到五种类型

tingly-design 目前复刻的是 Claude 的 **Design** 画布。原版的 artifact 平台上其实有五种核心类型，Design 只是其中之一：

| 类型 | 一个实例是什么 | 内容存在哪 | 索引 | 内容单元 | 格式约束 |
|---|---|---|---|---|---|
| **Design** | 一块画布，上面摆着若干画板 | 文件 `project/` | `canvas.json` | 一个画板 = 一个 `.dc.html`（模板 + `DCLogic` 脚本） | 宽松：任意 HTML/CSS，约定内联样式 |
| **Slides** | 一套 16:9 幻灯片 | 文件 `project/` | `deck.json`（`order`、`sections`、`faces`、`cover`） | 一页 = `slides/<id>.html`，正好一个 `<section>` | 严格：1920×1080 固定画布，封闭的标签与 CSS 子集，`<x-embed>` 承载动画 |
| **Dashboard** | 一页数据看板 | artifact 自带的 db | `dash/meta` | `datasets/<id>`（查询或文件）+ `files/index.html`（页面） | 数字必须来自数据集并做 `data-source` 标注；d3 全局；主题 token |
| **Docs** | 多人协作的文档 | 独立的 Docs 服务（MCP 连接器） | 文档 / 标签页 | 块（有稳定 id），每个标签页一个 `rev` | 块类型：正文、表格、图表、图示、上传 |
| **Design System** | 品牌规范 | 文件 `project/` | `design-system.json` | `tokens.json`、`README.md`、`components/<C>/`、`assets/`、`fonts/` | token 族都是 `{name,value,usage}` 列表 |

各类型的原始材料在 `artifact/`（`claude-slides/`、`claude-dashboard/`、`claude-docs/`、`claude-design-system/`），见 `artifact/README.md`。

## 哪些东西可以直接复用

现在的架构里，大部分和"画布"无关：

| 现有部件 | 位置 | 能否复用 |
|---|---|---|
| 版本号 + 409 + 重放、journal、SSE、文件监听、git 提交 | `apps/server` | 全部复用。只有 `safeRel()` 和 `listProjects()` 写死了 `canvas.json` / `.dc.html`，要改成按类型判断 |
| 带源码位置的解析 + DOM 副本 + 最小补丁回写 | `packages/core/src/{parse,copy}.ts` | 可以复用，但要做取舍（见下文 Slides）。解析器现在只认 `<x-dc>…</x-dc>` 这段为模板；Slides 的文件整个就是一个 `<section>`，只需把"模板范围"做成按类型可配 |
| 人工操作（改样式、改字、重排、拖出、改尺寸） | `packages/core/src/ops.ts` | 复用，但 Slides 要在落盘前过一遍 CSS 子集校验（不在 `format.md` 表里的属性、`margin`、`z-index`、`em` 等都不允许） |
| 快速 AI（jQuery 语句流式执行） | `core/exec.ts`、`stream.ts`、`prompt.ts` | 复用执行链；提示词按类型换（Slides 用 `format.md` 的子集规则） |
| 沙箱 iframe + postMessage 协议 | `packages/sandbox`、`core/protocol.ts` | 复用。Slides 页面本身是静态 HTML，不跑 `DCLogic`；`<x-embed>` 再嵌一层 `allow-scripts` iframe |
| 右侧面板（图层 / 属性 / 代码） | `apps/editor/src/components/panel` | Slides 基本可复用；Tweaks 页不适用（没有 `data-props`） |

## 按类型的工作量

### 1. Slides（建议先做）

和 Design 最接近：同样是文件、同样是 HTML、同样需要"手改 + Claude 改"回写到同一份源码。

**原版的做法和 Design 不同**（`artifact/claude-slides/FINDINGS.md`）：Slides 编辑器把每页 HTML 解析成**类型化模型**（text / img / icon / shape / table / html / stack / grid / overlay…），解析器本身就是子集校验器（不认识的标签 → 整页只读 `slideHeld`）；编辑改的是模型，保存时把**整页 `<section>` 规范化重新序列化**，只发布改过的页和 `deck.json`。原版 Slides 也**没有**页内快速 AI，只有"交给 Claude"。

我们有两条路：

- **A. 沿用本仓库的最小补丁回写**：保留 Claude 写的原文格式，三方协作和冲突重放直接复用；代价是校验要另写一层。
- **B. 照原版做模型 + 规范化序列化**：校验、导出 PPTX/PDF、放映都基于同一个模型，简单直接；代价是每次手改都会重排整页文本，git diff 噪音大，与"只改真正变了的字符"的理念相反。

建议 **A 为主、借 B 的模型做只读用途**：编辑仍走 `copy.ts` 的最小补丁；另写一个 slide 模型（解析 + 校验），用来做子集校验、图层命名、放映的 build/magic 匹配和导出。这样快速 AI（jQuery）也能直接用在 Slides 上，比原版多一项能力。

其余差别：

- **项目识别**：目录里有 `deck.json` 就是一套幻灯片。
- **编辑器外壳**：左侧缩略图条（按 `order`，按 `sections` 分组，可拖动重排、新建、删除、隐藏）；中间一张 1920×1080 的舞台按比例缩放；工具条是 文字 / 图片 / 表格 / 形状；右上是 下载、放映、布局、缩放（见截图）。
- **渲染**：`<x-shape>`、`<x-icon>`、`<x-connector>` 需要自己的渲染；`<x-embed>` 用独立 iframe（CSP 禁网络），编辑时也在跑——这正是"数学奇遇记"每一页的动画来源。
- **放映**：`data-transition="fade|push|magic"`（magic = 两页同 id 的绝对定位元素补间）、`data-build-in/out`、`<aside>` 演讲者备注。
- **校验 / 规范化**：实现 `format.md` 的 CSS 子集表，作为编辑器的写入闸门和给 AI 的报错反馈（相当于原版 build 的 error / warning / note）。
- **导出**：原版全部在浏览器端完成——PPTX 用 PptxGenJS 生成原生文本/形状/表格/备注（另有整页图片兜底），PDF 是 SVG `foreignObject` → 图片 → 手写 PDF。我们可先用服务端 Playwright 出 PDF，再用 PptxGenJS 基于模型出 PPTX；`<x-embed>` 只能拍平成图。
- **字体**：`deck.json` 的 `faces`（Google Fonts `href` 或本地文件）注入每一页。

### 2. Dashboard

模型完全不同：不是"改源码"，而是"数据集 + 一页读数据的 HTML"。开源版可以这样落到文件上：

- `dash.json`（`title`、`params`）、`datasets/<id>.json`、`files/index.html`、附带的 CSV/JSON 数据文件。
- 运行时：实现 `dash` API（`data`、`onData`、`calc`、`loader`、`params/setParams/resetParams`、`setLink`、`colors`、`refresh`）、标注校验（`data-source` / `data-field` / `data-where` / `data-row` / `data-row-key`）和 Sources 侧栏。
- 数据源：先支持文件（CSV/TSV/JSON）；查询型数据源做成可插拔的连接器（例如本地 SQLite / DuckDB / Postgres，只读 SQL 白名单与原版一致）。
- 编辑：原版页面**不能手改**，只能 Claude 写；人能做的是在 Sources 里编辑查询参数、试跑、保存、看历史、恢复，以及暂停/恢复（把当前结果存成 JSON 文件）。我们照做即可。
- 沙箱：原版把页面直接注入同一文档的 `#dash-root`（剥掉 script/iframe/form/`on*` 后用 `Function` 执行脚本），靠约定隔离 CSS。开源版建议放进 `allow-scripts` iframe（复用 `packages/sandbox`），`dash` API 通过 postMessage 桥接。
- 细节（标注数值核对规则、runs 文档、状态戳、CSV 解析）见 `artifact/claude-dashboard/FINDINGS.md`。

### 3. Design System

文件型，结构简单。先做**消费侧**：Design 和 Slides 读取 `project/ds/<folder>/tokens.json`，在颜色选择器和文字样式菜单里给出 token，而不是裸的十六进制。浏览页（品牌书、token、组件预览）其后。

### 4. Docs

内容不是文件，而是带稳定 id 的块树，每个标签页一个修订号，按块 id 编辑。可以放在同一个服务端（版本、SSE、journal 都能用），但编辑器是另一套（富文本 / 块编辑器），与画布代码几乎不共享。放最后。

## 建议的第一步

1. 服务端和 core 引入"项目类型"：按索引文件识别（`canvas.json` → design，`deck.json` → slides，`design-system.json` → design-system），`safeRel()` / `listProjects()` / 文件监听按类型取白名单。
2. 解析器的"模板范围"可配：Design 取 `<x-dc>` 内部，Slides 取整个文件。
3. 把 `artifact/claude-slides/sample-deck/` 复制成 `projects/math-deck/` 作为演示与测试夹具。
4. Slides 编辑器：缩略图条 + 舞台 + 复用右侧面板 + 子集校验 + 放映模式；然后接快速 AI 和 Claude Code 委托（`.claude/skills/` 加一份 slides 格式说明）。
