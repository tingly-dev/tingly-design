# 对接 Tingly Box：未来方案

状态：**方案，未实施**。tingly-design 这边的准备工作（打包、路径前缀、宿主消息、Tingly Box 主题）已经做完，见 [docs/en/embedding.md](../docs/en/embedding.md)（约定 protocol 1）和 [docs/en/theming.md](../docs/en/theming.md)。本文写的是将来在 Tingly Box（下称 TB）里接入时怎么做，以及为什么这样做。在决定动 TB 之前，TB 仓库不做任何改动。

TB 侧的引用路径都相对 tingly-box 仓库。

## 1. 目标

用户在 TB 控制台的侧栏点「设计」，就能看到 tingly-design 的启动页，打开画布、幻灯片、文档、仪表盘、设计系统，用的是 TB 的主题、TB 的模型网关、TB 的登录，不需要另装、另配或另开端口。

不在本期范围：

- 把编辑器改写成 TB 的 React 页面。编辑器保持独立应用，用 iframe 嵌入，两边各自发版。
- 团队或远程部署时多人共用一份项目（现在是单机单用户）。
- 编辑器内的 TB 账号体系。编辑器自己没有登录，见 §4.2。

## 2. 现状

### 2.1 tingly-design 已经提供的

| 能力 | 约定 |
|---|---|
| 可独立运行的包 | `pnpm bundle` 输出 `dist/tingly-design/`，只需要 Node ≥ 20.11；清单 `tingly-design.json` 写着 `version`、`protocol`、`entry`、`node` |
| 挂在前缀下 | `DC_BASE_PATH`：所有路由、编辑器和沙箱资源都在前缀下，前缀可以有多段 |
| 进程托管 | `PORT=0` 时打印 `TINGLY_DESIGN_READY {port, basePath, version, protocol}`；`SIGTERM` 或关闭 stdin（`DC_EXIT_WITH_STDIN=1`）时退出，并带走它启动的 Claude Code |
| 数据目录 | `DC_PROJECTS`；目录不存在时放入示例项目，`DC_SAMPLES=0` 则从空开始 |
| 模型 | 快速 AI 直接调用 `ANTHROPIC_BASE_URL`；「交给 Claude Code」在同样的环境里运行 `claude`。模型名用 `DC_FAST_MODEL` 和 `DC_DELEGATE_MODEL` 指定 |
| 宿主消息 | `tingly-design:open`、`set-theme`（宿主发给编辑器）；`ready`、`location`、`theme-changed`（编辑器发给宿主） |
| 主题 | 预设 `light`、`dark`、`claude`、`ds`、`sunlit`，取自 TB `@tingly/ui` 的调色板，用 `scripts/sync-tingly-box-theme.mjs` 同步 |

### 2.2 TB 侧和接入有关的事实

- **HTTP 服务**是 Gin（`internal/server/server_routes.go`）。前端用 `//go:embed web/dist` 打进二进制，`NoRoute` 对所有未匹配的路径返回 `index.html`（`internal/server/webui_static.go:42-69`）。代码里还没有反向代理（`httputil.ReverseProxy` 只在测试里出现），也没有设置 `X-Frame-Options`。
- **控制台登录**用的是存在 localStorage `user_auth_token` 里的 bearer token，只靠 `Authorization` 头校验（`internal/middleware/auth.go:252-292`），不认 cookie，也不认查询串。所以浏览器对 iframe 的普通导航带不上身份。
- **数据目录**是 `~/.tingly-box`（`internal/constant/constant.go`），默认端口 12580，实际端口写在 `~/.tingly-box/tingly-server.port`。
- **子进程**通过 agentboot 的 `process/osexec.go` 启动。给 Claude Code 的网关环境已经现成（`internal/agent/prefs.go:135-150`、`internal/tbclient/tb_client.go:64-92`）：`ANTHROPIC_BASE_URL=<tb>/tingly/claude_code`，`ANTHROPIC_AUTH_TOKEN=<ModelToken>`，`localhost` 加进 `NO_PROXY`。
- **模型规则**：`claude_code` 场景下默认只有 `tingly/cc` 是启用的；`tingly/cc-haiku`、`tingly/cc-sonnet` 等存在但默认关闭（`internal/config/init.go:46-52`）。
- **前端**：
  - 路由在 `frontend/src/routes/appRoutes.tsx`（都是 `lazy()`），侧栏在 `layout/useActivityItems.tsx`。
  - 实验功能用 `_global` 场景开关加 `<ExperimentalFeatureGate>` 控制（`components/ExperimentalFeatureGate.tsx`、`contexts/FeatureFlagsContext.tsx`）。
  - 主题模式存在 localStorage `tingly-theme-mode`，取值 `light | dark | sunlit | claude | ds | system`（`packages/ui/src/theme/options.ts:8`），**和我们的预设名一一对应**。
- **分发**：
  - 发的是单个 Go 二进制，CLI 和 Wails 桌面版共用同一份前端构建，**不带 Node**。
  - npm 包 `tingly-box` 只是一层薄壳，按平台下载 release 压缩包（`.design/npm.md`）。
  - 桌面版页面的 origin 是 `wails://localhost`，HTTP 走本机端口（`.design/gui-host-bridge.md`）。

## 3. 总体结构

```
 浏览器 / Wails 窗口
 ┌──────────────────────────────────────────────┐
 │ TB 控制台  /design?p=box-console              │   TB 自己的 SPA 路由
 │  ┌────────────────────────────────────────┐  │
 │  │ <iframe src="/apps/design/<key>/?p=…">  │  │   能力地址，见 §4.2
 │  └────────────────────────────────────────┘  │
 └──────────────────────────────────────────────┘
          │ GET /api/v1/design/session (bearer)        │ /apps/design/<key>/*
          ▼                                            ▼
 ┌──────────────────────── TB (Go, :12580) ─────────────────────────┐
 │ design 模块：启动和看护子进程、发放 key、反向代理（不缓冲）          │
 │ 模型网关 /tingly/design  ◀───────────────┐                         │
 └──────────────┬───────────────────────────┼─────────────────────────┘
                │ spawn, stdin 管道           │ ANTHROPIC_BASE_URL
                ▼                            │
 ┌──── node ~/.cache/tingly-box/design/<ver>/server.mjs (127.0.0.1:随机端口) ────┐
 │ DC_BASE_PATH=/apps/design/<key>   DC_PROJECTS=~/.tingly-box/design/projects     │
 │ 快速 AI ─────────────────────────────┘    claude（交给 Claude Code）─────┘       │
 └─────────────────────────────────────────────────────────────────────────────────┘
```

## 4. 关键决定

### 4.1 页面地址和代理前缀分开

- TB 的 SPA 页面放在 `/design`，代理前缀放在 `/apps/design/<key>`。
- 不能两个都用 `/design`：Gin 的 `/design/*any` 会吞掉 SPA 路由，刷新 `/design?p=…` 时会直接进编辑器，TB 的侧栏也就没了。
- `/apps/` 给以后其他嵌入应用留了位置。代理路由要在 `NoRoute` 之前注册。

### 4.2 认证：能力地址，不用 cookie

问题有三个：

- TB 的身份只在 `Authorization` 头里，iframe 导航带不上；
- 画板跑在 opaque origin 的沙箱 iframe 里，本来就不带 cookie；
- 桌面版的 `wails://localhost` 嵌入 `http://127.0.0.1` 属于跨站，WebKit 会挡第三方 cookie。

做法是让前缀本身就是凭证：

1. TB 每次启动子进程时生成 32 字节随机 key，`DC_BASE_PATH=/apps/design/<key>`。
2. TB 前端用现有 bearer 调 `GET /api/v1/design/session`，返回 `{ url, version, protocol, status }`，再把 `url` 设给 iframe。这个接口在 `UserAuthMiddleware` 之后。
3. 代理只转发 key 正确的请求。key 不对或者没有 key，一律 404，不暴露编辑器是否存在。
4. 沙箱和项目资源（`/sandbox/*`、`/raw/*`）的地址里本来就带着 key，所以不用像 embedding.md §3 写的那样单独放行。

代价和对策：

- key 会出现在 iframe 的地址里。代理在响应上加 `Referrer-Policy: same-origin`；TB 地址栏只镜像 `search`，不带前缀，key 不会进入分享链接。
- key 只活在一个进程的生命周期里，TB 重启或子进程重启后就换新的。旧 iframe 拿到 404 后，页面重新取 session 即可（§4.7）。
- 代理补上 `Content-Security-Policy: frame-ancestors <TB origin> wails://localhost`，防止别的站点嵌入。
- 只有这一种认证，其他东西都不需要知道 TB 的 token。

不选 cookie：桌面版跨站 iframe 不可靠，沙箱请求也带不上。不选查询串 token：子资源和沙箱请求还是带不上。

### 4.3 子进程生命周期

放在 TB 新增的 `internal/server/module/design` 模块里：

- **何时启动**：第一次打开设计页（第一次调用 session 接口）时才启动，不随 TB 一起启动；没用过这个功能的人不付任何代价。启动后常驻，TB 退出时停掉它。
- **怎么启动**：
  - 通过 agentboot `process` 启动 `node <包>/server.mjs`，`PORT=0`，`DC_EXIT_WITH_STDIN=1`，stdin 接一根 TB 一直开着的管道。这样 TB 被 kill -9 也不会留下孤儿进程。
  - 先读 `tingly-design.json`，`protocol` 不认识就拒绝启动。
  - 等 stdout 里的 `TINGLY_DESIGN_READY` 行，最多 15 秒。
- **健康检查**：拿到端口后调一次 `/api/health`，核对 `protocol` 和 `basePath`。之后只在请求失败时再查，不做定时轮询。
- **崩溃处理**：子进程退出后标记为 `stopped`，下一次 session 请求时重启；连续失败 3 次后停在 `failed`，把 stderr 最后 50 行交给前端显示（§4.8）。
- **停止**：TB 关闭时先发 `SIGTERM`，2 秒后 kill。Windows 没有 SIGTERM，靠关闭 stdin 让子进程退出，这也是 `DC_EXIT_WITH_STDIN` 的用处。

### 4.4 分发：包按需下载，Node 先用系统里的

TB 是单个 Go 二进制，桌面版也不带 Node，所以不把 tingly-design 打进 TB：

- **发布**：tingly-design 发版时把 `dist/tingly-design/` 打成 `tingly-design-<ver>.tgz`，放到 GitHub release，同时发一个 npm 包 `@tingly-dev/tingly-design`，和 TB 的 npm 方案一致。包本身与平台无关，只有一份；两边是同一个文件（见 [release.md](./release.md)）。
- **版本**：TB 在代码里钉一个版本和 sha256（比如 `internal/server/module/design/version.go`），升级 tingly-design 就是在 TB 里改这一行。
- **下载**：第一次启用时下载到 `~/.cache/tingly-box/design/<ver>/`，按 sha256 校验后解压，和 `.design/npm.md` 里二进制缓存的位置并列。下载走 TB 已有的代理设置。
- **Node 运行时**：
  - 第一期从 `PATH` 找 `node`，要求 ≥ 20.11，按清单里的 `node` 字段核对。
  - 找不到时，页面就地说明并给出安装链接（§4.8），不静默失败。
  - 用 Claude Code 的人大多已经装了 Node。第二期再考虑按平台下载官方 Node 二进制到同一个缓存目录。
- **开发时**：设 `TB_DESIGN_DIR=<本地 dist/tingly-design>`，跳过下载；或者设 `TB_DESIGN_URL=http://127.0.0.1:8787`，直接代理到一个已经在跑的 `pnpm dev` 服务。

### 4.5 模型：TB 里单独一个 `design` 场景

- `ANTHROPIC_BASE_URL=<tb>/tingly/design`，`ANTHROPIC_AUTH_TOKEN=<ModelToken>`，和 Claude Code 用的是同一套拼法（`tb_client.go`）。地址用 `127.0.0.1` 加实际端口，并把 `localhost` 加进 `NO_PROXY`。
- 新增 `design` 场景，预置两条规则：
  - `tingly/design-fast` 给快速 AI，是 `DC_FAST_MODEL`；
  - `tingly/design` 给交给 Claude Code 的任务，是 `DC_DELEGATE_MODEL`，同时把 `ANTHROPIC_DEFAULT_*_MODEL` 都设成它，免得 Claude Code 自己的分层模型落到未配置的规则上。
- 单独一个场景，是因为用量统计和规则页能清楚显示「设计」用了多少、走的是哪个模型（UX 原则 5），也不会和用户自己调好的 Claude Code 规则互相影响。
- 过渡方案：如果先不加场景，就用 `claude_code` 场景，两个模型都设成 `tingly/cc`，因为它是唯一默认启用的规则。

### 4.6 主题：TB 说了算

- TB 打开 iframe 时带上 `?theme=<模式>`。`system` 先解析成 `light` 或 `dark` 再传，这样首屏颜色就对，不会闪一下。
- 用户在 TB 里切换主题时，TB 发 `{ type: 'tingly-design:set-theme', theme: <模式> }`。TB 的模式名和我们的预设名完全一样，不需要映射表。
- TB 改了调色板之后，在 tingly-design 跑 `node scripts/sync-tingly-box-theme.mjs <tb>` 再发版，`SOURCE.json` 记录对应的 TB commit。不在运行时传整套调色板：那样两边的映射逻辑会写两份。
- tingly-design 待做：嵌入时编辑器的「外观」菜单应该隐藏，否则会出现两个主题入口，违反 UX 原则 2 和 12。做法是 `?theme=` 来自宿主时（或收到第一条 `set-theme` 后）不显示这个菜单。这属于可以兼容的新增，protocol 不变。

### 4.7 地址和导航

- TB 页面 `/design` 加上编辑器给的 `search`，就是可以分享和刷新的地址，比如 `/design?p=tingly-intro&s=box`。
  - 编辑器发来 `ready` 或 `location` 时，TB 用 `history.replaceState` 把 `search` 写进自己的地址；
  - 页面加载时，iframe 的 `src` 是 session 的 `url` 加上这段 `search`。
- 浏览器后退会离开 TB 的 `/design`。编辑器内部的切换（幻灯片、标签页）用的是 replace，不产生历史记录，和独立运行时一样。
- iframe 收到 404（key 过期）时，TB 重新取 session，用当前的 `search` 重新加载。这件事在 `ready` 超时或 iframe `onload` 后检查 `ready` 是否到达时发现。
- TB 发 `open` 前要校验 `event.origin` 等于 TB 服务的 origin；收消息同样要校验 `event.origin`，再看 `type`。

### 4.8 入口、开关和出错时的样子

- 第一期放在实验功能里：`_global` 场景下加 `design` 开关，`<ExperimentalFeatureGate feature="design">` 包住路由，侧栏在开关打开时出现「设计」。稳定后去掉开关。
- 页面是全幅 iframe，不套 `PageHeader`。编辑器自带顶栏，再加一层会重复（UX 原则 9）。
- session 的 `status` 决定页面显示什么，都在 iframe 的位置就地显示（UX 原则 7、8）：

| status | 用户看到 |
|---|---|
| `downloading` | 进度条加版本号（「正在获取设计编辑器 0.2.0」） |
| `no-node` | 说明需要 Node 20 以上，给安装链接，旁边一个「重新检测」按钮 |
| `starting` | 骨架屏 |
| `ready` | iframe |
| `failed` | 错误摘要加 stderr 末尾，可以复制（UX 原则 11），按钮「重启」 |

- 健康接口里「快速 AI 可用」和「`claude` 命令可用」由编辑器自己显示，TB 不重复显示。

### 4.9 数据和提交

- 项目放在 `~/.tingly-box/design/projects`，和 TB 的其他数据在一起，备份和迁移一起处理。
- 默认 `DC_SAMPLES=1`，第一次打开就能看到示例，不是一片空白（UX 原则 2）。
- 「提交」需要项目目录在 git 仓库里。TB 第一次创建这个目录时执行一次 `git init`，这样提交和历史开箱就能用；没有 git 时跳过，编辑器会说明原因。

## 5. 两边要做的事

### TB（将来的 PR，现在不开）

后端：

- 新增 `internal/server/module/design`，只在 `server_modules.go` 里接线，内容包括：
  - 包的下载、校验和缓存；
  - Node 探测；
  - 子进程启动和看护；
  - `GET /api/v1/design/session`，带 swagger 定义，然后跑 `task codegen`；
  - `/apps/design/:key/*any` 反向代理：用 `httputil.ReverseProxy`，`FlushInterval: -1` 保证 SSE 和流式文本不被缓冲，不加 CORS，加上 §4.2 的两个响应头。
- 新增 `design` 场景和两条预置规则，加上配置迁移。
- 加 `_global/design` 开关。

前端：

- 新增 `pages/Design.tsx`，在 `appRoutes.tsx` 里 `lazy()` 引入，放在 `ExperimentalFeatureGate` 里。
- 在 `useActivityItems.tsx` 加入口，在「系统 → 实验功能」页加开关。
- 主题联动：读 `ThemeContext`，变化时发 `set-theme`。
- 地址镜像和 404 时重新加载，见 §4.7。
- 所有界面文字同时写进 `en.ts` 和 `zh.ts`。
- 图标从 `@/components/icons` 引入。

测试：

- Go 单元测试覆盖代理：key 校验、流式响应不缓冲、子进程崩溃后重启。
- e2e：在 TB 里打开 `/design`，切换主题，打开一个项目后刷新，地址保持不变。

### tingly-design（可以先做，都不改 protocol）

- 发版流程：GitHub release 附上 `tingly-design-<ver>.tgz` 和 sha256，并发布 npm 包。已实施，见 [release.md](./release.md)。
- 嵌入时隐藏外观菜单（§4.6）。
- 服务端响应加上 `Referrer-Policy: same-origin`，作为 TB 代理之外的第二道防线。
- `embedding.md` 补上能力前缀的写法，把示例前缀改成 `/apps/design/<key>`，并说明这时 `/sandbox` 和 `/raw` 不需要单独放行。
- `e2e/embed.py` 加一组多段前缀（`/apps/design/<key>`）的检查。

## 6. 分期

1. **第一期，实验开关后面**：用系统 Node、下载钉住的版本、能力前缀代理、主题联动、地址镜像，暂用 `claude_code` 场景的 `tingly/cc`。
2. **第二期**：独立的 `design` 场景和用量归属、`git init`、更完整的出错页。
3. **第三期，去掉开关**：按需下载 Node 运行时，桌面版的完整验证（见 §7）。

## 7. 未决问题

- **桌面版能不能在 `wails://localhost` 里嵌入 `http://127.0.0.1` 的 iframe**：macOS WKWebView 和 Windows WebView2 对混合内容的规则不同，要实际验证。如果不行，桌面版改成用 gui-host-bridge 打开一个独立窗口，直接加载能力地址。
- **团队部署**：TB 监听非本机地址时，能力地址就成了远程可访问的凭证。第一期在这种模式下禁用设计功能，或者只允许本机访问。
- **`claude` 命令从哪来**：现在用 `PATH` 里的 `claude`。如果 TB 将来自己管理 Claude Code 的安装，就把它的路径传进来（需要新增 `DC_CLAUDE_BIN`，属于兼容新增）。
- **多个 TB 实例共用 `~/.tingly-box`**：项目目录会被两个编辑器进程同时写。我们的写入是原子的，watcher 也能容错，但没有锁。先在文档里说明不支持。

## 8. UX 原则自检

| 原则 | 本方案 |
|---|---|
| 2 消解模式选择 | 点侧栏就直接进入启动页，有示例；没有「启用、配置、启动」这几步 |
| 3 命名统一 | TB 里统一叫「设计」，项目类型沿用编辑器里的叫法 |
| 5 具体值 | 规则页显示 `tingly/design-fast` 实际指向的模型；出错页显示具体版本和 Node 版本 |
| 6 默认值 | 模型、主题、数据目录都有默认值，不新增设置项 |
| 7 诊断走真实链路 | 状态来自真实的启动和健康检查，不是假探测 |
| 9 降噪 | 全幅 iframe，不套第二层顶栏 |
| 12 副作用限于当前表面 | 主题由 TB 统一控制，编辑器在嵌入时不再提供自己的主题入口 |
