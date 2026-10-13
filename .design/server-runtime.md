# 服务端用什么跑：Node、Go 还是两者分工

状态：**研究，待定**。现行实现是 Node（`apps/server`，Hono）。本文比较几条路，给出倾向和迁移草图，供决定前讨论；在决定之前代码不动。和 [tingly-box-integration.md](./tingly-box-integration.md) 的关系见 §6。

## 1. 问题

tingly-design 现在前后端都是 TypeScript，服务端跑在 Node 上。单独看，这样最省事。放到团队的整体方案里看有三处别扭：

- **和已有系统不合**。Tingly Box（下称 TB）是 Go 单二进制，加 React 前端；团队的后端都是 Go。一个 Node 服务意味着另一套运行时、另一套部署和排错方式。
- **桌面客户端**。TB 的 Wails 桌面版不带 Node（`tingly-box/.design/gui-packaging.md`）。要在客户端里用设计编辑器，要么让用户自己装 Node，要么在每个平台的安装包里塞一份 Node，并处理签名和公证。
- **接入成本**。[tingly-box-integration.md](./tingly-box-integration.md) 的大部分篇幅（§4.2 能力地址、§4.3 子进程看护、§4.4 包下载和 Node 探测、§4.8 里的 `downloading`/`no-node` 状态）都是因为"编辑器服务是另一个进程、另一种运行时"才需要的。

要回答的是：服务端换成 Go 值不值，换的话换到哪一层，哪些东西换不动。

## 2. 先把"Node"拆开看

说"tingly-design 用 Node"，其实混着三种运行环境，它们的迁移难度完全不同：

| 层 | 现在在哪 | 内容 | 规模 |
|---|---|---|---|
| **编辑器和运行时** | 浏览器 | `apps/editor`（React）、`packages/sandbox`（画板、看板、动效运行时）、`packages/core` 的格式解析和回写、`packages/import` 的 HTML/SVG 导入（编辑器里的导入已经在浏览器里做，`apps/editor/src/importer.ts`） | 绝大部分代码 |
| **服务端** | Node | `apps/server`：带版本的文件读写、文件监听加 SSE 推送、journal、快速 AI 流式代理、起 `claude` 子进程、看板的只读 SQLite 查询、`git commit` | 约 1500 行（`index.ts` 606、`store.ts` 394、`delegate.ts` 187 …） |
| **批处理工具** | Node + 真浏览器 | `scripts/motion-render.mjs`（Playwright Chromium 逐帧截图 + ffmpeg）、`dc-import` 命令行和 `check` 像素对比、调研中的 `vgpu/node`（Dawn 原生模块） | 都不在服务端的请求路径上 |

第一层不管怎么选都是 JS，它本来就是"Go + JS"里的 JS 那一半。真正要选的是第二层；第三层的重量来自 Chromium、ffmpeg、Dawn，不来自 Node。

另外更正一个常见的误解：「交给 Claude Code」起的是 `claude` 命令。Claude Code 现在有原生安装包，不需要 Node，所以这一条不构成留在 Node 的理由。

### 2.1 服务端对 `@dc/core` 的依赖

服务端换语言，难点不在 HTTP，而在它调用了哪些"懂格式"的共享代码。逐项看（`apps/server/src/index.ts`、`store.ts`、`connectors.ts` 的 import）：

| 用途 | 用到的 core | 换 Go 时怎么办 |
|---|---|---|
| 新建项目、放示例 | `newBoardSource`、`newSlideSource`、`newMotion`、`newDash`、`newDocTab`、`newDsIndex`、各类型的 `stringify*` | 移到浏览器：编辑器算好文件，服务端只负责写。示例项目用 `go:embed` 原样带上 |
| 设计系统改 `tokens.json` 后重写 `tokens.css` | `resolveTokens`、`compileTokensCss` | 移到浏览器（编辑器已经在用这两个函数）。外部改动（Claude Code 改了 `tokens.json`）由打开的编辑器在收到文件事件后补写；没人打开时，下次打开再补 |
| 快速 AI 的系统提示 | `FAST_EDIT_*` | 提示是纯文本，构建时导出成文件让 Go `go:embed`，或由编辑器随请求带上 |
| 输入校验 | `checkUploads`、`checkMessages`、`isKeptPath`、`isUploadPath`、`isDataPath`、`safeRel` | 在 Go 里重写。都是几十行的路径和结构检查，但涉及安全边界，要有共用的测试用例 |
| 看板查询 | `cleanParams`、`bindSql`、`fillArgs` | 在 Go 里重写。`bindSql` 管只读 SQL 规则，是安全敏感的，同上 |
| 启动页卡片 | `projectCard`、`kindOf` | 读 JSON 取标题和类型，Go 里写一份；或卡片字段由编辑器自己算 |

结论：真正要在两种语言里各写一份的只有"校验"和"看板 SQL 绑定"两小块；其余都可以挪到浏览器，让服务端变成不懂格式的"带版本的文件库 + 事件总线 + 模型代理"。

## 3. 可选方案

### A. 保持 Node sidecar（现行方案）

- 好处：零改动；服务端和编辑器同一种语言，格式代码只有一份。
- 代价：TB 多一种运行时；需要下载包、探测 Node、子进程看护、反向代理和能力地址；桌面版要么要求用户装 Node，要么每个平台带一份 Node（几十 MB，加 macOS 签名公证）；排错跨两个进程。
- 适合：tingly-design 主要独立使用，TB 只是偶尔接入。

### B. 用 Bun 或 Deno 把服务端编成单个可执行文件

- 好处：用户不用装 Node；代码基本不动。
- 代价：仍然是另一个进程，§4.2–4.3 的代理、能力地址、看护一样都不少；每个平台一个 50–100 MB 的二进制；`node:sqlite`、chokidar 等要验证兼容。只解决了"装 Node"，没解决"格格不入"。

### C. Go 薄宿主，懂格式的逻辑全在浏览器（倾向）

- 服务端用 Go 重写，但只做 I/O：文件和版本、监听和 SSE、journal、模型代理、起 `claude`、只读 SQLite、`git`。§2.1 里能挪的都挪到浏览器。
- 做成一个 Go 包（暴露 `http.Handler` 和选项），两种用法：
  - TB 直接 import，挂在自己的路由下，编辑器构建产物 `go:embed` 进 TB 二进制；
  - 独立运行时一个很小的 `main`，替代现在的 `node server.mjs`。
- 好处：
  - TB 和桌面版都是一个二进制，不下载、不探测 Node、不看护子进程、不反向代理；
  - 同源挂载后能力地址可以简化（认证仍要处理 iframe 带不上 bearer 的问题，但不再需要"前缀即凭证"来跨进程）；
  - 模型调用直接走 TB 网关的进程内路径；文件监听、SQLite、SSE、Anthropic SDK、子进程启动在 TB 里都已有现成实现（fsnotify、go-sqlite3、gin、anthropic-sdk-go、agentboot）。
- 代价：
  - 重写约 1500 行，加上 §2.1 的校验和 SQL 绑定的 Go 版；
  - 过渡期两份服务端并存；
  - 贡献者跑 `pnpm dev` 需要 Go 工具链（对这个团队不是负担）；
  - fsnotify 在 Linux 上不递归，要自己遍历加目录；Windows 的原子改名和文件锁行为要单独测。
- 风险控制：`e2e/` 的 Playwright 套件只通过 HTTP 和浏览器说话，和服务端语言无关，可以原样当成两份实现的一致性测试。

### D. Go 里嵌 JS 引擎（goja、QuickJS）跑 `@dc/core`

- 好处：格式代码只有一份，服务端仍是 Go。
- 代价：goja 不支持 ESM 和不少新语法，要先用 esbuild 打成脚本；性能和调试都差；两种运行时的边界反而更难懂。C 方案已经把需要两份的代码压到两小块，嵌引擎不值得。

### 对比

| | A Node | B 单文件 JS | C Go 薄宿主 | D 嵌 JS 引擎 |
|---|---|---|---|---|
| 和 TB 同一进程、同一二进制 | 否 | 否 | 是 | 是 |
| 桌面版额外负担 | Node 运行时 | 每平台一个二进制 | 无 | 无 |
| TB 接入工作量 | 大（代理、看护、下载） | 大 | 小（挂路由） | 小 |
| 重写量 | 0 | 很小 | 约 1500 行 + 两块校验 | 中，且长期复杂 |
| 格式代码几份 | 1 | 1 | 1（浏览器），校验 2 | 1 |

## 4. 换不动、也不必换的部分

- **编辑器、沙箱运行时、导入**：浏览器代码，留在 JS。桌面版跑在 Wails 的 WebView 里（macOS WKWebView、Windows WebView2、Linux WebKitGTK），要验证的是沙箱 iframe（opaque origin）、`html-to-image`、WebGPU 在这几个引擎里的表现，和服务端语言无关。
- **动效导出**：需要 Chromium 和 ffmpeg，用 Node 还是 Go 驱动都一样重。逐帧控制本来就是页面里的 JS（`packages/sandbox/src/motion.ts`），外面那层只是"开页面、seek、截图、送 ffmpeg"，Go 用 CDP（chromedp 或 rod）可以做。Chromium（chrome-headless-shell）和 ffmpeg 首次导出时按平台下载，见 [motion.md](./motion.md) 的依赖一节。
- **`dc-import` 命令行和 `check`**：是开发和评测用的工具，不随产品分发，留在 Node 没有问题。
- **`vgpu/node`**：唯一真正绑在 Node 上的东西（Dawn 原生模块）。还在调研阶段，没有进产品。如果服务端换 Go，特效导出可以换成：有 GPU 时在 Chromium 里用 WebGPU 渲；或者用 Go 的 WebGPU 绑定（wgpu-native、Dawn 的 Go 封装）跑同一份 WGSL；或者把它作为按需下载的独立渲染器。这是开放问题，不该反过来决定服务端语言。
- **pnpm 和 esbuild**：前端构建工具，只在开发和发版时用，产物是静态文件，和运行时无关。

## 5. 倾向和迁移草图

倾向 C：服务端用 Go 写成薄宿主，懂格式的东西放在浏览器。理由是要长期运行在 TB 和桌面客户端里，单二进制带来的简化（接入、分发、排错）是持续的收益，而重写量小且能被现有 e2e 兜住。如果近期 tingly-design 主要独立使用、TB 接入和客户端都不急，A 继续用着也合理，但 §5 第 1、2 步无论选哪条都值得先做，因为它们让服务端更薄、契约更清楚。

1. **把契约写下来**。现有二十多个路由和 SSE 事件写成 OpenAPI（和 TB 的 swagger 习惯一致），包括版本冲突返回 409 的语义、journal 格式、`TINGLY_DESIGN_READY` 行。e2e 套件定为契约测试。
2. **服务端变薄（仍是 Node）**。新建项目、`tokens.css` 重写、启动页卡片的计算挪到浏览器；服务端只剩 I/O、校验、SQL 绑定。用现有 e2e 验证，用户感觉不到变化。
3. **写 Go 版**。放在本仓库一个独立 Go 模块里（宿主包加一个小 `main`），和 Node 版并行，用同一套 e2e 跑到全绿；校验和 SQL 绑定的测试用例做成两边共用的数据文件。
4. **TB 接入改成挂路由**。TB import 这个包，`go:embed` 编辑器产物，挂到同源路径下；integration 方案里的下载、Node 探测、子进程看护、反向代理都不再需要。
5. **删掉 Node 服务端**。`pnpm dev` 改为 `go run` 加 Vite；`pnpm bundle` 产出 Go 二进制加静态文件。
6. **动效导出**。真做编辑器内导出时，用 Go 驱动按需下载的 Chromium 和 ffmpeg；vgpu 特效走 §4 的开放问题。

## 6. 和 tingly-box-integration.md 的关系

那份方案以 A（Node sidecar）为前提。如果选 C：

- §4.1 的路由划分、§4.5 模型场景、§4.6 主题、§4.7 地址镜像、§4.9 数据目录保持不变；
- §4.2 的能力地址可以简化，§4.3 子进程看护、§4.4 下载和 Node 探测、§4.8 里的 `downloading`/`no-node` 状态不再需要。

决定之后改写那份方案，而不是两份并存。

## 7. 开放问题

- 选 C 时，Go 宿主包放在 tingly-design 仓库还是 TB 仓库？倾向放在 tingly-design，让编辑器和它的服务端同一个仓库、同一个版本，TB 按版本引用。
- 同源挂载后，编辑器请求怎么带 TB 身份：沿用能力地址，还是宿主通过消息把 token 交给编辑器、编辑器自己加 `Authorization` 头？沙箱里的资源请求仍然带不上头，这一点决定了能力地址能不能完全去掉。
- 动效导出放在服务端（Go + Chromium）还是客户端 WebView 里（WebCodecs 编码）？后者不用下载 Chromium，但三个 WebView 引擎的一致性和确定性要实测。
- vgpu 特效的导出路径（§4）。
