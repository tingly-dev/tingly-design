# 动效（motion）能不能搬到 Go

状态：**研究**，只做盘点，不改代码，也没有移植。背景是 [server-runtime.md](./server-runtime.md) §10 的"团队统一到 Go"；文档类型的移植验证见 [docs-go.md](./docs-go.md)，画布和幻灯片的解析见 [parse5.md](./parse5.md)。动效本身的设计见 [../.design/motion.md](../.design/motion.md)。

问题：动效是最复杂的类型，大家直觉上觉得"后端改 Go"时它是重头戏。它的代码到底在哪跑、每一段谁调用、哪些能换成 Go、换了能得到什么？

结论先说：**动效的难点几乎全在浏览器里，不在服务端。** 时间轴和画面由浏览器的 Web Animations 引擎算，Go 算不了也不该算；场景文件的回写走的是幻灯片那条 HTML 回写路径，和 parse5.md 是同一个问题。真正能交给 Go 的只有三块：存文件、导出视频时的调度、以及（已经在服务端的）模型调用。所以动效不是"后端改 Go"的重头戏，反而是改动最小的类型之一；它对 Go 方案的意义在于导出（§4）。

下面凡是"实测"的是读代码或跑过的，"推断"的是没有验证的判断。

## 1. 动效的代码有四块

| 代码 | 行数 | 在哪跑 | 做什么 |
|---|---|---|---|
| `packages/core/src/motion.ts` | 714 | 浏览器（编辑器、沙箱），服务端只用很少几个函数 | motion.json 的读写、时间写法解析、场景计时、各尺寸的样式覆盖、检查 |
| `packages/sandbox/src/sceneAnim.ts` | 111 | 浏览器（沙箱 iframe、导出页） | 把一个场景的计时属性编成暂停的 Web Animations，按时间拨动 |
| `packages/sandbox/src/motion.ts` | 348 | 浏览器（沙箱 iframe、导出页） | 播放器：挂载场景、转场、跳转、封面 |
| `scripts/motion-render.mjs` | 304 | Node（命令行） | 导出：起 Chromium，逐帧截图，交给 ffmpeg 出 MP4、封面、GIF |

编辑器里另有 `apps/editor/src/motion.ts`（175 行）和 `components/motion/`（约 780 行），都是界面。（实测）

## 2. core 的每个函数谁在用（实测，按 import 统计）

| 调用方 | 函数 |
|---|---|
| 沙箱（播放器、导出页） | `speedOf` `parseTime` `planScene` `countText` `easeProgress` `attrsForFormat` `motionTimeline` `sceneBaseCss` |
| 编辑器 | `sceneFile` `sceneIdOf` `parseMotion` `primaryFormat` `parseTime` `formatTime` `editsForFormat` `styleInFormat` `sceneTiming` `motionTimeline` `checkScene` `sceneVisibility` `speedOf` |
| 服务端 | `isMotionFile` `newMotion` `sceneFile` |
| 只在模块内部 | `parseCover` `easingOf` `parseAnim` `parseKeys` `countParts` `setOverride` `mergeStyle` `parseTransition` |

服务端只用三个函数：认出动效文件、建新项目时写起始内容、拼场景路径。这三个在 Go 里各是几行。core 的其余部分（时间解析、计时、尺寸覆盖）服务于预览和编辑，必须在浏览器里跑。

## 3. 一帧是怎么画出来的

容易误解的一点是"每一帧都要算一遍动画"。实际不是（实测，`sceneAnim.ts`）：

| 时机 | 做的事 | 谁算 |
|---|---|---|
| 场景挂载时，一次 | `planScene` 读 `data-in` / `data-out` / `data-keys`，`animateScene` 编成暂停的 `element.animate(...)` | core（JS） |
| 每一帧 | `setTime` 把每个动画的 `currentTime` 拨到目标时刻 | 浏览器动画引擎插值 |
| 每一帧 | 数字滚动：`countText` + `easeProgress` 算出当前显示的文字 | core（JS），很小 |
| 每一帧 | 嵌入的子页面经 `SEEK_BRIDGE` 同步时间 | 浏览器 |
| 每一帧 | 布局、合成、光栅化 | 浏览器 |

所以插值、缓动、变换、布局、字体都在浏览器引擎里。Go 没有这个引擎，在 Go 里重写时间轴等于重写一个浏览器的动画和排版子系统；而导出靠的正是"预览就是导出"（同一个运行时、同一个引擎），换引擎就丢了这个保证。**动效的时间轴和画面留在 JS + 浏览器，这一点不随服务端语言变。**（推断，但理由是结构性的）

## 4. 导出：唯一值得用 Go 重写的部分

`motion-render.mjs` 做的事（实测）：

1. 拼一张页面：内嵌 `packages/sandbox/dist/motion.js` 和全部场景，`window.dcMotion.mount` 挂上。
2. 用 playwright-core 起 Chromium（`DC_CHROME` 或 `PLAYWRIGHT_BROWSERS_PATH` 里的）。
3. 每帧：`page.evaluate` 调 `window.__stage.seek(t)`，再用 CDP `Page.captureScreenshot` 截 PNG。
4. 把 PNG 流管道给 ffmpeg 出 MP4；另出封面 PNG 和 GIF。
5. `--verify`：倒着再拨一遍，比对截图，检查拨动是确定的。

这一层只是调度：它不懂场景格式，画面全由页面里的 JS 运行时出。换成 Go 的对应关系（推断，未验证）：

| 现在 | Go |
|---|---|
| playwright-core | chromedp 或 rod（都直接说 CDP，`Page.captureScreenshot` 原样可用） |
| `child_process.spawn('ffmpeg')` | `os/exec`，管道写 PNG |
| 页面拼装 | `html/template` 或字符串拼接，内嵌同一个 `motion.js` |
| Chromium、ffmpeg 的来源 | 不变：首次导出时下载，或用宿主已有的 |

这一步换了能得到的是：导出不再需要 Node，桌面端和 TB 里可以由 Go 宿主直接起导出任务、报进度、可取消。代价约是 300 行 Go，外加 chromedp 的依赖。浏览器和 ffmpeg 两个大件无论哪种语言都要带，所以安装体积几乎不变。

## 5. 编辑器保存场景：走幻灯片的 HTML 回写

场景文件是幻灯片子集的 HTML。编辑器改场景（拖动、改样式、插图片，例如 `apps/editor/src/motion.ts` 的 `placeOnScene` 调 `insertHtml`）走的是 `parse.ts` / `copy.ts` 那条 DcDoc 回写路径，和幻灯片、画布共用（实测）。尺寸覆盖（`data-<format>`）由 `editsForFormat` / `styleInFormat` 换算成普通的属性改动，最后也落到这条路径上。

所以"动效的回写能不能搬到 Go"其实就是"HTML 回写能不能搬到 Go"，答案和风险都在 [parse5.md](./parse5.md)，这里不重复。动效自己多出来的只有 motion.json（普通 JSON，读写顺序要保持，docs-go 的有序 JSON 已经解决）和时间写法的解析（`parseTime` / `formatTime`，几十行，容易逐字节对齐）。

## 6. vgpu

`vgpu/node`（Dawn 的 Node 绑定）会是唯一的 Node 原生依赖。主干代码还没有引用它（实测，全仓 grep）；动效的着色器效果正在另一个尚未合并的改动里试，用 vgpu 离屏渲染、浏览器里用 WebGL2。如果以后用 GPU 离屏渲染替代"截图 + ffmpeg"，Go 侧对应的是 Dawn 的 C API 经 cgo，或 wgpu-native；这会带来 cgo 和逐平台构建，和"Go 单文件"的初衷相冲。在它从研究变成需要之前，不值得为它定方向。（推断）

## 7. 拆开看：动效哪些跟着服务端语言走

| 部分 | 现在 | 后端改 Go 之后 | 理由 |
|---|---|---|---|
| 时间轴、插值、画面 | 浏览器 | 浏览器 | 依赖浏览器动画和排版引擎；预览即导出 |
| 播放器、`sceneAnim.ts` | 浏览器 | 浏览器 | 同上 |
| core 的计时、尺寸覆盖、检查 | 浏览器 | 浏览器 | 服务于编辑和预览 |
| 场景 HTML 的回写 | 浏览器（DcDoc） | 见 parse5.md | 和幻灯片同一个问题 |
| 存文件、版本、SSE | Node | Go | 不懂格式 |
| 新建项目的起始内容 | Node（`newMotion`） | Go，或由前端生成后写入 | 几行 |
| 导出调度 | Node（playwright） | Go（chromedp） | 只是调度，见 §4 |
| 模型调用、Claude Code 委托 | Node | Go | 不懂格式 |

## 8. 开放问题

- chromedp 的截图在高帧率、大尺寸下和 playwright 的速度是否一致，没有测。值得做一个只导出现有示例项目的小验证，用 `--verify` 的同一套比对检查两边逐帧一致。
- 导出是否应该放到用户本机的 Go 宿主，还是在 TB 里统一排队，取决于 server-runtime.md §10 的融合问题。
- 将来若做移动端，导出在手机上起不了 Chromium 和 ffmpeg，只能交给宿主（TB 或桌面端）或用 WebCodecs 在页面内编码；后者不经过任何服务端语言。
