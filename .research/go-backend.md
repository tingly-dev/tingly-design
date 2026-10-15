# 后端一定要换成 Go：要改哪些

状态：**研究**，按当前 main 的代码盘点，不改产品代码。为什么要不要换、换了值不值，见 [server-runtime.md](./server-runtime.md)；本文接受"服务端一定是 Go"这个前提，只回答：服务端、编辑器、打包发布、Claude Code 那一侧、测试，各要动什么，哪些不用动。文档类型的移植实测见 [docs-go.md](./docs-go.md)，动效见 [motion-go.md](./motion-go.md)。

标"实测"的是读代码或统计出来的，标"推断"的是没有验证的判断。

## 1. 结论

- **编辑器、沙箱、导出、导入、core 都留在 TypeScript。** 编辑器和服务端之间只有 `apps/editor/src/api.ts` 一个出口（HTTP 加一条 SSE），只要 Go 服务端的接口原样保持，编辑器可以一行不改。（实测）
- **服务端本身是 10 个文件、2075 行。** 其中文件、版本、锁、日志、SSE、文件监视、模型代理、Claude Code 子进程、本机 Chrome 渲染，都不懂格式，直接改写成 Go。（实测行数；改写量是推断）
- **真正的难点是服务端已经开始懂格式了。** 它从 core 引用了 11 个模块里的函数（§3）：新建项目的起始内容、启动页的卡片、design system 的 tokens.css 生成、安装 design system、看板的 SQL 绑定、快速 AI 的提示词、Claude Code 步骤的描述。每一项要么移植成 Go 并用 TS 生成的对照用例锁住，要么挪回编辑器。这是迁移里唯一需要设计的部分。
- **Claude Code 侧要换掉两个 Node 脚本**（看板查询、动效命令行），否则委托出去的 Claude 仍然要求本机有 Node。
- **发布从"一个与平台无关的 npm 包"变成"每个平台一个二进制"**，CI、发版、TB 的下载方式都跟着改。

## 2. 服务端：直接改写，不涉及格式（实测文件，推断做法）

| 现在（Node） | 做什么 | Go 里用什么 |
|---|---|---|
| Hono、`@hono/node-server`、`serveStatic` | 路由、静态文件、路径前缀 `DC_BASE_PATH` | `net/http`（Go 1.22 的路由模式）、`embed.FS` 内嵌编辑器构建产物 |
| `store.ts` 的读写、`versionOf`、`withLock`、`writeAtomic`、`ownWrites` | 文件带版本（sha256 前 12 位）、冲突回 409、原子写、区分自己写的和外部写的 | `crypto/sha256`、按项目的 `sync.Mutex`、临时文件加 `os.Rename` |
| chokidar | 监视 `projects/`，外部改动推给编辑器 | fsnotify（递归要自己挂子目录；macOS 上的合并事件行为要实测） |
| `hub.ts` | 日志文件（journal）、SSE 广播 | 追加写文件；SSE 就是 `text/event-stream` 加 `Flush` |
| `log.ts` | 结构化日志，`DC_LOG_LEVEL`、`DC_LOG_FORMAT=json` | `log/slog`，字段名照旧 |
| `aiconfig.ts` + `@anthropic-ai/sdk` | 模型设置文件、密钥不出服务端、连通性测试 | anthropic-sdk-go（TB 的 `libs/` 里已有） |
| `/fast-edit` 的流式代理 | 把模型输出的文字流回编辑器，出错写 `__ERROR__` 行 | 同上 SDK 的流式接口 |
| `delegate.ts` | 起 `claude` 子进程，读 `stream-json`，推 RunFeed 的步骤，能停 | `os/exec`、逐行 JSON 解码 |
| `render.ts` | 本机 Chrome 调试管道逐帧截图，ffmpeg 编码 | `os/exec` 的 `ExtraFiles` 接 fd 3、4，见 motion-go.md §4 |
| `connectors.ts` 的 `node:sqlite` | 看板只读查询 | modernc.org/sqlite（纯 Go，不要 cgo），只读打开 |
| `git commit` | 提交项目 | 照旧调 `git` 命令 |
| `i18n.ts` | 服务端错误、起始内容的文案 | 见 §5 |

接口要一字不差地保持，编辑器才能不改：路由和方法、JSON 字段、SSE 事件的形状（`type: 'file'` 等）、版本号算法和 409、`__ERROR__` 行、渲染进度的 JSON 行、`/api/health` 的字段、启动时打印的 `TINGLY_DESIGN_READY` 行和环境变量（这些是 protocol 1 的一部分，见 `docs/en/embedding.md`）。

## 3. 服务端里懂格式的部分：这是要设计的地方

按服务端 import 统计（实测）：

| core 模块 | 服务端用来做什么 | 规模 | 建议 |
|---|---|---|---|
| `canvas` `deck` `docs` `dash` `motion` `designSystem` 的 `new*` / `starter*` | 新建项目时写起始内容（带当前语言的文案） | 每个几十行 | **挪到编辑器**：编辑器生成整套起始文件，服务端只负责一次写入多个文件。命令行和 TB 新建项目时也走这个接口 |
| 各类型的 `parse*` / `stringify*`（index 文件） | 读写 deck.json、canvas.json、doc.json、dash.json 这类 JSON 索引 | JSON，字段少 | Go 里用有序 JSON 读写，docs-go 的 `js.go` 已经做过 |
| `launcher.projectCard` | 启动页每张卡片：标题、数量、封面那一页的源码 | 170 行，依赖各类型的 parse 和 `faceMarkup` | **移植**，用 TS 生成的对照用例锁住；或者服务端只回索引文件和文件表，卡片在编辑器里算（多一轮请求） |
| `designSystem.resolveTokens` + `compileTokensCss` | tokens.json 一变就重新生成 tokens.css，**包括 Claude Code 或终端改的时候**，编辑器不一定开着 | 约 550 行 | **移植**，用对照用例锁住。挪不回编辑器，因为生成要在没人开编辑器时也发生 |
| `designSystem` 的安装（`dsFolderOf`、字体、改 deck/canvas 的 `designSystems` 和 `faces`） | 把一个 design system 装进画布或幻灯片 | 约 60 行（在 `index.ts`） | 依赖上一项的 `resolveTokens`，跟着一起移植 |
| `dash.bindSql` `cleanParams` `fillArgs` `isDatabasePath` | 看板查询的参数绑定和只读规则 | 约 80 行 | **移植**，对照用例要覆盖拒绝的写法，这是安全边界 |
| `prompt` 的 `FAST_EDIT_*` | 快速 AI 的系统提示词 | 147 行字符串 | **构建时导出成 JSON**，Go 用 `embed` 读，提示词仍只在 TS 里改 |
| `activity.describeTool` | 把 Claude Code 的每次工具调用变成 RunFeed 的一步 | 95 行 | 移植，规则简单 |
| `attachments` 的 `checkMessages` `checkUploads` `isKeptPath` `isUploadPath` | 请求和上传路径的校验 | 几十行 | 移植，对照用例覆盖越界路径 |
| `aiConfig` 的 `resolveAi` `sanitizeSaved` `validBaseUrl` | 环境变量 > 保存值 > 默认值 | 113 行 | 移植。编辑器也用这份规则显示来源，两边要一致，所以同样要对照用例 |

移植部分合计约 1000 行 TS，按 docs 验证的比例（Go 约是 TS 的 2.8 倍，因为要补 JS 的字符串和 JSON 语义）大概是 2500 行 Go。（推断）

关键是**格式逻辑以后有两份**。办法和 docs 验证一样：TS core 跑出对照用例（输入和期望输出），Go 的测试逐字节比对；CI 每次都重新生成用例，core 一改、Go 没跟上就红。没有这一步，两份实现迟早会悄悄分叉。

还要记住的一条边界：编辑器保存时的回写（`parse.ts`、`copy.ts`、`docs.ts` 的 merge）**一直在浏览器里**，服务端不参与，所以不用移植。只有将来要让服务端自己改文件内容（比如没有浏览器的移动端、服务端合并冲突）时才需要，那时见 docs-go.md 和 parse5.md。

## 4. 编辑器：要动的很少

- `api.ts`：接口不变就不用改。若把起始内容挪到编辑器（§3 第一行），新建项目的调用从"传类型和标题"改成"传整套文件"，`Launcher.tsx` 的新建对话框跟着改。
- 若启动页卡片改在编辑器里算，`Launcher.tsx` 要多取一次封面源码。
- `vite.config` 的开发代理目标不变（端口照旧）。
- 编辑器里写着"服务端从 tokens.json 生成 tokens.css"的注释不用改，事实不变。
- 不变的：画布、幻灯片、动效、文档、看板、design system 六个编辑器，沙箱，`@dc/export` 的浏览器导出，`@dc/import`，主题，宿主消息，i18n 的界面文案。

## 5. 文案（i18n）

服务端用到 i18n 的地方：错误信息（`HttpError(status, key, params)`）、新建项目的起始文案、给模型的"用某语言回答"。文案的源头留在 `packages/i18n` 的 TS 里，构建时导出成每种语言一个 JSON，Go 内嵌并实现同样的 `{{占位符}}` 替换和英文回退。`pnpm test` 现在检查缺键和占位符不一致，要加一项：Go 引用的键都在 JSON 里。（推断）

起始内容如果挪到编辑器，`starter` 这一组文案服务端就不用了。

## 6. Claude Code 那一侧

委托出去的 Claude 按 skill 运行命令，其中两个是 Node 脚本（实测）：

| 现在 | 谁用 | 换成 |
|---|---|---|
| `node scripts/dash-query.mjs <db> "<SQL>"` | 看板 skill，`delegate.ts` 的允许工具里写死了 `Bash(node scripts/dash-query.mjs:*)` | Go 二进制的子命令，例如 `tingly-design dash-query`，和服务端共用只读规则 |
| `node scripts/motion-render.mjs` | 动效 skill 的导出说明 | Go 二进制的 `render` 子命令，和服务端精确渲染合成一份 |

这两处改了，`.claude/skills/dashboard/SKILL.md`、`.claude/skills/motion/SKILL.md`、`delegate.ts`（届时是 Go 里的同一段提示词）要同步。`dc-import`（`packages/import/bin`）是开发和导入用的命令行，留在 Node，不在服务端路径上。

## 7. 打包、发布、嵌入

| 现在 | Go 之后 |
|---|---|
| `scripts/bundle.mjs` 用 esbuild 把服务端打成一个 `server.mjs`，加编辑器、沙箱、样例、skill | 编辑器、沙箱、样例、skill 用 `embed.FS` 编进二进制，或照旧放在旁边的目录 |
| 一个与平台无关的 npm 包 `@tingly-dev/tingly-design`，需要 Node ≥ 20 | 每个平台一个二进制（darwin/linux/windows × amd64/arm64）。还要 npm 就学 esbuild：一个主包加按平台的可选依赖 |
| `tingly-design.json` 里写 `entry` 和 `node` | 写二进制名；`protocol` 不变 |
| CI：`pnpm test`、`typecheck`、`bundle`、`smoke-bundle.sh` | 加 `go test`（含对照用例）、交叉编译；冒烟测试改成起二进制 |
| TB 下载 tgz、准备 Node 运行时（见 `.design/tingly-box-integration.md`） | TB 下载对应平台的二进制，不再准备 Node；如果融合，TB 直接 import Go 包，不起子进程 |

## 8. 测试

- `e2e/` 是 Python + Playwright，对着 HTTP 和页面测，还带一个假的 Anthropic 服务（`mock_anthropic.py`）。它不关心服务端是什么语言，正好当验收：Go 服务端过了全部 e2e 才算接口没变。（实测：e2e 只经 HTTP 和浏览器）
- `packages/core` 的单测留着，另加 §3 的对照用例生成。
- 迁移期间两个服务端可以并存，同一套 e2e 各跑一遍。

## 9. 顺序（推断）

1. Go 骨架：文件、版本、锁、SSE、监视、日志、静态文件、`/api/health` 和 ready 行。先让画布和文档的 e2e 通过。
2. 模型设置、快速 AI（提示词从 TS 导出）、Claude Code 委托和 `describeTool`。
3. 新建项目：起始内容挪到编辑器，服务端加一次写多个文件的接口。
4. design system：`resolveTokens`、`compileTokensCss`、安装，带对照用例。
5. 启动页卡片。
6. 看板查询和 `dash-query` 子命令，带拒绝用例。
7. 精确渲染和 `render` 子命令。
8. 打包、CI、发版、冒烟测试；改 embedding 文档（中英两份）和 skill；删除 `apps/server`。

## 10. 开放问题

- 起始内容挪到编辑器后，没有编辑器的入口（命令行、TB 的接口）怎么新建项目：也调同一个接口，还是 Go 里留一份最小模板。
- fsnotify 在 macOS 和 Windows 上递归监视的可靠性，没有测。
- 是否保留 npm 分发。保留就要维护按平台的可选依赖包。
- 以后 core 里新加的函数，凡是服务端要用的，都要同时写 Go 版和对照用例。这条规则要写进 CLAUDE.md，否则新功能会默认只写 TS。
