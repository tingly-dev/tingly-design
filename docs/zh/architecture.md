<p align="right"><a href="../en/architecture.md">English</a> · <b>简体中文</b></p>

# 工作原理

```
            ┌──────────── 唯一真相：projects/<name>/ 下的源文件（每个文件有版本号）─────────────┐
            │                                                                               │
  界面手改（秒）          快速 AI（秒）                     Claude Code（分钟）         终端 / git
  DOM 操作 → 回写      jQuery 在沙箱副本上执行 → 回写         直接改文件                  直接改文件
            │                   └── askClaude() 委托 ──→           │                         │
            └──────────── 共享 journal：谁、什么时候、改了什么 ←── 文件监听 ──────────────────┘
```

## 1. 一个格式受约束的源文件

`.dc.html` 是一页自包含 HTML：`<x-dc>` 里是模板（`{{path}}`、`<sc-for>`、`<sc-if>`、`<dc-import>`），`<script data-dc-script>` 里是 `class Component extends DCLogic`。约定是视觉属性写内联 `style`、文案写字面量、布局用 flex/grid + `gap`。这些约束保证界面上的每个操作都能落到源码里一个确定的位置。幻灯片页面同理，用的是更严格的 HTML/CSS 子集。

## 2. 统一的回写引擎（`packages/core/src/copy.ts`）

所有编辑者都在同一种东西上工作：用 parse5 带源码位置解析模板，再建一份 DOM 副本，每个元素记得自己来自源码的哪一段，并带一个临时句柄 id（`#dc12`，按深度优先编号，从不落盘）。

编辑完成后，比较副本和原始语法树，生成**最小文本补丁**：

- 只改了属性：只替换那一个属性；
- 只改了文字：只替换那段文字；
- 子元素增删或重排：才重写父元素的内部，而且没动过的子元素直接拷贝原文，不重新序列化；
- 样式按文本编辑而不是走 CSSOM，所以 `background:{{r.bg}}` 这类带占位的声明不会丢。

人的操作（`applyHumanOps`）、快速 AI 的 jQuery（`FastEditSession`）、冲突后的重放，全都走这一个引擎。

## 3. 快速 AI：输出的是“编辑操作”，不是新文件

用哪个模型、经哪个网关，在“AI 模型设置”里定（见 `.design/ai-settings.md`）：快速 AI 和 Claude Code 共用一个连接，各有自己的模型名，推荐 Tingly Box。宿主设的环境变量优先于这里保存的值。

模型拿到的上下文依次是：画布概览、你正在看的画板、目标画板带句柄的标记、journal、你指着的元素、你的话。它的回复只能是 jQuery 语句，一行一条：

```js
$('#dc12').css('color', '#7c3aed')
$('#dc12').after(`<ul style="margin: 0; padding-left: 18px"></ul>`)
$('#dc12').next().append(`<li style="font-size: 14px"></li>`)
$('#dc12').next().children().first().repeat(3)
.text((i) => ['计划', '构建', '发布'][i])
```

- **流式执行**：每写完一行就在沙箱里执行，画板马上显示草稿（虚线框）。
- **出错重写**：任何一行报错，整次回复撤销，把错误告诉模型重写，最多重试两次。
- **工具**：`log(x)` 让模型先看看某个元素的当前状态；`askClaude()` 把请求原样委托给 Claude Code。
- **附件**：粘贴、拖入或选择到输入框里的图片、PDF 和文本文件，发送时存进项目的 `uploads/`（按内容命名，同一个文件只存一份），并作为内容块放在你的话前面交给模型，每个都标明它在项目里的路径（给模型的图片长边缩到 1568 px，存下的是原图）。Claude Code 拿到路径自己读。之后的请求还能用它们；幻灯片可以按路径（`uploads/…`）显示存下的图片，文档用 `../uploads/…`。
- **保存**：改完后作为一次普通编辑保存；如果期间文件被别人改了，就把这些语句在新版本上重放一遍。

## 4. 协同：版本号 + 重放，加一份 journal

- 每个文件的版本号是内容哈希。保存时带上基于的版本，不一致就返回 409 和当前内容。
- 编辑器里每次编辑都以“源码 → 新源码”的函数入队，乐观地先显示；遇到 409 就在新版本上重新执行这个函数再保存。两个人同时改同一个文件，两边的改动都会保留。
- 撤销按上下文定位自己的那处改动，所以别人改了同一文件的其他地方，你照样能撤销自己的。
- journal 记录所有编辑者的改动（手改、jQuery、快速 AI、Claude、外部、撤销），实时推送到所有打开的编辑器，也作为快速 AI 的上下文，所以“再来一个”“少一点”这类话它能听懂。

## 5. 沙箱

画板和 AI 代码都运行在 `sandbox="allow-scripts"` 的 iframe 里（不同源，拿不到编辑器的 cookie 和存储），并用 CSP 禁止网络请求（画板只允许 Google Fonts 和图片）。编辑器与它们只通过 `postMessage` 通信，协议定义在 `packages/core/src/protocol.ts`。

## 项目结构

```
packages/core       格式解析、DOM 副本、最小补丁回写、人工操作、jQuery 执行会话、语句切分、提示词；
                    幻灯片的 deck.json、子集检查、形状/图标/连线绘制；设计系统的 tokens 语法与 tokens.css；
                    看板的数据集、CSV 解析、SQL 检查与参数绑定、标注核对；文档的按块合并与重放、评论定位；启动页卡片、36 个设计系统风格、项目压缩包与 Claude Design 格式、PowerPoint 导入
packages/export     在浏览器里导出、不装东西：DOM 画成图、帧编成 MP4 或 WebM 和 GIF、混音、内联网页字体、原生对象的 PowerPoint，以及各浏览器能写什么（.design/export.md）
packages/i18n       界面文字的英文和中文（locales/<语言>/<区域>.ts）、语言匹配、服务端和导入器用的翻译函数（.design/i18n.md）
packages/sandbox    画板运行时（模板 → React、选中、就地改字）、看板运行时（dash API + d3）和 AI 执行器，esbuild 打成 IIFE
apps/server         Hono：文件读写与版本、SSE、journal、文件监听、快速 AI 流式代理、委托 claude CLI（一个项目一份对话）、用本机的 Chrome 和 ffmpeg 精确渲染动效、一键 PDF、git 提交、项目 .zip 导入导出、图像生成、看板的数据连接器；`tingly-design` 命令（cli.ts、commands.ts）和同一份命令作为 MCP 工具（mcp.ts）
apps/editor         React + Vite + zustand 的编辑器：各类型共用的部件在 components/ 根下；每种类型的编辑器和它的状态在 components/<kind>/（canvas、slides、ds、dash、docs、motion）
projects/           示例项目：tingly-box-console-canvas（画布）、tingly-design-intro-slides（幻灯片）、tingly-design-system（设计系统）、tingly-box-usage-dashboard（看板）、tingly-design-guide-doc（文档，含一个“架构”页签）、tingly-design-motion（动效）；tingly-design-ui-canvas 是编辑器自己的设计画布
scripts/            dash-query.mjs：只读地查看板的 SQLite 数据库（给 Claude Code 用）；bundle.mjs：宿主随自己发布的文件夹（docs/zh/embedding.md）；sync-tingly-box-theme.mjs：把 Tingly Box 的调色板拷进编辑器（docs/zh/theming.md）
.claude/skills/     给 Claude Code 看的格式说明：dc-canvas、slides、design-system、dashboard、docs、motion（委托时会让它先读）；issue-resolve 是维护者的 issue 跟进
artifact/           原版五种类型（Design、Slides、Dashboard、Docs、Design System）的参考材料，私有
docs/               使用指南与工作原理：docs/en/ 英文，docs/zh/ 中文；docs/images/ 是截图
.design/            设计说明：每个功能为什么这样做，以及每种项目类型都要支持什么（索引在 .design/README.md）
e2e/                Playwright 端到端测试和一个模拟的 Messages API
```

包之间的依赖只有一个方向：`core`、`export`、`i18n` 不引用其他包；`import` 用 `core` 和 `i18n`；`sandbox` 用 `core` 和 `export`；服务端用 `core`、`export`、`i18n`；编辑器用这些再加 `import`。`pnpm depcheck`（`.dependency-cruiser.cjs`）在 CI 里拦住源码里任何其他方向（测试不检查；`sandbox` 只以构建出的 IIFE 被使用，不被引用）。服务端里，`app.ts` 放核心路由并挂载 `routes/` 下每个区域一个文件，`chrome.ts` 是启动本机 Chrome（渲染、PDF、页面导出）的唯一地方。

---

返回 [README](../../README.zh-CN.md)
