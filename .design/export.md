# 导出：在浏览器里做，不装东西

状态：**部分已实施**。动效在编辑器里导出视频已实施，浏览器画不了的作品自动改走服务端，本机没有时由嵌入内容自己交出画面（§3、§4）；其余类型的 PNG、PDF、PPTX 和共用的导出菜单是方案（§5）。调研和备选方案的比较见 `.research/export.md`，这里只记定下来的和还开着的。

## 1. 问题

（历史基线）动效的导出只有命令行：`scripts/motion-render.mjs` 要 Playwright 的 Chromium（约 150 MB）和 PATH 里的 ffmpeg，编辑器里没有按钮。别的类型各有各的下载代码（画布 PNG、幻灯片 HTML 和打印 PDF、文档 Markdown 和 HTML），没有共用的部件。要的是：多种格式、每种类型都能导出、本机不要装特殊的东西。

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
| `planVideo(...)` / `encodeVideo(...)` | 试编码器而不是看 User-Agent：H.264 + AAC 能编就写 MP4，否则写 WebM（VP9、AV1、VP8 + Opus），并带一个 `note` 说清为什么不是 MP4。视频一律带音轨：没有声音的作品写一条等长的静音轨（浏览器路线按秒分块喂给 AudioBufferSource；服务端路线用 ffmpeg 的 `anullsrc`），因为有的平台拒收没有音轨的文件。没做成开关：没有音轨从来不是谁想要的结果，多出来的只是几 KB；AAC 编不了时和有声作品一样退到 WebM + Opus。GIF 不受影响。帧由调用方画，WebCodecs 编码，Mediabunny 封装，全在内存里 |
| `mixAudio(clips, seconds)` | 把 `motion.json` 的音频按起点和增益混成一轨（OfflineAudioContext） |
| `encodeGif(...)` | 帧到 GIF（gifenc），编辑器的浏览器路线用它；服务端路线由 ffmpeg 写（见 [export-menu.md](./export-menu.md) §4） |
| `download(name, blob)` | 交给浏览器的保存对话框 |

依赖：Mediabunny（MPL-2.0，按文件的弱 copyleft，不改它就可以打进来，许可证文本随 bundle 的 `THIRD_PARTY_LICENSES.txt` 走）、html-to-image、gifenc（MIT）。包标了 `sideEffects: false`，编辑器只引用 `fontCss` 和 `download`，编码器不会进编辑器的主包。

### 动效怎么用它

编码器在沙箱的 `export.js` 里，第一次导出时才加载，播放器的 `motion.js` 不带它。流程：编辑器取字体和音频文件（沙箱没有网络），发 `export` 消息；沙箱里逐帧 `seek` 再 `rasterize` 舞台，交给 `encodeVideo`；进度回传，文件以 Blob 回传，编辑器下载。导出时播放器那一层要显示出来（隐藏的跨源框架浏览器可能不给它画帧），所以画面会在舞台上跑一遍，标签页要留在前台。导出完把播放头放回原处。

开源 Chromium 编不了 H.264 和 AAC，只有 VP9、AV1、Opus，所以 MP4 要 Chrome、Edge 或 Safari；和 CDP 截图逐帧比，肉眼一致，差异是 VP9 压缩带来的。

## 3.1 速度，以及怎么知道慢在哪

问题：1920×1080 约 4 帧/秒，而且人看不到慢在哪、走了哪条路线。

**先量。** 一个计时器 `Clock`（`@dc/export/timing`，纯数据，能随 postMessage 和 JSON 行走）给每个阶段记总时间和次数：`audio`、`seek`、`snapshot`（复制页面）、`decode`（等浏览器把图画出来）、`encode`（等编码器）、`finish`；服务端路线是 `launch`、`seek`、`capture`（截图）、`write`（等 ffmpeg）、`finish`。阶段是固定的 id，编辑器负责措辞，core 不带文案。每次导出结束得到一份 `ExportReport`（路线、总耗时、帧数、实际帧率、各阶段）。

量出来的（容器里的 Chromium，没有 GPU，1080p，60 个节点的场景）：

| 路线 | 做法 | 每帧 | 大头 |
|---|---|---|---|
| 浏览器，原来 | html-to-image 逐帧 | 约 120 ms | 复制页面 66%，等图画出来 20% |
| 浏览器，现在 | 逐帧拷贝 + 流水线 | 约 25 ms（40 帧/秒） | 复制页面 53%，其余被流水线盖住 |
| 服务端 | Chrome 逐帧截图 + ffmpeg | 约 105 ms（9 帧/秒） | 截图 67% |

**浏览器路线慢在复制页面，不在编码。** Chrome 的 `getComputedStyle().cssText` 是空的，html-to-image 于是对每个节点把约 400 个属性逐个读出来、逐个写回去（每个属性还要查一遍原型链判断是不是 iframe），一个节点要一毫秒多。选择：

- 不改 html-to-image，写自己的 `FrameRasterizer`（`packages/export/src/frames.ts`）：只写与"同一个标签在空白页里"不同的样式；继承来的属性只在与父节点不同、或这个标签自己的默认规则会盖掉它时才写；`width`、`height`、`transform-origin` 这类取决于所在盒子的值永远写。动画、过渡、指针、滚动一类属性不写，样式表和脚本不带（带上 `@keyframes` 的话，图里的动画会重新跑一遍）。空白页的样式放在一个 shadow tree 里读（沙箱页读不进 iframe）。图片只取一次，换成 data: URL 记着；没用到的 `@font-face` 不放进每一帧。
- 原来的 `rasterize` 留给单张图（画布、幻灯片、文档的 PNG）：一次性的，不值得冒回归的险。
- 结果比原来更准：同一时刻和页面真实截图比，差异像素 0 到 0.5%，原来是 0.1 到 1.5%（html-to-image 会把小数字号向下取整再减 0.1px）。剩下的是动画中途的亚像素位移。
- blob URL 做图更快，但 Chrome 把它画出来的 canvas 标为被污染，编码器读不了，所以仍用 data URL。
- 流水线：`prepareFrame` 只做必须让页面停住的事（seek 加复制），返回的帧自己解码；下一帧复制时，浏览器在解码上一帧、编码器在吃再上一帧，一帧的耗时是三者中最长的，不是三者的和。`VideoSample` 在 `add()` 返回前已经拿到 canvas 的副本，所以可以立刻画下一帧。

**服务端路线慢在截图，不在 ffmpeg**：软件渲染的 Chrome 每帧截图约 70 ms，PNG 换 JPEG 不变，说明耗时在合成而不在编码。有 GPU 的机器会好很多；没有 GPU 的机器，浏览器路线现在更快，所以只有含 embed、视频、WebGL 的作品才走服务端。

**怎么看见**：进度按钮显示百分比、实时帧率和剩余秒数，悬停说明在哪里画；保存后的提示说明走了哪条路线、花了多久、最耗时的是哪一步；服务端日志有 `render.start`（为什么走服务端）、`render.done`（服务端路线的各阶段）和 `export.done`（浏览器路线的各阶段，编辑器导出完成后报给服务端），每行一份 `*_ms`。

没做、仍开着：服务端路线可以不截图，改成让 Chrome 逐帧吐像素；浏览器路线里 `seek` 在很短的作品上占比高，是首帧的字体和布局，没细查；视频层仍要走服务端；有了框架交画面，服务端是否还该是含 embed 作品的默认，要等有 GPU 的机器上的数字；幻灯片 PNG 和启动页缩略图还没接上 `snapFrames`。

## 4. 浏览器路线画不了什么，所以要有第二条路线

foreignObject 画不到：`<x-embed>`（单独的框架，父页面拍不进去，也读不了沙箱里的内容）、`<video>` 层、个别 CSS（backdrop-filter、少数混合模式）。页面自己的 `<canvas>` 能拍（转成图片放进副本）。这些不能让人自己发现、自己换工具，所以导出前先看作品里有没有 embed 或 video（`exactScenes`），有而且本机有 Chrome 和 ffmpeg 就换路线。从画布导入的画板（`<x-embed src>`，[import-from-project.md](./import-from-project.md)）也是一个单独的框架，同样走这条路线；服务端渲染把场景用到的画板文件和画板运行时一起交给播放器。

**嵌入内容自己交出画面（已实施）**：本机没有 Chrome 或 ffmpeg 时，embed 不再是空白。拍每一帧之前，页面问屏幕上的每个 embed 框架要一张它自己的图（`snapFrames`，`packages/export/src/frameSnap.ts`）：

```
页面 → 框架   { dcSnap: 'take', n }
框架 → 页面   { dcSnap: 'taken', n, url }   // data:image/… ；拍不了就没有 url
```

框架里用同一个 `FrameRasterizer` 拍自己的 DOM（不含 canvas），再把 canvas（着色器的 WebGL）直接 `drawImage` 上去；只有一块 canvas 的框架不走 foreignObject。图不透明时交 JPEG（q 0.92），有透明时交 PNG，先在 48×27 的小图上看。页面拍副本时把这个 iframe 换成一张同样样式的 `<img>`（`FrameRasterizer.begin(node, frames)`），层次和裁切都照旧。答话的脚本是 `answerSnaps()`：画板运行时（`runtime.js`）启动时装上；内联 embed 的页面（编辑器的 `embed.html`、播放器的 srcdoc 头）由构建写进去（`snapEntry.ts` → `__DC_SNAP__`，约 9 KB）。

- 为什么是框架自己拍：父页面拿不到沙箱框架的 DOM，这是隔离的本意；把画板挂进父页面（shadow root）能拍，但它的脚本就跑在编辑器里了，着色器也照样拍不到；屏幕录制要授权、不能逐帧确定。框架自己拍，出来的只有像素，沙箱和 CSP 都不变。
- 安全上守两条：页面只认 `e.source` 是那个框架、`url` 是 `data:image/` 的回话；框架不回话（没有 `answerSnaps`、出错）就等到超时，那一处留空并在提示里点名场景，导出不卡住。框架里要的图片和字体由页面事先内联，框架不为这件事开网络。
- 只问在这一刻屏幕上的场景里的框架（场景的开始到它转场结束）；播放器把所有场景的框架都挂着。
- 代价：1080p、无 GPU 的机器上每帧约 180–270 ms，服务端截屏约 110–180 ms，同一个量级；保真度和服务端截屏一致（平均差不到 1/255）。慢在框架里的 foreignObject 和交图的编解码；朴素地交位图再让页面转 PNG 要 530–760 ms。实测见 `.research/embed-render.md` §5。
- 着色器的 WebGL 要能在画完之后读回：`preserveDrawingBuffer: true`（示例都这样写），否则拍到的是空缓冲。
- 动效的"保存当前帧为 PNG"（`exportFrame`）走同一个做法，也画得出 embed。

编辑器的 `embed.html` 和播放器的 srcdoc 头写同样的页面样式（`html,body` 铺满嵌入块）。浏览器导出拍的就是编辑器里看到的，两边一不一致，同一个 `height:100%` 的内联 embed 就会在编辑器里零高、在服务端渲染里铺满。

**精确渲染（已实施）**：服务端用本机已有的 Chrome 或 Edge 逐帧截图，交给 ffmpeg 编码，和 `scripts/motion-render.mjs` 是同一个做法，只是不用 Playwright、也不下载浏览器：Chrome 用自带的调试管道（`--remote-debugging-pipe`，NUL 分隔的 JSON）驱动，Node 20 也不需要 WebSocket 库。接口 `POST /api/projects/:p/render` 回一串 JSON 行（进度，最后是文件名），关掉请求就停；成品从 `GET /api/projects/:p/render/:file` 取，只给 `renders/` 里的 MP4。`GET /api/render` 说本机有没有 Chrome 和 ffmpeg，编辑器据此选路线。

选路线（编辑器里）：没有 embed 和 video，走浏览器；有，而且本机两样都有，走服务端并告诉人为什么（稍快，MP4 不受浏览器编码器限制）；有，但本机缺 Chrome 或 ffmpeg，仍走浏览器，embed 由框架交出画面，只有没交出画面的场景在导出后点名；视频层在浏览器里仍不逐帧对齐。服务端渲染不要求标签页留在前台，也不被浏览器能不能编 H.264 限制（总是 MP4），代价是慢和需要 ffmpeg。

试导出用 `projects/harness-motion`：两个场景共 2 秒，带淡入转场，不用网络字体，服务端路线约 5 秒出片；`design-motion` 有 36 秒，一次要等两分钟（服务端）到十分钟（标签页）。

## 5. 没做的

- **PPTX**（pptxgenjs，先一页一图）。共用的导出菜单、PNG、一键 PDF 和视频选项见 [export-menu.md](./export-menu.md)。
- **封面**：导出的视频第一帧是封面（`coverFirstFrame` 不为 false，MP4 和 WebM；GIF 循环播放，不放），“封面图片”存封面 PNG，和命令行一致。封面场景在同一个框架里临时挂在视野外、画到结束再拿掉；封面图也写进文件做封面图片（MP4 和 WebM，两条路都写：服务端用 ffmpeg 的附加图片流，浏览器用封装器的元数据图片），因为只靠第一帧只对取第 0 帧的软件有用，文件管理器和播放器读的是内嵌图片。
- **命令行和服务端渲染合成一份**：已做。`render.ts` 出 MP4、GIF、封面 PNG（封面作第一帧并附进 MP4），命令行 `tingly-design export`（[cli.md](./cli.md)）和主页、README 的脚本都用它，不再要 Playwright。原来的 `scripts/motion-render.mjs` 已删掉：单文件播放器成了 `export --as html`，`--scale` 成了 `export --scale`，`--verify` 成了 `check --snapshots` 里的 seek 检查（16 帧顺着 seek 再倒着 seek，逐像素比；只差抗锯齿那几个像素算一致）。
- **服务端渲染的封面**：同样不把封面放在第一帧。
- **WebM 透明**、**Lottie / 动画 SVG**（见 [motion.md](./motion.md) §8）。GIF 已能在编辑器里导出（[export-menu.md](./export-menu.md) §4）。
- **两条路线逐帧对比的测试**（浏览器路线和 `render.ts` 同一帧比像素；seek 检查只比 `render.ts` 自己）。
