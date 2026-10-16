# 从项目导入：把画布的画板带进幻灯片和动效（特效就是会动的画板）

状态：**已实施（第一期）**。来源只有画布的画板，去处只有幻灯片和动效。测试是 `e2e/import_board.py` 和 `packages/core/test/boardEmbed.test.ts`；共用的导入入口见 [import-into-project.md](./import-into-project.md)。

## 1. 要解决的问题

起点是"特效系统"：幻灯片和动效都想要一块会动的背景、一道光、一段循环的小动画。最早的想法是在设计系统里加一族节奏 token、再配一组 shader 预设，各类型去引用。往下想就发现它在造第二套东西：一个特效要有参数、要能预览、要能被 AI 改、要能导出，这些画布的画板**已经全有了**：画板是一份 HTML 加一个逻辑类，`data-props` 里声明的 Tweaks 就是参数，画布上能看、能点、能交给快速 AI 和 Claude Code。

所以问题变成另一个更一般的问题：**一种类型做出来的东西，怎么拿到另一种类型里用**。特效是它的第一个用例。

## 2. 考虑过的做法

| 做法 | 问题 |
|---|---|
| 设计系统里加节奏 token + shader 预设 | 新格式、新编辑界面、新预览、新导出，全要从头做；人能改的只有预设给的几个旋钮 |
| 新开一种"特效"项目类型 | 第七种类型要在十几个地方登记（[project-kinds.md](./project-kinds.md) §2），而它和画布几乎一样 |
| 在幻灯片/场景里直接**引用**另一个项目的文件（`../box-console/Glow.dc.html`） | 一个项目不再自足：挪走、改名、单独发给别人都会断；源画布一改，已经做好的幻灯片悄悄变样 |
| **导入：把画板复制进来，记下来源，嵌入块指向副本**（采用） | 和"导出"对称，人一听就懂；项目自足；想跟上原画板时手动"从原画板更新" |

交互上它就是一种导入，只是导入的东西来自一个项目而不是一个文件，所以放在已有的导入入口里，不另开一处（ux-principles §2"不要模式选择器"、§12"副作用只落在当前界面"）。

## 3. 决定

### 3.1 入口

共用的"导入 / 导出"菜单（`FileMenu`，[export-menu.md](./export-menu.md)）在导入一段的"选择文件…"旁边多一项"从项目导入…"（`ImportTarget.board` 存在的类型才有；`FileMenu` 通过 `ImportControls.pickProject()` 让 `ImportHere` 打开选择器）。点开是一个画板选择器（`BoardPicker.tsx`）：列出每个画布项目的画板，用画板运行时画成缩略图；会动的画板排在前面、带"会动"标记，指针停在上面时播放，所以人是看着效果挑的。

幻灯片原来没有导入入口（图片走"插入图片"）；现在每种类型都有同一个"导入 / 导出"菜单，幻灯片的导入一段因此不只是放图片。

### 3.2 复制到哪、记在哪

服务端 `POST /api/projects/:p/import-board {from, board}`：

- 画板复制到 `uploads/<来源项目>-<画板名>/<画板文件>`；它用 `<dc-import>` 挂载的兄弟画板一起复制，保持相对位置；它显示的 `uploads/…`、`assets/…` 文件按原路径复制（目标里已有同名文件则不覆盖）。
- 目标的索引（`deck.json` / `motion.json`）记 `imports: [{path, from: "projects/<名>", board, copiedAt}]`。索引里未知的键本来就会保留，旧版本编辑器打开也不会丢。
- 同一个画板再导入一次，覆盖同一个副本，所有指向它的嵌入块一起更新。这就是"从原画板更新"。

放到 `uploads/` 是沿用"人带进来的东西放 `uploads/`"的规则（[import-into-project.md](./import-into-project.md) §3）。

### 3.3 嵌入块

编辑器把它放到页面上：

```html
<x-embed src="uploads/box-console-Glow/Glow.dc.html" data-props='{"accent":"#7c3aed"}' style="position:absolute;left:0px;top:0px;width:1920px;height:1080px"></x-embed>
```

- 沿用幻灯片子集里已有的 `<x-embed>`（钉住、`<section>` 的直接子元素），只是多了 `src`：有 `src` 的嵌入块是空的，`src` 必须是 `uploads/` 下的画板（`checkSlide` 检查）。没有 `src` 的嵌入块照旧是一段内联的小网页。
- 画板由画板运行时在自己的 iframe 里画，按 cover 方式铺满嵌入块。iframe 是嵌入块的直接子元素，动效舞台的 `showTime` 可以直接找到它。
- `data-props` 覆盖画板自己的 Tweaks 默认值，只写和默认不同的键。面板（`BoardEmbedProps.tsx`）用和画布 Tweaks 同一个控件（`TweakControl`）改它，另有"还原"、"打开原画板"、"从原画板更新"，并说明来源。
- 会动的画板放在页面第一个（最底层），铺满；静止的画板居中、不超过页面的 60%。动效里静止的画板和图片一样从播放头淡入。

### 3.4 "会动"是什么：`$time`

画板在 `data-props` 里声明 `"$time": {"loop": "8s", "still": "2s"}`（或 `true`）就是会动的。运行时给它一个 `time` 属性（毫秒），画板**只从 `this.props.time` 画**，不自己计时：

| 在哪 | `time` 从哪来 |
|---|---|
| 动效（编辑舞台、播放器、命令行渲染） | 场景时间，逐帧 seek（`data-seek` 握手：`{dcMotion:'seek', t, n}` → `{dcMotion:'seeked', n}`），所以视频逐帧确定，`motion-render --verify` 倒着 seek 也逐字节相同 |
| 幻灯片放映、导出的 HTML | 从这一页出现起的时间，按 `loop` 取模，循环播放 |
| 幻灯片编辑、缩略图、打印 | 停在 `still` |
| 画布 | 停在 `still`；Tweaks 里有时间滑块和播放，只改画面、不改文件 |

为什么不让画板自己用 `requestAnimationFrame` 或 CSS 动画：那样动效没法逐帧渲染成视频，也没法停在任意一刻给人看。代价是写画板的人（或 AI）要遵守这条规则，写在 `dc-canvas` 技能里。

### 3.5 导出

- 幻灯片的单文件 HTML：画板运行时只写进页面一次（`#dc-boards` 里一份 JSON：运行时页面、画板文件、尺寸），每个嵌入块由页面脚本建一个 iframe。导出文件因此大约多 500 KB，与嵌入几个画板无关。
- 动效在编辑器里导出视频时，含嵌入的场景在本机有 Chrome 和 ffmpeg 时走服务端的精确渲染，没有时浏览器路线让画板框架自己交出画面（[export.md](./export.md) §4）；服务端渲染、命令行渲染和单文件播放器：收集场景用到的画板文件（图片内联成 data: URL），把 `runtime.js` 的正文交给播放器（`boardRuntime: {inline}`）。

## 4. 代码在哪

| 位置 | 内容 |
|---|---|
| `packages/core/src/boardEmbed.ts` | `$time`、尺寸、Tweaks、依赖收集、`imports` 记录、运行时页面、cover 计算 |
| `packages/sandbox/src/slide.tsx` `XBoard`、`runtime.tsx` | 幻灯片/场景里画嵌入的画板；画板一侧接 seek、给 `time` |
| `packages/sandbox/src/motion.ts` `mountBoard` | 播放器里的画板嵌入 |
| `apps/server/src/app.ts` `import-board` | 复制和记录 |
| `apps/server/src/render.ts` | 服务端精确渲染带上画板文件和画板运行时 |
| `apps/editor/src/components/BoardPicker.tsx`、`ImportHere.tsx`、`FileMenu.tsx` | 选择器和入口 |
| `apps/editor/src/boards.ts`、`slides.ts`、`motion.ts` | 嵌入块的写法、放到页面上、给帧准备画板文件 |
| `apps/editor/src/components/panel/BoardEmbedProps.tsx`、`OtherProps.tsx` | 嵌入块的面板；画布 Tweaks 的时间滑块 |
| `apps/editor/src/components/slides/exportDeck.tsx`、`apps/server/src/render.ts`（命令行 `tingly-design export`）、`scripts/motion-render.mjs`（播放器、`--verify`） | 导出 |

## 5. 还没做的

- **来源只有画布的画板，去处只有幻灯片和动效**。看板的图表、设计系统的组件、文档的段落都是候选来源；画布导入另一个画布的画板可以直接复制，不需要嵌入。
- 启动页卡片的预览不画嵌入的画板（幻灯片封面和动效静帧里是空的）。
- 幻灯片的 PNG 导出还不画嵌入的画板（动效的视频和"保存当前帧为 PNG"已经画，用的是框架交画面，[export.md](./export.md) §4；幻灯片接上同一个 `snapFrames` 即可）。
- 画板里引用的图片在编辑器里按目标项目解析，复制时已带上；运行时请求网络字体（`@import url(…)`）在离线导出里拿不到。
- 没有"源画板变了"的提示：要人自己点"从原画板更新"。是否该提示、在哪提示，等用起来再定。
- 动效里另有一种特效：内联在 `<x-embed data-seek>` 里的着色器（[motion-effects.md](./motion-effects.md)）。两者用同一个 seek 握手，区别是来处：着色器写在场景里、只给动效用；画板在画布里做、能调参、幻灯片和动效都能导入。要不要让着色器也能做成画板、从画布导入，还没定。
