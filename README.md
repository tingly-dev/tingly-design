# Tingly Design

**人和 AI 同时编辑的开源设计工具。** 画布、幻灯片、设计系统都存成普通文件，人在界面上改、快速 AI 逐行改、Claude Code 直接改文件，三方改的是同一份源码。

- 🖱️ **人**：点选元素、双击改字、拖动重排或拖出自由摆放，在右侧面板改图层 / 属性 / CSS / Tweaks，还能画便签、形状、箭头和手绘线。
- ⚡ **快速 AI**：模型逐行输出 jQuery 语句，在沙箱副本上执行，画面一行一行地变，几秒完成。
- 🤖 **Claude Code**：适合改脚本、数据、跨画板的事。它直接编辑文件，编辑器通过文件监听实时刷新。

每次改动只回写源码里真正变了的那几个字符，模板里的 `{{占位}}`、循环和你的排版都原样保留，所以这些文件可以放进 git、交给 Claude Code，也可以手写。文件格式沿用 Claude 的 Design / Slides / Design System 类型，Tingly Design 是对其双向编辑机制的开源复刻。

![Tingly Design 画布编辑器](docs/images/canvas.png)

## 目录

- [三种项目](#三种项目)
- [快速开始](#快速开始)
- [使用指南](#使用指南)
  - [画布](#画布)
  - [幻灯片](#幻灯片)
  - [设计系统](#设计系统)
- [工作原理](#工作原理)
- [项目结构](#项目结构)
- [开发与测试](#开发与测试)
- [与原版的差别](#与原版的差别)

## 三种项目

| 类型 | 适合做什么 | 文件 | 演示 |
|---|---|---|---|
| **画布** | 界面设计、原型，多画板多页面 | `canvas.json` + 每个画板一个 `.dc.html` | [`?p=demo`](http://localhost:5173/?p=demo) |
| **幻灯片** | 1920×1080 的演示文稿，可放映、可导出 | `deck.json` + `slides/<id>.html` | [`?p=math-deck`](http://localhost:5173/?p=math-deck)（“数学奇遇记”） |
| **设计系统** | 颜色、文字、间距、组件与品牌资源 | `design-system.json` + `tokens.json` + `components/` | [`?p=math-ds`](http://localhost:5173/?p=math-ds) |

设计系统可以“装进”画布或幻灯片，之后颜色和文字样式都能直接从 token 里选。

<table>
  <tr>
    <td width="33%"><a href="docs/images/canvas.png"><img src="docs/images/canvas.png" alt="画布"></a></td>
    <td width="33%"><a href="docs/images/slides.png"><img src="docs/images/slides.png" alt="幻灯片"></a></td>
    <td width="33%"><a href="docs/images/design-system.png"><img src="docs/images/design-system.png" alt="设计系统"></a></td>
  </tr>
  <tr>
    <td align="center">画布</td>
    <td align="center">幻灯片</td>
    <td align="center">设计系统</td>
  </tr>
</table>

## 快速开始

```bash
pnpm install
pnpm dev            # 编辑器 http://localhost:5173 ，服务端 :8787
```

打开 http://localhost:5173/?p=demo 看演示画布。生产方式运行：`pnpm start`（先构建，再由服务端在 8787 端口同时提供 API 和编辑器）。

### 配置

| 环境变量 | 作用 |
|---|---|
| `ANTHROPIC_API_KEY` | 开启快速 AI（服务端用 Anthropic SDK 调模型）。也支持 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`。 |
| `DC_FAST_MODEL` | 快速 AI 用的模型，默认 `claude-haiku-5-5`。 |
| `DC_DELEGATE_MODEL` | 交给 Claude Code 时用的模型（不设则用 CLI 默认）。 |
| `DC_PROJECTS` | 项目目录，默认仓库里的 `projects/`。 |
| `PORT` | 服务端端口，默认 8787。 |

- 没有 API key 也能用：jQuery 模式可以手写语句，走的是和快速 AI 完全相同的执行与回写链路。
- “交给 Claude Code” 需要本机能运行 `claude` 命令。

## 使用指南

### 画布

界面布局：左上是页面菜单和工具条，右上是播放、面板开关、缩放和同步记录，底部是给 AI 的输入框，右侧是可收起的面板（`⌘\`）。

- **画布工具**：选择 V、抓手 H、文字 T、画板 A、便签 N、手绘 P、矩形 R、椭圆 O、直线 L、箭头 ⇧L。便签与形状存在 `canvas.json`，有字号（s/m/l/xl/xxl）、颜色、填充、旋转和翻转。
- **画板**：名称条可改名、全屏运行、导出 PNG；右下角拖动改尺寸；多页面（每页一组画板）。
- **右侧面板**：图层树（按角色命名：横向/纵向/网格/文字/图片…，循环项标出来）；属性页（文字样式、尺寸模式 适应/固定/填充、布局方向与间距、填充、描边、圆角、阴影、不透明度）；代码页（元素自己的声明可直接改，继承来的值只读列出）；Tweaks（改的是 `data-props` 默认值）。
- **直接操作**：选中后拖动可以在兄弟之间重排；拖出父容器变成绝对定位（父元素自动 `position:relative` 并冻结高度）；四角手柄改尺寸；双击就地改字；右键菜单。
- **播放模式**：画板运行自己的逻辑，画板之间的链接可以跳转。

<details>
<summary><b>快捷键</b></summary>

| 快捷键 | 作用 |
|---|---|
| Esc | 关菜单 → 退出播放 → 回到选择工具 → 取消选中 |
| ⇧↵ / ↵ | 选中上一级 / 第一个子元素 |
| ⌫ | 删除 |
| ⌘C ⌘X ⌘V ⌘D | 复制、剪切、粘贴、复制一份 |
| ⌘G / ⌘⇧G / ⇧A | 编组 / 解组 / 包进 flex 容器 |
| [ ] | 移到最前 / 最后 |
| ⇧H ⇧V | 水平 / 垂直翻转 |
| ⌘Z ⌘⇧Z | 撤销 / 重做 |
| ⌘= ⌘- ⌘0 ⇧1 ⇧2 | 放大、缩小、100%、适应全部、缩放到选中 |

</details>

格式说明：[`.claude/skills/dc-canvas/SKILL.md`](.claude/skills/dc-canvas/SKILL.md)

### 幻灯片

新建项目时类型选“幻灯片”。演示 [`?p=math-deck`](http://localhost:5173/?p=math-deck) 的每一页都有一段会动的数学动画。

![幻灯片编辑器：左侧缩略图与分节，中间舞台和演讲者备注，右侧图层与属性](docs/images/slides.png)

```
projects/<name>/
  deck.json            标题、顺序 order、分节 sections、字体 faces
  slides/<id>.html     每页一个文件：正好一个 <section id="<id>">，1920×1080，封闭的 HTML/CSS 子集
  assets/              上传的图片和字体
```

- **左侧缩略图条**：按节分组（双击节名改说明）；拖动排序；右键新建、复制、跳过、从这一页开始新的一节、删除。缩略图里的动态嵌入不运行，只显示占位。
- **舞台**：当前页按比例缩放；选中、双击改字、拖动重排或拖出成自由定位、右侧面板（图层/属性/代码）和画布完全一样，走同一个最小补丁回写。下方是演讲者备注（写进 `<aside>`）。
- **插入**：文字、图片（上传到 `assets/`）、表格、形状（矩形、圆角、椭圆、菱形、四向箭头、直线）、连线、图标。
- **格式检查**：每一页都按原版 `format.md` 的子集检查（不认识的标签、`margin`、`z-index`、`em`、`var()`、`<x-embed>` 没有钉住……），舞台上方和缩略图上标出处数，点一条就选中对应元素。快速 AI 改完如果引入了新的越界，会被撤销并把原因告诉模型重写。
- **放映**：F5 从头、⇧F5 从当前页；→ / 空格 / 点击 先播放这一页的出场动画（`data-build-in`），再翻页；切换效果 `fade` / `push`（`magic` 先按淡入淡出处理）；N 打开演讲者备注栏；F 全屏；Esc 退出。
- **下载**：单个 HTML 文件（图片内联、嵌入在沙箱里照常运行、方向键翻页）、打印成 PDF、演讲者备注文本。

渲染上忠实于原版的几处规则：没写 `display` 的 `<div>` 是纵向 flex；子元素按源码顺序绘制，所有流式内容作为一层画在第一个流式子元素的位置（所以写在最前面的全幅背景会在文字下面）；`<x-embed>` 跑在独立的沙箱页里（无网络、不同源）。

格式说明：[`.claude/skills/slides/SKILL.md`](.claude/skills/slides/SKILL.md)

### 设计系统

演示 [`?p=math-ds`](http://localhost:5173/?p=math-ds) 是从“数学奇遇记”幻灯片里提取的颜色、字体、间距和卡片。

| 概览：封面 + 品牌手册 | 颜色：用法与对比度 |
|---|---|
| ![设计系统概览](docs/images/design-system.png) | ![设计系统颜色页](docs/images/design-system-colors.png) |

```
projects/<name>/
  design-system.json      索引：标题、namespace、资源分组
  tokens.json             颜色（按主题）、文字、间距、圆角、阴影……都是 {name, value, usage} 列表
  tokens.css              由 tokens.json 自动生成（编辑器、Claude Code、终端改 tokens.json 都会重新生成）
  README.md、*.md          品牌手册
  components/<C>/         README.md（使用说明）和 preview.html（实时预览）；Cover 是封面
  components/bundle.js    组件实现，挂在 window.<namespace>；bundle.css、index.d.ts
  assets/<分组>/、fonts/   标志、图标、图片和字体文件
```

- **页面**：概览（封面 + 品牌手册，可直接编辑 Markdown）、颜色（按主题切换；用法里写“on surface”就显示在那个底色上的对比度；别名显示指向谁）、文字（每个样式按自己的字体和字号渲染）、间距与圆角与阴影、组件（每个预览都在沙箱里先加载 tokens.css、bundle.css、bundle.js 再运行）、资源（按分组上传、下载、删除）。
- **原地改 token**：点一行展开，改值、改名（别名会跟着改）、写用法、增删。保存的是 tokens.json 的数据，tokens.css 随之重建，只改真正变了的那几行。
- **检查**：tokens.json 里不符合原版语法的部分（颜色名、`var()`、不存在的别名、循环别名、DTCG 的 map 写法……）会被丢弃并在“问题”里写明原因。
- **装进画布或幻灯片**：在画布或幻灯片的面板里（不选中任何东西时）选择“设计系统 → 装入”。tokens.json 复制到那个项目的 `ds/<folder>/`，索引的 `designSystems` 记一条；之后所有颜色输入框旁边有 ◆ 可以选它的颜色、并标出当前值是哪个 token，文字样式菜单列出它的样式；幻灯片还会拿到它的字体。幻灯片里写的是颜色值本身（子集不允许 `var()`）。
- **托管字体**：`tokens.json` 的 `type.hosted: [{family, href}]` 是这里的扩展（原版只认字体文件），用 Google Fonts 的 css2 链接；预览和装入的幻灯片都会加载。
- **AI**：原版设计系统页面没有页内模型，这里也只交给 Claude Code。

格式说明：[`.claude/skills/design-system/SKILL.md`](.claude/skills/design-system/SKILL.md)

## 工作原理

```
            ┌──────────── 唯一真相：projects/<name>/ 下的源文件（每个文件有版本号）─────────────┐
            │                                                                               │
  界面手改（秒）          快速 AI（秒）                     Claude Code（分钟）         终端 / git
  DOM 操作 → 回写      jQuery 在沙箱副本上执行 → 回写         直接改文件                  直接改文件
            │                   └── askClaude() 委托 ──→           │                         │
            └──────────── 共享 journal：谁、什么时候、改了什么 ←── 文件监听 ──────────────────┘
```

### 1. 一个格式受约束的源文件

`.dc.html` 是一页自包含 HTML：`<x-dc>` 里是模板（`{{path}}`、`<sc-for>`、`<sc-if>`、`<dc-import>`），`<script data-dc-script>` 里是 `class Component extends DCLogic`。约定是视觉属性写内联 `style`、文案写字面量、布局用 flex/grid + `gap`。这些约束保证界面上的每个操作都能落到源码里一个确定的位置。幻灯片页面同理，用的是更严格的 HTML/CSS 子集。

### 2. 统一的回写引擎（`packages/core/src/copy.ts`）

所有编辑者都在同一种东西上工作：用 parse5 带源码位置解析模板，再建一份 DOM 副本，每个元素记得自己来自源码的哪一段，并带一个临时句柄 id（`#dc12`，按深度优先编号，从不落盘）。

编辑完成后，比较副本和原始语法树，生成**最小文本补丁**：

- 只改了属性：只替换那一个属性；
- 只改了文字：只替换那段文字；
- 子元素增删或重排：才重写父元素的内部，而且没动过的子元素直接拷贝原文，不重新序列化；
- 样式按文本编辑而不是走 CSSOM，所以 `background:{{r.bg}}` 这类带占位的声明不会丢。

人的操作（`applyHumanOps`）、快速 AI 的 jQuery（`FastEditSession`）、冲突后的重放，全都走这一个引擎。

### 3. 快速 AI：输出的是“编辑操作”，不是新文件

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
- **保存**：改完后作为一次普通编辑保存；如果期间文件被别人改了，就把这些语句在新版本上重放一遍。

### 4. 协同：版本号 + 重放，加一份 journal

- 每个文件的版本号是内容哈希。保存时带上基于的版本，不一致就返回 409 和当前内容。
- 编辑器里每次编辑都以“源码 → 新源码”的函数入队，乐观地先显示；遇到 409 就在新版本上重新执行这个函数再保存。两个人同时改同一个文件，两边的改动都会保留。
- 撤销按上下文定位自己的那处改动，所以别人改了同一文件的其他地方，你照样能撤销自己的。
- journal 记录所有编辑者的改动（手改、jQuery、快速 AI、Claude、外部、撤销），实时推送到所有打开的编辑器，也作为快速 AI 的上下文，所以“再来一个”“少一点”这类话它能听懂。

### 5. 沙箱

画板和 AI 代码都运行在 `sandbox="allow-scripts"` 的 iframe 里（不同源，拿不到编辑器的 cookie 和存储），并用 CSP 禁止网络请求（画板只允许 Google Fonts 和图片）。编辑器与它们只通过 `postMessage` 通信，协议定义在 `packages/core/src/protocol.ts`。

## 项目结构

```
packages/core       格式解析、DOM 副本、最小补丁回写、人工操作、jQuery 执行会话、语句切分、提示词；
                    幻灯片的 deck.json、子集检查、形状/图标/连线绘制；设计系统的 tokens 语法与 tokens.css
packages/sandbox    画板运行时（模板 → React、选中、就地改字）和 AI 执行器，esbuild 打成 IIFE
apps/server         Hono：文件读写与版本、SSE、journal、文件监听、快速 AI 流式代理、委托 claude CLI、git 提交
apps/editor         React + Vite + zustand 的画布、幻灯片（components/slides）和设计系统编辑器
projects/           演示项目：demo（画布）、math-deck（幻灯片）、math-ds（设计系统）
.claude/skills/     给 Claude Code 看的格式说明：dc-canvas、slides、design-system（委托时会让它先读）
artifact/           原版五种类型（Design、Slides、Dashboard、Docs、Design System）的参考材料，私有
docs/               扩展到其他类型的方案；docs/images/ 是 README 用的截图
e2e/                Playwright 端到端测试和一个模拟的 Messages API
```

## 开发与测试

```bash
pnpm test           # core 单元测试：解析、回写、jQuery 会话、语句切分、撤销重定位、幻灯片、设计系统
pnpm typecheck
```

端到端测试需要先 `pnpm dev`，以及 Python 版 Playwright（用别的 Chromium：`DC_CHROME=/path/to/chrome`）。

| 命令 | 覆盖 |
|---|---|
| `python3 e2e/e2e.py` | 画布：面板、图层、样式、改字、结构操作、剪贴板、拖动/拖出、画布工具、页面、导出、并发、撤销、播放（40 项） |
| `python3 e2e/slides.py` | 幻灯片：缩略图与分节、改字、删除与撤销、拖动钉住的元素、备注、新建/复制/排序/删除、格式检查、jQuery、放映、导出（20 项） |
| `python3 e2e/ds.py` | 设计系统：封面与品牌手册、改颜色/改名带别名/增删、文字与圆角、组件预览、上传资源、外部改坏后的提示、新建、装进幻灯片后选 token 与文字样式、移除（22 项） |
| `python3 e2e/fast.py` | 快速 AI：流式执行、报错撤销、重试、回写 |
| `python3 e2e/fast_slides.py` | 幻灯片上的快速 AI：报错重试、越出幻灯片格式时撤销并把原因告诉模型 |
| `python3 e2e/delegate.py` | 真的调用本机 `claude` CLI |

快速 AI 的两项测试使用模拟模型（第一次故意给一行会报错的语句）：

```bash
python3 e2e/mock_anthropic.py &
ANTHROPIC_API_KEY=x ANTHROPIC_BASE_URL=http://127.0.0.1:8790 pnpm dev
```

## 与原版的差别

| | 已实现 | 尚未实现 |
|---|---|---|
| **画布** | 画布外壳（工具条、页面、缩放、同步记录）、右侧面板（图层/属性/代码/Tweaks）、选中与层级导航、就地改字、拖动重排与拖出自由摆放、改尺寸、编组/解组/翻转/排序、剪贴板、便签与形状/箭头/手绘、多页面、画板改名/改尺寸/全屏/导出 PNG、播放模式与画板间链接、`<dc-import>` | 评论、多选、导出 PDF、快速 AI 修改画板布局（`canvas.json`） |
| **幻灯片** | deck.json 与每页一个文件、缩略图条与分节、拖动排序、新建/复制/跳过/删除、插入文字/图片/表格/形状/连线/图标、演讲者备注、子集检查、放映（出场动画、fade/push 切换、备注栏、全屏）、HTML/PDF/备注导出 | 神奇移动（magic 按淡入处理）、PPTX 与 Google Slides 导出、图片裁剪、表格合并单元格的编辑 |
| **设计系统** | tokens 浏览与原地编辑、tokens.css 生成、语法检查、组件预览、资源管理、装进画布与幻灯片 | 组件挂载到画布、页内模型 |
| **AI 与协同** | 快速 AI 的流式执行/重试/日志/委托、Claude Code 委托、版本冲突重放、journal、撤销重做、git 提交 | 快速 AI 一次只改一个画板，跨画板的事交给 Claude Code |

原版的 agent 基础设施（托管、权限、发布）不在复刻范围内。
