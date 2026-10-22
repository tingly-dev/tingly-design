# Claude Docs 的图示：它是什么，导出带不带，我们怎么接

状态：**调研**；B 档已做（见末尾“结果”）。

## 问题

从 Claude Docs 把文档带进 Tingly Design（导出 Markdown 或 HTML，再从启动页导入）时，文档里的图示（架构图、流程图）没有跟过来，只剩一行文字。想弄清：Claude 里的图示到底是什么，它有没有自己的渲染逻辑，我们能不能接上。

## 事实（用一份只含一张三框图示的测试文档实测）

1. **图示是代码，不是图片。** 在 Docs 里它是一个 widget 节点：一个 JS 模块，`export default () => <svg viewBox='0 0 760 H' role='img' aria-label='…'>…</svg>`，没有数据，每次画出来都一样。文档里的 embed 块指向这个节点，`caption` 写这张图是什么。
2. **模块里有约定，渲染靠约定。**
   - 每个手写的文字带 `data-claude-text-id='<slug>'`，人在页面里原地改字、评论就靠它；
   - 每个框、泳道、柱子外面有 `<g data-claude-anchor='<slug>'>`，人可以评论“这一部分”；
   - 颜色只用主题变量 `--cds-text-primary`、`--cds-chart-axis`、`--cds-chart-categorical-1…8` 等，明暗两套主题自动跟着变；
   - 带数据的图（图表、时间线、漏斗）用 `<claude.Visualize sources={{rows:…}}>`，位置和数字从行里算，标记带 `datum(row,'col')`，点一个标记能指到那一格数据；
   - 有校验器：不能用 `<style>`、`<use>`、`<foreignObject>`，不能用计算下标，文字不能在循环里写。
3. **Markdown 导出丢掉它。** 导出结果里这张图变成一行 `[embedded content: <caption>]`，导出报告写 `dropped … widget`。
4. **HTML 导出也不带图。** 只有 `<figure data-embed="node/<id>"><figcaption>caption</figcaption></figure>`，没有 SVG。
5. 原版应用里图示可以下载成 PNG、SVG 或 MMD（Mermaid 文本）（来自 `claude-design-artifact` 的 `claude-docs/FINDINGS.md` 对应用代码的阅读，这次没有实际点过下载）。
6. 我们这边：文档标签页是 Markdown，没有图示块；Mermaid 围栏按“编辑器不支持的写法”原样保留，显示为原文（`.design/import-external-material.md`）。`.design/claude-design-format.md` 也写明原版 Docs 的图表和图示块不在 Markdown 里。

所以：看到的“文字”应该就是 `[embedded content: …]` 占位或 caption。**渲染逻辑确实存在，但在 Claude 的运行时里，导出文件里没有。**

## 能接的几档

| 档 | 做什么 | 数据从哪来 | 代价 |
| --- | --- | --- | --- |
| A | 导入时把图示的 SVG 或 PNG 当作文档里的图片放进 `uploads/`，占位行换成图片引用 | 从 Claude 下载的 SVG，或我们通过 Docs 工具读到 widget 代码后渲染 | 小；图只读，不能原地改字 |
| B | 文档支持 Mermaid 围栏的渲染（对应原版的 MMD 下载） | 原版下载的 `.mmd` | 中；需要一个 Mermaid 运行时（沙箱里加载，不进编辑器主包） |
| C | 文档里加“图示块”：一个 `.svg` 文件，保留 `data-claude-text-id`、`data-claude-anchor`，在编辑器里原地改字，评论挂在锚点上 | SVG（A 的数据） | 较大；要定块的存储和评论定位，和 `.design/docs-markdown.md` 的往返规则对齐 |
| D | 在沙箱里直接运行 widget 的 JSX 模块，补 `--cds-*` 主题变量和 `claude.Visualize` | widget 代码 | 最大；要转译 JSX、复刻 `claude.*` 运行时，且是对方未公开的约定，容易漂移 |

建议顺序：先 A（立刻解决“图不见了”），再 B（文本图示可编辑、可被 Claude Code 直接写），C 视需要，D 不做，除非要逐字节往返。

## 没查清的

- 原版应用里下载 SVG / PNG / MMD 的实际文件；需要有人在界面里点一次。
- Docs 的 PDF、DOCX 导出里图示是否被画成图片（这次只试了 Markdown 和 HTML）。
- 从 Claude Docs 的“读取 widget 代码”这条路，对没有 Docs 连接器的用户不可用，只能靠下载文件。
- 我们自己的 agent 写图示时用什么：目前 docs 技能没有图示的写法。

## 结果

选了 B：文档里的 ` ```mermaid ` 围栏现在在编辑器里画成图，同时有 ` ```latex ` 公式和 ` ```csv ` 表格，文件里仍是普通围栏（`.design/docs-markdown.md` §4b，沿用 Mermaid、KaTeX 和核心的 CSV 解析，没有自己造渲染器）。A（导入时把图示当图片）和 C（可改标签的 SVG 块）还开着，见 #261。
