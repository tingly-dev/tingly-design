# 对话里的回答：按 Markdown 读

状态：**已实施**（§5 是没做的）。Claude Code 一轮结束后的回答，在对话记录、底部运行卡片和历史里都按 Markdown 画；快速 AI 的状态注记、失败和停止的说明仍是原样的文字。

参考：Tingly Box 的对话部件（`frontend/packages/projects/src/transcript/Transcript.tsx`、它的 Markdown 宿主 `frontend/packages/projects/src/components/Markdown.tsx`、阅读面 `frontend/packages/projects/src/transcript/conversationStyles.ts`）。那边把 assistant 的话画成 GFM，代码块带语言和复制，链接限定安全协议，标题、列表、表格、引用有安静的一套字号。

## 1. 问题

原来回答是一个 `<p class="run-result">` 加 `white-space: pre-wrap`（`Transcript.tsx` 的 `TurnBody`、`RunFeed.tsx` 的 `DelegateRun`）。Claude Code 的回答经常是这种形状：

    ## 改好了

    标题改短了，`npm run build` 之后重新打开。

    | 文件 | 改动 |
    |---|---|
    | Main.dc.html | 标题 |

于是人看到的是一堵字符：反引号、竖线、井号都在，命令要先用鼠标选中、再 ⌘C，表格读不出行列。链接不可点，长回答在底部卡片里是一整块 13px 的文字。

## 2. 决定

### 2.1 一个共用的渲染部件

`ChatMarkdown`（`apps/editor/src/components/ChatMarkdown.tsx`，解析在 `apps/editor/src/chatMarkdown.ts`）画“一轮的回答”。谁都用它：

- 左侧对话记录与服务端记录：`TurnBody`（`Transcript.tsx`）；
- 底部请求栏的运行卡片：`DelegateRun`（`RunFeed.tsx`）；
- 历史列表展开的一行：同一份 `TurnBody`。

因此六种类型（画布、幻灯片、设计系统、看板、文档、动效）一次到位，没有按类型分支。快速 AI 的 `f.note` 是“已保存 / 已停止 / 报错”这类诊断，不是给读的回复，保持原样；`stopped` 的说明和失败的错误也一样，显示成原来的红色一行，不经过 Markdown（免得错误文本里的 `<`、`*` 被当成语法）。

外层仍是 `.run-result`：`#448` 的选中与 ⌘C 复制、底部卡片 120px 的限高、记录里 `max-height: none` 的覆盖都照着它，改用 `div` 承载渲染结果不改变这些契约。

### 2.2 解析与消毒

仓库已经带着 `marked`（14）和 `dompurify`（`ds/ds.ts` 的 `markdown()` 就在用），不新增依赖，也不引入 `react-markdown`、`remark-gfm`、`prism-react-renderer`。

- `marked`：`gfm: true`、`breaks: true`。`breaks` 是刻意选的——原来一句只有换行的回答靠 `pre-wrap` 保持分行，换成 Markdown 后单换行必须变成 `<br>`，否则“第一句\n第二句”会被并成一行，是可见的退化。
- 解析出的 HTML 先过 `DOMPurify.sanitize`，再进页面：保留 html 基础档案，禁止 `style`、`form`、`input`、`img`、`picture`、`source`、`svg`、`math`、`iframe`、`object`、`embed`、`video`、`audio`、`link`、`meta`、`base` 和行内的 `style` 属性。答案里可以出现原始 HTML，但脚本、事件处理属性和外来样式都活不下来。
- 链接：只认 `http`、`https`、`mailto`；在页面里装上之后，`ChatMarkdown` 给它们加 `target="_blank"` 和 `rel="noopener noreferrer"`，其余协议（`javascript:`、`data:`、相对路径、锚点）去掉 `href`，只留文字。相对路径若可点，会把编辑器本身导航走，所以宁可不可点。
- 图片：不加载。远程图片是答案的作者替页面发起的请求，隐私上有代价，也让页面依赖网络；`marked` 的 image 渲染器把它换成一段占位文字（alt，没有 alt 就用文件名，悬停看地址），`<img>` 本身也在禁止列表里。
- 代码块：`marked` 的 code 渲染器输出 `.md-code`（语言标签 + `<pre><code>`）。“复制”按钮不在消毒前的 HTML 里，而是 `ChatMarkdown` 在消毒后的 DOM 里补上的，答案自己的 HTML 造不出可点的控件。点击复制 `pre code` 的原文，按钮显示“复制 → 已复制”一秒多；剪贴板不可用（或页面没有焦点）时退化为选中这段代码，⌘C 仍然可用。

### 2.3 外形

用编辑器的主题 token，不写颜色：标题 15/14/13.5px、列表缩进 22px、引用一条 `--line` 竖线、表格边框 `--line`、表头 `--panel-2`、行内代码 `--hover` 圆角、代码框头 `--panel-2` + `pre` 底色 `--canvas`、链接 `--accent`、图片占位 `--muted`。深色和浅色同一套，因为它们都是 token。

没有语法高亮：为一个聊天框往 bundle 里加一个 highlighter 不划算，带语言标签、保持换行、可复制的框已经解决“看清 / 拿走”的问题。

表格和代码都横向滚动，不撑破列；底部卡片里整个回答仍限高 120px 内滚，记录里不限高（已有规则）。

## 3. 对照 ux-principles

| # | 判断 |
|---|---|
| 1 围绕问题组织 | 回答就在“它说了什么”的位置按原意排；头部只多一行语言，不为 Markdown 加页签或开关 |
| 2 消除模式选择 | 自动：看着像 Markdown 就按 Markdown 读，没有“预览 / 原文”切换 |
| 3 一个词一个意思 | “回答”指 Claude Code 一轮结束的话；快速 AI 的注记不叫回答，也不按 Markdown 画 |
| 4 轴要分开 | 渲染只决定“怎么读”，不碰“谁说的 / 改了什么 / 能不能撤销” |
| 5 具体值 | 代码块给原文和语言；图片占位给 alt 或文件名；链接给真实地址 |
| 6 智能默认 | 纯文本回答视觉上没有变化（`breaks` 保换行，字号沿用 `.run-result`）；代码才有新框 |
| 7 诊断走真实路径 | 解析的就是服务端存下的 `answer` 原文，对话记录和历史读到的是同一份 |
| 8 教育在产品里 | 代码框自带“复制”，不用先选中 |
| 9 少视觉噪声 | 只有代码框和表格加了边框；标题比正文大一档，不抢运行状态那一行 |
| 10 完成 ≠ 锁死 | 回答一直是普通页面文字，可选中、可复制、可再读 |
| 11 把下一步交到手上 | 命令一键复制；链接新标签打开，不离开作品 |
| 12 副作用限在当前界面 | 链接不导航编辑器本身；图片不发请求；横向滚动只在框内 |

## 4. 跨类型

`ChatMarkdown` 由 `TurnBody` 和 `DelegateRun` 共用，六种类型同一份。差别只在容器：左侧列不限高，底部卡片限高 120px；历史行展开后同左侧。

## 5. 还开着的 / 没做的

- **工具调用的输入与输出展开**（参考里的 `ToolRow` 点开看到工具拿到什么、返回什么）：`AgentStep`（`packages/core/src/activity.ts`）只留下翻译后的一句话，工具输入/输出在服务端就被丢掉，也不进 `.transcript.jsonl`。留着要做协议和存储的改变（长度上限、命令里的密钥），单独做。
- **更长的工具输出折叠**：上一条做完才有东西可折。
- **运行中的流式 Markdown**：Claude Code 的回答在结束时一次给出；中途它说的话（`say`）已经逐条显示，暂不把半句话按 Markdown 画。
- **语法高亮**：见 2.3。
- **本地图片**（`uploads/…`）：回答里引用项目自己的图，现在也只显示 alt；要画出来得按项目解析路径，单独做。
- **每条回答的时间戳 / 相对时间**：运行行已有用时，再加一个时钟是噪声，等有人要。
- **虚拟化记录**：记录上限 200 轮、300 步，还不到需要虚拟化的量。
- **一轮里的附件**、**“上次离开之后的新内容”分隔线**：`Turn` 没有附件字段，服务端也不记“谁什么时候看过”。

## 6. 实现里的事实

- 解析器是模块级的一个 `Marked` 实例（`chatMarkdown.ts`），每个回答只用 `useMemo` 解析一次；消毒后的字符串交给 `dangerouslySetInnerHTML`，因此 React 不参与逐个节点的渲染。
- “复制”按钮、链接的 `target/rel` 都在 `useLayoutEffect` 里对消毒后的 DOM 操作，`html` 变了就重来一次（`html` 只在回答文本变化时变）。
- 复制失败时选中代码依赖 `document.createRange`，不依赖应用的选择状态，所以画布里选中的元素不受影响。
- `agent.css` 里 `.run-result.md` 的规则按 `.run-result` 之后放置；`agent-dock.css` 的 `.turn-body .run-result`（限高与可选）继续生效。
- e2e：`e2e/run_feed.py` 的替身 `claude` 在请求含 `MARKDOWN` 时回一段含标题、粗体、列表、表格、代码、安全/不安全链接和原始 `<script>` / `<img onerror>` 的答案，断言渲染、复制、链接和不执行脚本；`chat_copy.py` 与 `chat_panel.py` 的选中、⌘C 和文本断言照旧通过。