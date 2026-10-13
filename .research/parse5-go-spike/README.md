# 给 x/net/html 加源码位置：验证代码

结论和数据见 [../parse5.md](../parse5.md)。这里只放能复现的代码。

- `loc.go`：新增文件，放进 `x/net/html` 包里。定义 `Loc`（整个节点、开始标签、结束标签、每个属性的字节区间），给分词器加 `AttrSpans()`，给解析器加 `closePopped()`（每处理完一个 token，看哪些元素离开了打开元素栈，记下它们在哪里结束）。
- `parse.go.diff`、`node.go.diff`：对 `golang.org/x/net v0.61.0` 的改动，约 55 行。
- `cmd/dump`：Go 侧，读 JSON 行（每行一段模板），以 `<template>` 为上下文解析片段，输出带区间的树。
- `js/dump.mjs`：parse5 侧，输出同样格式（UTF-16 下标换算成 UTF-8 字节）。
- `cmd/bench`、`js/bench.mjs`：耗时。
- `corpus.py`：生成对照用例。

```bash
mkdir spike && cd spike && go mod init spike && go get golang.org/x/net@v0.61.0
cp -r $(go env GOMODCACHE)/golang.org/x/net@v0.61.0/html xhtml && chmod -R u+w xhtml && rm xhtml/*_test.go && rm -rf xhtml/testdata xhtml/charset xhtml/atom
patch xhtml/parse.go < parse.go.diff && patch xhtml/node.go < node.go.diff && cp loc.go xhtml/
# cmd/dump 和 cmd/bench 复制过来后：go build -o dump ./cmd/dump
python3 corpus.py <html5lib-tests 在 224991e^ 的检出> <tingly-design 检出>
node js/dump.mjs run < corpus5lib.jsonl > a.out; ./dump < corpus5lib.jsonl > b.out   # 逐行比较
```
