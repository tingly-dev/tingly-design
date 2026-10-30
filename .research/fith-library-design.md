# fith 拆库设计报告

状态：**实施中**（YZ 2026-10-30 同意在 fith 仓库按本方案叠加 PR 推进；PR 均未合并，等 YZ）。
进度：阶段 0 和 A（#34）、B（#35）、C 和 D（#40–#43：跨文档、辅助模块、背景模块、`CaptureCtx` 与 walk/elements/box/text 四个模块，`captureScene` 2729→162 行）、E 的 `CaptureReport`（#44）、`rasterize` 带元素与原因和 `fonts` 由宿主提供（#45）、`idPrefix`（#46）已完成并有测试；每步 44 个固件的输出逐字节不变。未做：E 的包出口调整（Playwright 改可选依赖、子路径入口，有破坏性，等 YZ 确认）、`dom-raster.ts` 跨文档（fith#39）、Tingly Design 侧的适配层。过程中发现的问题：fith#36、#37、#39。依据：对 `YZYExp/fith`（包名 `fith`，v0.0.0）源码、DESIGN.md、docs/development-backlog.md、bench-log.md 的阅读，**没有构建或运行**；行数、数量为静态统计。配套评估见 `svg-export.md`。

## 1. 目标

把 fith 变成一个可被 Tingly Design（以及其他项目）直接依赖的库：

1. `captureElement(el, opts) → { svg, report }` 在浏览器里零依赖运行（不带 Node、Playwright、opentype）。
2. 输出可编辑的真矢量 SVG（文字保留 `<text>`，可选转路径）。
3. 捕获、发射、字体、栅格回退、后端各自独立，能单独测试，能按需加载。
4. 内部结构允许继续修保真缺口（backlog 的 P1/P2），而不是继续堆进一个大函数。

不做：改变现有输出（重构期间同一固件输出的 SVG 逐字节或像素差在阈值内一致）；新增 CSS 覆盖（另行排期）；扩展、Node 后端的功能变化。

## 2. 现状与问题（事实）

- 结构：`core/ir`（Scene 类型）→ `core/capture`（读 DOM）→ `core/emit`（Scene→SVG）→ `backends/{node,browser,extension}`。分层方向正确，`emit` 已是纯函数。
- **`core/capture/capture.ts` 2729 行，导出一个函数 `captureScene`**，内部约 96 个闭包函数共享状态（节点计数器、`nodes`/`groups`/`rasterTargets`、滚动与 `content-visibility` 的暂存与恢复），`as any` 约 50 处；多个运行选项（`captureScrollableContent`、`externalCss`、`rasterElements`、`unfurlScrollContainers`）不在 `CaptureOptions` 类型里，是 `(opts as any)` 读出来的。
- 之所以是一个函数：Node 后端 `page.evaluate(captureScene, …)` 要把函数序列化进页面，函数不能 import。浏览器库和扩展是直接 import（扩展用 esbuild 打 IIFE），所以这条限制只来自 Node 注入这一条路。
- 核心直接使用全局 `document`、`window`、`getComputedStyle`，所以只能捕获「当前页面」的元素；不能由编辑器页面去捕获另一个 iframe 里的元素。
- 字体收集（`collectFonts`，约 100 行）在捕获函数内部，靠 `document.styleSheets` 和 `fetch`；沙箱框架无网络时取不到字体。
- 包出口：`playwright` 是硬依赖；主入口是 Node 后端；浏览器入口为 `fith/browser`；outline 要调用方传入回调；`opentype.js` 在 emit 里。
- 栅格回退：浏览器入口只收 `rasterize(rect, scale)`，拿不到元素本身；库自带 `dom-raster.ts`（foreignObject）作兜底；失败时区域被**静默省略**。
- 已知保真缺口（backlog）：层叠上下文跨兄弟、父级透明度对重叠子节点的合成、栅格与矢量子节点重复绘制、复杂文字整形、SVG id 在多个克隆间冲突。

## 3. 目标结构

```
src/
  ir/            Scene 类型、Report 类型            （无运行时依赖）
  css/           纯解析：color, length, gradient, shadow, filter, transform,
                 background-layers, mask, clip-path   字符串 → 数据，不碰 DOM
  capture/
    context.ts   CaptureContext：win/doc、选项、nodes、groups、rasters、id 计数、report
    walk.ts      遍历与可见性、display:contents、shadow DOM
    order.ts     层叠上下文、绘制顺序
    paint/       box, text, list-marker, pseudo, native-controls, inline-svg, image, canvas
    unfurl.ts    滚动容器展开与恢复（成对的 apply/restore，finally 保证）
    fonts.ts     @font-face 收集；字体来源可替换（见 4.3）
    index.ts     captureScene(ctx) 调度，约几十行
  emit/          Scene → SVG（现有 svg.ts / defs.ts / primitives.ts）
  outline/       opentype 转路径（可选，单独入口）
  raster/        dom-raster 兜底（可选，单独入口）
  backends/
    browser/     captureElement / captureCurrentPage（默认入口）
    node/        Playwright、CLI、fontconfig、diff-patch
    extension/   MV3
  inject/        esbuild 产物：Node 后端注入页面的 IIFE
```

依赖方向：`ir ← css ← capture ← backends`，`emit` 只依赖 `ir`。lint 约束一条规则（类似 depcheck）：`css/`、`emit/` 不得引用 `document`/`window`，`capture/` 不得 import `backends/`。

## 4. 对外 API（拆库后的稳定面）

### 4.1 入口（package.json `exports`）

| 入口 | 内容 | 依赖 |
|---|---|---|
| `fith` | `captureElement`、`captureCurrentPage`、`emitSvg`、类型 | 无 |
| `fith/outline` | `createOutliner(fonts)` | opentype.js（可选 peer） |
| `fith/raster` | `createDomRasterizer()` | 无 |
| `fith/node` | `htmlToSvg`、`renderDetailed`、CLI | playwright（可选 peer） |

`htmlToSvg` 不再是主入口；主入口不拉起任何后端。

### 4.2 `captureElement(el, opts)`

```ts
interface CaptureOptions {
  fontMode?: 'embed' | 'outline' | 'none';     // 默认 'embed'
  fonts?: FontSource;                            // 4.3
  outline?: Outliner;                            // fontMode:'outline' 时
  rasterize?: (req: RasterRequest) => Promise<string | null>;   // 4.4
  idPrefix?: string;                             // 4.5
  viewportOnly?, unfurlScrollContainers?, deviceScaleFactor?, width?, height?
}
interface CaptureResult { svg: string; report: CaptureReport }  // 4.6
```

全部选项进入 `CaptureOptions` 类型，不再有 `(opts as any)`。`captureElement` 用 `el.ownerDocument.defaultView` 作为窗口，**不读全局**（见 5 阶段 C）。

### 4.3 字体来源可替换

`FontSource` 可以是：默认（读 `document.styleSheets` 并 `fetch`，现有行为）、调用方给定的字体列表 `[{family, weight, style, src: dataUrl, unicodeRange?}]`、或 `async resolve(family, weight, style, usedChars)`。用途：沙箱框架无网络时，宿主先取好字体（并按用到的字做子集）再传入；`outline` 在浏览器里直接用同一份字体字节，不依赖 fontconfig。

### 4.4 栅格回退拿到元素

`RasterRequest = { rect, scale, element, reason }`。`reason` 是现在已经计算出的原因（filter、3D、canvas、iframe …）。宿主可以对 `<iframe>`/`x-embed` 返回「框架自己交的图」；返回 `null` 则走 `fith/raster` 兜底（如果传了），再不行记入 report 的 `omitted`。

### 4.5 `idPrefix`

SVG 内部 id（clipPath、filter、gradient、pattern、mask）带前缀，多张 SVG 合进同一页面或 Figma 不冲突；内联 SVG 克隆时重写 id 及引用（backlog 的「SVG identifiers」项）。默认前缀为空，行为不变。

### 4.6 失败可见

```ts
interface CaptureReport {
  rasters: { reason: string; rect: Rect; selector: string; filled: 'host'|'dom'|'none' }[];
  omitted: { reason: string; selector: string }[];       // 画不了且无栅格
  fonts: { family: string; mode: 'embedded'|'outlined'|'referenced'|'missing' }[];
  warnings: string[];                                     // 跨域图读不到等
}
```

宿主据此在导出结果里点名「哪些区域变成了图片 / 被省略」，不再静默缺失。`reason` 是固定 id，文案由宿主写。

## 5. 迁移阶段（每阶段行为不变，可单独合并）

**验收基线（阶段 0，先做）**：为现有固件（`test/fixtures` 约 35 个）和 bench 语料生成「SVG 快照」：每个固件在固定 Chromium 下输出 SVG，保存归一化后的文本（id 归一）与「SVG 栅格化 vs 原页面」的像素差。之后每个阶段 PR 必须：快照文本不变，或变化经审阅并更新；像素差不得上升；`pnpm test` 全绿。

| 阶段 | 内容 | 风险 | 完成标准 |
|---|---|---|---|
| A | 构建：esbuild 把 `captureScene` 及其依赖打成 IIFE（`inject/`），Node 后端注入该产物而不是序列化函数。注意 esbuild 的 `keepNames`/`__name` 在注入页面时的行为要用固件验证 | 低 | 全部测试通过；capture.ts 仍可保持原样，只改注入方式 |
| B | 抽 `css/`：先搬纯解析函数（颜色、渐变、阴影、滤镜、变换、背景层、mask、clip-path、长度），每个配字符串级单元测试 | 低 | capture.ts 行数明显下降；新增单元测试覆盖这些函数的现有固件输入 |
| C | 引入 `CaptureContext`：把闭包状态（计数器、nodes、groups、rasters、暂存样式）收进去；`document`/`window`/`getComputedStyle` 全改走 `ctx.win`/`ctx.doc` | 中（改动面最大） | 同一固件在「当前页」和「另一个 iframe 里的元素」两种调用方式下输出一致 |
| D | 按职责拆 `capture/paint/*`、`order.ts`、`unfurl.ts`、`fonts.ts`；`captureScene` 只剩调度 | 中 | 无文件超过约 500 行；`as any` 清零或集中到一处类型守卫 |
| E | 出口与 API：重做 `exports`、`playwright` 与 `opentype.js` 改可选 peer、`FontSource`、`RasterRequest`、`idPrefix`、`CaptureReport`、`CaptureOptions` 类型完整 | 中（有破坏性变更，v0.x 内可接受） | 浏览器入口的打包体积与依赖清单有记录；类型测试通过 |
| F | 首个发布版本：包名与仓库名统一，README 以「库」为主，CHANGELOG | 低 | 能在空项目里 `npm i` 后在浏览器与 Node 各跑一个例子 |

阶段 A 单独就解除了「必须是单函数」的限制，所以 A 之后 B、C、D 可以并行给不同的人。E 的 API 先写成类型和文档，再实现。

## 6. 测试策略

- **单元**：`css/` 与 `emit/` 纯函数，字符串/数据进出。
- **固件快照**：阶段 0 的基线，守住行为不变。
- **像素回归**：沿用 `pnpm validate`（SVG 栅格化 vs 原页面），阈值沿用 `FH_THRESHOLD`。
- **跨文档**：新增固件——宿主页面 + 一个 iframe，从宿主调用 `captureElement(iframe 内元素)`，覆盖 `ctx.win`。
- **无依赖**：测试 `fith` 主入口的打包产物里不含 playwright、opentype。
- **失败可见**：固件里放 iframe、WebGL canvas、跨域图，断言 report 里有对应 `omitted`/`warnings`。

## 7. Tingly Design 对库的需求（拆库时要保住的接口）

1. 在编辑器页面里对离屏框架/画板框架内的元素调用 `captureElement`（`ctx.win`，阶段 C）。
2. 沙箱无网络：字体由宿主传入（4.3）。
3. `<x-embed>`、导入的画板、设计系统组件预览、WebGL 效果：栅格回调拿到元素，宿主返回框架交的图（4.4）。
4. 导出结果点名栅格/省略区域（4.6），写进我们已有的导出报告。
5. 一次导出多页（幻灯片每页、画布每个画板）合并或并排时 id 不冲突（4.5）。
6. 只在导出时动态加载，不进编辑器主包（`fith` 零依赖、`outline`/`raster` 分入口，有利于此）。
7. 许可：MPL-2.0，原样打包并在 `THIRD_PARTY_LICENSES.txt` 声明；我们的修改若针对 fith 的文件，应回到 fith 仓库。

## 8. 分工与节奏

- 在 fith 仓库做（合作伙伴可信、问题都可反馈）。我这边可以承担阶段 0、A、B（风险低、收益大、不改行为），每阶段一个 PR，附快照/像素对比结果。C 到 E 涉及 API 取舍，需要和 fith 的维护者对一次接口再动手。
- Tingly Design 侧在 E 之前不接入；E 之后再写 `@dc/svg` 适配层与各类型菜单项（见 `svg-export.md` §3）。如果要提前验证保真，可以用锁定 commit 的构建产物在样例项目上做一次小实验（需要放行安装与构建）。
- 粗估（我的估计）：0+A 约 2–3 天，B 约 3–5 天，C+D 约 1–2 周，E+F 约 1 周。主要不确定性在 C（全局改上下文）和 D 里层叠顺序与绘制函数之间的隐含耦合。

## 9. 需要你确认

1. 方案整体是否认可（尤其 §3 的目录和 §4 的 API 形状）。
2. 在 fith 仓库做：我需要对该仓库的写权限（目前只读克隆，且没有加入本项目的可推送仓库），以及是否由我提 PR 还是先给合作伙伴看设计。
3. 阶段顺序：是否先做 0 + A（最小、最安全）作为第一个 PR。
4. 包名：已定为 `fith`（项目、npm 包、命令统一）。
