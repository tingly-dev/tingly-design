# SVG 导出评估

状态：**研究**（只评估，未实施；候选库是 fith，等 YZ 决定）。

## 1. 现状

- 导出菜单是各类型唯一入口（`FileMenu`，`.design/export-menu.md`），CLI/MCP 的 `export --as` 用同一份列表（`apps/server/src/commands.ts` 的 `KIND_CLI.formats`）。加一个格式 = 各类型交一个 `ExportItem` + `KIND_CLI` 一行。
- 图片目前统一走 `@dc/export` 的 `rasterize`（html-to-image：DOM → SVG foreignObject → canvas → PNG）。**中间产物已经是 SVG，只是再被栅格化了。** 网页字体由编辑器用 `fontCss` 内联（沙箱框架无网络）。
- 各类型现状：

| 类型 | 现有导出 | 画面所在 | SVG 的难点 |
|---|---|---|---|
| 画布 | PDF、PNG、源文件 | 每个画板一个沙箱框架 | 最适合；`uploads/` 图片可读（connect-src 开了 `/api/`）；`<x-embed>` 导入的画板是单独框架 |
| 幻灯片 | PDF、PPTX、PNG、HTML | 离屏框架，1920×1080 | 一页一张 SVG；已有 `pptxCapture.ts` 测量布局，可复用 |
| 文档 | PDF、Word、MD、HTML、PNG | 离屏框架，高度随内容 | 长页面；可选中文字意义大 |
| 看板 | PNG | 沙箱框架 | 图表多是 canvas/SVG；动态数据，快照式 |
| 设计系统 | PNG | 编辑器页面 `.dsview` | 组件预览在沙箱 iframe 里，当前图里是空白 |
| 动效 | MP4/GIF/PNG/HTML | 沙箱舞台 | 当前帧可做；动画 SVG 另论 |

## 2. 需要回答的问题

1. **foreignObject 还是真矢量？** foreignObject 包 HTML：实现最便宜、与现 PNG 一致，但 Figma/Illustrator/Inkscape 多数不渲染，只有浏览器能开，价值有限。真矢量（文字转 `<text>`/路径、盒子转 `<rect>`、渐变/阴影/圆角/clip 映射）才是"SVG 导出"的实际价值（进设计稿、印刷、嵌网页）。
2. **字体**：真矢量下要么 `<text>` + 内联 `@font-face`（base64，只取用到的字；中文作品很大，复用 `fontCss` 的 `text=` 子集化），要么转路径（任何地方都对，但不可编辑、文件大）。建议默认保留 `<text>`+内联子集，提供"文字转路径"选项（折起来，符合 UX 原则 6）。
3. **图片**：`<img>`、背景图转 `<image href="data:…">`；`uploads/` 在沙箱里读得到，外网图取不到（与 PNG 同限制，错误要点出是哪张图）。大图内联会让文件很大，可考虑 zip（svg + 图片目录）作为后续。
4. **画不到的东西**（与 PNG 相同）：`<x-embed>`、`<video>`、WebGL/WebGPU canvas、backdrop-filter、混合模式。2D `<canvas>` 可转 `<image>`。SVG 里这些要么空白要么栅格化后嵌入，需在导出结果里**说明**，不静默丢。
5. **动画（动效）**：当前帧 SVG 与 PNG 同路。动画 SVG（SMIL/CSS）只对简单场景可行，`motion.md` §8 / `.research/export.md` 已列 Lottie/animated SVG 为 phase 2；建议本期不做，只做"播放头所在帧"。
6. **运行位置**：库若是纯 JS/DOM，放在沙箱里或编辑器离屏框架跑，与 `rasterize` 同位置，不依赖服务端和本机 Chrome；CLI 通过 `headless.ts` 自动得到。包边界：放 `@dc/export`（不依赖 editor/server/core）；`pnpm depcheck` 约束不变。
7. **许可证与体积**：待库确定后查（Mediabunny MPL-2.0 已有先例，进 `THIRD_PARTY_LICENSES.txt`）；只在导出时动态加载，不进主包（`sideEffects:false`，同 `export.js` 做法）。

## 3. 建议路线（待库确认后修订）

- 菜单：每类型在 PNG 项旁加一项"SVG"（画布：选中的画板 / 每个画板；幻灯片：这一页 / 每一页；文档：当前标签页；看板、设计系统：当前视图；动效：播放头所在帧）。命令行 `export --as svg`，`KIND_CLI.formats` 加 `svg`，`jobs` 与 `png` 一样。
- 画法共用 `imageExport.ts` 的一层（`nodeToSvg`），各类型只交"画哪棵 DOM"，与 PNG 共用同一批 `pick`。
- 不弹选项；字体子集内联、图片内联为默认。"文字转路径"作为后续的折起选项。
- 先做画布（价值最大、问题最少），再铺其余五类；每类验证：字体是否一致、图片是否在、画不到的东西有无提示。
- 同步：`.design/export-menu.md` 矩阵、`e2e/coverage.json`、`.design/project-kinds.md` 矩阵、两种语言的 i18n（`common`/export 区词条）、`docs/*/guide`；改 UI 需截图与 self-design 画布更新。

## 4. 评估库时要看的清单

| 项 | 问题 |
|---|---|
| 输出 | foreignObject 还是真矢量？文字是 `<text>` 还是路径？ |
| CSS 覆盖 | flex/grid、渐变、阴影、`clip-path`、`transform`、`mask`、`filter`、伪元素、`::before` 内容 |
| 字体 | 是否内联、是否子集化、中文大字体表现 |
| 图片 | data: 内联？跨域？`background-image`、`object-fit` |
| 运行环境 | 浏览器内/Node？能否在沙箱 iframe（无网络、CSP）里跑？ |
| 体积与许可 | 包大小、License、是否能动态加载 |
| 保真 | 用 `check --snapshots` 思路：同一页 PNG 与 SVG 栅格化像素差 |
| 失败方式 | 画不了时报错还是静默空白 |

## 5. 候选库 fith（YZYExp/fith，包名 fitting-html）

只读了 README、DESIGN、docs/bench-log、backlog 和 `src` 结构；**没有安装、构建或运行**，下面的保真数字都是它自己文档里的，不是我们的实测。

| 清单项 | fith |
|---|---|
| 输出 | **真矢量**。浏览器算布局，读几何和 computed style 进场景 IR，再发成 SVG：文字（逐行 `<text>`，含间距、装饰、省略号、渐变填充）、盒子、边框圆角、外阴影、线性渐变、内联 SVG、图片 `object-fit`、裁剪、不透明度、2D 变换。径向/锥形/多层渐变已用 `<pattern>`，filter 与 blend 已有 `<g filter>`，2D canvas 读出为 `<image>`，原生表单控件做成矢量 |
| 字体 | `embed`（`<text>` + 内联可读 `@font-face`）、`outline`（opentype.js 转路径，仅 Node 后端经 fontconfig；浏览器入口需调用方给 `outline` 回调）、`none`。正好对应 §2.2 的两种选择 |
| 图片 | 内联 data URI；读不到的图（跨域）退回栅格 |
| 画不了 | 栅格回退：iframe、video、WebGL、3D 变换、mask/clip-path、部分 filter/inset 阴影。浏览器库里栅格回退要调用方给 `rasterize(rect, scale)`，库自带一个 `dom-raster`（foreignObject，和我们现有 `rasterize` 同一思路）；不给就**省略**该区域 |
| 运行环境 | 三种：Node（Playwright）、**浏览器库** `fitting-html/browser`（只用 DOM API，`captureElement` / `captureCurrentPage`）、Chrome 扩展。核心不依赖 Node |
| 依赖与许可 | 运行时依赖只有 opentype.js（outline 用）和 playwright（仅 Node 后端）。**MPL-2.0**，与已在用的 Mediabunny 同类，可原样打包，须随 `THIRD_PARTY_LICENSES.txt` 声明；改它则那些文件需公开 |
| 保真 | 自带 Chromium 像素对比与 bench 语料（真实站点、ECharts、MUI、antd 例子）；README 明说「矢量优先不等于逐像素」。已知未解：兄弟间 stacking context、父级透明度合成、栅格与矢量子节点重复绘制、复杂文字整形（连字、双向文字） |
| 失败方式 | 栅格回退返回 null 就省略，不会报错；静默缺失，需要我们在结果里补提示 |

### 对 Tingly Design 的适配判断

- **适合**：画布、幻灯片、文档、设计系统、看板的静态快照。这几类的 HTML 是我们自己写的（flex/grid、渐变、圆角、阴影、文字），正是 fith 覆盖最好的那一类，输出可在 Figma/Illustrator 里打开。
- **跑在哪**：用浏览器库，放进现有的画板/离屏框架里调用，和 `rasterize` 同位置；CLI 经 `headless.ts` 自动获得。画布画板框架无网络，字体仍要编辑器先用 `fontCss` 内联，再交给 fith 读 `@font-face`；`outline` 模式在浏览器里要我们自己接 opentype.js 回调（字体字节我们已经有）。
- **要补的缝**：① 栅格回退用 fith 自带 `dom-raster` 还是我们的 `rasterize`/`FrameRasterizer`；② `<x-embed>`、导入的画板、设计系统组件预览、WebGL 效果是单独框架，fith 读不到，需要沿用 `snapFrames`（框架自己交一张图）再当 `<image>` 嵌入；③ 动效只导出播放头一帧，动画 SVG 不做；④ 失败要在导出结果里点名「哪些区域变成了图片 / 被省略」，与 PPTX 的报告同一做法（`.design/slides-pptx.md`）。
- **与现有 PPTX 的关系**：`pptxCapture.ts` 也是读真实布局，但目标是 PowerPoint 对象；fith 的场景 IR 与它是两套，不要合并，只共享「先测量、再发」的思路。
- **风险**：fith 是 0.0.0、单人项目，API 可能变；文字整形、stacking context 有已知缺口；我们要把它固定版本（vendor 或锁 commit），并在 `e2e` 加 `export_svg` 套件用样例项目做像素对比。

### 建议的验证步骤（决定后、动手前的小实验）

1. 在 `projects/` 的样例上各取一页（画布画板、幻灯片、文档标签、设计系统视图、看板），用 fith 浏览器库在真实 Chromium 里出 SVG，再用同一 Chromium 栅格化 SVG 与原页面比像素（fith 自带 `validate` 脚本可参考）。
2. 记录：像素差、栅格区域占比、文件大小（字体 embed vs outline）、耗时、被省略的东西。
3. 用 Figma 或 Inkscape 打开一份，确认「可编辑」目标成立。
这一步需要在本环境构建 fith，需 YZ 同意我安装并运行它。

## 6. 未决

- 目标是「设计稿里可编辑」还是「浏览器能开即可」（决定 fith 的 outline 与否、是否值得做）。
- 是否同意我安装并构建 fith 做 §5 的小实验。
- 文字默认保留 `<text>`（可选中、文件小）还是转路径（任何地方一致）。
- 菜单项叫「SVG」，每类型放在 PNG 旁，是否认可。
