# PPTX smoke corpus

状态：独立模块测试语料，非产品导入入口。11 个 PPTX / 共 20 页（含重复覆盖）。

## 来源与许可

所有页面文字、几何、备注与 48×32 RGBA 四象限 PNG 均由本目录 `generate.mjs` 原创生成，随仓库 Apache-2.0 许可；没有下载的演示文稿、图片、字体或保密素材。生成器直接使用 MIT `pptxgenjs@4.0.1` 原生 `addText/addShape/addImage/addTable/addChart/addNotes`，**不调用本项目 writer**。生成器和 writer 使用同一个上游库，所以这不是第二种 Office 实现的输出对比。

`manifest.json` 是人工定义的预期，不从 importer 结果更新。它列出文件、页数、物理尺寸、成功/原子失败、具体诊断和内容/几何；`comprehensivePages` 将综合文件的每页映射回独立文件与 feature ID。

## 内容与预期

| 文件 | 页数 | 覆盖 / 预期 |
|---|---:|---|
| `supported.pptx` | 2 | 同字号/字体 rich text，粗斜体/下划线/颜色、CJK 与转义、多段落、旋转/翻转、叠放、矩形/椭圆/圆角/斜线、本地 PNG、背景、普通备注；成功且可经现有 write-back 改字 |
| `comprehensive.pptx` | 9 | supported 两页 + 下列七页；整包原子失败，不交部分文件 |
| `cases/table.pptx` | 1 | 原生表格的主题/效果样式仍拒绝 → `unsupported_style`；显式未合并表格另由合成单元用例覆盖 |
| `cases/chart.pptx` | 1 | 原生饼图 + 完整嵌入 XLSX → `forbidden_package`（当前 importer 拒绝全部 embeddings 路径） |
| `cases/bullets.pptx` | 1 | 原生列表 → `unsupported_text_style` |
| `cases/crop.pptx` | 1 | 原生非零 srcRect 裁剪 → 成功，保留原图、可编辑裁剪容器 |
| `cases/mixed-font-size.pptx` | 1 | 同段不同字号 → `unsupported_text_style` |
| `cases/complex-geometry.pptx` | 1 | 原生 chevron → `unsupported_geometry` |
| `cases/shadow.pptx` | 1 | 原生外阴影 → `unsupported_style` / effectLst |
| `four-three.pptx` | 1 | 10×7.5 in，uniform contain 的居中位置/尺寸及 `page_contained` |
| `portrait.pptx` | 1 | 7.5×10 in，同上 |

chart 和 comprehensive 的诊断来自包级 embeddings 策略，**不是说该嵌入工作簿恶意**，也不是证明已走到图表绘制诊断。独立 case 避免综合文件的首个失败掩盖其它对象。没有声称覆盖 groups、gradients、theme/placeholder 继承、JPEG 或真实 Office 导出语料；这些保留给后续语料扩展。

## 运行与确定性

在仓库根目录运行（只需已有 workspace 依赖，无新运行时依赖）。普通 smoke 只读取已提交二进制，不调用生成器或 .NET。

```bash
pnpm --filter @dc/core exec vitest run test/pptxSmoke.test.ts
node packages/core/test/fixtures/pptx-smoke/generate.mjs --check
# 有意更新原生内容之后；必须 review manifest 与二进制，并重跑独立校验
node packages/core/test/fixtures/pptx-smoke/generate.mjs
```

`--check` 在内存中重新生成并逐字节比较，不改原件。ZIP entries 排序、固定 DOS 时间与 core created/modified 时间；chart 嵌入 XLSX 同样规范化，避免嵌套 ZIP 时钟造成差异。正常 smoke 独立用 fflate + namespace-aware saxes 检查所有 XML、content types、relationship 目标/ID 引用、native feature 存在、页数/尺寸/内容；随后检查 importer 的结构、几何、备注、媒体原字节、原文件保留、checker 和 `applyHumanOps`，不拿 importer 自证包合法。

## PptxGenJS 4.0.1 的有限修正

上游原生 API 输出在独立检查中出现 schema/包问题；不能为通过测试而把非法包称为复杂合法输入。生成器仅对自己输出、固定已知结构修正，**不是任意 OOXML 修复器，也不修改 importer/writer**。

1. 多页包的 `[Content_Types].xml` 为不存在的 `slideMaster2+` 添加 override；只移除不存在且名称精确匹配的 phantom override，断言数量恰好为页数减一。实际 master、layout、relationship 全保留。
2. `presentation.xml` 的 `notesMasterIdLst` 在 `sldIdLst` 后；将这一完整列表移到前面，保留所有 ID/内容；若预期结构不再出现则失败。
3. rich-text 每个 run 前重复生成相同 `a:pPr`；每段只保留第一个，断言重复值完全一致，不同值立即失败。不改文字、run 字形或段落属性。
4. 原生二维柱图输出三个 `axId`，SDK 报 schema 错；本语料改用原生饼图 API，不手写/删除 chart axis XML。完整 chart part 与嵌入 workbook 仍在。

元数据规范化与上述有限修正均已写入生成器。新上游版本或扩大生成词汇必须重新独立验证，不能凭 regex 沿用合法性结论。

## 验证层次与限度

2026-10-21 的独立验证：.NET SDK 10.0.402、`DocumentFormat.OpenXml` 3.3.0、`FileFormatVersions.Office2019`，11 个 PPTX **零报告错误**，并检查 chart 嵌入 XLSX（也零错误）。可用仓库可选工具复验，不属于普通测试依赖。

```bash
dotnet run --project scripts/validate-pptx -- packages/core/test/fixtures/pptx-smoke
```

这是指定 SDK/schema 版本下的结构验证，不是完整 ECMA 所有版本合规认证，更不是视觉保真证明。2026-10-21，用户人工确认这批 PPTX 均可打开、未见问题；打开所用应用和版本未记录。自动化环境仍没有 PowerPoint/LibreOffice，未做可复现的 Office 渲染/逐对象继续编辑验证；也没有性能或真实用户语料规模承诺。本目录不引入产品 UI、导入菜单或命令行 PPTX 支持。
