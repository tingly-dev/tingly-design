# `.dc.html` 为什么只出现在画布里，其他类型能不能复用

状态：**研究**（结论待确认，未实施）。§7 是对 Claude 原版当前版本（2026-10-14）的核对。

## 1. 问题

六种项目类型里，只有画布（`design`）的内容单元叫 `*.dc.html`：幻灯片是 `slides/<id>.html`，动效是 `scenes/<id>.html`，看板是 `files/index.html`，设计系统是 `components/<C>/preview.html`，文档是 `tabs/<id>.md`（`.design/project-kinds.md` §1 的表）。直觉上它们都是 HTML，应该共用一套。

## 2. 先分清两件事：格式 vs 引擎

"dc.html" 其实指两样东西，答案不一样：

| | 是什么 | 谁在用 |
|---|---|---|
| **`.dc.html` 格式** | Claude Design 画板的文件格式：`<x-dc>` 里的模板（`{{path}}`、`<sc-for>`、`<sc-if>`、`<dc-import>`）+ `<script data-dc-script>` 里的 `class Component extends DCLogic` + `data-props`（Tweaks）。见 `docs/en/architecture.md:16` | 只有画布 |
| **dc 引擎** | 带源码位置的解析 `parseDc`（`packages/core/src/parse.ts:189`）、最小补丁回写 `DesignCopy`（`copy.ts:82`）、人工操作 `applyHumanOps`（`ops.ts:85`）、沙箱渲染 `runtime.tsx`、快速 AI 的 jQuery 执行链 | 画布、幻灯片、动效 |

**引擎其实已经复用了一半。** 幻灯片和动效的场景文件没有 `<x-dc>` 包装，`parseDc` 认出"整个文件就是一个 `<section>`"就按幻灯片模式解析（`parse.ts:91-93`、`parse.ts:206`）；同一个 `runtime.js` 渲染它们，只是多包一层 `.dc-slide-host`（`runtime.tsx:494-498`）。幻灯片舞台和动效的编辑舞台都是 `SlideFrame`，加载的就是 `sandboxDoc(SERVER, 'runtime')`（`SlideFrame.tsx:63`，`MotionApp.tsx:334`），和画布的 `Board.tsx:99` 是同一个沙箱。人工编辑都走 `applyHumanOps`（`apps/editor/src/store.ts:634`），快速 AI 也是同一条链，只是检查换成 `checkSlide` / `checkScene`（`fastedit.ts:52`）。

所以看到的"只有画布用 dc.html"，主要是**文件扩展名和外层包装**不同；真正干活的那部分，三种 HTML 类型是共用的。名字 `parseDc` 让人误以为它只管画布，这是命名问题。

## 3. 为什么格式没统一

### 3.1 每种类型照的是 Claude 原版各自的格式

`.design/five-kinds.md` 开头的表：项目最初复刻的是 Claude 的 Design 画布，原版 artifact 平台另有 Slides、Dashboard、Docs、Design System 四种，**各有各的文件格式**。后面四种是照原版补的，保留了原版的文件布局（`deck.json` + `slides/<id>.html`、`dash.json` + `files/index.html` …），这样原版的样例和 Claude 已经熟悉的格式能直接用。

### 3.2 `.dc.html` 的核心特性，在别的类型里是要禁止的

- **幻灯片要的是封闭子集，不是模板 + 脚本。** 幻灯片是"一个 `<section>`、固定 1920×1080、封闭的标签和 CSS 子集"（`five-kinds.md` 表），导出 PPTX/PDF、放映的 magic move 都依赖这个子集可被静态分析。`parseDc` 在幻灯片模式下直接丢掉脚本（`parse.ts:290`：`script: slide ? null : script`）。`DCLogic` 状态、`sc-for` 循环生成的元素都没法导成原生 PPTX 形状。
- **动效要的是确定性。** `motion.md` §2 第 1 点：每个动的东西必须是播放头的函数，自由运行的脚本会让逐帧导出出错。所以动效选了"幻灯片子集 + 元素上的时间属性"（格式 E，`motion.md` §4-§5），明确不用画布的模板 + `DCLogic`（§4 对比表 "No (our canvas is template + `DCLogic`, not JSX)"）。
- 换句话说，给幻灯片/动效套上 `.dc.html`，带来的唯一新东西就是它们本来就要拒绝的那部分能力。

### 3.3 另外三种根本不是"编辑一段静态 HTML"

- **看板**：`files/index.html` 是读数据集、用脚本生成 DOM 的页面。示例 `projects/box-usage/files/index.html` 452 行里大部分是 class 样式和生成 DOM 的脚本；它在自己的 `allow-scripts` iframe 里跑，脚本用 `new Function('dash', …)` 执行（`packages/sandbox/src/dash.ts:355`），`dash` API 也只在那里实现。屏幕上的数字、表格行都不在源码里，点选回写落不到字符上。数字还必须带 `data-source` 标注，按原版只交给 Claude Code 写，快速 AI 服务端直接拒绝（`apps/server/src/index.ts:438`）。
- **设计系统**：`preview.html` 是组件的演示页，内容由 `bundle.js` 里的组件在脚本里画出来（例如 `components/Button/preview.html` 的 `root.appendChild(Tingly.Button(…))`），编辑器把它当源码编辑、`srcDoc` 预览（`ComponentViews.tsx:41`、`:55`）。真正的设计数据在 `tokens.json`。
- **文档**：是 Markdown，按块合并（`docs.ts` `mergeBlocks`），和 HTML 无关。

`.dc.html` 的整套编辑能力建立在"视觉属性是内联 `style`、文案是字面量、布局是 flex/grid"这几条约定上（`architecture.md:16`，`import-external-material.md` 的表）。看板和设计系统预览恰恰相反：class 样式 + 脚本生成内容。把它们改成 `.dc.html`，引擎能选中的只是外层空壳。

## 4. 选项

| 选项 | 做什么 | 得到什么 | 代价 |
|---|---|---|---|
| **A. 统一成 `.dc.html`** | 幻灯片/动效/看板/预览都改扩展名，必要时加 `<x-dc>` 包装 | 文件名一致 | 和原版格式、现有 skill、样例、导出全部断开，要迁移；幻灯片和动效要的是"去掉"模板和脚本；看板、预览照样点不中脚本生成的内容。几乎没有功能收益 |
| **B. 保持格式，承认引擎已共用，并把它说清楚** | `parseDc` 之类改成中性名（如 `parseSource`），在 `architecture.md` / `project-kinds.md` 写明"三种 HTML 类型共用一套解析和回写，区别只在外层与检查规则" | 消除误解；以后加类型知道该接哪 | 一次纯重命名，改动面广但机械 |
| **C. 在 B 的基础上，把引擎接到确有静态 HTML 的地方** | 看板页面里静态的部分（标题、说明、卡片外框）和设计系统预览，接入点选 + 属性面板 + 快速 AI | 矩阵里看板、设计系统的"快速 AI / 手写 jQuery"从 ✗ 变成部分 ✓ | 能点中的只是静态外壳，脚本生成的内容仍改不了，体验会是"有时能点有时不能"，违背 UX 原则里"一个词一个意思"；看板还要绕开"数字只由 Claude Code 写"的规则。投入大、收益不确定 |

## 5. 建议

**选 B，不选 A；C 先不做，等有具体需求再按单个场景评估。**

- 不统一扩展名：`.dc.html` 是画布的格式（模板 + `DCLogic` + Tweaks），不是"我们的 HTML"的统称。幻灯片和动效刻意不要它的模板和脚本（导出、放映、逐帧渲染都靠这一点），看板和设计系统的 HTML 是脚本页面，套上格式也用不上引擎。
- 该共用的部分已经共用了：画布、幻灯片、动效是同一个解析器、同一个沙箱运行时、同一个回写队列、同一条快速 AI 链。真正的问题是名字（`parseDc`、`DcDoc`、`dc-slide-host`）和文档没把这件事说清楚，所以看起来像只有画布在用。
- B 的具体做法（YZ 同意后再做）：
  1. core 里把 `parseDc` / `DcDoc` / `DcElement` 改成中性名，旧名保留一个版本的别名，避免外部脚本断掉；
  2. `docs/{en,zh}/architecture.md` 加一段"一套引擎、三种外层"（`<x-dc>` 模板 / 单个 `<section>` / 带时间属性的 `<section>`）；
  3. `.design/project-kinds.md` §1 的表加一列"解析 / 回写引擎"，写明看板、设计系统、文档为什么不走它。
- C 如果以后要做，最值得先试的是**设计系统的组件预览**：它是静态演示页、和画布的使用方式最接近；但前提是预览改成直接写 HTML 而不是 `Tingly.Button(...)` 脚本调用，这会改变设计系统的格式，需要单独决定。

## 6. 还没定的

- 重命名要不要连 sandbox 里的 `data-dc-tid`、`dc-slide-host` 这些 DOM 名一起改（它们出现在 e2e 和导出里，改动面更大，收益只是好看）。倾向只改 TypeScript 的导出名。
- 设计系统预览要不要从脚本调用改成静态 HTML（见 C）。

## 7. Claude 原版的当前版本是怎么做的

2026-10-14 读了五种类型当前 release 的全部类型文件（`claude-design-artifact` 仓库已更新到这一版，见其 `artifact/README.md`）。

### 7.1 这一版改了什么

| 类型 | release（旧 → 新） | 变化 |
|---|---|---|
| Design | `1791586906-56be` → `1791995251-3af4` | `app.js` / `app.css` / `index.html` 变了；**`dc-runtime.js`（画板运行时）和 `fast-edit-worker.js`（快速 AI）一字未改**，`format.md` 等格式文档也没变。可见的新东西：复制单个画板的链接（"Select just one artboard to copy a link to it"）、改到 `<sc-for>` 里的元素时提示"会改到列表里每一项"、字体改从独立域名加载、健康上报加了 insert / delete / reorder 动作；`view-state.md` 把 `dirty` 改成"可能还没进你读到的版本" |
| Slides | `1791584864-97b0` → `1792006065-07f4` | 新增 `<div data-text>`（一组无样式的 `<p>`/`<ul>` 合成一个文本框）；排版标点规则（正文里用弯引号）；`view-state.md` 同上 |
| Dashboard | `1791487385-53e8` → `1792006705-3bf5` | 连接器来的数据要做成实时查询而不是附件；编出来的数字必须放进标题为 "Sample…" 的文件并在交付时说明 |
| Design System | `1791558544-c1cf` → `1791927328-0a67` | 只有代码改动，文档未变 |
| Docs | `1791658616-c881` → `1792002905-b2ae` | 换了一批 chunk（新增表情选择器，去掉 Spark 菜单），文档未变 |

格式本身这一版都没动，对 dc.html 的结论没有影响。

### 7.2 Anthropic 自己也只在 Design 里用 `.dc.html`

在五个编辑器 bundle 里数关键字（当前版）：

| bundle | `x-dc` | `DCLogic` | `sc-for` | `x-embed` / `x-shape` | `PptxGenJS` |
|---|---|---|---|---|---|
| Design `app.js` | 73 | 3 | 30 | 0 / 0 | 0 |
| Slides `app.js` | 0 | 0 | 0 | 22 / 25 | 9 |
| Dashboard `app.js` | 0 | 0 | 0 | 0 / 0 | 0 |
| Design System `app.js` | 0 | 0 | 0 | 0 / 0 | 0 |
| Docs `app-core` / `lfile-runtime` | 0 | 0 | 0 | 0 / 0 | 0 |

每种类型是一个独立的编辑器，各有自己的内容模型：

- **Design**：画板在 iframe 里由 `dc-runtime.js`（React 18 + 模板编译器，作为画板的 `support.js` 提供）渲染；快速 AI 在 Web Worker 里用 happy-dom + jQuery 改副本。
- **Slides**：没有 iframe，页面内 React 渲染；把 HTML 解析成类型化模型（解析器就是子集校验器），保存时整页 `<section>` 重新序列化；PPTX 用 PptxGenJS 生成。没有页内快速 AI（`claude-slides/FINDINGS.md`）。
- **Dashboard**：内容在 artifact 自己的 db 里，不是文件；页面注入同一文档执行。
- **Design System**：文件型，预览由 `run.html` 跑。
- **Docs**：内容在独立的 Claude Docs 服务里，编辑器是 ProseMirror。

所以"每种类型一套格式"不是我们复刻时的偶然，原版就是这样设计的。我们比原版共享得更多：画布、幻灯片、动效共用一套解析和最小补丁回写，幻灯片因此有了原版没有的快速 AI（§2）。

### 7.3 原版共享的是"套件层"，不是内容格式

几样东西在多个 bundle 里是同一份代码或同一份文档：

- **文件索引表**：Design、Slides、Design System 三个 `app.js` 里有一模一样的 `{design:"project/canvas.json", slides:"project/deck.json", designSystem:"project/design-system.json"}`，连同从 db 迁到文件的迁移逻辑（`migration.json`、索引里的 `createdOnFiles`）。Dashboard 和 Docs 不在文件上，所以没有。
- **保存与冲突**：都走 `window.claude.self.publish(files, {ifMatch})`，冲突返回 `{code:"conflict", live, paths}`。
- **装入设计系统**：画布和幻灯片用同一套规则：文件拷到 `project/ds/<folder>/`，索引里记一条 `designSystems`，颜色选择器和文字样式读 `tokens.json`。
- **共用的模型文档片段**：`view-state.md` 的 `shared:view-context`、`craft.md` 的 `shared:content-design`、`questions.md` 的 `shared:ask-first`，注释写明由 `skills/_shared/*.md` 生成。
- **页面外壳**：`index.html` 里的 flags、健康上报、字体加载。

这和我们的分层一致：服务端的版本、409 重放、journal、SSE，设计系统装入，提示栏、附件、AgentBar 这些跨类型部件，就是我们的"套件层"（`.design/project-kinds.md` §3 的矩阵）。

### 7.4 原版让 `.dc.html` 覆盖多种用途，但仍然是"设计"

Design 自己用一种格式做了很多事：`expand: "fill"` 的 PAGE 做落地页、看板、应用界面；`print: "flow"` + `paper` 做可分页的文档；固定尺寸画板做海报和多页印刷品。画板里还能写 `<meta name="design_doc_mode">` 改变全窗口显示方式。也就是说，"像看板的设计""像文档的设计"放在画布里画；真正的看板（数据集、数字溯源）和文档（多人协作、评论）是另外的类型。

### 7.5 对结论的影响

原版的做法支持 §5 的建议：**不把其他类型统一成 `.dc.html`**，共享放在套件层和引擎层。值得补的只有一点：既然原版把"看板样子的页面""文档样子的页面"作为画布里的 PAGE / print flow 处理，我们的画布也应该把这两种画板做好，而不是去改看板和文档的格式。现状：`packages/core/src/canvas.ts:10` 有 `expand?: 'fill'`，但没有 `print` / `paper`，画布还不能导出可分页的文档 PDF；这是一个可以单独立项的缺口。
