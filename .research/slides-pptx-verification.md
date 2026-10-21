# PPTX verification

状态：已执行受限模块与产品路径验证；独立 Office 渲染和视觉保真尚未验收。验证日期：2026-10-21。

当前支持范围见 [设计契约](../.design/slides-pptx.md)，候选方案与依据见 [研究](./slides-pptx.md)。本页仅保留可复现的检查、结果和限制，不记录本机目录、输入文稿信息或会话过程。

## 模块与导入回归

| 检查 | 已执行结果 |
|---|---|
| `pnpm --filter @dc/core exec vitest run test/pptx.test.ts test/pptxSmoke.test.ts test/pptxBridge.test.ts test/serverPptxImport.test.ts` | 4 files /94 tests 通过；包含行距、原图裁剪、显式未合并表格、空装饰文本框、包安全、API/CLI、原子失败与并发重名 |
| `pnpm --filter @dc/export test` | 46 tests 通过；原生对象、单位、文字、图片、备注、输入边界与 writer normalization |
| `pnpm --filter @dc/import --filter @dc/i18n test` | 分别 22 /7 tests 通过 |
| `node --test evals/test/evals.test.mjs` | 4 tests 通过 |
| `pnpm typecheck` | 全仓通过 |
| `pnpm build`、`pnpm bundle --no-build` | 产品第一期整合时通过；不代表后续每次源修改均重建过 |

回归用例为独立合成 OOXML，不包含外部输入的文稿、媒体或元数据。额外本地输入经实际 CLI 成功导入，但输入不随仓库分发，该结果不作为公开可复现语料，也不证明视觉一致。表格、裁剪能导入不代表当前原生导出支持它们。

## 浏览器与产品路径

- `python3 -I packages/export/test/pptxDom.browser.py`：实际 Chrome，42 assertions 通过，覆盖布局、文字行框、媒体、隐藏内容、取消/预算和 unsupported 诊断。
- `python3 -I packages/export/test/pptxProduct.browser.py`：实际 opaque runtime，11 assertions 通过，覆盖解码前图片尺寸限制、图片内联、逐页资源、隐藏资源、字体失败与取消清理。
- `e2e/pptx.py`：第一期 65/65 checks 通过；拆分格式入口后在隔离工作区运行 89/89 checks 通过，包含三种 picker 的 accept 过滤、PPTX picker/drop/API、ZIP/Markdown/Claude package 回归、编辑保存重开、菜单/CLI/MCP 导出、失败/取消和非 slides 无 PPTX 项。
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

## 全仓测试的环境边界

包含本地额外项目的工作区内，`pnpm test` 曾因既有 `project.test.ts` 的五项样例检查失败（类型枚举、样式子集、大纲检查）而退出；没有修改这些项目来掩盖失败。该次全量命令不能称为通过，其他包另行执行。格式入口改动在干净隔离工作区的全量测试通过；两种结果对应不同输入环境，不互相覆盖。

## 尚未验证

Schema 合法、浏览器布局和自家 importer 成功都不等于 Office 视觉/编辑保真。可复现的外部 Office 打开、逐对象编辑、字体替代、换行及逐页视觉对照仍未验收；大型文稿的性能和内存也没有规模承诺。产品没有整页截图 fallback，不能将拒绝、空白或图片化描述为原生编辑成功。
