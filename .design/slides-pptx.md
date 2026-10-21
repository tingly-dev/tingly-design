# Slides: PPTX import and export

已实施（独立受限模块、新项目导入、整份可见 deck 导出：原生优先、逐元素图片化）；聚焦产品套件 90/90 通过，LibreOffice 渲染的图像差分已作为保真度量；真实 PowerPoint 打开/渲染仍未验收。下文区分当前契约、验证边界与未来提案。

## 1. 当前产品边界

`.pptx` 是现有 slides 类型的交换格式，不是新项目类型。两条独立转换路径是 **PPTX → 新 slides 项目** 和 **slides → 新 PPTX**；编辑只发生在 `deck.json` 与 `slides/<id>.html`。不回写原 OOXML，不维护第二份编辑状态，不承诺无损往返、任意 Office 对象或像素级保真。原文件仅作来源保留。不要求安装 Office、Python 或 LibreOffice，不上传到第三方转换服务。

### 新项目导入

- 启动页“导入 PowerPoint（.pptx）…”picker、PPTX 拖放、`POST /api/archive?file=<文件名>` 和 `tingly-design import talk.pptx` 共用服务端 `archive.ts` 的 `unpackProject`。不加类型或模式选择。扩展名和 OPC 元数据用于分派，真实内容仍须严格转换器验证；PPTX 在通用 ZIP 解压前进入自己的预算检查。
- 转换成功后，服务端独占保留目标名字，以隐藏 staging 写文件再发布；重名加后缀，并发导入不覆盖已有项目。失败清理 staging 和预留目录，不留下可打开的半成品。使用 `projectDir`，不另建项目寻址规则。
- 生成普通 deck、可编辑页面和 `uploads/<id>/` 下的精确 `source.pptx`、媒体、`report.json`。`deck.json.pptxImport` 指向报告；报告包含源尺寸、part → slide 对应和结构化诊断，随整个项目归档保留。
- picker/drop 的结果是常驻对话框，不是即逝 toast：按页/对象说明近似与拒绝原因；成功时可下载原文件、JSON 报告，再打开新项目。失败留在启动页并说明没有创建项目。诊断和操作文案为英中 i18n；核心只返回 code 与参数。API 返回 `pptx` 元数据或结构化错误诊断，CLI 输出本地化诊断及保留的原文件/报告路径。
- **不支持向已开 deck 追加 PPTX**。当前 `ImportHere` 的图片/SVG 路径不因此扩大。PPTX 也没有被加入模型附件的通用文字解析类型。

### 整份可见 deck 导出

- 幻灯片 `FileMenu` 的“PowerPoint（.pptx）”直接开始导出，跳过隐藏页和隐藏元素，保留原生 speaker notes。不增加“图片/可编辑”模式选择。
- `exportDeckPptx` 冻结标题、字体声明、页面尺寸（`deckSize`，1920 px 对应 13.333 in，其它尺寸同密度）、可见页顺序和当前源；`deckSnapshotToPptx` 在渲染前读取并固定资源 bytes。专用 `sandbox="allow-scripts"` iframe 使用真实 slides runtime 渲染（嵌入块真实运行，不是缩略图占位），等待字体、图片与对应源提交后，在框架内部调用 DOM 布局适配器。父页面只通过受限 `dcPptx` 消息接收临时绘图 DTO，不跨 opaque origin 读 DOM。捕获框架放在视口内、缩到 1% 且透明：放在视口外时 Chrome 停掉其中嵌入框架的动画帧，嵌入块交出空白。
- **原生优先**：文字（字距、`text-transform`、删除线、半透明颜色、继承的下划线）、实色/半透明填充、统一圆角（roundRect 带半径，正圆为 ellipse）、四边一致的边框为描边、只在部分边上的实线边框为独立线条、列表符号（disc/circle/square/数字/字母/罗马数字，按 `::marker` 字体测量放在首行左侧）、表格单元格（作为普通盒子与文字）、`opacity`（乘进文字与填充透明度）、PNG/JPEG 图片与备注。兄弟元素按 CSS 叠放顺序输出（流内内容与直接文字，然后定位元素按 z-index，flex `order`，同级按源顺序），不再要求 runtime paint-layer 标记。完全在页外的元素省略，部分出界的保留。文字阴影、small-caps、word-spacing、非实线下划线被省略并给近似提醒，以保持文字可编辑。
- **逐元素图片化**：PowerPoint 没有对应对象的元素只把它自己变成图片，放在它原来的叠放位置。两种范围：`self` 只画元素自己的盒子（渐变、阴影、伪元素、非实线或带透明度的边框、非统一圆角），其文字与子元素仍原生；`subtree` 连同后代一起画（SVG/canvas/x-icon/x-connector/表单控件等替换元素、x-embed 与 iframe、transform、filter/混合、clip-path/mask、确实裁掉内容的 overflow、渐变文字、竖排/RTL、非 PNG/JPEG 图片和带裁剪/内边距的图片）。原生处理过程中抛出的任何非致命问题都回滚该元素已写出的对象，再整体图片化，因此不会重复也不会遗漏。图片由 sandbox 内的 `FrameRasterizer`（与图片导出同一套 foreignObject 复制）画整页，借 `visibility` 只留目标元素（不改布局），2× 像素，按实际 alpha 裁到所画范围（阴影包含在内）；嵌入框架用 `snapFrame` 交出自己的画面。
- 失败只来自无法读取或超出限制：可见图片读不到、字体失败、预算/超时、图片化本身失败。失败给出定位诊断，不下载部分成品。文字按实测行框输出、每行不换行（`wrap="none"`），不保证 PowerPoint 的完整段落重排语义或字体度量一致，不嵌入字体。
- 常驻结果对话框显示进度；成功时说明有多少元素作为图片放入，并按页（可点击跳到该页）汇总各类图片化元素的数量与省略的文字效果；失败页与对象路径可跳转；运行中可取消。超时、取消和失败都清理捕获框架与监听。整次截止随页数增长（60 秒 + 每页 15 秒，上限 10 分钟），单页 30 秒。导入报告/原文件的下载属于导入结果，不宣称导出另有报告文件下载。
- 成品通过 `local.download` 交付；CLI `tingly-design export talk --as pptx --out ./exports`、MCP `export` 使用同一 `FORMATS` / `pageJobs` / FileMenu 路径。PPTX 是整份可见 deck，明确拒绝 `--slide`，不把当前选页误称为范围。其他类型没有 PPTX 项：此格式表达演示文稿，不是所有项目的通用导出。

## 2. 独立模块契约（保留独立可用）

- `importPptx(bytes, { id, title, limits? })`（core）：同步纯函数，无 DOM、文件系统、网络、时间或随机依赖。`id` 是调用方保证不冲突的 1–40 字符安全 ASCII 标识。成功返回 `{ ok: true, files, report, diagnostics }`，失败仅 `{ ok: false, diagnostics }`，不交出部分文件。生成 `deck.json`、`slides/<id>-N.html`、原文件、媒体和报告，不建立第二份编辑状态。
- 导入新增映射：段落百分比/固定点数行距按原单位转 CSS；`wrap="none"` 保持不折行；图片 `srcRect` 以保留原图的可编辑裁剪容器表达（退化裁剪拒绝）；显式未合并表格保留行列尺寸、单元格文字/填充/边框/内边距，主题表格样式及合并单元格仍拒绝。空装饰形状保留绘图，不为没有文字的 `txBody` 解析无用字体或制造空行。表格/裁剪能导入不表示当前原生 PPTX 导出支持它们。
- 导入只支持 Transitional OOXML 的明确子集：真实页顺序、uniform contain 到 1920×1080、基础文字与段落/CJK/粗斜体/下划线/颜色、简单 placeholder/layout/master 默认值与背景/主题 Latin 字体、rect/roundRect/ellipse/直线、PNG/JPEG、旋转/翻转、普通备注。斜线生成受清洗 SVG。字体度量/换行、kerning、圆角近似和缺省背景有诊断；支持实色 background style-matrix 引用及 phClr 代入，形状 style matrix 仍拒绝。脚本字体只有解析为相同字体才支持；HSL luminance 修饰、hidden 对象及非零 fillRect 偏移明确拒绝。分组、主题/合并表格、图表、复杂几何、特效、列表及混合字号/字体等不支持项原子失败；没有通用预览渲染器。导入成功不保证该页一定能原生再导出（例如受清洗 SVG 线仍可能被 DOM 导出拒绝）。
- `writePptx(deck): Promise<Uint8Array>`（`@dc/export/pptx`，root 也导出）：只读绘图 DTO，页有背景/备注和有序文字、基础形状、图片对象。文字含段落/runs；图片为本地 PNG/JPEG bytes，不接受 URL/HTML/原包透传。坐标、字号、padding、stroke 统一以 `widthIn / widthPx` 换算。精确锁定 MIT `pptxgenjs@4.0.1`，校验并复制输入后按需加载；保留空段落、独立对齐、显式 false 字形覆盖。图片支持 contain/居中 cover/stretch。
- `slidesDomToPptx(roots, options)`（`@dc/export/pptx-dom`，root 也导出）：读取连接到真实浏览器、同尺寸、未缩放的已渲染页，等待字体；返回 `{ ok: true, deck, diagnostics }` 或失败诊断。测量 flex/grid 后的位置、DOM Range 文字行、盒子、列表符号和受限形状，按 CSS 叠放顺序输出。图片必须由 `resolveImage` 提供 bytes，不隐式 fetch。有超时/AbortSignal/预算约束。
- 可选回调由调用方提供真实捕获，模块不自带渲染器：`rasterizeElement(el, { mode, feature })` 返回一个元素在原位置的图片与其相对页面的框（产品使用此项）；`rasterizeSlide` 是更粗的整页替代，替换全部对象并保留备注。两者都不传时，没有原生形式的内容仍原子失败（独立调用的旧契约）。图片化以 `rasterized` warning 报告元素路径与原因。writer 仍校验最终图片头/尺寸、XML 文字和物理字号；DOM 成功不代表任意回调 bytes 可写包。
- writer DTO 增加：文字 `strike`、`charSpacingPx`、`opacity`，文本框 `wrap`；形状 `fillOpacity`、roundRect `radiusPx`；素材上限 2048 个（逐元素图片会比整页多）。

### 资源与安全边界

导入默认：压缩 32MiB、展开 128MiB、2048 entries、单 part 16MiB、单 XML 4MiB、深度 64、每 XML 100k / 总 500k 节点、1000 诊断、300 页、每图片 40M pixels、备注 4000 UTF-16 单位。ZIP 检查中央/本地头、CRC、路径、重复、实际解压字节；namespace-aware XML 禁止 DTD/处理指令；外部关系、宏/ActiveX/OLE/加密包拒绝。不抓取外部关系，生成源按白名单转义；checker 不是 sanitizer。预算覆盖只可收紧。同步导入函数没有取消或时间截止，需可中断时由调用方放入 worker；这些上限不是语料验证的性能承诺。

writer 默认：500 页、10k 对象、50k 段落/runs、总 2M UTF-16、单串 1M、256 图片、单图 32MiB/总 128MiB、40M pixels、物理页边 1–56in，并限制几何/字体/描边。图片检查头和尺寸，不完整解码。独立 DOM 更保守：200 页、10k elements/objects、200k 文字、100MiB 总媒体、30 秒；只能收紧。

产品导出另有整次 60 秒截止、200 页/总源 2M 字符、单资源 32MiB/总资源 100MiB、单图片 40M pixels 等限制；框架消息等待和单页适配也各有截止。图片仅从本项目安全相对路径取 PNG/JPEG；显式字体只允许本地路径或受限 Google Fonts 地址，下载失败不静默忽略。可用系统字体与接收方 Office 的字体环境仍可能不同。

### 精确版本 writer 的 schema normalization

writer 对刚由 PptxGenJS 4.0.1 生成的包执行有限结构修正：notesMaster 列表移到 slide IDs 前，重复且相同的段落属性只保留首个，删除不存在的 slideMaster2..N 的精确 content-type 声明。结构/计数/属性不符合预期即失败；不是任意 OOXML 修复入口。原先已知的 writer schema 缺陷已由此修复，不能继续描述为未修复阻塞，也不能把 normalization 说成任意 Office 兼容保证。

## 3. 验证状态与门槛

实施状态不等于任意格式保真承诺。产品 `e2e/pptx.py` 已登记在 `e2e/run.py` 和 `e2e/coverage.json`，聚焦产品运行 **90/90 通过**。覆盖真实 picker/drop/API、源编辑保存重开、FileMenu 下载、原生对象/备注、渐变背景逐元素图片化而标题仍为原生文字、不可读图片的失败与取消清理、非 slides 无入口、英中/明暗、CLI/MCP 共用导出及安全 ZIP/Markdown/Claude Design picker 回归。此结论只适用于这些路径与断言，不是整个仓库 e2e 全量或任意 PPTX 的通过证明；矩阵的 ✓ 表示已接线的受限能力。

已取得的验证与仍待验证的项目分开看：

- 独立模块有 package/security、跨模块源编辑（`pptxBridge.test.ts`）、真实 Chrome DOM 布局和 smoke 语料检查。集成状态的 focused core/export/import/i18n/eval 检查及 typecheck/build/bundle 已通过；完整单元运行仍有既有 baseline 失败，不能写成全量 `pnpm test` 通过。
- 精确版本 writer 的含备注/混合 run、无备注、三页、十二页成品已有独立 Office2019 schema 检查证据；真实 Chrome 菜单、CLI、MCP 导出的三个成品也通过 Open XML SDK Office2019 检查（3 files / 0 errors）。独立验证工具在 `scripts/validate-pptx/`，不随产品运行。
- **图像差分**：`scripts/pptx-fidelity/compare.py <project> --fonts` 用真实命令行导出 PDF（编辑器自己的渲染）和 PPTX，用 LibreOffice 渲染 PPTX，两边按同宽栅格化逐像素比较，输出每页参考图、渲染图、差异图和差异像素比例。LibreOffice 是独立读者但不是 PowerPoint；它的已知偏差（例如带 alpha 的文字加字距会被截短）不等于导出错误，需看图判断。示例 deck 与压力 deck 的结果见 [验证记录](../.research/slides-pptx-verification.md)。
- Schema 合法不等于 Office 打开后的视觉保真或逐对象可编辑验收。现有用户提供语料的打开确认不能扩大为所有 writer 成品的 Office 互操作证明；真实 Office 字体、换行、对象编辑与视觉比较仍是单独门槛。详细既有证据及其适用范围见 [验证记录](../.research/slides-pptx-verification.md)。

### Smoke 语料契约

`packages/core/test/fixtures/pptx-smoke/` 按“综合展示 + 支持集 + 单特性用例”组织；目录 README 维护重建方法、逐页覆盖、预期和验证边界。一个大文件不可替代单特性包：导入原子失败时，一个图表就会掩盖其他页回归。

生成器直接用 PptxGenJS，而不是被测 writer；提交固定 `.pptx` 和独立 manifest，普通 smoke 不临时生成。可复现检查消除 ZIP/元数据时间差异。支持集检查内容/几何/媒体/备注和源编辑；不支持的合法特性独立成包，检查精确诊断与无部分输出。多种页尺寸分别成包；恶意路径、DTD、炸弹仍由安全测试覆盖，不冒充合法演示文稿。新增能力须更新 manifest 的预期与断言，不自动接受当前实现结果。ZIP/XML/关系检查、完整 schema、Office 打开/渲染是不同门槛，不能以自己的 importer 能读替代独立验证。

## 4. 已定取舍与 UX

- 选择受限 OOXML 解析生成普通 slides 源，而不是把第三方预览 HTML 当成编辑格式。PptxGenJS 负责新包，不负责读 PPTX 或任意 HTML/CSS 布局；真实浏览器先求解布局，临时 DTO 只读、不持久化。
- 不采用必需的 Office/LibreOffice/python-pptx 运行依赖或在线转换服务；本地边界、隐私和 bundle 分发保持一致。PptxGenJS 的实际依赖不能按“零依赖”营销描述处理。
- 不选全页图片作为产品默认：它会丢掉文字结构。也不再“遇到任何不支持就整份拒绝”：几乎每份真实 deck（包括自带示例）都有渐变、阴影、图标或嵌入，整份拒绝等于没有导出。选择逐元素图片化：能编辑的保持可编辑，不能的看起来一样，并逐个列出；只画盒子（`self`）让渐变卡片上的文字依旧可编辑。曾考虑“整页底图 + 原生文字”：实现简单、视觉稳，但形状和图片都被烤进底图，且后绘制的非文字元素会被文字压住，故不采用。图片化的隔离借 `visibility` 而不是删节点，布局不变；用整页复制再按 alpha 裁剪，变换、阴影、溢出都能落在正确位置。
- 入口使用 Import PowerPoint (.pptx)… / FileMenu；结果按“带进了什么、哪里变了、下一步拿什么”组织，英中说明配可下载来源和报告；失败定位到真实页，不每个对象弹 toast。现有 Launcher / Slides 自身设计板已反映入口与结果反馈。按 [UX 原则](./ux-principles.md) 保留明确作用域：导入新项目，不暗中改已开 deck；导出不写回源。

## 5. 未来提案（未实施，不扩大上述支持集合）

以下是后续方向，不是当前首版承诺：

- **向已开 deck 追加 PPTX**：必须先有真实批次可见性、并发合并、冲突安全 ID、失败回滚与撤销。当前页面发现规则会找回不在 order 的页面，独立页面写入再写索引不是原子事务。撤销应仅移除本批次，不覆盖他人的后续修改。
- **扩大导入映射**：主题/合并表格、分组、非矩形图片遮罩、复杂几何、列表、混合字号/字体、更多主题继承等需逐项定义和测试；不能把 SmartArt/图表存在于包中当作有可用预览图。旧 `.ppt`、宏、加密包、OLE、动画和音视频不在当前支持中。
- **更多原生化**：只含旋转的 transform 可写成原生旋转；表格可写成 PowerPoint 原生表格（现在是独立单元格盒子与文字，能编辑但不是表格对象）；SVG 可附原生 SVG 图片。嵌入块是“导出那一刻”的画面，动画型嵌入没有确定静态时刻。
- **更强互操作与性能证据**：真实 Office 环境中的 CJK/混合 run、字体替代、换行和逐对象编辑；大型 deck 的耗时、内存与重复导出；未来追加的并发/撤销。资源上限不是性能承诺。能力扩展须同步技能、用户指南、自身设计板、矩阵和对应验证。

## 6. 参考

- [Microsoft PresentationML structure](https://learn.microsoft.com/en-us/office/open-xml/presentation/structure-of-a-presentationml-document)：slide、master、layout、theme、notes 经关系关联，单张 XML 不足以还原外观。
- [研究与候选比较](../.research/slides-pptx.md)、[验证证据](../.research/slides-pptx-verification.md)：历史观察与验证边界，不替代当前代码契约。
- [项目类型矩阵](./project-kinds.md)、[共用导出菜单](./export-menu.md)、[项目归档](./project-archive.md)、[导入当前项目](./import-into-project.md)。
