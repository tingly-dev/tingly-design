# 文档导出到微信公众号

状态：**已实施**（文档一个类型：菜单项、预览、复制、保存为 HTML、命令行）；§7 的实测、代码高亮、脚注、API 发草稿是没做的。调研（参考实现、编辑器限制、方案比较）在 [.research/wechat-export.md](../.research/wechat-export.md)，这里只写现行设计。入口在 [export-menu.md](./export-menu.md) 的文档一行；文本来源和取舍沿用 [docs-markdown.md](./docs-markdown.md)。

## 1. 问题

写好的文档要发到公众号。公众号后台的文章编辑器对粘贴进来的 HTML 做白名单过滤：`<style>`、class、`var()` 被丢，只认标签自己的 `style`；本地图片是项目里的相对路径，到了后台读不到；Mermaid、公式、CSV 围栏是编辑器现画的。已有的出口没有一个能直接贴：HTML 靠样式表，Word 要先在 Word 里打开再复制，Markdown 要另找排版工具。

发布本身总要在后台做，所以不指望绕开粘贴，要的是**贴过去就是成品**，并且在贴之前能看到大概的样子、知道一路上改了什么。

## 2. 决定

**一个菜单项，打开预览，预览里复制。** 文档的"导入 / 导出"菜单有"微信公众号…"（整篇）和"微信公众号（当前标签页）…"（沿用 Markdown 导出那样两项分开写）。点开是一个对话框：左边手机宽度（375px）的预览，右边是这次改了什么（问题清单）、一句提示，以及三个动作："复制"（主）、"保存为 HTML"、"打开公众号后台"。不做模式选择，也不是盲目复制：预览是下一步动作（贴进后台）之前的最后一眼。

**预览是我们对粘贴的模拟，不是公众号过滤后的真实结果。** 它显示的就是要复制的那份 HTML，所以预览和输出不会各漂各的；提示里写明以后台实际的样子为准。真实过滤只有贴进后台才知道，这是 §7 的实测要校准的。

**转换在核心里，一个纯函数。** `packages/core/src/wechatHtml.ts` 的 `markdownToWechat(markdown, options, referencesTitle)`：输入是导出 Markdown 用的同一份文本（`docToMarkdown`：标题推移、图片路径、`==高亮==` 写成 `<mark>`），用 `marked` 读，**每个标签写出时就带上自己的 `style`**，样式来自一张表（`wechatStyles`，由文档的字体外观派生）。选了这条没选的：

- 先输出带 class 的页面再用 juice 内联（doocs/md 的做法）：要多一个依赖，要在浏览器里跑，Mermaid 的字体名、`undefined` 样式会让它抛错，要写多级回退；而这里输入是 Markdown 加两种已知的行内标记，没有任意 CSS 要解析。
- 在浏览器里取计算样式内联：输出冗长、带上公众号不认的属性、命令行要开 Chrome。

好处是同一个函数在 Node 里就能单测，命令行和 MCP 用同一份：`tingly-design export <文档> --as wechat [--tab …]`（`KIND_CLI` 的 `formats` 里一项，`jobs` 指向同一个菜单项）。命令行不问问题，直接存页面：菜单项在 `headlessActive()` 时不开对话框，存 `<名称>-wechat.html`。

**核心不带文案，也不碰文件。** 图片和画好的图示通过选项进来（`images`、`figures`，都是 `data:` 地址），文末参考链接的标题由编辑器传入；问题以数据返回（`WechatIssue`：`links` / `picture-missing` / `picture-remote` / `figure-missing` / `html-dropped`），由对话框说成话。

## 3. 一路上改了什么（默认，没有开关）

| 内容 | 输出 |
|---|---|
| 标题 h1–h6、段落、粗体 / 斜体 / 删除线、行内代码、引用、列表（含任务项）、分割线、表格 | 带内联样式的同名标签；`code` 明确写 `background:none`（公众号编辑器会给裸 `<code>` 加灰底）；字体跟文档的外观（无衬线 / 衬线），颜色名（`data-color`）用 `DOC_COLORS` 的浅色值，`<mark>` 写成带底色的 `span` |
| 链接 | 指向公众号文章（`mp.weixin.qq.com`）的保持 `<a>`；其他地址在文章里点不开，改成带编号的 `span[n]`，文末追加"参考链接"列表（同一地址一个号；链接文字就是地址本身的不再列）|
| 本地图片 | 取回字节，宽度超过 1080 缩到 1080，大于 1MB 的存成 JPEG（0.85），SVG 画成 2 倍 PNG，GIF 原样；内联为 `data:`；读不到的留成文字说明并列进问题清单。远程图原样保留并提示（编辑器可能不加载） |
| Mermaid、LaTeX 围栏 | 编辑器按浅色画成图片（Mermaid 用 `htmlLabels:false` 的 SVG 再画成 PNG，公式用 KaTeX 画在屏外节点再取图），2 倍，白底；画不出来的列进问题清单 |
| CSV / TSV 围栏 | 真表格 |

画 SVG 成图时一律走 `data:` 地址，不走 `blob:`：Mermaid 的标签里有 `foreignObject`，从 `blob:` 地址载入再画到画布会让画布“被污染”、取不出 PNG（做的时候真遇到了，那一块被当成画不出来而略去）。
| 代码块 | 带内联样式的 `section > pre > code`，每行一个 `<br>`，行首空格写成 `&nbsp;`；**没有语法高亮**，也不模仿公众号原生的 `code-snippet__*` 结构（没验证编辑器会采用） |
| 其他原始 HTML | 略去，问题清单里说一声；只带 `<mark>`、`<span data-color>`、`<br>` |
| 暗色 | 复制永远用浅色值，不跟编辑器的暗色主题 |

输出不含 `<style>`、`<link>`、`<script>`、class、id、`var()`，也不用 position / float / flex / grid / transform / animation / box-shadow（`wechatHtml.test.ts` 把这条当不变量查：每个块级标签都有 `style`，标签配对，不含这些）。

## 4. 剪贴板

`text/html`（那份 HTML）加 `text/plain`（文字，一个块一行）一起写（`ClipboardItem`）。页面不让写时，退到屏外 `contenteditable` 里选中再 `execCommand('copy')`；再不行就下载页面，提示里说明改成了下载（和"复制为 PNG""复制为 Markdown"一样，不安静失败）。"保存为 HTML"存的页面是一个 `<body>` 里放着同一份 HTML 的单文件，图片都在里面，用浏览器打开、全选、复制、粘贴也行。

## 5. 范围，故意没做的

- **只有文档**。幻灯片、画布、动效的出口是图片，公众号直接贴图；在 [project-kinds.md](./project-kinds.md) 的矩阵里记为有意不做。
- **不调公众号 API**（`draft/add`、`media/uploadimg`）：要 AppID / AppSecret 和服务端 IP 白名单，是另一类功能，而且 `uploadimg` 限 1MB 的 jpg/png。
- **没有"公众号样式"预设**（调研里的插件有 8 套主题）：先跟文档自己的外观，有人要再做。
- **评论、脚注（`[^1]`）**：评论不导出；脚注语法文档的 Markdown 还不渲染。

## 6. 验证了什么

- 核心单测（`packages/core/test/wechatHtml.test.ts`）：不变量、样式、编号链接、图片、围栏、纯文字。
- 端到端（`e2e/wechat.py`，14 项）：菜单项、手机宽度预览、问题清单、复制进剪贴板（带图片，Mermaid 块是图片）、保存为 HTML、标签页范围。
- 命令行路径（`export --as wechat`）只验了命令表和类型；本容器里命令行的 Chrome 起不来，没有端到端跑过。

## 7. 没验证 / 还开着

- **真实公众号后台的行为**：`data:` 图片粘贴后是否被接受并转存、1MB 的体量对不对、嵌套列表和 `overflow-x:auto` 的代码块是否保持、手机端和暗色模式的样子。没有后台账号，调研里的"公众号收什么"来自第三方文章和 doocs/md 的源码，不是官方规格。做法是：一个有后台的人把导出的页面贴一遍（`data:` 图片三种大小、表格、代码块、嵌套列表、外链），结果写回这里和调研笔记，再据此改默认。**如果 `data:` 图片被拒**，默认要改成"导出 .zip（页面加图片文件），去后台逐张传"，并把预览里的图片问题提到最前。
- 代码语法高亮（需要引入一个高亮库，按语言上内联颜色）；脚注语法；Mermaid / 公式是否改成矢量 SVG（doocs/md 做了，约 1500 行适配）；是否有公众号专用样式预设。
- 公式画成图后不跟公众号的暗色模式，白底图在暗色下可能刺眼。
