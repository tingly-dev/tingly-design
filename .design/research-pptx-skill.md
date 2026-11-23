# 调研：Anthropic pptx 技能对 Tingly Design 的借鉴价值

状态：**研究**（只有结论与建议，未实施；选定后各项再走 issue → 设计 → 实现）。

对象：[anthropics/skills `skills/pptx`](https://github.com/anthropics/skills/tree/main/skills/pptx)，读的是 `e4bb5d9`（2026-11-16）的 `SKILL.md`、`scripts/`（`add_slide.py`、`clean.py`、`slide_text.py`、`thumbnail.py`、`apply_theme.js`、`office/validate.py` 与 `validators/`、`helpers/`、`soffice.py`），以及已删掉的旧版 `html2pptx.md` / `html2pptx.js`（`ef74077`）作对照。我们这边对照的是 [slides-pptx.md](./slides-pptx.md)、[slides-variety.md](./slides-variety.md)、[drawn-check.md](./drawn-check.md)、`.claude/skills/slides/`、`apps/server/src/delegate.ts`、`packages/export/src/pptx*.ts` 和一次实际导出（§2）。

## 1. 一句话结论

它不是我们的底层（它让 agent 直接写 pptxgenjs 脚本或改 OOXML；我们是自己的 HTML 子集模型 + 浏览器排版 + 受限 writer），所以**代码路线不搬**；但它有三样东西正好是我们缺的，能明显改进项目：

1. **“结构化 deck”的可编辑性要求**：一个文本块是一个文本框、原生项目符号、标题占位符、主题色与主题字体、分节。我们的 PPTX 导出在“看起来对”上做得比它细得多，但在“PowerPoint 里好改”上明显落后（§2 实测：一个标题被拆成 3 个文本框，项目符号是单独的“•”文本框）。
2. **必做的视觉 QA 闭环**：渲染 → 用新眼光看 → 只改有问题的页 → 停。我们的 CLI/MCP agent 有 `check --snapshots` / `look`，但**编辑器里委托的 Claude Code 既不能渲染也拿不到任何版面检查结果**。
3. **一份具体的“别这样做”清单和跨页一致性检查**（标题位置漂移、标题下的强调线、边缘色条、断词、残留占位文字），比我们现有 skill 更可检查。

## 2. 实测：我们导出的 PPTX 在 PowerPoint 里是什么样

用两页的小 deck（`h1` 一段三行标题、一段带 `<b>` 的段落、一个三项 `ul`、两张圆角卡片；Arial，无网络字体），`pnpm tingly-design export <dir> --as pptx`，再用 python-pptx 读回：

| 看什么 | 结果 |
|---|---|
| 三行标题 `h1` | **3 个**独立文本框（每行一个，`wrap="none"`） |
| 含 `<b>` 的一段话 | **5 个**文本框（每行、每个 run 切开） |
| `ul` 三项 | 6 个文本框：每个“•”是单独的文本框，文字另一个；不是 `<a:buChar>` |
| 标题占位符 / 版式 | 无；每页 `DEFAULT` 版式，`slide.shapes.title` 为空 |
| `txBox="1"`、对象名 | 无（读屏软件当“图形”）；名字是 `Text 0`… |
| 主题 | pptxgenjs 默认 Office 主题（Calibri Light/Calibri、`4472C4`），与 deck 的颜色字体无关 |
| 分节 | 无 `<p:sectionLst>`，尽管 `deck.json` 有 `sections` |

原因在 `packages/export/src/pptxDom.ts` 的 `text()`：按 DOM Range 逐字测量，换行或换 run 就 `flush()` 一个 `wrap:false` 的文本对象（`.research/slides-pptx-verification.md` 记录了当初为避免 LibreOffice 折行而改成 `wrap="none"`）。这保证了视觉位置，代价是：在 PowerPoint 里改一个字，后面的行不会重排；改标题要改三个框；大纲视图、辅助功能检查、“重用幻灯片”、缩放定位都看不到标题。样例 deck 与成品留在 project library 的 `outputs/evaluate-pptx-skill-for-our-proj/`。

（`tingly-design-intro-slides` 原样导出失败：“A deck resource could not be frozen or loaded”，推测是本机取不到 Google Fonts；未深究，与本调研无关。）

## 3. 逐项对比

收益与工作量是估计：S ≈ 1–2 天，M ≈ 3–7 天，L ≈ 2 周以上，含测试与文档。

### 3.1 导出 PPTX 的可编辑性 —— 值得借鉴

| 技能的做法 | 我们现状 | 建议 | 收益 / 工作量 |
|---|---|---|---|
| 一个文本块一个文本框；列表用 `bullet:true` 一项一段，**绝不写字面“•”**（旧 html2pptx 同样把 `p`/`h*`/`ul` 各做一个文本框） | 每行每 run 一个框，列表符号单独成框（§2） | **块级文本框**：`h1–h3`/`p`/`li` 所在列表/`div data-text` 各成一个形状，段落 + runs，原生 `buChar`/`buAutoNum`（起始号、缩进取测量值），`wrap` 打开、宽度取测量宽 + 少量余量、`fit:none`。块内出现子集表达不了的情况（混排旋转、竖排等）再退回现有逐行路径并提示。我们的子集本来就规定 `span` 不能改字号字体、`data-text` 是“一个文本框”，所以块级映射是贴合模型的 | 高 / M |
| `isTextBox:true`（`txBox="1"`）、`objectName`、图片 alt | 都没有 | 文本框写 `txBox`；对象名用元素 id/标签（`Title`、`Card 2`）；`img alt` 写 `descr` | 中 / S（随上项） |
| 字体：只用 Office 自带且 LibreOffice 等宽替身可靠的字体（安全清单），清单外的给 ~10% 余量；别用 Aptos | 导出只提示 `font-not-embedded`；逐行 `wrap=none` 掩盖了换行差异 | 块级文本框之后换行差异会显现：导出对话框按“接收方大概率没有的字体”提示，并按字体栈写一个 Office 有的后备（`'Inter', Arial` → 写 Arial 还是 Inter 需取舍，见 §5）；宽度留余量 | 中 / S |
| “结构化 deck”：主题（`dk1…accent6`、标题/正文字体）、用版式与命名占位符装标题、页脚和页码放版式、分节 | 默认 Office 主题、无占位符、无分节 | 主题：把 deck 的 `theme`/已装设计系统的颜色与 `faces` 写进 `theme1.xml`（`apply_theme.js` 的思路：写完再改 theme part），文字仍写具体颜色（我们“值，不是变量”的规则不变）；每页标题（每页第一个 `h1`/`h2`）进“仅标题”版式的 `title` 占位符；`deck.json.sections` → `addSection`。不做逐页版式库（我们没有母版模型，见 §4） | 中高 / M |
| 原生图表（`addChart`，只有 Sankey 等无原生形态的才用图片） | slides 子集里没有图表元素；图表是 SVG 或 div 柱，导出为图片；导入的图表重绘为 SVG，数据不再可编辑 | 增加带数据的图表元素（如 `<x-chart>`：类型 + 系列 + 少量样式），编辑器画 SVG、导出写原生图表、导入把 chart part 映射成它而不是 SVG；技能里 pptxgenjs 图表的坑（堆积图 `outEnd`、次坐标轴要成对声明、`crossesAt`）此时直接适用 | 高（商务 deck）/ L |
| `validate.py`：schema + 关系 + 内容类型 + 图表/页面的已知 PowerPoint 拒收项，每条带修法 | `scripts/validate-pptx/`（Open XML SDK）离线检查；writer 有 4.0.1 专用 normalization | 暂不需要；做原生图表时把它的 chart 检查并入开发期门槛（许可允许，§6） | 低 / S |

### 3.2 agent 的设计准则与自检闭环 —— 值得借鉴

| 技能的做法 | 我们现状 | 建议 | 收益 / 工作量 |
|---|---|---|---|
| **QA 必做**：先 `slide_text` 查内容，再渲染成图逐页看；“盯着生成代码看久了只看到预期，用新眼光（可用子代理）看”；改完只重渲改过的页，然后停 | CLI/MCP agent：skill 的 “Look at what you made” 让它跑 `check --snapshots` / `look`。**编辑器内委托**：`--allowedTools` 只有 `Read,Edit,Write,Glob,Grep`（+ 图片生成），`SLIDES_SYSTEM` 写着 “Do not run builds, servers or browsers”，也没有任何版面结果回传。看板有 `.runs.json` 的 `drawn` 回路，幻灯片没有 | **给幻灯片补上看板那样的回路**：打开着的 deck 在每次写入安静后，对改过的页跑现成的 `layoutProbe`（裁切、出界、对比度、挤压、空白）并写进 `.runs.json` 的 `layout`；编辑器用已有的 `FrameRasterizer` 把改过的页画到 `renders/`；`SLIDES_SYSTEM` 加一步“读这些结果和图，改真问题，再停”。没开编辑器的路线不变 | 高 / M |
| 视觉 QA 清单：文字溢出优先；元素重叠；页脚撞内容；间距 < 0.3"；边距 < 0.5"；对齐；低对比；**同类页之间比**（标题高度、图表标签样式）；**断词、数字和单位拆行**；残留占位内容 | `layoutProbe` 已覆盖裁切/出界/对比度/挤压/空白带；skill 讲了标题不跳、版式节奏；没有跨页比较，没有断词和占位检查 | 在 `check` 加 deck 级规则：同类页标题位置/字号漂移、残留占位（`[€__]`、`lorem`、`TODO`、`xxx`、起始封面文案）、字号低于 24px、数字与单位被拆行；`layoutProbe` 加“单词被拆行”。都报警告 | 中 / S–M |
| “别这样做”：标题下的强调线、贯穿页宽的色条、单边色边的卡片（“AI 生成感”）；默认米色底；标题句号；正文居中；只精修一页其余不管；每页要有视觉元素 | skill 有一套更长的正面指导（方向、配色、字阶、节奏、`craft.md`），但没有这几条明确禁令；`reference/styles.md` 还教“用 `border-left` 给引语画一条强调竖条” | 把这几条补进 `.claude/skills/slides/SKILL.md` 的 “Designing the deck”，并决定 `styles.md` 那条（引语竖条是否算例外）；用 `pnpm eval` 前后比一次 | 中 / S |
| 内容结构：金字塔（结论先行、执行摘要、分节、结论与下一步）；按用途（现场讲 / 预读）和时长（1.5–2 分钟一页）定篇幅 | `craft.md` 有“先写大纲、标题成故事”，`questions.md` 问长度与听众 | 把“按用途和时长定篇幅”与金字塔作为可选结构补进 `craft.md` | 低中 / S |

### 3.3 导入已有 PPTX 与模板复用

| 技能的做法 | 我们现状 | 建议 | 收益 / 工作量 |
|---|---|---|---|
| 读：`slide_text.py` 把每页标题、文字、表格、图表数据、alt、备注转成 Markdown | 导入器能读全部这些，但 PPTX **不是**请求附件可解析的类型（slides-pptx.md §1） | 把 `.pptx` 加进附件：复用 core `importPptx` 的解析，给模型一份按页的文字提要（任何类型都能用，如“按这份 deck 写一篇文档”） | 中 / S |
| 模板：`thumbnail.py` 出全 deck 缩略图网格 → 配合文字提要把内容映射到模板页 → `add_slide.py` 复制页 → 填内容 → 删多余槽位整组 → 查残留占位 | PPTX 导入成普通 deck；没有“拿一份 deck 当模板”的流程；`look` 一次一页；slides-variety §4 的“设计系统承载版式”是方案 | 便宜的一层：skill 写明“以导入的（或引用的）deck 为模板”的流程（看全貌 → 选页 → 复制页文件改 id → 填 → 删整组 → `check` 查残留）；`look`/`check --snapshots` 加一张全 deck 联系表。贵的一层（版式库进设计系统）照 slides-variety §4 | 中 / S（流程）；高 / L（版式库） |
| 编辑现有 PPTX：解包 → 改 `slideN.xml` → 打包，保留母版与原格式 | 刻意不回写原 OOXML（slides-pptx.md §4 已定） | **不适用**，理由见 §4 | — |

## 4. 不适用的部分与原因

- **让 agent 写 pptxgenjs 脚本生成 deck**：我们的 deck 是可在编辑器双向编辑的文件（`deck.json` + `slides/*.html`），PPTX 只是交换格式。让 agent 直接产出 PPTX 会绕开编辑器、撤销、journal、设计系统和 Review。技能里 pptxgenjs 的大部分坑（`#` 颜色、共享 options 被改写、负阴影偏移、`letterSpacing`）对我们是 writer 内部问题，由 `writePptx` 的校验和锁定版本兜住，agent 碰不到；仍有价值的是其中几条 writer 自查项（`isTextBox`、不写字面“•”、页脚页码放版式），已并入 §3.1。
- **解包改 OOXML 再打包、`add_slide.py` / `clean.py`**：这是“在原 PPTX 上编辑并保留母版”的路线。slides-pptx.md §4 已定不回写原 OOXML、不维护第二份编辑状态；采用它等于给 slides 加第二个编辑模型。真正想要的“套公司模板”在我们这里应是 §3.1 的主题/占位符 + 将来“用一份 .potx 作为导出外壳”（读它的母版和主题，把我们的页放进它的“仅标题”版式），后者是 L 级、排在主题与占位符之后的提案。
- **LibreOffice 渲染做 QA（`soffice.py`、`pdftoppm`）**：我们的真相是编辑器自己的渲染（真实 Chrome），PPTX 是从同一排版测量出来的；产品不依赖 Office/LibreOffice/Python 是已定取舍。LibreOffice 只留在 `scripts/pptx-fidelity/` 作离线差分。技能里关于“QA 渲染器替换字体导致溢出判断不可信”的提醒，对我们只在“PowerPoint 那边字体不同”时成立，已体现在 §3.1 的字体项。
- **配色表、字号表（pt）、0.5" 边距**：我们按 brief 定方向，或用设计系统和 36 个内置 look；skill 已有按 1920×1080 写好的字阶、边距与留白算法。照搬那张 10 色配色表反而会把输出拉向同一套颜色。
- **python-pptx 的使用说明、`.ppt` 转换**：不用 python-pptx，旧 `.ppt` 不在支持范围（slides-pptx.md §5）。

## 5. 前 3 项建议

1. **导出的 PPTX 在 PowerPoint 里好改**（§3.1 前四行合做）：块级文本框 + 原生项目符号 + `txBox`/对象名/alt，标题进 `title` 占位符，`deck.json.sections` 成分节，deck 的颜色和字体写进主题。收益高：现在导出的文字在 PowerPoint 里基本不可改（§2）；这是“导出 PPTX”这个功能对用户的主要价值。工作量 M：改 `pptxDom.ts` 文本遍历、writer DTO 加列表/占位符/主题字段、`pptxNormalize` 写主题、浏览器回归和 `pnpm e2e pptx` 断言、python-pptx 读回校验。要先定的一点：块级文本框交给 PowerPoint 换行后，接收方字体不同时折行会和编辑器不同——是按测量宽度加余量接受这种差异（技能的做法），还是保留一个“逐行精确”的后备；建议前者为默认，不加模式开关，差异在导出结果里提示。
2. **编辑器里的 Claude Code 改完幻灯片能看到自己做的样子**（§3.2 第一行）：打开着的 deck 对改过的页跑 `layoutProbe`、画 PNG，结果进 `.runs.json`，`SLIDES_SYSTEM` 加 QA 一步。收益高：技能的经验是“第一次渲染通常都有几处真问题”，而现在委托路线完全没有这个回路，看板已经证明这条路可行。工作量 M。canvas 与 motion 也有同样缺口，可以照同一做法跟进（另开）。
3. **设计禁令 + deck 级检查**（§3.2 第二、三行）：skill 补“别这样做”清单（标题下强调线、边缘色条、米色默认底、标题句号、正文居中），`check` 加跨页标题漂移、残留占位、过小字号、断词/数字单位拆行。收益中，工作量 S–M，且直接给第 2 项提供可读的检查结果；用 `pnpm eval` 前后比较。

第 4 名是**原生图表元素**（§3.1 第五行）：对商务 deck 收益最高，但要新增元素、编辑器绘制、导入导出三处，工作量 L，适合在前 3 项之后单独设计。

## 6. 许可

- 该目录 `LICENSE.txt` 现在是 **Apache License 2.0**（`2c5958e`，2026-11-06 “Move Office skills to the Apache 2.0 license”），仓库 README 也写明 docx/pdf/pptx/xlsx 技能开源（Apache 2.0）。我们是 Apache-2.0，兼容：可以复用代码和文字，须保留许可文本与版权声明、在改过的文件里注明修改，按我们的惯例写进 `NOTICE`（与 pptx-ts 的做法相同）。
- 在此之前（如 `4e6907a`）的许可是 “© 2025 Anthropic, PBC. All rights reserved”，受 Anthropic 服务条款约束。**旧版的 `html2pptx.js`、`html2pptx.md`、`ooxml.md`、`inventory.py`、`replace.py` 等在改许可前就被删掉了，没有以 Apache 发布过**，只能参考思路，不能复制。
- `scripts/office/schemas/` 下的 XSD 来自 ISO/IEC 29500 和微软扩展，有各自的条款，本次未核实；若将来复用 `validate.py`，schema 文件要单独确认来源许可。
- 技能自带的免责声明：示例用途，实际 Claude 的行为可能不同；所以本报告引用的是它的做法和经验，不把它当规范。
