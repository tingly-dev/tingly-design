# 导出：在浏览器里做，不装东西

状态：**部分已实施**。动效在编辑器里导出视频已实施（§3）；其余类型的 PNG、PDF、PPTX 和共用的导出菜单是方案（§5）。调研和备选方案的比较见 `.research/export.md`，这里只记定下来的和还开着的。

## 1. 问题

动效的导出只有命令行：`scripts/motion-render.mjs` 要 Playwright 的 Chromium（约 150 MB）和 PATH 里的 ffmpeg，编辑器里没有按钮。别的类型各有各的下载代码（画布 PNG、幻灯片 HTML 和打印 PDF、文档 Markdown 和 HTML），没有共用的部件。要的是：多种格式、每种类型都能导出、本机不要装特殊的东西。

## 2. 决定

- **能在用户自己的浏览器里做的，就在浏览器里做。** 用户的浏览器已经装好了，没有安装、没有服务端、有进度和取消。
- **做成独立的包 `@dc/export`**，不依赖编辑器、服务端和 core，将来可以在别处复用和单独维护。它只管"怎么把东西变成文件"；"导出什么、从哪取帧"留给调用方。
- **服务端渲染保留**，只给命令行、CI 和浏览器画不准的作品（§4）。

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

## 4. 浏览器路线画不了什么

foreignObject 画不到：`<x-embed>`（单独的框架，会是空白）、`<video>` 层、WebGL 和 WebGPU 的 canvas 特效、个别 CSS（backdrop-filter、少数混合模式）。导出后编辑器会列出含 embed 的场景，并指给 `scripts/motion-render.mjs`。这是"诊断走真实路径"的最小版：提示在导出的结果上，不是事先拦下。

## 5. 没做的

- **共用的导出菜单**：每个类型的 `download()` 换成一份，格式按"想做什么"列，不可用的写原因和办法。
- **PNG** 给幻灯片、文档、看板、设计系统；**PDF** 一键（需要 `Page.printToPDF`，即有 Chrome 的一侧），现在是浏览器打印；**PPTX**（pptxgenjs，先一页一图）。
- **封面**：导出的视频还不把封面放在第一帧、也不单独出封面 PNG（命令行会）。
- **无头路线共用同一份帧循环**：让 `motion-render.mjs` 也跑这份代码，并优先用机器上已有的 Chrome 或 Edge，Playwright 的下载变成可选。
- **GIF**、**WebM 透明**、**Lottie / 动画 SVG**（见 [motion.md](./motion.md) §8）。
- **速度**：每帧克隆并序列化一遍 DOM，比 CDP 截图更慢是预期；缓存、只重画变化的层是可做的优化，没测。
- **两条路线逐帧对比的测试**（`motion-render.mjs --verify` 的指标）。
