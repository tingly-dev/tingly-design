# Embed 的渲染：哪里要过后端，能不能不过

状态：**研究**。延伸自 #53（项目之间互相引用）：引用落地时最常见的形状就是一个 `<x-embed>`，所以先回答"embed 现在怎么画、是不是必须过后端"。和 #107（编辑器和渲染器各有一套 embed 宿主）是同一块代码。原型在 `.research/embed-render/spike-frame-snapshot.mjs`。

## 1. 现在的两种 embed

| 写法 | 是什么 | 在哪画 |
|---|---|---|
| `<x-embed>…</x-embed>`（无 `src`） | 一段内联小网页，动效里的着色器特效也是它 | `embed.html` 里的沙箱 iframe（`packages/sandbox/src/slide.tsx:39` `XEmbed`；播放器 `packages/sandbox/src/motion.ts:152-205`） |
| `<x-embed src="uploads/…/X.dc.html" data-props>` | 从画布导入的画板（复制进来，不是引用） | 画板运行时在自己的沙箱 iframe 里画（`slide.tsx:87` `XBoard`；播放器 `motion.ts:357` `mountBoard`） |

两种都是 **`sandbox="allow-scripts"` 的 iframe**（`slide.tsx:70`、`:160`），不透明源，没有网络。这是隔离的来源，也是导出难的来源。

## 2. 结论：显示不过后端，"把 embed 变成像素"才过后端

| 场景 | 过后端吗 | 依据 |
|---|---|---|
| 编辑器里编辑、预览、放映（幻灯片和动效舞台） | **不过**。iframe 在浏览器里跑；服务端只是把 `runtime.js` / `embed.html` 当静态文件发出来（`apps/server/src/index.ts:751-757`），和编辑器其他文件一样 | `slide.tsx:113` |
| 幻灯片导出单文件 HTML | **不过**。运行时正文内联进页面一次（`#dc-boards`），每个 embed 由页面脚本建 iframe | `apps/editor/src/components/slides/exportDeck.tsx:88-130` |
| 动效导出单文件播放器 | **不过**（`boardRuntime: {inline}`） | `motion.ts:383` |
| 幻灯片 / 文档 PDF | 有 Chrome 时走服务端打印，没有就退回浏览器打印对话框；两条路都是真浏览器，iframe 画得出 | `apps/editor/src/pdfExport.ts:1-14` |
| **动效导出视频 / GIF** | **含 embed 的作品必须过后端**（本机 Chrome + ffmpeg）。没有就仍走浏览器，导出后点名哪些场景是空白 | `apps/editor/src/motionExport.ts:27-32` `exactScenes`；`MotionApp.tsx:286-287`；服务端 `index.ts:652` `/render`、`render.ts:207-214` |
| 幻灯片 PNG、动效"当前帧存 PNG"、启动页缩略图 | 不过后端，但 **embed 是空白** | `.design/import-from-project.md` §5 |

所以"必须过后端"只发生在**把整页栅格化**的时候。原因只有一个：浏览器路线用 SVG `foreignObject` 拍 DOM（`packages/export/src/frames.ts:137`），而 `foreignObject` 画不了 iframe，复制树时 iframe 直接被跳过（`frames.ts:160`）。父页面又进不去不透明源的 iframe 去读它的 DOM。后端 Chrome 的做法是整页截屏，绕开了这一点，代价是要装 Chrome 和 ffmpeg、而且慢（`.design/export.md` 58 行）。

## 3. 不过后端的办法

### A. 帧自己拍自己，把像素交出来（推荐）

父页面拍到 iframe 时，不去读它，而是发一句"拍一张"：

```
父 → 帧   {dcMotion:'snap', n, w, h}
帧 → 父   {dcMotion:'snapped', n, bitmap}   // ImageBitmap，transfer，不拷贝
```

帧里用和父页面同一套办法拍自己：DOM 走 `foreignObject`，`<canvas>`（2D 和 WebGL）直接 `drawImage`，合成后 `transferToImageBitmap()` 交回。父页面复制树时把这个 iframe 换成一张 `<img>`（或者合成阶段直接画到对应的框里），和现在处理 `<canvas>` / `<video>` 的方式一样（`frames.ts:150-151`）。

已验证（Chromium，`spike-frame-snapshot.mjs`）：`sandbox="allow-scripts"` 的 srcdoc 帧，`origin` 为 `null`；帧里的 DOM、2D canvas、WebGL canvas 都拍得到，交给父页面后父页面的 canvas **没有被污染**（`getImageData` / `toDataURL` 正常），四块颜色逐像素对。

它好在：

- 一个协议治好所有"embed 是空白"的地方：动效视频/GIF、幻灯片 PNG、当前帧 PNG、启动页缩略图。
- 和现在的 seek 握手（`seek` → `seeked`）同形，动效逐帧确定性不变：先 seek，等 seeked，再 snap。
- 隔离不变：帧仍是不透明源、无网络，交出来的只是像素。
- 服务端渲染降成"可选的快路"或"校验路"，不再是唯一能导出 embed 的路。

要做 / 要量的：

- 画板运行时和 `embed.html` 要带一份栅格化代码。`@dc/export` 不依赖编辑器（`CLAUDE.md` 布局一节），可以直接打进 sandbox 的 IIFE，体积待量。
- 每帧多一次 `foreignObject` 解码。一个全屏会动的画板约等于再拍一页，视频导出时间大致翻倍于该场景；可以按 embed 的大小只拍它的框。
- WebGL 没开 `preserveDrawingBuffer` 时，要在画完的同一个任务里拍（snap 跟在 seek 的绘制后面），否则读到空的缓冲。着色器运行时是我们自己的（`.design/motion-effects.md`），可以直接开。
- 帧里的图片和字体要内联成 data: URL 才拍得到；导出的单文件已经内联，编辑器里靠服务端的 CORS（`index.ts:453`）。
- Safari / Firefox 对 `foreignObject` 的污染规则不同，原型只跑了 Chromium；而浏览器路线本来就以 Chromium 为主（WebCodecs）。
- 帧里再嵌帧（画板里放 embed）要递归：帧对自己的子帧做同一件事。

### B. 导出时不用 iframe，把画板直接画进父页面

导出那一刻把画板运行时挂到父页面的 shadow root 里，`foreignObject` 就能拍到。问题是画板的脚本会跑在编辑器页面里，丢掉沙箱隔离和 CSP；着色器 embed 照样画不了（还是 WebGL canvas，需要另一套）。**不推荐**。

### C. 屏幕/元素捕获（`getDisplayMedia`、Region/Element Capture）

要人点授权、只能实时录、拿不到逐帧确定的画面，和"导出可以倒着 seek 也逐字节相同"冲突。**不推荐**。

### D. 维持现状，只把后端渲染做稳

即 #107 的方向：编辑器和渲染器共用一个 embed 宿主、空白时报错。它解决"两条路不一致"，不解决"没装 Chrome/ffmpeg 就导不出 embed"。和 A 不冲突：A 落地后 #107 的第 1、3、4 条仍然值得做，而且宿主统一后 `snap` 只需写一次。

## 4. 和 #53（互相引用）的关系

#53 想要的"幻灯片里放另一个项目的动效、用画布当一页、链到看板、文档引用别的项目"，落地时多半都是一个 `<x-embed>`：现在的画板导入是**复制**（`.design/import-from-project.md` §2 解释了为什么不做跨项目路径引用）。不管将来是复制还是活引用，embed 都是 iframe，导出时都会撞上同一个问题。所以 A 是 #53 的前置：先让任何 embed 都能在浏览器里变成像素，再扩来源（动效、看板、文档）就不会每多一种来源就多一个"导出只能走服务端"的例外。

活引用（不复制，指向另一个项目）额外的问题和渲染无关，属于 #53 本身：项目不再自足、源改了目标悄悄变样、单文件导出要把被引用项目一起打包。那些在 #53 里另做。

## 5. 待定

- A 先做在哪：动效视频（收益最大，现在唯一"必须过后端"的地方）还是 PNG/缩略图（最简单，一次性拍一张）。
- 服务端渲染在 A 之后的角色：保留为默认（快，有 GPU 时）还是降为后备。
- 原型只验证了 Chromium 和一个简单帧；真实画板（字体、图片、`<dc-import>` 兄弟画板）的保真度要用 `projects/` 里的样例量。
