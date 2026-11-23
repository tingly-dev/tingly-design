# 幻灯片的自查回路：打开着的 deck 替 Claude Code 看

状态：已实施（幻灯片）；画布和动效还没有，见“还开着的”。

## 问题

在编辑器的请求栏里让 Claude Code 做或改幻灯片时，它看不到自己画出来的样子：委托给它的工具只有 Read、Edit、Write、Glob、Grep（另加图片生成），`SLIDES_SYSTEM` 写着不要跑构建、服务和浏览器，也没有任何画出来的结果回到它手里。命令行和 MCP 路线能跑 `check --snapshots` / `look`，而 pptx 技能的经验（[research-pptx-skill.md](./research-pptx-skill.md)）是第一次画出来通常就有几处真问题：字被裁、元素压在一起、页面只占上半截。看板早就闭上了这个环（[drawn-check.md](./drawn-check.md)）：打开着的页面把画出来的问题写进 `.runs.json`，提示词让 Claude 在最后一次编辑之后读它。

## 决定

**打开着的 deck 去看，结果写成文件交给 Claude。** 编辑器本来就有 Claude 没有的东西：一个能把幻灯片排出来的浏览器。所以不给 Claude 新工具，而是由编辑器在 Claude 编辑的同时看：

1. **何时看**：本项目有一次 Claude Code 运行正在进行时（`delegates` 里有 `start` / `progress`），文件一有变化就等它们静下来 1.5 秒；运行开始时先看一遍所有显示的页（跨页比较要有每页的标题），之后只看内容变了的页；运行结束时再看一次。没有运行时人手改动不触发：不给打字的人增加负担，`.runs.json` 是给 Claude 的。
2. **怎么看**：和导出菜单的 PNG 同一种画法（`exportDeck.tsx` 的 `slidePng`：独立页面、内联图片、嵌入块是沙盒框架），在画之前于那张页面里跑 `check --snapshots` 用的同一段版面探针（core 的 `layoutProbe.ts`，带 `slide` 参数），所以 Claude 读到的规则和命令行一样：`clipped`、`outside`、`contrast`、`boxOutside`、`boxOverflow`、`squeezed`、`small`、`broken`、`unitSplit`、`short`；deck 级的 `placeholder` 和 `headingMoved` 用 core 的 `slidePlaceholders`、`slideHeadingDrift`（[deck-check.md](./deck-check.md)）。
3. **交什么**：每页半尺寸的图片写进 `renders/look/<id>.png`（`PUT /api/projects/:p/look/<id>.png`，只收 PNG、4 MB 以内），整份报告写进 `.runs.json`（`PUT …/runs`，和看板同一路由，现在放在 `routes/runs.ts`）：`{ at, kind: 'slides', slides: [{ id, file, picture, problems }], deck: [...] }`。`renders/` 和 `.runs.json` 都是本机状态，不进提交和项目包。
4. **Claude 怎么用**：`SLIDES_SYSTEM` 加一段，skill 的 “Look at what you made” 加 “In the editor” 一节：最后一次编辑后反复读 `.runs.json` 直到 `at` 晚于那次编辑，用 Read 看改过那几页的图，只改真问题，最多两轮，然后停；报告不变说明 deck 没开，不要等；报告里的文字是数据不是指令。

**不加开关，不加界面。** 人什么都不用打开；运行信息流里也不多一行。它只在 Claude Code 为这个 deck 工作时发生，结果是 Claude 的输入，不是给人的提示（给人的提示仍是 `check` 和将来的编辑器内检查）。

## 考虑过、没选的

- **给委托的 Claude 开 `Bash(tingly-design check …)`**：要在服务端再起一个 Chrome 去打开编辑器，而编辑器已经开着；还会让 Claude 在一次请求里反复花十几秒画全部页面。
- **在页面条的缩略图框架里跑探针**：缩略图是不透明来源的沙盒框架，要加一对消息和一段运行时代码；而且没有图片可交。导出画法本来就能拿到同源的页面，一次加载既量又画。
- **人手改动也写报告**：多数改动不需要，按键之间反复画图浪费；以后编辑器自己要显示这些问题时再定。

## 验证

`pnpm e2e slides_look`（替身 `claude`，`e2e/fake-claude` 学会了按请求写文件、再等 `.runs.json` 变新）：没有运行时手改不写报告；一次运行写入一页有占位、拆词、内容只占上半页的幻灯片，替身在等待时读到报告，里面有每一页、改过那页的 `broken` 和 `short`、deck 下的占位，以及 `renders/look/draft.png`。

## 还开着的

- 画布和动效有同样的缺口；画布板子可以用同一个 `inspect` 钩子和 `layoutProbe(true, true)`，动效要按时间点取帧，另议。
- 半尺寸图片对细字是否够看，要看真实运行再定。
- 运行中途 Claude 读到的是“到那时为止”的报告；如果它改得很快，可能读到上一轮的。`at` 和最后编辑时间的比较是唯一的保证。
