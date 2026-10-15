# 导出：在浏览器里做，不装东西

状态：**部分已实施**。动效在编辑器里导出视频已实施，浏览器画不了的作品自动改走服务端（§3、§4）；其余类型的 PNG、PDF、PPTX 和共用的导出菜单是方案（§5）。调研和备选方案的比较见 `.research/export.md`，这里只记定下来的和还开着的。

## 1. 问题

动效的导出只有命令行：`scripts/motion-render.mjs` 要 Playwright 的 Chromium（约 150 MB）和 PATH 里的 ffmpeg，编辑器里没有按钮。别的类型各有各的下载代码（画布 PNG、幻灯片 HTML 和打印 PDF、文档 Markdown 和 HTML），没有共用的部件。要的是：多种格式、每种类型都能导出、本机不要装特殊的东西。

## 2. 决定

- **能在用户自己的浏览器里做的，就在浏览器里做。** 用户的浏览器已经装好了，没有安装、没有服务端、有进度和取消。
- **做成独立的包 `@dc/export`**，不依赖编辑器、服务端和 core，将来可以在别处复用和单独维护。它只管"怎么把东西变成文件"；"导出什么、从哪取帧"留给调用方。
- **服务端渲染保留，并且自动切换**：含浏览器画不了的东西（§4）的作品，编辑器自己改走服务端，不让人去选、也不让人去改用命令行（§4）。

选了而没选的：ffmpeg.wasm（WebCodecs 已经在编码，wasm 版更慢更重）、录屏（实时、要授权、不确定）、HTML-in-Canvas（仍是 Chrome 的试用特性，API 在 150 到 155 之间改过名，只预留换掉 `rasterize` 的位置）。

## 3. 包里有什么（已实施）

| 部分 | 做什么 |
|---|---|
| `rasterize(node, opts)` | 一棵 DOM 画成 canvas：放进 SVG foreignObject 让浏览器画（html-to-image） |
| `fontCss(sources, text)` | 把网页字体的 `@font-face` 连字体文件内联成 data URL，只取 `text` 用到的 unicode-range。foreignObject 里的图加载不了网络字体，不内联就是后备字体。要在有网络的一侧（编辑器）跑，沙箱框架没有网络 |
| `planVideo(...)` / `encodeVideo(...)` | 试编码器而不是看 User-Agent：H.264 + AAC 能编就写 MP4，否则写 WebM（VP9、AV1、VP8 + Opus），并带一个 `note` 说清为什么不是 MP4。帧由调用方画，WebCodecs 编码，Mediabunny 封装，全在内存里 |
| `mixAudio(clips, seconds)` | 把 `motion.json` 的音频按起点和增益混成一轨（OfflineAudioContext） |
| `encodeGif(...)` | 帧到 GIF（gifenc）。包里有，编辑器还没接 |
| `download(name, blob)` | 交给浏览器的保存对话框 |

依赖：Mediabunny（MPL-2.0，按文件的弱 copyleft，不改它就可以打进来，许可证文本随 bundle 的 `THIRD_PARTY_LICENSES.txt` 走）、html-to-image、gifenc（MIT）。包标了 `sideEffects: false`，编辑器只引用 `fontCss` 和 `download`，编码器不会进编辑器的主包。

### 动效怎么用它

编码器在沙箱的 `export.js` 里，第一次导出时才加载，播放器的 `motion.js` 不带它。流程：编辑器取字体和音频文件（沙箱没有网络），发 `export` 消息；沙箱里逐帧 `seek` 再 `rasterize` 舞台，交给 `encodeVideo`；进度回传，文件以 Blob 回传，编辑器下载。导出时播放器那一层要显示出来（隐藏的跨源框架浏览器可能不给它画帧），所以画面会在舞台上跑一遍，标签页要留在前台。导出完把播放头放回原处。

测出来的（容器里的 Chromium，没有 GPU）：1920×1080 约 4 帧/秒；开源 Chromium 编不了 H.264 和 AAC，只有 VP9、AV1、Opus，所以 MP4 要 Chrome、Edge 或 Safari；和 CDP 截图逐帧比，肉眼一致，差异是 VP9 压缩带来的。

## 4. 浏览器路线画不了什么，所以要有第二条路线

foreignObject 画不到：`<x-embed>`（单独的框架，会是空白）、`<video>` 层、WebGL 和 WebGPU 的 canvas 特效、个别 CSS（backdrop-filter、少数混合模式）。这些不能让人自己发现、自己换工具，所以导出前先看作品里有没有 embed 或 video（`exactScenes`），有就换路线。从画布导入的画板（`<x-embed src>`，[import-from-project.md](./import-from-project.md)）也是一个单独的框架，同样走这条路线；服务端渲染把场景用到的画板文件和画板运行时一起交给播放器。

**精确渲染（已实施）**：服务端用本机已有的 Chrome 或 Edge 逐帧截图，交给 ffmpeg 编码，和 `scripts/motion-render.mjs` 是同一个做法，只是不用 Playwright、也不下载浏览器：Chrome 用自带的调试管道（`--remote-debugging-pipe`，NUL 分隔的 JSON）驱动，Node 20 也不需要 WebSocket 库。接口 `POST /api/projects/:p/render` 回一串 JSON 行（进度，最后是文件名），关掉请求就停；成品从 `GET /api/projects/:p/render/:file` 取，只给 `renders/` 里的 MP4。`GET /api/render` 说本机有没有 Chrome 和 ffmpeg，编辑器据此选路线。

选路线（编辑器里）：没有 embed 和 video，走浏览器；有，而且本机两样都有，走服务端并告诉人为什么；有，但本机缺 Chrome 或 ffmpeg，仍走浏览器，导出后点名哪些场景会是空白、本机缺什么。服务端渲染不要求标签页留在前台，也不被浏览器能不能编 H.264 限制（总是 MP4），代价是慢和需要 ffmpeg。

试导出用 `projects/harness-motion`：两个场景共 2 秒，带淡入转场，不用网络字体，服务端路线约 5 秒出片；`design-motion` 有 36 秒，一次要等两分钟（服务端）到十分钟（标签页）。

## 5. 没做的

- **共用的导出菜单**：每个类型的 `download()` 换成一份，格式按"想做什么"列，不可用的写原因和办法。
- **PNG** 给幻灯片、文档、看板、设计系统；**PDF** 一键（需要 `Page.printToPDF`，即有 Chrome 的一侧），现在是浏览器打印；**PPTX**（pptxgenjs，先一页一图）。
- **封面**：导出的视频还不把封面放在第一帧、也不单独出封面 PNG（命令行会）。
- **命令行和服务端渲染合成一份**：现在 `motion-render.mjs`（Playwright，带封面、GIF、播放器、`--verify`）和 `apps/server/src/render.ts`（Chrome 调试管道，只出 MP4）各有一份截图循环，该合并，让命令行也不用 Playwright。
- **服务端渲染的封面**：同样不把封面放在第一帧。
- **GIF**、**WebM 透明**、**Lottie / 动画 SVG**（见 [motion.md](./motion.md) §8）。
- **速度**：每帧克隆并序列化一遍 DOM，比 CDP 截图更慢是预期；缓存、只重画变化的层是可做的优化，没测。
- **两条路线逐帧对比的测试**（`motion-render.mjs --verify` 的指标）。
