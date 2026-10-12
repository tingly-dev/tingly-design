# 代码评审

每个 PR 至少一个人看过再合并。

## 看什么

- **回写是否最小**：同一份文件只改真正变了的字符。看 diff，格式化导致的整段改动是问题。
- **沙箱边界**：运行用户内容的 iframe 只有 `allow-scripts`，CSP 禁网络。新增的通信都走 `postMessage`，协议写在 `packages/core/src/protocol.ts`。
- **格式说明同步**：改了文件格式，`.claude/skills/` 里对应的说明一起改，Claude Code 靠它写文件。

## 怎么回复

评论要具体到行，说清楚“为什么”。小问题标“可选”，作者可以不改。
