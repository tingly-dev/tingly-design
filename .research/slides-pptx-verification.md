# PPTX verification

状态：已执行受限模块与产品路径验证；独立 Office 渲染和视觉保真尚未验收。验证日期：2026-10-21。

当前支持范围见 [设计契约](../.design/slides-pptx.md)，候选方案与依据见 [研究](./slides-pptx.md)。本页仅保留可复现的检查、结果和限制，不记录本机目录、输入文稿信息或会话过程。

## 模块与导入回归

| 检查 | 已执行结果 |
|---|---|
| `pnpm --filter @dc/core exec vitest run test/pptx.test.ts test/pptxSmoke.test.ts test/pptxBridge.test.ts test/serverPptxImport.test.ts` | 4 files /88 tests 通过；尽力而为后：包安全与预算仍整份拒绝，对象/页级问题局部化；列表、分组、主题表格与合并、图表重绘、渐变、阴影、页形、API/CLI 与并发重名 |
| `pnpm --filter @dc/export test` | 48 tests 通过；原生对象、单位、文字、图片、备注、输入边界与 writer normalization，及半透明、圆角半径、字距、删除线、不换行 |
| `pnpm --filter @dc/import --filter @dc/i18n test` | 分别 22 /7 tests 通过 |
| `node --test evals/test/evals.test.mjs` | 4 tests 通过 |
| `pnpm typecheck` | 全仓通过 |
| `pnpm build`、`pnpm bundle --no-build` | 产品第一期整合时通过；不代表后续每次源修改均重建过 |

回归用例为独立合成 OOXML，不包含外部输入的文稿、媒体或元数据。额外本地输入经实际 CLI 成功导入，但输入不随仓库分发，该结果不作为公开可复现语料，也不证明视觉一致。表格、裁剪能导入不代表当前原生导出支持它们。

## 浏览器与产品路径

- `python3 -I packages/export/test/pptxDom.browser.py`：实际 Chrome（headless shell），62 assertions 通过，覆盖原生表格（CSS 表格与绝对定位表格的网格、合并、填充、边框、内边距、垂直对齐；格间距和含 SVG 的单元格退回逐元素）、布局、文字行框、折叠空白、媒体、隐藏内容、CSS 叠放顺序、透明度/圆角/单边框/字距/列表符号的原生输出、`self`/`subtree` 逐元素图片化与回滚、取消/预算和无回调时的 unsupported 诊断。
- `python3 -I packages/export/test/pptxProduct.browser.py`：实际 opaque runtime，11 assertions 通过，覆盖解码前图片尺寸限制、图片内联、逐页资源、隐藏资源、字体失败与取消清理。
- `e2e/pptx.py`：逐元素图片化后 90/90 checks 通过（渐变背景页导出为一张图片 + 原生标题文字，不可读图片失败且不下载）；第一期 65/65 checks 通过；拆分格式入口后在隔离工作区运行 89/89 checks 通过，包含三种 picker 的 accept 过滤、PPTX picker/drop/API、ZIP/Markdown/Claude package 回归、编辑保存重开、菜单/CLI/MCP 导出、失败/取消和非 slides 无 PPTX 项。
- 导入摘要初始焦点另有 EN/ZH × light/dark 四组合检查通过。菜单与结果截图保留为本地测试产物；没有发布截图或创建远程 PR。
- 旧 archive / claude_design 完整 UI 套件未在包含个人项目的工作区运行：其目录差集清理策略不适合该环境。对应 picker 关键路径已由隔离 PPTX suite 覆盖，不宣称旧套件整体通过。

## 合成语料与独立 schema

固定语料在 `packages/core/test/fixtures/pptx-smoke/`，共 11 PPTX /20 页（含重复覆盖）；目录 README 和 manifest 说明来源、预期和限制。生成器直接使用 PptxGenJS，而非本项目 writer。`generate.mjs --check` 已逐字节通过。

可选工具 `scripts/validate-pptx/` 使用 Open XML SDK 3.3.0 / Office2019 schema。已执行：

- 全部 11 份合成 PPTX，含嵌入 XLSX：0 errors。
- 真实 writer 的四份成品（含备注/混合 run、无备注、多页）：0 errors。
- 实际菜单、CLI、MCP 三入口导出成品：3 PPTX /0 errors。
- validator 自测：坏 ZIP、非法 XML/schema、坏嵌入 XLSX、缺失输入、目录/符号链接边界、诊断截断和源文件不变。

独立检查曾发现 writer 的 notes master 顺序、重复段落属性及不存在的 master content-type 声明。当前 pinned PptxGenJS 4.0.1 输出的有限 normalization 修复这些问题；未知结构失败，不是通用 OOXML 修复器。

## 图像差分（LibreOffice 渲染 vs 编辑器 PDF）

`python3 scripts/pptx-fidelity/compare.py <project> --fonts`，960 px 宽，单通道差 > 48/255 计为不同像素。2026-10-21：

| deck | 页数 | 平均差异像素 | 最高一页 | 说明 |
|---|---|---|---|---|
| 自带示例 `tingly-design-intro-slides` | 8 | 2.48% | 4.08%（box） | 改进前第 1 页即整份失败；box 页的差异来自参考 PDF 里嵌入块没画出来，PPTX 反而有 |
| 压力 deck（渐变封面、阴影卡片、渐变文字、列表、SVG/JPEG 图片、旋转标签、SVG 图标、文字阴影、径向渐变） | 4 | 1.45% | 2.31%（封面） | 剩余差异多为抗锯齿与亚像素字形偏移 |

看图发现并修复的问题：每行文本框按测量宽度会在 LibreOffice 里折行（改为 `wrap="none"`）；只有一边的表格分隔线以 2px 图片放大后发黑（改为原生线条）；离屏捕获框架里嵌入块不画（Chrome 停掉视口外框架的动画帧，改为视口内 1% 透明）；`FrameRasterizer` 的空白基线宿主用了 `visibility:hidden`，使根节点的隐藏不被写出（改为 opacity）。LibreOffice 自身偏差：带 alpha 的文字加字距会被截短（去掉 alpha 即正常），PowerPoint 未复核。

## 导入方向的图像差分（LibreOffice 渲染原文件 vs 导入后的编辑器 PDF）

`python3 scripts/pptx-fidelity/compare.py --import <file.pptx> --fonts`：经 CLI 导入，参考图是 LibreOffice 渲染的原始 PPTX，候选是编辑器导出的 PDF，同样 960 px、阈值 48。2026-10-21：

| deck | 页数 | 平均差异像素 | 最高一页 | 说明 |
|---|---|---|---|---|
| python-pptx Office 模板（标题、两级列表、主题表格、柱状图、分组与预设形状） | 5 | 2.30% | 5.15%（列表页） | 改进前整份拒绝（列表、主题表格、图表、分组各自都会） |
| 同一份经 LibreOffice 另存 | 5 | 1.90% | — | 另存后的 XML 更显式，继承链更短 |

看图发现并修复的问题：空 `<a:ln>` 让文本框多出黑边（无宽度、无填充、无主题线时不画描边）；tint 公式方向错（改为线性光里计算，与 LibreOffice/PowerPoint 的表格色一致）；合并单元格被重复画出；值轴上限低于 Office（按 Office 多留一档）。剩余差异：项目符号字形 `–` 画成圆点、小幅文字偏移、LibreOffice 自身的表头加粗差异。

### 表格样式与图表覆盖语料（2026-10-22）

`python3 scripts/pptx-fidelity/corpus.py <dir>` 生成 `tables.pptx`（38 页：74 种内置样式各一张“首行 + 横条带”表和一张“首末行列 + 纵条带”表，最后一页是自有边框、双线、对角线、合并、竖排）与 `charts.pptx`（26 页）。

| 语料 | 方向 | 页数 | 平均差异像素 | 说明 |
|---|---|---|---|---|
| `tables.pptx` | 导入 | 38 | 8.95% | 差异大多来自 LibreOffice 自己的样式近似（它不用 PowerPoint 的定义）；逐页看图确认按 PowerPoint 的定义画出，如 Dark Style 1、Themed 的渐变与阴影 |
| `charts.pptx` | 导入 | 26 | 16.41% | 第 15–16 页（复合饼）与 21–26 页（chartex）LibreOffice 只画替代文字，分数无意义，需看图；其余页的差异主要是刻度步长、字号与 LibreOffice 把所有折线画平滑 |
| 导入后的 `tables` 项目 | 导出 | 38 | 3.06% | 74 张表全部写成原生表格（python-pptx 读回 74 个表格对象）；带对角线和竖排的那页按逐元素路径导出 |

看图修过的问题：内置样式 Medium Style 2 - Accent 2 的 GUID 末位写错（`AFE8` → `AFE0`）；单元格自有边框被相邻格的样式线盖住；瀑布图的总计柱高度为零；直方图读 `binCount` 的 `val` 属性时被空文本挡住；100% 堆积轴标签乘了两次 100；带系列名的单系列图表、未写 `c:smooth` 的折线、`solidFill` 无颜色等默认值改按 PowerPoint。Open XML SDK 校验没有在本环境运行（无法安装 .NET），原生表格导出的 schema 合法性尚未独立验证。

## 全仓测试的环境边界

包含本地额外项目的工作区内，`pnpm test` 曾因既有 `project.test.ts` 的五项样例检查失败（类型枚举、样式子集、大纲检查）而退出；没有修改这些项目来掩盖失败。该次全量命令不能称为通过，其他包另行执行。格式入口改动在干净隔离工作区的全量测试通过；两种结果对应不同输入环境，不互相覆盖。

## 尚未验证

Schema 合法、浏览器布局和自家 importer 成功都不等于 Office 视觉/编辑保真。可复现的外部 Office 打开、逐对象编辑、字体替代、换行及逐页视觉对照仍未验收；大型文稿的性能和内存也没有规模承诺。产品没有整页截图 fallback，不能将拒绝、空白或图片化描述为原生编辑成功。
