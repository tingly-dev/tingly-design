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

AI 设置对话框已经有了（`.design/ai-settings.md`）：一个连接（地址 + 密钥），快速 AI 和 Claude Code 各一个模型名，每一项按"环境变量 > 已保存 > 默认"解析（`packages/core/src/aiConfig.ts` 的 `resolveAi`）。那份说明 §6 已经把图片生成定为同一个对话框里的第三个用途。这里只补它和前两个用途不一样的地方：

- **地址不能直接沿用。** 连接地址是 Anthropic 兼容的入口（Tingly Box 是 `/tingly/anthropic`），图片走的是 OpenAI 兼容的 `/v1/images/*`，路径不同，协议也不同。
- **倾向的做法**：图片这一块有自己的"地址"一栏，默认跟着连接走。选 Tingly Box 时自动填 `http://localhost:12580/tingly/imagegen/v1`，密钥沿用连接的。选 Anthropic 时没有可用的图片接口，这一栏留空，图片生成不出现。选"其他地址"时，人自己填一个 OpenAI 兼容的地址，必要时再填一把单独的密钥。
- 模型名一栏：Tingly Box 默认 `tingly`，由 TB 的规则决定实际用哪个模型；其他情况由人自己填，不预设。
- 环境变量照旧最先：新增 `DC_IMAGE_BASE_URL`、`DC_IMAGE_MODEL`，以及可选的 `DC_IMAGE_API_KEY`（不设就用连接的密钥）。宿主设了的值在界面上只读。
- `/api/health` 增加 `imageGen: boolean`。没配好时，入口和工具都不出现，不显示一个点了才报错的按钮。

### 4. 改图

选中一张图，说"把背景换成夜景"，走 `/images/edits`。这是第二步：要先有选中图片后的上下文（哪种类型能选中图片，见缩放手柄那一行），而且 mask 怎么画还没设计。

### 5. 各类型

画布、幻灯片、动效、文档都能显示 `uploads/` 里的图，可以支持。设计系统放进 `assets/`。看板的图片基本是数据图表，先不接，在矩阵里写明原因。

## 需要的决定

1. 入口：A（倾向）、B，还是 C？
2. 存放：`uploads/`（倾向）还是 `generated/`？
3. 图片这一栏放进 AI 设置对话框、地址默认跟着连接走（Tingly Box 自动填 imagegen 地址，Anthropic 不提供），这样可以吗？
4. 改图放第二步，这次先不做，可以吗？
