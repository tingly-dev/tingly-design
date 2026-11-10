# 导出到微信公众号:粘贴进 公众号编辑器

状态:**调研**(2026-11-07),第一版已按 §6 的建议实现,现行设计见 [.design/wechat-export.md](../.design/wechat-export.md)。对应 issue #433。下面是调研当时的事实、选项和建议;"未验证"的地方都标出来了,最大的一项是 `data:` 图片粘贴进真实公众号后台的行为(没有账号可测)。

## 问题

公众号后台的文章编辑器对粘贴进来的 HTML 做白名单过滤。我们的文档现有出口(PDF、Word、Markdown、HTML、PNG,见 `.design/export-menu.md`)没有一个能原样贴进去:HTML 导出靠 `<style>` 和 class,过滤后只剩无样式的文字;本地图片是项目里的相对路径;Mermaid / LaTeX / CSV 围栏是编辑器里现画的。要的是一个"复制为公众号格式"的动作,贴进去就是成品。

## 1. 参考实现 1:FFengIll/vscode-wechat-md

VS Code 扩展,仓库属于本项目的维护者(FFengIll),**授权没有问题**:代码可以直接搬进本仓库,不受它自带的 MPL-2.0 约束(版权人可以另行授权;搬入时按本仓库的 Apache-2.0 处理即可,可在文件头注明出处)。读的是 `main`(`490b61c`)。

**管线**(`CLAUDE.md`、`src/renderer/index.ts`):`markdown-it` 实例两个,`mdPreview`(预览,Shiki 高亮)和 `mdCopy`(复制,公众号结构的代码块),共用 `applyWeChatRules()`(`src/renderer/rules.ts`):把每个 markdown-it 渲染规则(`heading_open`、`paragraph_open`、`blockquote_open`、`ul`/`ol`/`li`、`hr`、`strong`、`em`、`a`、`img`、`table`/`th`/`td`、`code_inline`)改成输出 **带 `style="…"` 的标签**。样式来自 `Theme` 对象(`src/renderer/theme.ts`:读 `.wechat/theme.css` 的 CSS 变量 + 颜色预设 JSON 拼出每个元素的 style 字符串),再叠一层"按类目的装饰预设"(`stylePresets.ts` 974 行:h1–h3、引用、列表、链接、图片、分割线、表格、行内代码)和用户的 `.wechat/custom/<类目>.css`。**没有用 juice 之类的内联库**:因为它自己生成标签,每条规则直接写 `style`,这也是它的核心取舍(CLAUDE.md:"every renderer rule must emit inline styles")。

**容器**(`containers.ts`,`markdown-it-container`):`::: card|tip|info|warning|center` 一份封闭目录,里面还是正常 Markdown;刻意不做用户自定义 HTML 结构,理由是每种效果都能证明"贴进微信不坏"并能被测试覆盖。

**图片**(`src/panel/imageUtils.ts`):复制时 `resolveImagesAsBase64()` 把 `<img src>` 里 `vscode-resource`、`file://`、相对路径读成文件、换成 `data:image/<ext>;base64,…`;`http(s)` 远程图原样不动。读不到的留原样。**不缩放、不压缩、不上传。**

**代码块**(`wechatTransformer.ts`):复制模式输出公众号编辑器自己的代码块结构 `<section class="code-snippet__js"><pre class="code-snippet__js code-snippet code-snippet_nowrap" data-lang="…"><code><span leaf="">…</span></code>…</pre></section>`(每行一个 `<code>`,空行 `<br class="ProseMirror-trailingBreak">`),也就是**模仿编辑器自己插入代码块时生成的 DOM**,希望粘贴后被编辑器认成原生代码块。**语法高亮在复制路径里没做**:`TOKEN_CLASS_MAP` 已定义但没被用,`parseShikiHtml` 是 TODO 占位,复制出来的是纯文字(预览里才有 Shiki)。

**剪贴板**(`src/panel/webview.ts`):扩展的 webview 里没有现成的剪贴板权限,做法是把 HTML 放进一个 `contenteditable` 暂存 div,`Selection` 选中它,`document.execCommand('copy')`,这样系统剪贴板得到 `text/html`(和浏览器的纯文本回退)。工具栏还有"公众号后台"按钮打开 `https://mp.weixin.qq.com`。

**没有的**:数学公式、脚注、Mermaid、链接转文末引用(`grep` katex/mathjax/footnote/mermaid/latex 在 `src`、README、docs 里全无);链接只保留 `href`(`rules.ts` 的 `link_open`);没有表格以外的版面处理。frontmatter 只支持一个 `header` 字段。

**测试**:`test/harness/`(vitest + htmlparser2),`stylePresets.test.ts` 对每个预设断言"没有 `<style>`/`class`、每个元素都有内联样式、标签配对"。这个"不变量测试"的思路值得抄。

**能借什么**:因为是自己的代码,什么都可以直接搬:样式字符串表(`theme.ts`、`stylePresets.ts` 与 `presets/*.ts` 的 8 套主题和 9 个类目装饰)、容器目录(`containers.ts`)、不变量测试(`test/harness/`)、图片转 base64 的逻辑。搬不能原样套用的只有一处:它挂在 `markdown-it` 的渲染规则上,而我们的文档渲染用 `marked`(`apps/editor`、`packages/core`、`packages/export` 都已依赖 `marked 14.1.4`),规则 API 不同,所以要移植的是**样式表数据和规则覆盖的清单**,渲染挂钩要用 `marked` 的 renderer 重写一遍。它和 VS Code 的耦合(`.wechat/` 设置文件、`workspaceState`、webview)不搬。

## 2. 参考实现 2:doocs/md(更成熟,WTFPL)

web 编辑器,许可证 WTFPL(随便用)。它回答了插件没做的那些问题,读的是 `apps/web/src/services/export/`:

- **CSS 内联用 juice**(`clipboard.ts` 的 `mergeCss`):渲染出的预览 DOM 带 class 和 `<style>`,复制时 `juice(html, {inlinePseudoElements: true, preserveImportant: true, resolveCSSVariables: false})`;失败有三级回退(关伪元素、去 font-family)。juice 前后还有一串字符串替换:`var(--md-primary-color)` 等 CSS 变量逐个换成真值、`top:Xem` 换成 `transform: translateY`、`li > ul` 提到 `li` 之后(`modifyHtmlStructure`)、去掉 `a[href^="#"]` 的 href。
- **复制前换浅色重渲染**(`wechatThemeMode: 'light'`):深色主题下预览是深色,复制出去必须浅色。
- **数学**:MathJax `tex-svg` 输出内联 SVG(`packages/core/src/utils/mathjax.ts`,`fontCache: 'none'` 让每个 SVG 自带字形),`prepareMathFormulasForWeChat` 再处理 SVG(深色墨水映射到 `currentColor` 让公众号暗色模式跟随)。
- **Mermaid / PlantUML**(`wechat-svg.ts`,1513 行):把图示 SVG 改到公众号能留下的样子——展开 `<marker>` 箭头成真实 polygon、`<use>` 展开、`url(#渐变)` 变成纯色、`foreignObject` 里的 HTML 标签改放 `<section>`(代码里的注释:"WeChat drops that HTML unless the inner node is a `<section>`")、`dominant-baseline` 换 `dy`、把尺寸固定到 677px 内容列宽(`WECHAT_MAX_WIDTH_PX`)。这是"SVG 能贴进公众号"的最大工程量所在。
- **脚注与链接**:`[^1]` 脚注扩展;"微信外链接转底部引用"(`citeStatus`)把所有外部链接编号收到文末。
- **剪贴板**(`editor-header/index.vue`):`navigator.clipboard.write([new ClipboardItem({'text/html', 'text/plain'})])`,失败回退到离屏 `contenteditable` + `execCommand('copy')`;复制前后各塞一个 `font-size:0` 的空 `<p>`(让公众号编辑器在内容前后有可点的位置)。
- 图片:另有"图床上传"配置;复制本身不上传。

## 3. 公众号编辑器到底收什么

**官方规格(2026-11 找到,第三方之上的权威来源)**:[插件/第三方内容开发规范](https://developers.weixin.qq.com/doc/service/guide/product/plugin_spec.html),配套官方校验器 [wechatjs/verify-article-structure-spec](https://github.com/wechatjs/verify-article-structure-spec)(puppeteer CLI,退出码可接 CI,规则以仓库内 `verify_article_structure.md` 为准)。要点与我们的做法:

| 官方规则 | 对我们的意义 |
|---|---|
| **不建议设置任何 `font-family`**;平台有自己的默认字体栈(`"mp-quote", PingFang SC, system-ui, …`),自设字体在 iOS 17+ 会出现大小/字距不一致 | **已照办**:文章不写 `font-family`(标题粗细仍随衬线选择变 600/700);预览页把平台默认栈放在 body 上,预览即所见 |
| `width`:固定宽度不被鼓励(宽屏不居中/窄屏溢出/不同屏占比不一);建议 `<img>` 带 `data-w`(图片原始像素宽),校验器用它兜底 | **已照办**:图片不再写死 `width:677px`,只留 `max-width:100%`,并写 `data-w`;文字/列宽用 padding 与百分比自适应 |
| `line-height` 不得小于字号(多行重叠);单行与纯图片元素豁免 | 我们的行高全部 ≥1(角色推导也限制在 1–3);`sup` 原写 `line-height:0`,已改 1 |
| `text-align: start/end` 不用(不同端不一致) | 我们只写 left/center/right |
| `<pre>` 不包普通段落(不换行会截断);代码块是它的正当用途 | 我们只在代码块用 `pre`,且 `white-space:pre-wrap` |
| 嵌套:同标签+同样式+单子节点的链 ≤10 层;`span[leaf]` 只装行内;`section[nodeleaf]` 只装官方组件或 `img` | 我们结构扁平、无这些容器,天然合规 |
| 不用 `!important`;`opacity:0` 图片、透明 `caret-color`、`height:0` 容器都会出问题 | 我们从不写这些;`docDecor` 的白名单也拒绝它们 |
| Dark Mode:平台算法自动转色,保对比度;文字背景少用渐变;`data-no-dark` 可让单节点跳过 | 我们全部纯色,交给算法即可,无需标记 |

官方校验器是后续把"预览=模拟"校准成"预览=实测"的现成工具(见 §7);本容器里没跑(puppeteer 要自带的 Chrome)。

下表是官方规格之外的补充说法,来源:几篇中文技术文章的一致说法(来源见末尾)。标"实测?"的是我们没验证、需要用真实账号试。

| 项 | 行为 | 把握 |
|---|---|---|
| `<style>`、`<link>`、class | 粘贴时被删,只认标签上的 `style` | 多处一致 |
| `<script>`、`iframe` | 删 | 多处一致 |
| CSS 变量 `var()` | 不解析,需展开成真值 | 推论(没有样式表,变量无从解析)+ doocs 的做法 |
| `position`/`float`/`flex`/`grid`/`transform`/`animation`/`filter`/`box-shadow` | 部分被删;只靠普通流排版最稳 | 多处说法,细节不一;**实测?** |
| 结构 | 少嵌套 div,用 `section`、`p`、`span` | 经验之谈 |
| 内容列宽 | 约 677px(doocs 常量) | 第三方 |
| 外部链接 | 订阅号 / 未开通支付的服务号**不能**加外链,粘贴的外链失去跳转,只有 `mp.weixin.qq.com` 文章链接可点;"阅读原文"可放一条外链(第三方称 2025-04 起文字里的外链再收紧) | 多处一致,政策会变 |
| 图片 `<img src>` | 外链图常被拒或要靠自动转存;自动转存对粘贴的图"载入成功时"上传到微信图库,载入不成功(防盗链、来源不让)则失败 | 多处一致 |
| `data:` base64 图片 | 超大的会被过滤;小图能否被自动转存**没有可靠资料** | **实测?(本调研最大未知)** |
| 图片大小 | 后台本地上传:jpg/png ≤10MB、gif ≤9MB、宽×高 ≤600 万像素;服务端 `uploadimg`(正文图片):jpg/png ≤1MB | 官方文档 + 文章 |
| SVG | 内联 `<svg>` 可保留;SVG 里引用的 `<image>` 必须是微信素材库地址;`foreignObject` 里的 HTML 要用 `<section>` | doocs 源码注释 + 文章 |
| 代码块 | 编辑器有原生代码块(`code-snippet__*` 结构,见插件);插件作者(本项目维护者)说用这种结构复制的结果几乎能直接贴进官方编辑器 | 作者的使用经验,已照搬;我们自己的输出仍**待实测** |
| `data:` base64 图片(插件的做法) | 插件把本地图片原样内联成 `data:`,作者说贴进去基本可用 | 作者的使用经验(插件不缩放;我们另把大图缩到 1080px / 约 1MB),**待实测** |
| 表格 | 保留,需要内联边框样式 | 多处一致 |

## 4. 我们已有什么(可复用)

- **渲染**:`docHtml()`(`apps/editor/src/components/docs/DocsApp.tsx:194`)用 `marked.parse` + DOMPurify 渲染每个标签页,样式在一个 `<style>` 里——正好是公众号会丢掉的那种。文档的外观(`DocSettings`:标题 / 正文字体 sans/serif、宽度、语言,`packages/core/src/docs.ts`)和文字颜色名(`docColors.ts`,`<span data-color>`)是结构化数据,可以映射成内联样式。
- **Markdown 单一来源**:`docToMarkdown`(`packages/core/src/docMarkdown.ts`)已经把整篇/当前标签页理成一份 Markdown(标题推移、图片路径、`==x==`→`<mark>`),Word 导出就是从它再走一遍(`.design/docs-docx.md`)。公众号导出应沿用,不再从编辑器文档另开一条路。
- **会自己画的围栏**(`richCode.ts`):`mermaid`→SVG、`latex`→KaTeX HTML、`csv`/`tsv`→表格(`parseDataFile`)。KaTeX 的 HTML 依赖 class 和字体,贴进公众号会散;要的是 SVG 或 PNG。
- **SVG→PNG**:Word 导出已有 `svgToPng`(`wordExport.ts`,2 倍绘制);`@dc/export` 有 `rasterize`/`canvasPng`;`imageExport.ts` 有剪贴板写图与"写不进就下载"的退路。
- **导出菜单**:`docsExportItems`(`DocsApp.tsx:218`)已有"复制为 Markdown(当前标签页)"这类剪贴板项,新增一项就是一个 `ExportItem`(菜单、命令行 `export` 的 `KIND_CLI`、MCP 一起带上)。
- 缺的:代码高亮库(编辑器里的代码块没有语法高亮依赖)、juice(不需要,见方案)、一份"公众号样式表"。

## 5. 选项

**A. 自己生成:渲染时直接写内联样式(插件的做法)。** 在核心里写一个纯函数,把 `marked` 的输出(或 token)按"标签 → 样式字符串"的表输出成带 `style` 的 HTML。表由文档的外观(字体、宽度)和颜色名派生。好处:确定性、没有 CSS 解析、能在 Node 里单测、命令行 / MCP 也能用(`export --as wechat`);不需要 juice。代价:每种元素的样式要自己写一遍,用户自己的 HTML 片段(文档里允许的行内 `<span data-color>`、`<mark>`)要单独处理。

**B. 浏览器里内联计算样式(doocs 的做法,juice 或 `getComputedStyle`)。** 用现有的 `docHtml` 页面渲染,再把样式表内联到元素上。好处:预览什么样、复制什么样,新的 CSS 自动跟上。代价:要加 `juice` 依赖(`cssom`/`postcss` 解析,doocs 为它写了三级回退和一堆预处理,因为 Mermaid、字体名会让它抛错);只能在编辑器页里跑,命令行要开 Chrome;输出冗长,会把公众号不认的属性一并带上,要白名单。

**C. 直接移植插件的代码(仓库是自己的,没有授权问题)。** 样式表、预设主题、容器目录、不变量测试可以整块搬进 core,省掉重新设计 8 套主题和类目装饰的工作;渲染挂钩要改写成 `marked` 的 renderer,VS Code 相关的设置文件和状态不搬。它没有数学、脚注、Mermaid、代码高亮,这些我们最需要的部分仍要新写(参考 doocs/md)。C 和 A 并不互斥:A 的"样式表"就从 C 搬来。

**D. 调公众号的 API 直接发草稿(`draft/add` + `media/uploadimg`)。** 图片可以上传成微信 CDN 地址,外链和 `data:` 的不确定都消失,还能放封面。代价:要 AppID / AppSecret、服务端 IP 白名单,`uploadimg` 限 1MB 的 jpg/png;凭据的存放要进 AI 设置那样的对话框(`.design/ai-settings.md` 的风格)。不属于"复制粘贴",是第二阶段。

## 6. 建议

**走 A,样式表和主题从自己的插件搬,SVG 与公式借 doocs 的经验。** 理由:

1. 复制的是**我们自己的文档**,不是任意网页。文档的出口早就是 `docToMarkdown` → `marked`,一张"标签 → 内联样式"的表比引入 juice 再收拾它的解析失败更小也更可测。
2. 输入是 Markdown + 少量已知的行内标记(`<mark>`、`<span data-color>`),没有任意 CSS 要解析。
3. 命令行和 MCP 能用同一份(`KIND_CLI` 里一行),Claude Code 也能直接产出文件。
4. 来源:样式表与预设主题从自己的插件搬(无授权问题),SVG / 公式 / 脚注 / 外链转引用借 doocs(WTFPL 无要求)的做法;只有 `markdown-it` 的渲染挂钩不搬(换成 `marked`)。

**结构**(符合 CLAUDE.md 的分层):

- `packages/core/src/wechatHtml.ts`:`docToWechatHtml(markdown, look, o)` 纯函数。输出带内联样式的 `<section>…</section>`;`o` 带"图片怎么取"(调用方给的回调,核心不碰文件)、"围栏画成了什么"(mermaid / latex 由编辑器画好的 SVG/PNG 传进来)。输入同样是 `docToMarkdown` 的文本。样式表是数据(`WECHAT_STYLES`),**一个单元测试对它做不变量检查**(借自插件的 harness):没有 `<style>`/`class`/`var(`/`id`,每个块级元素都有 `style`,标签配对,不含 `position`/`float`/`flex`/`grid`/`transform`/`animation`/`box-shadow`。
- 编辑器 `apps/editor/src/components/docs/wechatExport.ts`:取图片字节(沿用 `markdownExport` 的收集)、缩放压缩、把围栏画成图、写剪贴板(`ClipboardItem` 的 `text/html`+`text/plain`,不可用时用离屏 `contenteditable` + `execCommand('copy')`,再不行就下载 `.html`,提示写明改成了下载)。
- 菜单:`docsExportItems` 加 `copy-wechat`("复制到公众号",`rule` 分隔线之后、靠近"复制为 Markdown");说明行写"贴进公众号编辑器;外链改成文末编号"。词条走 `common.transfer.label.*` / `hint.*` 的 en + zh。

**默认行为(不做开关,UX 原则里的"聪明默认")**:

- 外链:正文里保留链接文字和颜色样式,**文末追加"参考链接"编号列表**(外部 `http(s)` 的;`mp.weixin.qq.com` 的原样保留 `<a>`)。
- 图片:本地图片取字节,宽度超过 1080px 缩到 1080,PNG 保持 PNG、照片类转 JPEG(质量 0.85),每张目标 ≤ 1MB;内联为 `data:`。**这条以实测为准**(§7);实测不过则退回"导出 .zip(html + 图片),提示去后台逐张传",并把 data: 路线作为默认的假设删掉。
- Mermaid:`mermaid.render` 的 SVG → 画成 PNG(沿用 Word 的 `svgToPng`,2 倍)作为 `<img>`;不走 doocs 那套 1500 行 SVG 改写(那是为了让 SVG 保持矢量并跟随暗色模式,MVP 不需要)。数学同理:KaTeX 渲染 → 画成 PNG。代价是图不可选字、不跟暗色;换来的是不依赖公众号的 SVG 过滤细节。
- CSV / TSV 围栏:输出成真的表格(已有 `parseDataFile`)。
- 代码块:`<section style><pre style><code style>` 带内联样式、等宽字体、横向滚动 `overflow-x:auto`(公众号里窄屏要能滑动),**不做**原生 `code-snippet__*` 结构(没验证编辑器会采用);高亮留作第二步,需引入一个高亮库,按语言给 token 上内联颜色。
- 暗色:复制永远用浅色值(同 doocs;公众号编辑器是白底),不跟编辑器的暗色主题。
- 脚注:Markdown 的 `[^1]` 当前文档不渲染;MVP 不做,作为开放项。
- 文字颜色名(`data-color`)按 `docColors.ts` 的浅色值写成内联色;`<mark>` 写成带背景色的 `<span>`。

## 7. MVP 范围、验证、风险

**MVP(docs 一个类型)**:菜单项"复制到公众号" + 上面的默认行为,当前标签页和整篇各一(沿用 Markdown 导出那样,名称分开写),`export --as wechat`(命令行、MCP 跟着)。幻灯片 / 画布不做(它们的出口是图,公众号直接贴图片就行,故意不做,在 `.design/project-kinds.md` 的矩阵里记一行)。

**动手前必须先实测的**(一个有公众号后台的人,半天):
1. 在后台文章编辑器里粘贴一份手写的 `text/html`,逐项看:`data:` 的 PNG(100KB、800KB、2MB 各一)、`<img>` 外链、`<table>`、`<pre><code>` 带内联样式、内联 `<svg>`、外链 `<a>`、`section` 嵌套、`overflow-x:auto`,记下哪些留下。
2. 同样内容用 doocs/md 复制一份贴进去作对照(它已经被很多人用,能确认 data: 路线可行与否)。
3. 手机预览一次(窄屏、暗色模式)。
结果写回本笔记的 §3,再定默认。

**工作量(估计,没有排期)**:核心转换器 + 样式表 + 不变量测试约 1–2 天;图片缩放与围栏转图 + 剪贴板与回退 1 天;菜单、词条、命令行、文档与 e2e(在每个 `Record` 里加一行,`e2e/coverage.json` 与矩阵要同步)1 天;实测与调样式 1 天;之后的高亮、脚注、可选的公众号专用样式(类似插件的预设)各自另算。

**风险**:公众号的过滤规则没有官方文档,会变(外链政策就在变),所以不变量测试守的是"我们不输出已知会被丢的东西",不是"公众号一定接受";data: 图片行为未知;Mermaid / 公式变成图片后不能在公众号里编辑、暗色模式下可能刺眼(白底图);中文字体在手机上由公众号决定,我们的 `font-family` 只是建议。

## 8. 还开着

- 是否做 D(API 发草稿)——要凭据与白名单,另开一条;
- 高亮用哪个库(体积:Shiki 很大,按需加载 + 限语言集;highlight.js 更小);
- 脚注语法(`[^1]`)要不要进文档的 Markdown 方言;
- "公众号样式"是否要有预设(插件有 8 套主题 + 类目装饰),还是只跟文档自己的外观——先跟外观,有人要再说;
- 是否把 doocs 的 SVG 展开做法(矢量图示、跟随暗色)作为第二步,取代 PNG。

## 来源

- FFengIll/vscode-wechat-md:`CLAUDE.md`、`src/renderer/{index,rules,wechatTransformer,containers,theme}.ts`、`src/panel/{imageUtils,PreviewPanel,webview}.ts`、`LICENSE`(MPL-2.0)。
- doocs/md(WTFPL):`apps/web/src/services/export/{clipboard,clipboard-dom,wechat-svg}.ts`、`apps/web/src/components/editor/editor-header/index.vue`、`packages/core/src/{extensions/footnotes.ts,utils/mathjax.ts}`。
- 公众号编辑器行为(第三方文章,非官方规格):[HTML/CSS 支持情况](https://www.axtonliu.ai/newsletters/ai-2/posts/wechat-article-html-css-support)、[图片转存与内联样式](https://juejin.cn/post/7678988101557190662)、[粘贴图片失败的原因](https://zhuanlan.zhihu.com/p/78437828)、[外链限制](https://yiban.io/blog/14900)、[mdnice 的外链转脚注](https://mdnice.com/writing/878ed8b436ce4a148e08127e97988a1d)。
- 官方:[上传发表内容中的图片](https://developers.weixin.qq.com/doc/subscription/api/material/permanent/api_uploadimage.html)(jpg/png,1MB 以下);[第三方内容开发规范](https://developers.weixin.qq.com/doc/service/guide/product/plugin_spec.html)(CSS/结构/字体/Dark Mode);[wechatjs/verify-article-structure-spec](https://github.com/wechatjs/verify-article-structure-spec)(官方校验器,`verify_article_structure.md` 为权威规则)。

## 9. 不走粘贴,还有什么出口;预览能不能直接做

公众号后台没有我们能确认的"导入 HTML"入口(没核实后台是否能导入 Word,未验证),所以"出口"只有三种,按离粘贴的远近排:

1. **保存成文件,再在浏览器里打开、全选、复制、粘贴。** 单文件 `.html`(内联样式)或带图片的 `.zip`。本质还是粘贴,只是多一步,第三方文章里也把它当兜底(Chrome 打开内联好的 HTML,全选复制)。适合剪贴板写不进的环境(菜单里已有"写不进就下载"的约定)。
2. **API 发到草稿箱**(`draft/add` + `media/uploadimg`,方案 D)。不用粘贴,图片变成微信 CDN 地址,是唯一能绕开 `data:` 图片未知的路。要 AppID / AppSecret 和服务端 IP 白名单,账号有没有接口权限(未认证订阅号)没核实。第二阶段。
3. **导出长图(PNG)。** 现成,但文字变图片,不是文章。

**预览可以直接做,而且不依赖微信。** 复制的 HTML 是我们自己生成的、全部内联样式,把同一份放进一个手机宽度(约 375–414px,正文列宽按 677px 的设计宽度缩放)的 iframe 里渲染,看到的就是"贴过去会是什么样"。建议的形态:**一个"公众号预览"对话框**,左边手机宽度预览,右边(或下面)一个问题清单("3 个外链改成了文末引用""2 张图超过 1MB 已压缩""1 张图读不到"),按钮是"复制"(主)和"保存为 HTML / zip"(备),这样"复制到公众号"菜单项打开的是预览,而不是盲目复制。符合 `.design/ux-principles.md` 的"把成品交到下一步动作手里"。

预览的边界要说清:它是**我们对公众号的模拟**,不是公众号过滤后的真实结果(真实过滤只有贴进后台才知道,§7 的实测就是为了把模拟校准到真实)。预览的成本很低(同一份输出,一个 iframe),可以放进 MVP;API 发草稿不放。
