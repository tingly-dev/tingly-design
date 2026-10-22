# Slides: PPTX import and export

已实施（独立受限模块、新项目导入：包级严格、对象级尽力而为，内置表格样式全覆盖，经典与 Office 2016 图表重绘；整份可见 deck 导出：原生优先、原生表格、逐元素图片化）；聚焦产品套件 90/90 通过，导入与导出两个方向都用 LibreOffice 渲染的图像差分作保真度量；真实 PowerPoint 打开/渲染仍未验收。下文区分当前契约、验证边界与未来提案。

## 1. 当前产品边界

`.pptx` 是现有 slides 类型的交换格式，不是新项目类型。两条独立转换路径是 **PPTX → 新 slides 项目** 和 **slides → 新 PPTX**；编辑只发生在 `deck.json` 与 `slides/<id>.html`。不回写原 OOXML，不维护第二份编辑状态，不承诺无损往返、任意 Office 对象或像素级保真。原文件仅作来源保留。不要求安装 Office、Python 或 LibreOffice，不上传到第三方转换服务。

### 新项目导入

- 启动页“导入 PowerPoint（.pptx）…”picker、PPTX 拖放、`POST /api/archive?file=<文件名>` 和 `tingly-design import talk.pptx` 共用服务端 `archive.ts` 的 `unpackProject`。不加类型或模式选择。扩展名和 OPC 元数据用于分派，真实内容仍须严格转换器验证；PPTX 在通用 ZIP 解压前进入自己的预算检查。
- 转换成功后，服务端独占保留目标名字，以隐藏 staging 写文件再发布；重名加后缀，并发导入不覆盖已有项目。失败清理 staging 和预留目录，不留下可打开的半成品。使用 `projectDir`，不另建项目寻址规则。
- 生成普通 deck、可编辑页面和 `uploads/<id>/` 下的精确 `source.pptx`、媒体、`report.json`。`deck.json.pptxImport` 指向报告；报告包含源尺寸、deck 尺寸、part → slide 对应和结构化诊断，随整个项目归档保留。deck 保留演示文稿的页形：横向页放进 1920×1080、竖向页放进 1080×1920（4:3 得 1440×1080），不是 1920×1080 时写 `deck.json` 的 `size`。
- picker/drop 的结果是常驻对话框，不是即逝 toast：同一种说明只出现一次，下面列出它涉及的页（连续页写成范围，全部页写“每一页”）和对象；错误在前，包级说明才显示 part。成功时可下载原文件、JSON 报告，再打开新项目。失败留在启动页并说明没有创建项目。诊断和操作文案为英中 i18n；核心只返回 code 与参数。API 返回 `pptx` 元数据或结构化错误诊断，CLI 输出本地化诊断及保留的原文件/报告路径。
- **不支持向已开 deck 追加 PPTX**。当前 `ImportHere` 的图片/SVG 路径不因此扩大。PPTX 也没有被加入模型附件的通用文字解析类型。

### 整份可见 deck 导出

- 幻灯片 `FileMenu` 的“PowerPoint（.pptx）”直接开始导出，跳过隐藏页和隐藏元素，保留原生 speaker notes。不增加“图片/可编辑”模式选择。
- `exportDeckPptx` 冻结标题、字体声明、页面尺寸（`deckSize`，1920 px 对应 13.333 in，其它尺寸同密度）、可见页顺序和当前源；`deckSnapshotToPptx` 在渲染前读取并固定资源 bytes。专用 `sandbox="allow-scripts"` iframe 使用真实 slides runtime 渲染（嵌入块真实运行，不是缩略图占位），等待字体、图片与对应源提交后，在框架内部调用 DOM 布局适配器。父页面只通过受限 `dcPptx` 消息接收临时绘图 DTO，不跨 opaque origin 读 DOM。捕获框架放在视口内、缩到 1% 且透明：放在视口外时 Chrome 停掉其中嵌入框架的动画帧，嵌入块交出空白。
- **原生优先**：文字（字距、`text-transform`、删除线、半透明颜色、继承的下划线）、实色/半透明填充、统一圆角（roundRect 带半径，正圆为 ellipse）、四边一致的边框为描边、只在部分边上的实线边框为独立线条、列表符号（disc/circle/square/数字/字母/罗马数字，按 `::marker` 字体测量放在首行左侧）、**原生表格**（见下）、`opacity`（乘进文字与填充透明度）、PNG/JPEG 图片与备注。兄弟元素按 CSS 叠放顺序输出（流内内容与直接文字，然后定位元素按 z-index，flex `order`，同级按源顺序），不再要求 runtime paint-layer 标记。完全在页外的元素省略，部分出界的保留。文字阴影、small-caps、word-spacing、非实线下划线被省略并给近似提醒，以保持文字可编辑。
- **原生表格**：`<table>` 的单元格只含文字时写成 PowerPoint 表格对象，用户在 PowerPoint 里拿到的是能加行、改样式的表格，而不是一堆盒子。网格取自单元格实际画在哪里（CSS 表格布局和导入器的绝对定位都适用）：边线去重成列宽/行高，跨行跨列由覆盖的格数得出，每个格位必须恰好被一个单元格覆盖。每格带实色/半透明填充、四边实线边框（双线近似为同宽实线并提醒；只有一侧画了的共享边归两侧）、内边距与垂直对齐（穿过只负责摆放文字的包装层，如导入器的 flex 列），文字按块级元素分段、内联元素成 run，带对齐、段前段后和行高。表格不写表格样式，只有单元格自己的格式。条件不满足（格间距、单元格里有图片/SVG/旋转文字/背景或边框的子元素、渐变单元格、整体半透明）时整张表回到逐元素路径，不部分原生。PowerPoint 会按自己的字体度量撑高放不下的行。
- **逐元素图片化**：PowerPoint 没有对应对象的元素只把它自己变成图片，放在它原来的叠放位置。两种范围：`self` 只画元素自己的盒子（渐变、阴影、伪元素、非实线或带透明度的边框、非统一圆角），其文字与子元素仍原生；`subtree` 连同后代一起画（SVG/canvas/x-icon/x-connector/表单控件等替换元素、x-embed 与 iframe、transform、filter/混合、clip-path/mask、确实裁掉内容的 overflow、渐变文字、竖排/RTL、非 PNG/JPEG 图片和带裁剪/内边距的图片）。原生处理过程中抛出的任何非致命问题都回滚该元素已写出的对象，再整体图片化，因此不会重复也不会遗漏。图片由 sandbox 内的 `FrameRasterizer`（与图片导出同一套 foreignObject 复制）画整页，借 `visibility` 只留目标元素（不改布局），2× 像素，按实际 alpha 裁到所画范围（阴影包含在内）；嵌入框架用 `snapFrame` 交出自己的画面。
- 失败只来自无法读取或超出限制：可见图片读不到、字体失败、预算/超时、图片化本身失败。失败给出定位诊断，不下载部分成品。文字按实测行框输出、每行不换行（`wrap="none"`），不保证 PowerPoint 的完整段落重排语义或字体度量一致，不嵌入字体。
- 常驻结果对话框显示进度；成功时说明有多少元素作为图片放入，并按页（可点击跳到该页）汇总各类图片化元素的数量与省略的文字效果；失败页与对象路径可跳转；运行中可取消。超时、取消和失败都清理捕获框架与监听。整次截止随页数增长（60 秒 + 每页 15 秒，上限 10 分钟），单页 30 秒。导入报告/原文件的下载属于导入结果，不宣称导出另有报告文件下载。
- 成品通过 `local.download` 交付；CLI `tingly-design export talk --as pptx --out ./exports`、MCP `export` 使用同一 `FORMATS` / `pageJobs` / FileMenu 路径。PPTX 是整份可见 deck，明确拒绝 `--slide`，不把当前选页误称为范围。其他类型没有 PPTX 项：此格式表达演示文稿，不是所有项目的通用导出。

## 2. 独立模块契约（保留独立可用）

- `importPptx(bytes, { id, title, limits? })`（core）：同步纯函数，无 DOM、文件系统、网络、时间或随机依赖。`id` 是调用方保证不冲突的 1–40 字符安全 ASCII 标识。成功返回 `{ ok: true, files, report, diagnostics }`，失败仅 `{ ok: false, diagnostics }`，不交出部分文件。生成 `deck.json`、`slides/<id>-N.html`、原文件、媒体和报告，不建立第二份编辑状态。
- **包级严格、对象级尽力而为**：只有包本身不可信或读不了才整份拒绝（ZIP/XML 结构、DTD、不安全路径或关系、重复项、宏/ActiveX、预算、参数），这些 code 是 `FATAL` 集合。其余问题都落在单个对象或单页：该对象带 `object_skipped`（附 reason）略过，该页整体出错才 `slide_skipped`，其余照常导入；一页都没留下才失败。诊断达到预算后停止记录，不再因此失败。理由：真实 deck 几乎总有一两个读不了的对象，整份拒绝等于没有导入。
- 映射覆盖：文字与段落（行距、段前后、自动缩放 `normAutofit`、逐 run 字号/字体/字距/大小写/删除线/高亮/描边/阴影/上下标、`slidenum` 字段、竖排）；列表（项目符号与编号转 `ul`/`ol`，含起始号和缩进）；占位符、layout、master 的 txStyles 与 lstStyle 逐级继承；预设几何（x-shape 能表达的用 x-shape，其余画成清洗过的 SVG path，含调整值）、自定义路径（含 arcTo）、连接线（直线与折线路由、箭头）；填充（实色、线性/径向渐变、图案、图片、组填充）与描边（合并主题 `lnRef`）；外阴影；颜色修饰（tint/shade 在线性光里算，与 Office 一致；lumMod/lumOff/sat/hue 经 HSL）；主题 style matrix 与 phClr；分组（chOff/chExt 缩放、翻转与旋转组合，文字从不镜像）；图片裁剪、透明度、灰度；表格（合并单元格；表格样式见下）；SmartArt 取其绘制好的 drawing part；OLE 用自带的预览图；背景图片与渐变。
- **表格样式全覆盖**：PowerPoint 的 74 种内置表格样式都随导入器携带（`pptxTableStyles.data.ts`，由 `scripts/import-table-styles.mjs` 从 pptx-ts 生成），文件只写样式 GUID、没有 `tableStyles.xml` 时也能画出；包内定义优先。样式各部分按 PowerPoint 的顺序叠加：wholeTbl → 横/纵条带 → 末列/首列 → 末行 → 四个角单元格 → 首行，`tblBg` 在所有单元格之下；边框读 `a:ln` 或主题矩阵 `lnRef`，`dbl`/`thickThin`/`thinThick` 画成 CSS 双线（`tri` 近似并提醒），对角线 `tl2br`/`tr2bl` 与单元格的 `lnTlToBr`/`lnBlToTr` 画成随单元格缩放的 SVG；`tcTxStyle` 的粗/斜体、颜色和字体（含 `fontRef` 的主题字体）进入单元格文字；相邻单元格共享的边由“单元格自己设的边框胜过样式、有线胜过无线”决定；`vert`/`vert270` 竖排、`rtl` 表格镜像列序。
- 图表按 part 自己的缓存数据重绘为一张 SVG，附 `chart_redrawn`：看起来是原图表，但不再是可编辑的图表对象；嵌入工作簿不解析。经典图表（`pptxChart.ts`）：簇状/堆积/百分比柱条与 3D 柱（斜顶与侧面）、折线（标记、平滑、空值、高低线、涨跌柱、垂直线）、股价、面积、散点、气泡、饼、3D 饼、圆环（第一系列在最内圈）、复合饼/复合条饼、雷达、曲面（俯视等值线：类别横排、系列纵排、按值带着色，图例为值带）；次坐标轴、对数轴、反向、日期轴、Excel 数字格式（分节、千分位、百分比、科学计数、缩放、日期，1900/1904 两种日期系统）、坐标轴标题、主次网格线、刻度线、旋转类别标签、手动布局、自动标题（单系列且未删时用系列名）、图例（位置、删除项、标记、趋势线条目、堆积时倒序）、数据标签、趋势线（含公式与 R²）、误差线；配色读图表的颜色样式 part 或 `c:style`，六个强调色之后用 Office 的明暗变体。值轴自动刻度按 Office：从 0（或最低值以下）到最高值上方留二十分之一，取 1/2/5×10ⁿ 中不超过十格（受绘图高度限制）的最小步长。Office 2016 图表（`cx:` chartex，取 `mc:AlternateContent` 的 Choice）：瀑布（小计/总计柱立在轴上、连接线、增加/减少/总计图例）、漏斗、直方图（分箱数/箱宽/Scott 规则、上下溢出箱）、帕累托、箱线图（包含/排除中位数的四分位、均值标记、离群点）、树状图（squarified，横幅/重叠父标签）、旭日图；地图图表回退到文件自带的替代图。其它读不了的图形框放一个虚线占位框（`object_placeholder`），保留位置。
- 近似与省略只提醒一次（每页）：字体度量与换行、几何、样式、特效、超链接、动画（只在确有动画效果时）、媒体只留海报帧、备注截断、缺省背景。表格/裁剪能导入不表示当前原生 PPTX 导出支持它们；导入成功也不保证该页一定能原生再导出。
- `writePptx(deck): Promise<Uint8Array>`（`@dc/export/pptx`，root 也导出）：只读绘图 DTO，页有背景/备注和有序文字、基础形状、图片对象。文字含段落/runs；图片为本地 PNG/JPEG bytes，不接受 URL/HTML/原包透传。坐标、字号、padding、stroke 统一以 `widthIn / widthPx` 换算。精确锁定 MIT `pptxgenjs@4.0.1`，校验并复制输入后按需加载；保留空段落、独立对齐、显式 false 字形覆盖。图片支持 contain/居中 cover/stretch。
- `slidesDomToPptx(roots, options)`（`@dc/export/pptx-dom`，root 也导出）：读取连接到真实浏览器、同尺寸、未缩放的已渲染页，等待字体；返回 `{ ok: true, deck, diagnostics }` 或失败诊断。测量 flex/grid 后的位置、DOM Range 文字行、盒子、列表符号和受限形状，按 CSS 叠放顺序输出。图片必须由 `resolveImage` 提供 bytes，不隐式 fetch。有超时/AbortSignal/预算约束。
- 可选回调由调用方提供真实捕获，模块不自带渲染器：`rasterizeElement(el, { mode, feature })` 返回一个元素在原位置的图片与其相对页面的框（产品使用此项）；`rasterizeSlide` 是更粗的整页替代，替换全部对象并保留备注。两者都不传时，没有原生形式的内容仍原子失败（独立调用的旧契约）。图片化以 `rasterized` warning 报告元素路径与原因。writer 仍校验最终图片头/尺寸、XML 文字和物理字号；DOM 成功不代表任意回调 bytes 可写包。
- writer DTO 增加：文字 `strike`、`charSpacingPx`、`opacity`，文本框 `wrap`；形状 `fillOpacity`、roundRect `radiusPx`；段落 `spaceBeforePx`/`spaceAfterPx`/`lineHeightPx`；`table` 对象（`columnsPx`、`rowsPx`、按行列出起始单元格，单元格有段落、样式、跨度、填充、四边边框、内边距、垂直对齐；校验网格恰好覆盖一次、不可旋转）；素材上限 2048 个（逐元素图片会比整页多）。

### 资源与安全边界

导入默认：压缩 32MiB、展开 128MiB、2048 entries、单 part 16MiB、单 XML 4MiB、深度 64、每 XML 100k / 总 500k 节点、1000 诊断、300 页、每图片 40M pixels、备注 4000 UTF-16 单位。ZIP 检查中央/本地头、CRC、路径、重复、实际解压字节；namespace-aware XML 禁止 DTD/处理指令；宏/ActiveX 与加密包拒绝；外部关系只记录不跟随（对应对象略过或丢链接），嵌入包不解析。不抓取外部关系，生成源按白名单转义；checker 不是 sanitizer。预算覆盖只可收紧。同步导入函数没有取消或时间截止，需可中断时由调用方放入 worker；这些上限不是语料验证的性能承诺。

writer 默认：500 页、10k 对象、50k 段落/runs、总 2M UTF-16、单串 1M、256 图片、单图 32MiB/总 128MiB、40M pixels、物理页边 1–56in，并限制几何/字体/描边。图片检查头和尺寸，不完整解码。独立 DOM 更保守：200 页、10k elements/objects、200k 文字、100MiB 总媒体、30 秒；只能收紧。

产品导出另有整次 60 秒截止、200 页/总源 2M 字符、单资源 32MiB/总资源 100MiB、单图片 40M pixels 等限制；框架消息等待和单页适配也各有截止。图片仅从本项目安全相对路径取 PNG/JPEG；显式字体只允许本地路径或受限 Google Fonts 地址，下载失败不静默忽略。可用系统字体与接收方 Office 的字体环境仍可能不同。

### 精确版本 writer 的 schema normalization

writer 对刚由 PptxGenJS 4.0.1 生成的包执行有限结构修正：notesMaster 列表移到 slide IDs 前，重复且相同的段落属性只保留首个，删除不存在的 slideMaster2..N 的精确 content-type 声明。结构/计数/属性不符合预期即失败；不是任意 OOXML 修复入口。原先已知的 writer schema 缺陷已由此修复，不能继续描述为未修复阻塞，也不能把 normalization 说成任意 Office 兼容保证。

## 3. 验证状态与门槛

实施状态不等于任意格式保真承诺。产品 `e2e/pptx.py` 已登记在 `e2e/run.py` 和 `e2e/coverage.json`，聚焦产品运行 **90/90 通过**。覆盖真实 picker/drop/API、源编辑保存重开、FileMenu 下载、原生对象/备注、渐变背景逐元素图片化而标题仍为原生文字、不可读图片的失败与取消清理、非 slides 无入口、英中/明暗、CLI/MCP 共用导出及安全 ZIP/Markdown/Claude Design picker 回归。此结论只适用于这些路径与断言，不是整个仓库 e2e 全量或任意 PPTX 的通过证明；矩阵的 ✓ 表示已接线的受限能力。

已取得的验证与仍待验证的项目分开看：

- 独立模块有 package/security、跨模块源编辑（`pptxBridge.test.ts`）、真实 Chrome DOM 布局（含 CSS 表格与绝对定位表格的原生化）和 smoke 语料检查。`scripts/pptx-fidelity/corpus.py <dir>` 生成两份覆盖语料（python-pptx）：`tables.pptx` 是 74 种内置样式各两种标志组合加单元格格式页，`charts.pptx` 是 26 种图表（python-pptx 能写的类型、手写的股价/复合饼/曲面/组合/3D/日期/对数轴，以及六种 chartex）；交给 `compare.py --import` 评分，导出方向用 `compare.py <导入后的项目>`。集成状态的 focused core/export/import/i18n/eval 检查及 typecheck/build/bundle 已通过；完整单元运行仍有既有 baseline 失败，不能写成全量 `pnpm test` 通过。
- 精确版本 writer 的含备注/混合 run、无备注、三页、十二页成品已有独立 Office2019 schema 检查证据；真实 Chrome 菜单、CLI、MCP 导出的三个成品也通过 Open XML SDK Office2019 检查（3 files / 0 errors）。独立验证工具在 `scripts/validate-pptx/`，不随产品运行。
- **图像差分**：导入方向是 `compare.py --import <file.pptx> --fonts`（经 CLI 导入，参考图为 LibreOffice 渲染的原文件，对比编辑器 PDF）；导出方向是 `scripts/pptx-fidelity/compare.py <project> --fonts` 用真实命令行导出 PDF（编辑器自己的渲染）和 PPTX，用 LibreOffice 渲染 PPTX，两边按同宽栅格化逐像素比较，输出每页参考图、渲染图、差异图和差异像素比例。LibreOffice 是独立读者但不是 PowerPoint；它的已知偏差（例如带 alpha 的文字加字距会被截短）不等于导出错误，需看图判断。示例 deck 与压力 deck 的结果见 [验证记录](../.research/slides-pptx-verification.md)。
- Schema 合法不等于 Office 打开后的视觉保真或逐对象可编辑验收。现有用户提供语料的打开确认不能扩大为所有 writer 成品的 Office 互操作证明；真实 Office 字体、换行、对象编辑与视觉比较仍是单独门槛。详细既有证据及其适用范围见 [验证记录](../.research/slides-pptx-verification.md)。

### 浏览器回归脚本

`python3 packages/export/test/pptxDom.browser.py` 在真实 Chrome 里检查 DOM 测量与布局；`python3 packages/export/test/pptxProduct.browser.py` 是聚焦的不透明运行时与资源边界回归（沙盒侧入口是 `pptxCapture.ts`，编辑器侧是 `pptxExport.ts`），都需要 Python Playwright 和本机 Chrome，不是完整产品 e2e。`pnpm e2e pptx` 走启动器、API、菜单、CLI、MCP 的产品路径。

### Smoke 语料契约

`packages/core/test/fixtures/pptx-smoke/` 按“综合展示 + 支持集 + 单特性用例”组织；目录 README 维护重建方法、逐页覆盖、预期和验证边界。一个大文件不可替代单特性包：综合文件里的近似提醒会混在一起，单特性包才能断言每项映射本身。

生成器直接用 PptxGenJS，而不是被测 writer；提交固定 `.pptx` 和独立 manifest，普通 smoke 不临时生成。可复现检查消除 ZIP/元数据时间差异。支持集检查内容/几何/媒体/备注和源编辑；每个单特性包断言该特性的映射结果与精确诊断。多种页尺寸分别成包；恶意路径、DTD、炸弹仍由安全测试覆盖，不冒充合法演示文稿。新增能力须更新 manifest 的预期与断言，不自动接受当前实现结果。ZIP/XML/关系检查、完整 schema、Office 打开/渲染是不同门槛，不能以自己的 importer 能读替代独立验证。

## 4. 已定取舍与 UX

- 选择受限 OOXML 解析生成普通 slides 源，而不是把第三方预览 HTML 当成编辑格式。PptxGenJS 负责新包，不负责读 PPTX 或任意 HTML/CSS 布局；真实浏览器先求解布局，临时 DTO 只读、不持久化。
- 不采用必需的 Office/LibreOffice/python-pptx 运行依赖或在线转换服务；本地边界、隐私和 bundle 分发保持一致。PptxGenJS 的实际依赖不能按“零依赖”营销描述处理。
- 导入不再“遇到任何不支持就整份拒绝”：包级安全仍然严格，因为那是信任边界；对象级问题局部化，因为整份拒绝让用户什么都拿不到，而少一个对象的 deck 加一条定位说明仍可继续编辑。图表重绘为 SVG 而不是占位框：用户首先要“看起来对”，编辑数据可以回原文件；没有引入通用图表组件，因为 slides 源里没有对应的可编辑图表格式。
- 不选全页图片作为产品默认：它会丢掉文字结构。也不再“遇到任何不支持就整份拒绝”：几乎每份真实 deck（包括自带示例）都有渐变、阴影、图标或嵌入，整份拒绝等于没有导出。选择逐元素图片化：能编辑的保持可编辑，不能的看起来一样，并逐个列出；只画盒子（`self`）让渐变卡片上的文字依旧可编辑。曾考虑“整页底图 + 原生文字”：实现简单、视觉稳，但形状和图片都被烤进底图，且后绘制的非文字元素会被文字压住，故不采用。图片化的隔离借 `visibility` 而不是删节点，布局不变；用整页复制再按 alpha 裁剪，变换、阴影、溢出都能落在正确位置。
- 表格样式的数据来源：样式只有 GUID 时 PowerPoint 用自己内置的定义，规范里没有这些定义。LibreOffice 的映射是手写近似，Apache POI 只覆盖一部分；pptx-ts（MIT）收录的是 PowerPoint 自己保存的 74 份 `a:tblStyle`，按色槽去重成 16 种结构，故采用它并生成数据文件（来源、提交与许可写在生成脚本、文件头和 NOTICE）。因此与 LibreOffice 渲染比较时，表格的差异多半来自 LibreOffice 自己的近似，看图以 PowerPoint 的定义为准。
- 图表默认值按 PowerPoint 而不是 LibreOffice：没有文本属性时用主题文字色，标题加粗；未写 `c:smooth` 的折线系列按平滑画（写出工具都会显式写 `val="0"`）；坐标轴未设线时画灰色轴线与刻度；`solidFill` 不带颜色表示自动。LibreOffice 画不了 chartex 和复合饼，只显示替代文字，这些页无法用图像差分评分，需看图。
- 入口使用 Import PowerPoint (.pptx)… / FileMenu；结果按“带进了什么、哪里变了、下一步拿什么”组织，英中说明配可下载来源和报告；失败定位到真实页，不每个对象弹 toast。现有 Launcher / Slides 自身设计板已反映入口与结果反馈。按 [UX 原则](./ux-principles.md) 保留明确作用域：导入新项目，不暗中改已开 deck；导出不写回源。

## 5. 未来提案（未实施，不扩大上述支持集合）

以下是后续方向，不是当前首版承诺：

- **向已开 deck 追加 PPTX**：必须先有真实批次可见性、并发合并、冲突安全 ID、失败回滚与撤销。当前页面发现规则会找回不在 order 的页面，独立页面写入再写索引不是原子事务。撤销应仅移除本批次，不覆盖他人的后续修改。
- **继续扩大导入映射**：非矩形图片遮罩、地图图表、真正的 3D 透视（现在 3D 图表画成平面并提醒）、项目符号字形（现在 `–` 等字符画成圆点）、3D 与发光/反射特效需逐项定义和测试。旧 `.ppt`、宏、加密包、动画和音视频不在当前支持中。图表若要可编辑，需要先有 slides 里的图表格式。
- **更多原生化**：只含旋转的 transform 可写成原生旋转；原生表格可再覆盖竖排文字（`vert`）、对角线和双线（PptxGenJS 4.0.1 写不出，需要 normalization 补写）；SVG 可附原生 SVG 图片；重绘的图表可写回原生图表对象。嵌入块是“导出那一刻”的画面，动画型嵌入没有确定静态时刻。
- **更强互操作与性能证据**：真实 Office 环境中的 CJK/混合 run、字体替代、换行和逐对象编辑；大型 deck 的耗时、内存与重复导出；未来追加的并发/撤销。资源上限不是性能承诺。能力扩展须同步技能、用户指南、自身设计板、矩阵和对应验证。

## 6. 参考

- [Microsoft PresentationML structure](https://learn.microsoft.com/en-us/office/open-xml/presentation/structure-of-a-presentationml-document)：slide、master、layout、theme、notes 经关系关联，单张 XML 不足以还原外观。
- [研究与候选比较](../.research/slides-pptx.md)、[验证证据](../.research/slides-pptx-verification.md)：历史观察与验证边界，不替代当前代码契约。
- [项目类型矩阵](./project-kinds.md)、[共用导出菜单](./export-menu.md)、[项目归档](./project-archive.md)、[导入当前项目](./import-into-project.md)。
