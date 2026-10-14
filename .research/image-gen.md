# 图像生成：接 OpenAI 风格的 images 接口

状态：研究。等决定入口、存放位置和配置名（见最后一节），定了以后结论写进 `.design/`。

## 问题

现在编辑器里的图片只能是人带进来的（附件、导入、粘贴）。要的是在项目里直接生成图片，以及改一张已有的图，走 OpenAI 风格的 `POST /v1/images/generations` 和 `POST /v1/images/edits`。这套接口 OpenAI、xAI 等都有，Tingly Box 的网关也已经提供，嵌进 Tingly Box 时可以直接用它。

## 现状（已核对）

- 服务端只接了 Anthropic：快速 AI 用 `@anthropic-ai/sdk`，读 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`（`apps/server/src/index.ts` 的 `/fast-edit`）。交给 Claude Code 时，`claude` 继承同样的环境变量。仓库里没有任何生成图片的代码。
- Tingly Box 提供 `/images/generations` 和 `/images/edits` 两条路由（`internal/protocolserver/routes.go`），对外地址是 `/tingly/imagegen/v1/images/generations` 和 `…/edits`（`internal/server/server_lifecycle.go`）。改图在 Codex、xAI、千帆、DashScope 上都有适配（TB 的 `.design/image-edit.md`、`image-edit-adapters.md`）。
- 引用图片已经有一条现成的路：除了看板，每种类型都能显示 `uploads/` 里的图（`.design/project-kinds.md` 附件那一行：画板、幻灯片、场景写 `src="uploads/…"`，文档写 `../uploads/…`）。设计系统收图片时放进它自己的 `assets/`。

## 要定的几件事

### 1. 入口

| 方案 | 怎么用 | 取舍 |
|---|---|---|
| A. 让模型自己调用 | 在提示栏里说"加一张插图"，快速 AI 和 Claude Code 判断需要图时就去生成，再把它放进作品 | 不加按钮，也不用选模式。快速 AI 现在只能输出 jQuery 语句，外加 `log()`、`askClaude()` 两个工具，要新增一个异步工具；Claude Code 则通过一个脚本调用（类似 `scripts/dash-query.mjs`） |
| B. 单独一个"生成图片"入口 | 放在"导入到这里"旁边：输入提示词，选尺寸，结果像导入的图片一样落进当前项目 | 好理解、好测；但多了一个入口，生成和摆放分成了两步 |
| C. A 和 B 都做 | B 先做，A 复用 B 的服务端接口 | 工作量最大 |

**倾向 A，按 C 的顺序落地**：服务端接口先做好（B 和 A 共用），先接 Claude Code 和快速 AI，单独的按钮等用过以后再看要不要。理由是 UX 原则里的"不要模式选择器"："生成一张图"本来就是一句请求。

### 2. 生成的图放哪

- **倾向 `uploads/`**：按内容命名，和附件一样（同一张图只存一份）。这样每种类型现有的引用写法都能直接用，六个技能不用新增路径规则。日志里记下这次用了什么提示词。
- 另一种做法是新开一个 `generated/` 目录，好处是能和人带进来的东西分开。代价是要改六个技能、各类型的引用检查和导入逻辑，换来的区分用处不大。
- 设计系统例外：和导入一样，图片放它自己的 `assets/`。

### 3. 配置

- 新增 `DC_IMAGE_BASE_URL`、`DC_IMAGE_API_KEY`、`DC_IMAGE_MODEL`（默认 `gpt-image-1`，有待确认）。嵌进 Tingly Box 时，宿主把地址设成自己的 `/tingly/imagegen/v1`。不从 `ANTHROPIC_BASE_URL` 推导，因为生成图片在 TB 里是另一个场景、另一条路径。
- `/api/health` 增加 `imageGen: boolean`。没配置时，入口和工具都不出现，不显示一个点了才报错的按钮。

### 4. 改图

选中一张图，说"把背景换成夜景"，走 `/images/edits`。这是第二步：要先有选中图片后的上下文（哪种类型能选中图片，见缩放手柄那一行），而且 mask 怎么画还没设计。

### 5. 各类型

画布、幻灯片、动效、文档都能显示 `uploads/` 里的图，可以支持。设计系统放进 `assets/`。看板的图片基本是数据图表，先不接，在矩阵里写明原因。

## 需要的决定

1. 入口：A（倾向）、B，还是 C？
2. 存放：`uploads/`（倾向）还是 `generated/`？
3. 配置名和默认模型是否就按上面写的？
4. 改图放第二步，这次先不做，可以吗？
