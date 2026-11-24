# 文档图片的名字：替代文字和图片说明

状态：**已实施**（文档的图片块；Markdown、HTML、PDF、PNG 和微信公众号导出都跟随）。§5 是没做的和还不定的。

## 1. 要解决的问题

文档里的图片原来只有一个 `alt`：插入、拖入或粘贴时写的是文件名（`photo`、`wechat-sample`），之后在编辑器里改不了，也不能加一行给人看的说明。读者看不出这张图是什么，屏幕阅读器读到的也是文件名；Markdown 里本来能写的 `![说明](x.png)` 在编辑器里没有入口，只能去改 `tabs/<id>.md`。

这和 [expand-to-edit.md](./expand-to-edit.md) §7 里"文档的图片"那一行是同一个缺口：非文字元素看着它的人知道想改什么（这张图的说明、替代文字），编辑器却没有地方改。

## 2. 数据放在哪：Markdown 的两个字段

- **`alt` 就是 Markdown 的图片文字**：`![alt](uploads/x.png)`。它一直是 HTML 的 `alt` 属性，导出原样带着。
- **图片说明用 Markdown 的图片 title**：`![alt](uploads/x.png "图片说明")`。这是 CommonMark 就有的第二个字段，`marked`、TipTap 和仓库里所有读 Markdown 的地方都认；文件仍是纯 Markdown，没有新语法，写回引擎照常按块比较（块的"意思"是渲染出来的 HTML，title 变了就是这一块变了）。
- 不另存一份到 `doc.json`：说明和图片是一体的，换标签页、复制块、导入导出、Word 路径都跟着文本走，不会有两份要同步。

考虑过、没有采用的：

| 做法 | 问题 |
|---|---|
| 图片后单独一段当说明（约定以某字符开头） | 破坏"用户在写正文"的直觉；删除、移动图片时说明不会跟着，写回和评论锚点也把它当普通段落 |
| 存成 `<figure><figcaption>` 的 HTML 块 | 编辑器里是原文 HTML，Markdown 往返和块比对都要为它开特例；title 已经是标准字段 |
| 在 `doc.json` 里按图片路径记一张表 | 同一张图用两次就有两个说明；剪贴板复制一段就丢了 |

**title 的两种引号**：说明里有双引号时写成 `'…'`，Markdown 读法相同；序列化在 `ProjectImage.renderMarkdown` 里。

## 3. 编辑：选中图片，旁边一个两格的表单

- 点击图片（TipTap 的 NodeSelection）时，图片下方浮出一个固定定位的小表单，两个输入框：**图片说明**（Caption）和**替代文字**（Alt text）。它不插进正文、不改变版面；图片和已经写好的说明留在原处。
- 说明边打边画：每次输入直接 `updateAttributes('image', …)`（一次改动由 ProseMirror 的历史合成一步），图片下面立刻出现/更新；清空就回到没有说明的样子。
- 没有说明时图片下面什么都不画——阅读时不添噪声；输入框里的占位提示只在选中时出现。
- 表单位置跟着图片的包围盒（滚动、窗口变化都重算），下方放不下就翻到图片上方。
- 词汇沿用浏览器和 HTML 的叫法：Caption、Alt text；中文是"图片说明""替代文字"。

## 4. 画在哪些地方（同一份 Markdown，同一种意思）

| 地方 | 怎么画 |
|---|---|
| 编辑器 | 图片节点改成 React NodeView：`<figure>` 里一张图，有说明时下面一个 `<figcaption>`；字号略小、`--look-muted`（穿了设计系统）或 `--muted`（文档自己的样子） |
| HTML / PDF / PNG（`docHtml`） | `marked` 之后跑 core 的 `captionsAsFigures`：整段只有一张带 title 的图时不画 `<p>`，改画 `<figure>` 和 `<figcaption>`，去掉 `title` 属性（不再是一句重复的 tooltip）；`docLookCss` 给 figure / figcaption 用 `DocLook.muted` 和正文字号 |
| 微信公众号（`markdownToWechat`） | 带说明的图片包成一个 `section`（居中）里放图和一段说明；颜色和字号来自同一个 `DocLook`，内联写出，平台不丢 |
| Markdown 导出 | 原样：`docToMarkdown` 只改路径，title 不动；导入也一样（`markdownToTab` 不碰图片） |
| Word | 还不跟（见 §5） |

`alt` 在每种画法里都是真正的 `alt` 属性；图片加载不出来时，公众号显示 `[alt]`，HTML 显示浏览器的替代文字。

## 5. 边界和还开着的

- **其他自画块**：mermaid、公式、csv/tsv 围栏没有 Markdown 的 alt/title 字段，这一期**不做**。要给它们加说明，得先决定语法（围栏的 meta 行、还是包一层图注），不能顺手把 title 约定套上去。动图（GIF）是图片，和静态图一样有说明。
- **一行里混着文字的图片**（`文字 ![x](a.png) 文字`）：HTML 导出保持行内，不加 figcaption；编辑器里 TipTap 的 image 是块节点，本来也不会和文字同一段。说明主要给"单独一张图"用。
- **Word（.docx）**：`markdownToDocx` 还没有把 title 画成图注；替代文字是否写进 docx 的 `descr` 也没做。
- **说明里的格式**：title 是纯文字，不支持斜体、链接；要富文本得另设计（可能那时就该是一项"图注块"而不是 title）。
- 图片块角部栏的"复制 / 保存原图"仍是另一件事（[block-corner-bar.md](./block-corner-bar.md) §4）。