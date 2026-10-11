# DC Canvas

一个可以让人和 AI 同时编辑的设计画布。设计稿存成普通文件（`canvas.json` + 每个画板一个 `.dc.html`），三方都能改它，而且改的都是同一份源码：

- **人**：在画布上点选元素、双击改字、在属性面板调样式和 Tweaks、拖动画板。
- **快速 AI**：模型逐行输出 jQuery 语句，在沙箱里对设计副本执行，画板随之一行一行地变，几秒内完成。
- **Claude Code**：适合改脚本、数据、跨画板的事。它直接编辑文件，画布通过文件监听实时更新。

每一次改动都只回写源码里真正变了的那几个字符，模板里的 `{{占位}}`、循环和你的排版保持原样，所以这些文件可以放进 git、交给 Claude Code，也可以手写。

文件格式沿用 Claude 的 Design 画布（`.dc.html` 设计组件），这是对它的双向编辑机制的开源复刻。

## 快速开始

```bash
pnpm install
pnpm dev            # 编辑器 http://localhost:5173 ，服务端 :8787
```

打开 http://localhost:5173/?p=demo 看演示画布。

| 环境变量 | 作用 |
|---|---|
| `ANTHROPIC_API_KEY` | 开启快速 AI（服务端用 Anthropic SDK 调模型）。也支持 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`。 |
| `DC_FAST_MODEL` | 快速 AI 用的模型，默认 `claude-haiku-5-5`。 |
| `DC_DELEGATE_MODEL` | 交给 Claude Code 时用的模型（不设则用 CLI 默认）。 |
| `DC_PROJECTS` | 画布目录，默认仓库里的 `projects/`。 |
| `PORT` | 服务端端口，默认 8787。 |

"Claude Code" 这条路需要本机能运行 `claude` 命令。没有 API key 也能用：jQuery 模式可以手写语句，走的是和快速 AI 完全相同的执行与回写链路。

生产方式运行：`pnpm start`（先构建，再由服务端在 8787 端口同时提供 API 和编辑器）。

## 它是怎么做到双向编辑的

```
            ┌──────────── 唯一真相：projects/<name>/*.dc.html（每个文件有版本号）────────────┐
            │                                                                               │
  画布手改（秒）          快速 AI（秒）                     Claude Code（分钟）         终端 / git
  DOM 操作 → 回写      jQuery 在沙箱副本上执行 → 回写         直接改文件                  直接改文件
            │                   └── askClaude() 委托 ──→           │                         │
            └──────────── 共享 journal：谁、什么时候、改了什么 ←── 文件监听 ──────────────────┘
```

### 1. 一个格式受约束的源文件

`.dc.html` 是一页自包含 HTML：`<x-dc>` 里是模板（`{{path}}`、`<sc-for>`、`<sc-if>`、`<dc-import>`），`<script data-dc-script>` 里是 `class Component extends DCLogic`。约定是视觉属性写内联 `style`、文案写字面量、布局用 flex/grid + `gap`。这些约束保证画布上的每个操作都能落到源码里一个确定的位置。完整规则见 [`.claude/skills/dc-canvas/SKILL.md`](.claude/skills/dc-canvas/SKILL.md)。

### 2. 统一的回写引擎（`packages/core/src/copy.ts`）

所有编辑者都在同一种东西上工作：用 parse5 带源码位置解析模板，再建一份 DOM 副本，每个元素记得自己来自源码的哪一段，并带一个临时句柄 id（`#dc12`，按深度优先编号，从不落盘）。

编辑完成后，比较副本和原始语法树，生成**最小文本补丁**：

- 只改了属性：只替换那一个属性；
- 只改了文字：只替换那段文字；
- 子元素增删或重排：才重写父元素的内部，而且没动过的子元素直接拷贝原文，不重新序列化；
- 样式按文本编辑而不是走 CSSOM，所以 `background:{{r.bg}}` 这类带占位的声明不会丢。

人的操作（`applyHumanOps`）、快速 AI 的 jQuery（`FastEditSession`）、冲突后的重放，全都走这一个引擎。

### 3. 快速 AI：输出的是"编辑操作"，不是新文件

模型拿到的上下文依次是：画布概览、你正在看的画板、目标画板带句柄的标记、journal、你指着的元素、你的话。它的回复只能是 jQuery 语句，一行一条：

```js
$('#dc12').css('color', '#7c3aed')
$('#dc12').after(`<ul style="margin: 0; padding-left: 18px"></ul>`)
$('#dc12').next().append(`<li style="font-size: 14px"></li>`)
$('#dc12').next().children().first().repeat(3)
.text((i) => ['计划', '构建', '发布'][i])
```

- 流式执行：每写完一行就在沙箱里执行，画板马上显示草稿（虚线框）。
- 任何一行报错，整次回复撤销，把错误告诉模型重写，最多重试两次。
- `log(x)` 让模型先看看某个元素的当前状态；`askClaude()` 把请求原样委托给 Claude Code。
- 改完后作为一次普通编辑保存；如果期间文件被别人改了，就把这些语句在新版本上重放一遍。

### 4. 协同：版本号 + 重放，加一份 journal

- 每个文件的版本号是内容哈希。保存时带上基于的版本，不一致就返回 409 和当前内容。
- 编辑器里每次编辑都以"源码 → 新源码"的函数入队，乐观地先显示；遇到 409 就在新版本上重新执行这个函数再保存。两个人同时改同一个文件，两边的改动都会保留。
- 撤销按上下文定位自己的那处改动，所以别人改了同一文件的其他地方，你照样能撤销自己的。
- journal 记录所有编辑者的改动（手改、jQuery、快速 AI、Claude、外部、撤销），实时推送到所有打开的画布，也作为快速 AI 的上下文，所以"再来一个""少一点"这类话它能听懂。

### 5. 沙箱

画板和 AI 代码都运行在 `sandbox="allow-scripts"` 的 iframe 里（不同源，拿不到编辑器的 cookie 和存储），并用 CSP 禁止网络请求（画板只允许 Google Fonts 和图片）。编辑器与它们只通过 `postMessage` 通信，协议定义在 `packages/core/src/protocol.ts`。

## 目录

```
packages/core      格式解析、DOM 副本、最小补丁回写、人工操作、jQuery 执行会话、语句切分、提示词
packages/sandbox   画板运行时（模板 → React、选中、就地改字）和 AI 执行器，esbuild 打成 IIFE
apps/server        Hono：文件读写与版本、SSE、journal、文件监听、快速 AI 流式代理、委托 claude CLI、git 提交
apps/editor        React + Vite + zustand 的画布编辑器
projects/demo      演示画布
.claude/skills     给 Claude Code 看的格式说明（委托时也会让它先读）
e2e                Playwright 端到端测试和一个模拟的 Messages API
```

## 测试

```bash
pnpm test                         # core 的单元测试：解析、回写、jQuery 会话、语句切分、撤销重定位
pnpm typecheck

# 端到端（需要先 pnpm dev，以及 Python 版 Playwright）
python3 e2e/e2e.py                # 选中、改样式、双击改字、jQuery、外部修改、两人并发、撤销、拖动、播放
python3 e2e/mock_anthropic.py &   # 模拟模型：第一次故意给一行会报错的语句
ANTHROPIC_API_KEY=x ANTHROPIC_BASE_URL=http://127.0.0.1:8790 pnpm dev
python3 e2e/fast.py               # 快速 AI：流式执行、报错撤销、重试、回写
python3 e2e/delegate.py           # 真的调用本机 claude CLI
```

## 和原版的差别

已实现：画板与便签、选中与属性面板、就地改字、Tweaks（写回 `data-props`）、复制/删除/移动、播放模式与画板间链接、`<dc-import>`、快速 AI 的流式执行/重试/日志/委托、Claude Code 委托、版本冲突重放、journal、撤销重做、git 提交。

没有实现：设计系统的安装与组件挂载、资源上传、评论、多页面、导出（PDF/图片）、手绘形状、多选、把 flex 子元素拖出来自由摆放、快速 AI 修改画板布局（`canvas.json`）。快速 AI 一次只改一个画板，跨画板的事交给 Claude Code。
