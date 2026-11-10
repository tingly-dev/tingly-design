# 服务端用什么跑：Node、Go 还是两者分工

状态：**研究，有了倾向**（§11）：保持 TS 服务端，独立产品优先。现行实现是 Node（`apps/server`，Hono）。本文比较几条路，给出倾向和迁移步骤，供决定前讨论；决定之前代码不动。图见 [server-runtime.pencil.md](./server-runtime.pencil.md)，文字和图冲突时以本文为准。和 [tingly-box-integration.md](../.design/tingly-box-integration.md) 的关系见 §8。

**一句话**：倾向取决于要不要和 TB 融合，见 §10。如果融合：倾向把服务端改成 Go 写的"薄宿主"，只管文件、事件、模型和子进程，不理解任何项目格式；理解格式的逻辑全部放在浏览器的 JS 里。这样 TB 和桌面版都能保持单个二进制，前端仍是 JS，和团队现有的 Go + JS 一致。

## 1. 问题

tingly-design 现在前后端都是 TypeScript，服务端跑在 Node 上。单独看最省事，放进团队的整体方案里有三处别扭：

- **和已有系统不合**。Tingly Box（下称 TB）是 Go 单二进制加 React 前端，团队的后端都是 Go。多一个 Node 服务，就多一套运行时、部署和排错方式。
- **桌面客户端**。TB 的 Wails 桌面版不带 Node（`tingly-box/.design/gui-packaging.md`）。要在客户端里用设计编辑器，要么让用户自己装 Node，要么每个平台的安装包都带一份 Node，还要处理签名和公证。
- **接入成本**。[tingly-box-integration.md](../.design/tingly-box-integration.md) 的大部分篇幅（能力地址、子进程看护、包下载、Node 探测、`downloading`/`no-node` 状态）都是因为"编辑器服务是另一个进程、另一种运行时"才需要的。

要回答三件事：服务端换成 Go 值不值；换的话，Go 和 JS 的边界划在哪里；哪些东西换不动。

## 2. "Node"其实是三层

说"tingly-design 用 Node"，其实混着三种运行环境，迁移难度完全不同（图 1）：

| 层 | 现在在哪 | 内容 | 换成 Go 时 |
|---|---|---|---|
| **编辑器和运行时** | 浏览器 | `apps/editor`、`packages/sandbox`（画板、看板、动效运行时）、`packages/core` 的格式解析和回写、`packages/import`（编辑器里的导入已经在浏览器里做，`apps/editor/src/importer.ts`） | 不动，本来就是"Go + JS"里的 JS |
| **服务端** | Node | `apps/server`，约 1500 行：文件和版本、监听和 SSE、journal、快速 AI、起 `claude`、只读 SQLite、`git` | 要选的只有这一层 |
| **批处理工具** | Node + 真浏览器 | 动效导出（`scripts/motion-render.mjs`：Chromium 逐帧截图 + ffmpeg）、`dc-import` 命令行和像素对比、调研中的 `vgpu/node` | 重的是 Chromium、ffmpeg、Dawn，不是 Node；见 §6 |

更正一个常见误解：「交给 Claude Code」起的是 `claude` 命令，而 Claude Code 有原生安装包，不需要 Node。这一条不构成留在 Node 的理由。

## 3. 边界原则：服务端不懂格式

换语言的难点不在 HTTP，而在服务端调用了哪些"懂格式"的共享代码（`@dc/core`）。如果这些代码要在 Go 里再写一份，两边迟早会不一致。所以先定一条原则：

> **服务端只做 I/O 和安全检查，不解析、不生成任何项目格式。凡是需要理解 `canvas.json`、`deck.json`、`tokens.json` 的事，都由浏览器算好，再交给服务端写。**

按这条原则，把服务端现在的每项职责过一遍（图 2）：

| 职责 | 现在怎么做 | 薄宿主里归谁 |
|---|---|---|
| 读写文件、版本号（内容 sha256 前 12 位）、冲突返回 409、原子写、项目锁 | `store.ts` | **服务端** |
| 文件监听，推送 SSE 事件，journal | `index.ts` 的 chokidar、`hub.ts` | **服务端**（fsnotify） |
| 资源和上传：图片、字体、`uploads/` | `index.ts` | **服务端** |
| 快速 AI：选系统提示，流式调用模型 | `index.ts`，提示来自 core 的 `FAST_EDIT_*` | **服务端**做流式代理；提示是纯文本，构建时导出成文件让 Go `go:embed` |
| 交给 Claude Code：起 `claude`，转发进度 | `delegate.ts`，每类一段系统提示 | **服务端**；提示同上 |
| 看板的只读 SQL 查询 | `connectors.ts`，core 的 `cleanParams`、`bindSql`、`fillArgs` | **服务端**，在 Go 里重写（安全边界，见下） |
| 提交 | `git commit` 子进程 | **服务端** |
| 输入校验：路径、附件、消息 | core 的 `safeRel`、`isKeptPath`、`isUploadPath`、`isDataPath`、`checkUploads`、`checkMessages` | **服务端**，在 Go 里重写（安全边界，见下） |
| 新建项目 | `createProject`，用 core 的 `new*`、`stringify*` | **浏览器**算出全部文件，一次批量写入 |
| 放示例项目 | `seedSamples` 复制 `projects/` | **服务端**原样复制，示例用 `go:embed` 带上 |
| 把设计系统装进画布或幻灯片 | 读 `tokens.json`、`resolveTokens`、改 `canvas.json`/`deck.json` 的 `designSystems` 和 `faces` | **浏览器**读来源、算出新的索引，一次批量写入 |
| 改 `tokens.json` 后重写 `tokens.css` | `regenTokensCss`，core 的 `compileTokensCss` | **浏览器**（编辑器已在用这个函数）。Claude Code 在外面改了 `tokens.json` 时，由打开的编辑器收到事件后补写；没人打开就在下次打开时补 |
| 启动页卡片：标题、类型、预览 | `projectCard`、`kindOf` | **浏览器**；服务端只列目录 |

两个随之而来的需求：

- **批量写入**。新建项目和安装设计系统要一次写多个文件。服务端提供"一组文件、各带基准版本、在项目锁里一起写"的接口，任何一个版本对不上就整组退回 409。这是一个与格式无关的通用原语，替代现在两个懂格式的专用路由。
- **两份的只有安全检查**。路径、附件、消息的校验和看板 SQL 绑定必须在服务端做（浏览器的检查可以被绕过），所以 Go 和 TS 各有一份。这几块都是几十到一百多行，测试用例做成两边共用的数据文件（输入加期望结果），各自的测试读同一份，以此防止不一致。

## 4. 可选方案

| | A 保持 Node | B Bun/Deno 单文件 | C Go 薄宿主（倾向） | D Go 里嵌 JS 引擎 |
|---|---|---|---|---|
| 做法 | 现状；TB 起 Node 子进程并反向代理 | 把现在的 TS 服务端编成可执行文件 | 按 §3 重写服务端，做成 Go 包，TB 直接 import | Go 宿主里用 goja/QuickJS 跑 `@dc/core` |
| 和 TB 同一进程 | 否 | 否 | 是 | 是 |
| 桌面版额外负担 | Node 运行时 | 每个平台 50–100 MB 的二进制 | 无 | 无 |
| TB 接入 | 下载、Node 探测、看护、代理、能力地址 | 同 A，只省了"装 Node" | 挂一组路由 | 挂一组路由 |
| 重写量 | 0 | 很小 | 约 1500 行 + 安全检查 | 中，且长期复杂 |
| 格式代码几份 | 1 | 1 | 1（浏览器）；安全检查 2 | 1 |

- **A** 适合 tingly-design 主要独立使用、TB 偶尔接入的情况。代价是 §1 的三处别扭一直存在。
- **B** 只解决了"用户要装 Node"，没解决"另一个进程、另一种运行时"；`node:sqlite`、chokidar 也要验证兼容。
- **D** 看似格式代码只有一份，但 goja 不支持 ESM 和不少新语法，要先打包；性能和调试都差，两种运行时的边界反而更难懂。按 §3 划界后需要两份的只剩安全检查，不值得为此嵌引擎。
- **C** 是倾向：要长期跑在 TB 和桌面客户端里，单二进制省下的接入、分发和排错成本是持续的；重写量小，而且能用现有 e2e 兜住（§7）。

## 5. 薄宿主的样子

- **一个 Go 包，两种挂法**（图 3）。包暴露 `http.Handler` 和选项（项目目录、路径前缀、模型地址和凭证、`claude` 的路径和环境、日志）：
  - TB 直接 import，挂在自己的路由下；编辑器和沙箱的构建产物 `go:embed` 进 TB 二进制。TB 已有的 fsnotify、go-sqlite3、anthropic-sdk-go、agentboot 子进程都可以直接复用。
  - 独立运行时用一个很小的 `main`，替代现在的 `node server.mjs`，环境变量（`PORT`、`DC_PROJECTS`、`DC_BASE_PATH`…）和 `TINGLY_DESIGN_READY` 行保持不变。
- **接口不变**。路由、SSE 事件、409 语义、journal 格式保持现状，只新增批量写入、删掉被它替代的专用路由。编辑器不需要知道服务端换了语言。
- **模型**。快速 AI 在 TB 里可以直接走网关的进程内路径；独立运行时照旧读 `ANTHROPIC_BASE_URL`。`claude` 子进程的环境和现在一样，由宿主给出。
- **实现上要当心**：fsnotify 在 Linux 上不递归，要自己遍历并为新目录补监听；自己写的文件要从监听事件里去掉（现在的 `ownWrites`）；Windows 的原子改名和文件占用要单独测；SSE 要关掉缓冲。

## 6. 换不动、也不必换的部分

- **编辑器、沙箱运行时、导入**：浏览器代码，留在 JS。桌面版跑在 Wails 的 WebView 里（macOS WKWebView、Windows WebView2、Linux WebKitGTK），要验证的是沙箱 iframe（opaque origin）、`html-to-image`、WebGPU 在这几个引擎里的表现。这和服务端用什么语言无关，选 A 也要验证。
- **动效导出**：需要 Chromium 和 ffmpeg，用 Node 还是 Go 驱动都一样重。逐帧控制本来就在页面的 JS 里（`packages/sandbox/src/motion.ts`），外面那层只是"开页面、seek、截图、送 ffmpeg"，Go 用 CDP（chromedp 或 rod）可以做到。Chromium（chrome-headless-shell）和 ffmpeg 在第一次导出时按平台下载，见 [motion.md](../.design/motion.md) 的依赖一节（图 4）。
- **`dc-import` 命令行和像素对比**：开发和评测用的工具，不随产品分发，留在 Node。
- **`vgpu/node`**：唯一真正绑在 Node 上的东西（Dawn 原生模块），还在调研，没有进产品。可能的出路：有 GPU 时在 Chromium 里用 WebGPU 渲；用 Go 的 WebGPU 绑定跑同一份 WGSL；或者做成按需下载的独立渲染器。这是开放问题，不该反过来决定服务端语言。
- **pnpm、Vite、esbuild**：只在开发和发版时用，产物是静态文件，和运行时无关。

## 7. 迁移步骤

每一步都能单独发布、单独回退；第 1、2 步不管最后选不选 C 都值得做，因为它们让服务端更薄、契约更清楚（图 5）。

1. **写下契约**。把现有路由和 SSE 事件写成 OpenAPI（和 TB 的 swagger 习惯一致），包括 409 语义、journal 格式、`TINGLY_DESIGN_READY` 行。`e2e/` 的 Playwright 套件只通过 HTTP 和浏览器说话，和服务端语言无关，定为契约测试。
2. **按 §3 让 Node 服务端变薄**。加批量写入；新建项目、安装设计系统、`tokens.css` 重写、启动页卡片挪到浏览器；安全检查的测试用例抽成共用数据文件。服务端仍是 Node，用现有 e2e 验证，用户感觉不到变化。
3. **写 Go 版**。放在本仓库一个独立的 Go 模块里（宿主包加一个小 `main`），和 Node 版并行，同一套 e2e 和共用用例跑到全绿。
4. **TB 接入改成挂路由**。TB import 这个包，挂到同源路径下。integration 方案里的下载、Node 探测、子进程看护、反向代理不再需要。
5. **删掉 Node 服务端**。`pnpm dev` 改为 `go run` 加 Vite；`pnpm bundle` 产出 Go 二进制加静态文件。
6. **动效导出进编辑器**。真做的时候，用 Go 驱动按需下载的 Chromium 和 ffmpeg；vgpu 特效走 §6 的开放问题。

代价：过渡期（第 3、4 步）两份服务端并存；贡献者要装 Go 工具链（对这个团队不是负担）。

## 8. 和 tingly-box-integration.md 的关系

那份方案以 A（Node 子进程）为前提。如果选 C：

- 路由划分（`/design` 页面和 `/apps/design/...` 分开）、模型场景、主题联动、地址镜像、数据目录保持不变；
- 能力地址可以简化（§9）；子进程看护、包下载和 Node 探测、`downloading`/`no-node` 状态不再需要。

定下来之后改写那份方案，不让两份并存。

## 9. 开放问题

- **Go 包放在哪个仓库**：倾向 tingly-design，让编辑器和它的服务端同仓库、同版本，TB 按版本引用。
- **TB 里怎么认证**：同源挂载后，编辑器的 API 请求可以由宿主通过消息交给它 token、自己加 `Authorization` 头；但沙箱里的资源请求（画板图片、字体）带不上头。能力地址能不能完全去掉，取决于这一点。
- **动效导出放哪**：服务端（Go + Chromium）还是客户端 WebView（WebCodecs 编码）？后者不用下载 Chromium，但三个 WebView 引擎的一致性和确定性要实测。
- **vgpu 特效的导出路径**（§6）。

## 10. 前提不同，结论不同

§1–§9 默认编辑器要并进 TB。换几个前提再看：

- **不和 TB 融合**：改 Go 的主要收益（同一个进程和二进制、去掉代理和看护、桌面版不带 Node）都不存在了。独立分发不想让用户装 Node，可以用 Bun/Deno 编成单文件，或者桌面版用 Electron（自带 Node）。这时倾向保持 Node，只把服务端保持得薄、接口写清楚，以后要换语言时只重写这一层。
- **不看团队现有技术栈，只看产品**：格式逻辑天然是 JS，最重的依赖是 Chromium（导出、导入、像素对比）。倾向全栈 TS；桌面端用 Electron，让编辑视图和导出用同一个 Chromium，"所见即所得"有保证。
- **要做移动端**：手机上跑不了 Node、Claude Code、无头 Chromium。两条路：
  - 有一台远程主机（自己的电脑或服务器）做重活，手机是 WebView 里的瘦客户端；这时 TB 正好是现成的主机，融合的理由变强。
  - 不要云端，App 内直接调模型、读写本地文件，自己跑一个工具调用循环充当 agent（Claude Code 给的工具只有 Read、Edit、Write、Glob、Grep 五个）。服务端的职责变成 App 里的一层，按平台接 Node 文件系统、Capacitor 文件接口或浏览器 OPFS。这一层只能是 JS/TS，Go 在手机上基本用不上。
- **团队就是要统一到 Go**：界面和运行时仍然只能是 JS（画布、幻灯片、动效本身是 HTML），"全平台 Go"指界面以外的逻辑。格式逻辑改写成 Go，原生编进服务端，或编成 WASM 给浏览器。文档类型的实测见 [docs-go.md](./docs-go.md)，画布和幻灯片回写依赖的源码位置见 [parse5.md](./parse5.md)。动效的时间轴和画面留在浏览器，能换成 Go 的只有存文件和导出调度，见 [motion-go.md](./motion-go.md)。按当前代码列出的、服务端换成 Go 时各处要改什么，见 [go-backend.md](./go-backend.md)。

## 11. 当前倾向：独立产品，TB 负责引流

讨论下来的判断：用户大多是独立来做设计的人，专门为了设计去装 TB 的会很少；TB 的作用是引流，而不是宿主。

- **服务端保持 TS。** 贡献者多半来自前端和设计工具，一种语言、一份格式逻辑，门槛最低。改 Go 会让服务端用到的格式逻辑有两份（见 [go-backend.md](./go-backend.md) §3），新功能要两边一起写。
- **普通用户的安装问题靠分发解决，不靠换语言。** 桌面安装包、npm 包都能藏住运行时；真正的门槛是 Claude Code 登录、本机 Chrome 和 ffmpeg、模型设置，换 Go 也还在。
- **和 TB 的连接走两条已有的路**：模型设置里把 TB 作为推荐的连接（设计工具的用户由此认识 TB）；TB 按 protocol 1 以子进程带上设计工具（TB 的用户由此用到设计工具）。两条都不要求服务端换语言。
- **什么时候重新考虑 Go**：设计工具主要以 TB 的一个模块被使用，或者要做不带 Node 的移动端宿主。到那时按 go-backend.md 的清单走。
