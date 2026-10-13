# 把 core 移植成 Go：文档类型的验证

状态：**验证**，不改产品代码。背景是 [server-runtime.md](./server-runtime.md) §10 的"团队统一到 Go"；画布和幻灯片的解析见 [parse5.md](./parse5.md)。验证代码在 [docs-go-spike/](./docs-go-spike/README.md)。

问题：把 `packages/core` 改写成 Go，能不能做到和 TypeScript 逐字节一致？编成原生（Go 服务端）和 WASM（浏览器）各要多少代价？先拿格式最简单的文档类型（`packages/core/src/docs.ts`，479 行）试。

复现步骤见 [docs-go-spike/README.md](./docs-go-spike/README.md)。

对照用例来自仓库自己的 Markdown（`docs/`、`.design/`、skill、示例项目，不含 `artifact/`）、core 单测里的样例和 30 个边界写法；编辑是带种子的随机改动（改字、删块、插块、换顺序、勾任务、换写法、改表格、加行），所以结果可复现。

## 结果（Go 1.24，goldmark 1.8.6，Node 22）

| 函数 | 一致 |
|---|---|
| splitBlocks | 87 / 87 |
| blockKey（两种写法是否算同一块） | 2220 / 2220 |
| mergeBlocks（编辑器保存时的回写） | 1044 / 1044 |
| rebaseBlocks（三方合并） | 1044 / 1044 |
| refineBlock | 300 / 300 |
| outlineOf | 83 / 87，差的 4 个是 TS 的 bug，见下 |
| wordCount、findQuote/quoteAt、doc.json、comments.json | 全部一致 |

WASM 构建对 2088 个合并、三方合并用例的输出也和 TS 完全一致。

耗时（毫秒/次，一处改动）：

| 文档 | merge TS | merge 原生 Go | merge WASM | rebase TS | rebase 原生 Go | rebase WASM |
|---|---|---|---|---|---|---|
| 7 KB | 1.9 | 0.46 | 3.0 | 3.3 | 0.81 | 5.7 |
| 28 KB | 4.5 | 1.3 | 5.5 | 7.2 | 3.4 | 13.0 |
| 111 KB | 12.1 | 5.6 | 27.5 | 29.0 | 14.3 | 48.9 |

WASM 体积：标准 Go 4.8 MB，gzip 后 1.25 MB，冷启动约 60 ms。TinyGo 能编到 1 MB（gzip 330 KB），但启动即崩：goldmark 用到的正则 TinyGo 的 `regexp` 不支持。

## 发现

- **一致性做得到，但要靠对照用例兜底。** 第一版只差一种情况：段落后面紧跟表格时，goldmark 给表格的位置是段落的开头，导致两块被并成一块。改成用表格单元格定位后全部一致。每迁一个类型都会遇到这类解析器差异，只有逐字节对照能发现。
- **TS 代码里藏着很多 JavaScript 语义**，移植时要一一复刻，集中在 `docs-go-spike/docs/js.go`（约 490 行，以后各类型可以共用）：
  - `\s` 和 `trim()` 认定的空白字符和 Go 不同；
  - 评论锚点用 UTF-16 下标（Go 字符串是字节）；
  - `JSON.parse`/`JSON.stringify` 的键顺序（整数键排最前）、数字写法、转义规则；
  - RE2 没有后行断言，表格拆列要手写。
- **顺带找到一个 TS 的 bug**：文档大纲里，标题含引号或撇号时显示成 `&quot;`、`&#39;`（`outlineOf` 取的是 marked 已转义的文本）。Go 版的结果才是对的。
- **原生 Go 比 TS 快 2 到 4 倍；WASM 比 TS 慢 1.5 到 2.3 倍。** 绝对时间都不大（111 KB 的文档合并一次 27 ms）。
- **代码量**：Go 版约 1330 行，TS 原版 479 行。多出来的主要是 JS 语义层和 JSON 序列化，后者可以复用。

## 还没验证的部分

画布和幻灯片的回写靠 parse5 的源码位置（`packages/core/src/parse.ts`）。[parse5.md](./parse5.md) 验证过：给 `x/net/html` 加约 55 行挂钩和一个新文件，就能得到同样的位置，所以难点不在解析器，而在 `packages/core/src/copy.ts` 的回写：它建立在可变 DOM 上，Go 里要有对应的 DOM 操作和序列化。这是下一个值得验证的东西。
