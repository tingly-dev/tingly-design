# 往打开的项目里导入：一个入口，按类型和文件决定去处

状态：**已实施**。测试是 `e2e/import_here.py`；从启动页新建一个导入项目见 [import-external-material.md](./import-external-material.md)。

## 1. 要解决的问题

导入原来只有一个入口：启动页的"导入 HTML 或 SVG"，结果总是**新建**一个画布。可真实的工作多半是往已有的东西里加：一张画布做到一半，要把另一张网页、一个 Figma 里复制的图形、几张截图放进来对照；一份文档要并进一份现成的 Markdown；一个看板要接上一份刚导出的 CSV；设计系统要加品牌字体和图标。这些都得先离开项目，或者交给 Claude Code 去搬。

## 2. 考虑过的做法

| 做法 | 问题 |
|---|---|
| 每种类型各写一个"导入"对话框 | 六份交互、六份拖放和粘贴处理，会各自走样；CLAUDE.md 要求跨类型功能只做一次 |
| 一个导入对话框，先选"导入成什么"（新画板 / 图片 / 标签页…） | 模式选择器（ux-principles §2）：人得先回答一个系统其实知道答案的问题 |
| 只在启动页导入，导入后再"移动到"别的项目 | 多一步，而且大部分类型之间根本不能移动内容 |
| **一个共用入口，类型和文件本身决定去处**（采用） | 每种类型只需说清"我收什么、收了变成什么" |

## 3. 决定

**一个部件 `ImportHere`（`apps/editor/src/components/ImportHere.tsx`），三种进入方式，同一个结果：**

- 栏里"导入 / 导出"菜单的导入一段（共用的 `FileMenu`，见 [export-menu.md](./export-menu.md)）：先用一句话说这种类型收什么、变成什么（教育内嵌，§8），再是"选择文件…"、（收网页或 Markdown 的类型）"选择文件夹…"，和（幻灯片、动效）"从项目导入…"：从画布挑一个画板复制进来，见 [import-from-project.md](./import-from-project.md)。
- 把文件拖到编辑器任何地方：拖动时整个编辑器显示虚线框和同一句话，说清松手后会发生什么。
- 粘贴：剪贴板里的文件，或 SVG 代码（Figma 的"复制为 SVG"）。正在输入框或正文里打字时的粘贴不算导入。

⌘V 在编辑器里不再在按键时直接做编辑器内的粘贴，而是等浏览器的 paste 事件：系统剪贴板里有能导入的文件或 SVG 时导入，否则（包括剪贴板里就是刚在编辑器里复制的那段，哪怕里面有 SVG）照旧粘贴编辑器内复制的东西；有的浏览器在没有输入框时不发 paste 事件，按键后等一小会儿没等到就照旧粘贴。拖动文件时，画板、幻灯片和看板页面的 iframe 暂时不接鼠标事件（`body.filedrag`），否则拖到它们上面的文件会被 iframe 吞掉；拖动若从 iframe 上方进入窗口，遮罩要等指针经过编辑器自己的区域才出现。

编辑器里别的拖放和粘贴（提示栏的附件、设计系统素材页的拖放区、幻灯片缩略图的拖动排序）先处理的，导入不碰（看 `defaultPrevented`）。导入期间顶部有一条"正在导入 …"，结束时用 toast 说结果；收不了的文件直接说"这里能导入的是：…"，不静默忽略。

**每种类型给出一个 `ImportTarget`**：`accepts`（收哪些材料）、`what`（那一句话）、`run`。材料按扩展名分六种：网页、SVG、图片、Markdown、数据（CSV/TSV/JSON）、字体。

| 类型 | 收什么 | 变成什么 | 原文件放哪 | 为什么这样 |
|---|---|---|---|---|
| 画布 | 网页（连同文件夹）、SVG | 新画板，放在**当前页**已有内容的右边、顶端对齐，视图移过去 | `uploads/`（单个文件按内容命名，文件夹保留目录结构），画板直接引用 | 不挪动、不覆盖已有的任何东西；放在右边而不是落点，因为一张网页的画板通常比屏幕还大，压在别的画板上没法看 |
| 画布 | 图片 | 画布上的图片项（`notes` 里 `kind: "image"`），落在松手的位置（按钮导入则在屏幕中央），最长边不超过 800 px | `uploads/`，图片项 `src: "uploads/…"` | 图片是对照材料，放在人手指着的地方（§12） |
| 幻灯片 | 图片、SVG | 当前这张幻灯片上的图片，居中，多张依次错开 | `uploads/`，`src="uploads/…"` | 放图片和"插入图片"是同一件事；幻灯片的导入一段里有"从项目导入…"（画布的画板，见 [import-from-project.md](./import-from-project.md)），拖放和粘贴仍只收图片；网页不收：幻灯片是封闭的 HTML 子集，任意网页放不进去，整套幻灯片的导入是 PPT（评估中） |
| 文档 | Markdown（连同文件夹） | 每个文件一个新标签页，排在最后，标题取第一个 `#` 标题，导入后打开最后一个 | `uploads/`；文件夹里被引用的图片保留目录结构，标签页里改写成 `../uploads/…` | 标签页是可编辑的副本，原文件留着对照 |
| 看板 | CSV、TSV、JSON 表格 | 每个文件一个数据集 `datasets/<id>.json`（`source.kind: "file"`），在"数据来源"里打开 | `data/<id>.<扩展名>` | 看板只从 `data/` 读文件；id 和文件名避开已有的，不会覆盖；读不出表格的 JSON 在写入任何东西之前就拒绝 |
| 设计系统 | 字体、图片、SVG | 字体加进字体并写进 `tokens.json`；图片和 SVG 加进素材的 Other 分组 | `fonts/`、`assets/Other/` | 这些是设计系统**自己的**文件（会被装入画布和幻灯片），不是留作参考的材料，所以放在系统放它们的地方，和"字体""素材"页的上传一样 |
| 动效 | 图片、SVG | 播放头所在场景上的图片，按主尺寸居中，多张依次错开；带 `data-in="fade 300ms @<播放头>"`，停在场景开头（落定页）时从 0 开始，并且总在场景结束前完全进来 | `uploads/`，`src="uploads/…"` | 和幻灯片一样是"往这一页放图"；从播放头入场，因为人停在哪一刻插入，就是要那一刻多一个东西（[motion-editing.md](./motion-editing.md) §3.9）。顶栏有导入按钮，因为动效没有"插入图片"。网页不收，理由同幻灯片。编辑舞台、播放器和命令行渲染都能解析场景里的相对路径（渲染时内联成 data: URL） |

**"人带进来的东西放 `uploads/`"** 这条规则（[import-external-material.md](./import-external-material.md) §12）在这里推广到所有导入；例外只有两种，都写在上表里：看板的数据必须在 `data/`，设计系统的字体和素材本身就是作品。顺带，幻灯片的"插入图片"和文档的插入图片也改存 `uploads/`，和导入一致。

**画板的来历跟着画板走**：每个导入的画板在 `canvas.json` 的条目里带 `imported: { from, source?, original?, at, width }`，不再写在画布顶层。一张画布可以有好几次导入，来历只有记在画板上才分得清。

**放到已有画布上**是 `@dc/import` 的纯函数 `addToCanvas(canvas.json, 生成结果, { taken, page })`：重新起不冲突的文件名（第一个画板用网页标题，`SpringLaunch.dc.html`），算出位置，返回新文件、画板列表、要移到的区域，以及一个 `merge`：编辑器的写回队列遇到别人同时改了 `canvas.json` 时，用它把同样的画板加到更新后的版本上，而不是覆盖。

## 4. 代码在哪

| 位置 | 内容 |
|---|---|
| `apps/editor/src/components/ImportHere.tsx` | 按钮和菜单、全编辑器的拖放和粘贴、材料分类、`ImportTarget` 接口 |
| `apps/editor/src/importer.ts` | `readPage`（排版并读回）、`keepPicked`（存进 `uploads/`）、`writePage`（生成画板）；启动页的 `importPicked` 也由它们组成 |
| `apps/editor/src/components/canvas/canvasImport.ts` | 画布的目标 |
| `slides.ts` `slidesImport`、`docs.ts` `docsImport`、`dash.ts` `dashImport`、`ds.ts` `dsImport` | 其余各类型的目标，挨着各自的写文件函数 |
| `packages/import/src/generate.ts` `addToCanvas` | 放到已有画布上 |
| `apps/editor/src/components/canvas/Item.tsx` | 图片项的相对路径按项目解析 |

## 5. 还没做的

- **启动页仍只认网页和 SVG**：拖进 Markdown 或 CSV 还不会新建文档或看板。做法很直接：按材料选类型，新建后跑同一个 `ImportTarget`；要解决的是新建之后才打开编辑器、导入要在编辑器里跑的时序。
- **网页 → 文档**、**PPT → 幻灯片** 仍在评估（[import-external-material.md](./import-external-material.md) §5、§6）。
- 撤销一次画布导入只撤掉 `canvas.json` 里的条目，画板文件和 `uploads/` 里的原文件留着（不再出现在画布上）。
- 文档的导入只收 Markdown；正文里插图片仍用斜杠菜单。
- 编辑器里排版只适合静态网页；要跑脚本才显示内容的页面仍要在终端用 `dc-import`，而终端只会新建项目，不会加进已有画布。
