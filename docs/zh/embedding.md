<p align="right"><a href="../en/embedding.md">English</a> · <b>简体中文</b></p>

# 嵌入到其他应用

Tingly Design 可以跑在别的应用里，就像 Tingly Box 把它挂成自己控制台里的一页。宿主随自己发布一个打包好的文件夹，以子进程启动它，把一个路径前缀转发给它，再用 iframe 嵌入编辑器。编辑器不关心宿主是谁：一切都走下面的约定。

```
 宿主（如 Tingly Box，:12580）                          tingly-design 包（node server.mjs）
 ┌───────────────────────────────┐   /design/*  ──→    ┌───────────────────────────────────┐
 │ 自己的页面，里面一个 <iframe   │                     │ 编辑器、API、沙箱，全部            │
 │ src="/design/?theme=…">       │ ←── postMessage ──→ │ 在 DC_BASE_PATH=/design 之下       │
 └───────────────────────────────┘                     │ 文件在 DC_PROJECTS                 │
         模型网关  ←──── ANTHROPIC_BASE_URL ────────── │ 快速 AI 和 Claude Code             │
                                                       └───────────────────────────────────┘
```

## 1. 打包

```bash
pnpm bundle        # 先构建，再写出 dist/tingly-design/
```

| 路径 | 是什么 |
|---|---|
| `server.mjs` | 打进了全部依赖的服务端，只需要 Node（版本见清单里的 `node`）。 |
| `tingly-design.json` | `{ name, version, protocol, entry, node }`：启动前先核对 `protocol`。 |
| `editor/`、`sandbox/` | 构建好的编辑器和画板运行时。 |
| `samples/` | 示例项目，会复制进一个还不存在的项目文件夹。 |
| `scripts/`、`.claude/skills/` | 交给 Claude Code 时它要读的格式说明和要跑的脚本。 |

这个文件夹可以拷到任何地方，不需要本仓库，也不需要 `node_modules`。

发布过的版本有现成的：GitHub release 上的 `tingly-design-<ver>.tgz` 和它的 `.sha256`，或者 npm 包 `@tingly-dev/tingly-design`（也以 `tingly-design` 发布，内容相同）。解开后是 `package/`，就是这个文件夹，另外带 `LICENSE`（Apache-2.0）、`NOTICE` 和 `THIRD_PARTY_LICENSES.txt`（打进包里的依赖的许可证声明）。

## 2. 启动

用下面这些环境变量运行 `node <包>/server.mjs`：

| 变量 | 宿主设成 |
|---|---|
| `PORT` | `0` 让服务端自己挑空闲端口（从就绪行读出来），或固定端口。 |
| `DC_HOST` | 不用设：服务端只监听 `127.0.0.1`，对外的是宿主。 |
| `DC_BASE_PATH` | 挂载的前缀，如 `/design`。所有路由、编辑器和它的资源都挪到它下面；只访问前缀本身会跳到 `前缀/`。转发时路径原样保留。 |
| `DC_PROJECTS` | 宿主数据目录里的一个文件夹，如 `~/.tingly-box/design/projects`。不存在时会先放入示例项目（`DC_SAMPLES=0` 则从空开始）。 |
| `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN` | 宿主的模型网关和它的令牌。快速 AI 直接调它；「交给 Claude Code」用同样的环境运行 `claude`，所以两者都经过宿主。 |
| `DC_FAST_MODEL`、`DC_DELEGATE_MODEL` | 网关认识的模型名。 |
| `DC_CONFIG` | 编辑器“AI 模型设置”保存到哪个文件（默认是 `DC_PROJECTS` 旁边的 `.tingly-design/ai.json`）。宿主在上面设的值优先于它，设置对话框里那一项显示为“由宿主设定”，不可改。 |
| `DC_THEME` | 用户还没挑主题时的默认外观（预设名或 JSON，见[主题](theming.md)）。 |
| `DC_LANG` | 链接和用户都没定语言时的界面语言（`en` 或 `zh`，也认 `zh-CN` 这类写法）。不设时跟随浏览器，再退回英文。 |
| `DC_EXIT_WITH_STDIN` | 设为 `1`，并把 stdin 接成宿主一直开着的管道：管道一关服务端就退出，宿主崩溃也不会留下孤儿进程。 |

开始监听时它打印一行：

```
TINGLY_DESIGN_READY {"port":41873,"basePath":"/design","version":"0.1.0","protocol":1}
```

`GET <前缀>/api/health` 返回同样的 `version`、`protocol`、`basePath`，以及快速 AI 和 `claude` 命令是否可用。`SIGTERM`（或关闭 stdin）会停掉它和它启动的 Claude Code。

Claude Code 在包的文件夹里运行，从那里找到格式说明；项目文件夹在包外时会加上 `--add-dir`。项目文件夹在 git 仓库里时可以提交，不在时会说明原因。

## 3. 转发请求

把 `<前缀>/*` 转发到 `http://127.0.0.1:<端口><前缀>/*`，路径、查询串和请求体原样不动，响应不要缓冲：`<前缀>/api/projects/<p>/events` 是 SSE 流，`<前缀>/api/projects/<p>/fast-edit` 是流式文本。

服务端自己没有登录。宿主有登录的话，在转发层检查。画板跑在不透明源的沙箱 iframe 里，它们的请求不带 cookie：`GET <前缀>/sandbox/*`（开源的运行时）和 `GET <前缀>/api/projects/<p>/raw/*`（项目的图片和字体）要免检放行，否则画布画不出来。

## 4. 和嵌入的编辑器通信

嵌入 `<前缀>/`（或 `<前缀>/?p=<项目>` 直接打开一个）。消息是带 `type` 的普通对象；编辑器只听父窗口（或打开它的窗口）。

宿主发：

| 消息 | 作用 |
|---|---|
| `{ type: 'tingly-design:open', project: 'box-console' }` | 打开一个项目；`project: null` 回到启动页。 |
| `{ type: 'tingly-design:open', search: '?p=tingly-intro&s=box' }` | 还原宿主记下的完整地址（见下面的 `location`）。 |
| `{ type: 'tingly-design:set-theme', theme }` | 应用一个主题直到页面刷新；`theme` 是预设名、令牌或 Tingly Box 的调色板（见[主题](theming.md)）。 |
| `{ type: 'tingly-design:set-language', language: 'zh' }` | 切换界面语言直到页面刷新；认 `zh-CN`、`en-US` 这类标签，不认识的语言忽略。也可以在嵌入地址上带 `?lang=zh`。 |

编辑器发：

| 消息 | 时机 |
|---|---|
| `{ type: 'tingly-design:ready', version, protocol, project, search, language }` | 每次页面加载：启动页（`project: null`）或某个项目；`language` 是当前界面语言。 |
| `{ type: 'tingly-design:location', project, search }` | 项目里的地址变了（换了幻灯片、标签页、视图）。 |
| `{ type: 'tingly-design:theme-changed', theme: { id, mode, scheme, name } }` | 任何主题变化，包括用户自己挑的。 |
| `{ type: 'tingly-design:language-changed', language }` | 任何语言变化，包括用户在外观菜单里选的。 |

宿主把 `search` 记进自己的地址（`/design?p=tingly-intro&s=box`），返回键、刷新和分享链接就都能用：加载时嵌入 `<前缀>/` 加上这段 search 即可。

打开项目是 iframe 里的一次页面加载，所以每个 `open` 之后都会来一条 `ready`。

## 版本

`protocol`（清单、就绪行和 `/api/health` 里都有）在启动变量、就绪行、`/api/health` 或上面的消息发生不兼容变化时加一。宿主遇到不认识的 protocol 应拒绝启动。老宿主可以忽略的新增不改这个数。

---

返回 [README](../../README.zh-CN.md)
