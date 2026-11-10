# 文档类型的 Go 移植：验证代码

结论和数据见 [../docs-go.md](../docs-go.md)。这里只放能复现的代码，不进产品构建。

- `gen/fixtures.ts`：用 TypeScript 的 `packages/core/src/docs.ts` 生成对照用例（输入和输出）。
- `docs/`：Go 移植。`js.go` 是 JavaScript 语义层（空白、UTF-16 下标、JSON 键顺序和数字写法），`blocks.go` 是分块、合并、三方合并、大纲和字数，`files.go` 是 doc.json、comments.json 和评论锚点。
- `docs/golden_test.go`：逐项对照，报告写到 `testdata/report.txt`；`docs/bench_test.go`：原生耗时。
- `cmd/wasm`：编成 WebAssembly；`cmd/bench/bench.mjs`：WASM 过一遍对照用例，再和 TS 比耗时。


```bash
pnpm install                                                     # 仓库根目录，给对照用例生成器用
cd .research/docs-go-spike
node --experimental-strip-types gen/fixtures.ts > testdata/docs.json   # TS 的输入和输出
go test ./docs/ -run Golden -v                                   # 逐项一致率，结果也写到 testdata/report.txt
go test ./docs/ -run XXX -bench . -benchtime 40x                 # 原生 Go 的耗时
GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o testdata/docs.wasm ./cmd/wasm
node --experimental-strip-types cmd/bench/bench.mjs              # WASM 过一遍对照用例，再和 TS 比耗时
```

