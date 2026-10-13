# Go 移植验证：文档类型

状态：**验证（spike）**，不进产品。讨论见 [.design/server-runtime.md](../../.design/server-runtime.md)。

问题：把 `packages/core` 改写成 Go，能不能做到和 TypeScript 逐字节一致？编成原生（Go 服务端）和 WASM（浏览器）各要多少代价？先拿格式最简单的文档类型（`packages/core/src/docs.ts`，479 行）试。

## 怎么跑

```bash
pnpm install                                                     # 仓库根目录，给对照用例生成器用
cd spikes/go-core
node --experimental-strip-types gen/fixtures.ts > testdata/docs.json   # TS 的输入和输出
go test ./docs/ -run Golden -v                                   # 逐项一致率，结果也写到 testdata/report.txt
go test ./docs/ -run XXX -bench . -benchtime 40x                 # 原生 Go 的耗时
GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o testdata/docs.wasm ./cmd/wasm
node --experimental-strip-types cmd/bench/bench.mjs              # WASM 过一遍对照用例，再和 TS 比耗时
```

对照用例来自仓库自己的 Markdown（`docs/`、`.design/`、skill、示例项目，不含 `artifact/`）、core 单测里的样例和 30 个边界写法；编辑是带种子的随机改动（改字、删块、插块、换顺序、勾任务、换写法、改表格、加行），所以结果可复现。

## 结果（Go 1.24，goldmark 1.8.6，Node 22）

| 函数 | 一致 |
|---|---|
| splitBlocks | 87 / 87 |
| blockKey（两种写法是否算同一块） | 2206 / 2206 |
| mergeBlocks（编辑器保存时的回写） | 1044 / 1044 |
| rebaseBlocks（三方合并） | 1044 / 1044 |
| refineBlock | 303 / 303 |
| outlineOf | 82 / 87，差的 5 个是 TS 的 bug，见下 |
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
- **TS 代码里藏着很多 JavaScript 语义**，移植时要一一复刻，集中在 `docs/js.go`（约 490 行，以后各类型可以共用）：
  - `\s` 和 `trim()` 认定的空白字符和 Go 不同；
  - 评论锚点用 UTF-16 下标（Go 字符串是字节）；
  - `JSON.parse`/`JSON.stringify` 的键顺序（整数键排最前）、数字写法、转义规则；
  - RE2 没有后行断言，表格拆列要手写。
- **顺带找到一个 TS 的 bug**：文档大纲里，标题含引号或撇号时显示成 `&quot;`、`&#39;`（`outlineOf` 取的是 marked 已转义的文本）。Go 版的结果才是对的。
- **原生 Go 比 TS 快 2 到 4 倍；WASM 比 TS 慢 1.5 到 2.3 倍。** 绝对时间都不大（111 KB 的文档合并一次 27 ms）。
- **代码量**：Go 版约 1330 行，TS 原版 479 行。多出来的主要是 JS 语义层和 JSON 序列化，后者可以复用。

## 还没验证、风险更大的部分

画布和幻灯片的回写靠 parse5 的源码位置信息（`packages/core/src/parse.ts`），只改动的节点重写、其余字节原样保留。Go 的 `x/net/html` 不提供源码位置，要自己写分词器或换库。这是迁移里最难的一块，适合作为下一个验证。
