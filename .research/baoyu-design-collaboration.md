# baoyu-design 的多人协作：调研与对 tingly-design 的建议

Status: researched 2026-11-03；调研对象为 [JimLiu/baoyu-design](https://github.com/JimLiu/baoyu-design) v2.8.2（commit `609638d`）。

## 结论（TL;DR）

- **baoyu-design 确实实现了多人协作**，但不是 Figma 式的实时共创（无 CRDT/Yjs/OT、无共享光标），而是**“局域网分享 + 角色链接 + 保存级合并”**：项目文件夹仍是唯一事实来源，多个浏览器通过角色链接加入同一个本地服务器，谁改了什么由版本历史记录，冲突靠三方行合并 + 覆盖通知（Compare / Bring back）解决。
- 其协作引擎全部在 `skills/claude-design/scripts/server.mjs`（MIT 许可，约 5172 行），**架构思路可以放心借鉴**；但它的编辑器页面和 skill 文本是 Anthropic claude.ai 素材，**明确不在 MIT 之内，不能拷贝**。
- **tingly-design 已经具备了最难的那一半**：版本哈希 + 409 + 编辑函数重放（`docs/en/architecture.md` §4）、按项目的事件流 + journal（`apps/server/src/hub.ts`）、外部修改检测（`apps/server/src/store.ts:825`）。缺的是“人”的那一半：身份与角色、分享链接、在线面板、覆盖通知 UI。
- 建议：**不要引入 CRDT**，沿文件优先架构走 baoyu 验证过的“保存级同步 + 合并”路线，分 4 个阶段落地（身份/角色 → LAN 分享 → 在线状态 → 冲突通知 UI），总体约 3–6 人周，风险集中在跨 kind 测试和局域网安全边界。

---

## 1. baoyu-design 是什么

宝玉（Jim Liu，@dotey）的开源项目，把 claude.ai 的 Artifact 类型（Design 画布、Slides、Design System、Dashboard、Motion）搬到本地：打包成 Agent Skill，agent 在磁盘上以文件为单位写作（如 `<root>/project/canvas.json` + 每个 artboard 一个 `.dc.html`），`scripts/artifact.mjs` 提供 `open / check / share / archive` 等命令，`scripts/server.mjs` 起本地编辑器页面并把用户的编辑写回同一批文件。与 tingly-design 的文件布局理念几乎同构（`project/canvas.json` + `.dc.html`、design system 的 `tokens.json`、slides 每页一个 html）。

- 仓库：<https://github.com/JimLiu/baoyu-design>
- 数据（2026-11-03，GitHub API）：**5944 stars，458 forks**，创建于 2026-06-07，最近推送 2026-11-03；最新 release v2.8.2（2026-11-03 发布）；open issues 仅 1。发版频率约每几天一个 patch，**非常活跃**。
- 语言：JavaScript（无构建、无依赖安装，编辑器为预构建产物）。
- 运行形态：每类 artifact 一个 skill；v2.8.0 起“一类一个服务器、共享一个端口”（如 `http://127.0.0.1:4720/design/<id>/`）。

## 2. 许可（重要，影响“能不能抄”）

GitHub 显示 license 为 **NOASSERTION**。`NOTICE.md` 把仓库内容分成三块：

1. **MIT（`LICENSE`）**：维护者自己的部分——`scripts/artifact.mjs`、`scripts/server.mjs`、本地 comments、本地工具、README/CHANGELOG、DeepSeek/ChatGPT 插件自有代码。**协作引擎（server.mjs 的分享、历史、合并模块）就在这一块。**
2. **Anthropic 素材，未授权、不 MIT**：各 `SKILL.md`（改编自 claude.ai Artifact 类型）、`artifact-type/reference/`、**编辑器页面（`scripts/editor/`，按 claude.ai 运行时重建）**、Anthropicons 图标字体、`archive/baoyu-design/` 的上游系统提示词等。
3. **第三方开源**：React、Base UI、d3、pptxgenjs 等，各自带 license。

→ **可以参考/派生 server.mjs 的协作实现；绝不能拷贝 editor/ 下的代码和 skill 文本。** 引用 URL：<https://github.com/JimLiu/baoyu-design/blob/main/NOTICE.md>

## 3. 多人协作是怎么实现的

### 3.1 架构：文件仍是事实来源，“协作”是同一个本地服务器的多客户端

- 所有改动（agent 写文件、owner 在页面里编辑、guest 在局域网里编辑、终端手工改）最终都落回同一个项目文件夹。
- 服务器 per-directory `fs.watch` 监视项目（300ms 防抖，`watchArtifact`，server.mjs:4397–4470），用 `ownWrites`/`seen` 的 sha 区分“自己写的”与“外部改动”（server.mjs:825 同样的思路 tingly 也有）；外部改动归属为 **Agent/System** 并广播给所有页面——所以 Claude Code 改文件，所有浏览器实时看到，这与 tingly 的 hub 行为一致。
- 每个打开的 artifact 是 hub 上的一个 "site"；LAN 分享时 hub 接受本机 LAN 地址与机器名的 Host（server.mjs:2009）。

### 3.2 同步技术：保存级（save-level）同步，不是 CRDT/OT

- **读**：页面加载时从服务器拿文件清单（path → sha256，带 `ver`/`seq` 版本号）。
- **写**：页面把一批文件（base64）POST 给服务器的 publish 端点，每个文件带 `ifMatch`（期望的 sha）做**乐观并发控制**；不匹配则 409，返回当前 `live` 版本与每个路径的实际 sha（server.mjs:4180–4250）。
- **通知**：hub 向每个页面推 **SSE**（`/__hub`，支持 `__lastEventId` 断线续传，server.mbs:1799/2175）；comments 模块也用 SSE（`text/event-stream`，server.mjs:603）。guest 每 5 秒轮询一次自己的角色（`GUEST_WATCH`，server.mjs:3516）。
- **没有**字符级合并、没有 Yjs、没有 WebSocket、没有共享光标/选区。README 明确定位：“只在本机运行，别人可以看、可以导出，**不是（实时）协作工具**”之外，v2.3+ 实际提供了 LAN 多人编辑——但粒度是“一次保存”，不是“每个按键”。

### 3.3 冲突处理（这个项目做得最深的部分）

- **三方行级合并**（自研 diff3 变体，`mergeText`，server.mjs:1080–1113）：slides/design-system 按“行”合并，tokens 文件按 token 合并，画布按“元素”合并；两边改了不同元素/行则自动都保留，无感；改了同一行才弹条。
- **覆盖通知**：一次保存盖掉了页面没见过的新内容时，历史记录 `overwrote`（丢了谁的第几版、sha、角色），并给双方发 notice（`overwritten`/`overwrote`，server.mjs:2640–2665）；UI 上是 **Compare / Bring back**，找回被覆盖的内容时用 `mergeTextBytes(base, lost, now)` 只恢复丢掉的那部分、保留对方的其它改动（server.mjs:4607）。
- **编辑器侧的兜底**：别人保存了你正在编辑且有未保存改动的文件时，弹“用对方的 / 保留我的 / 两份都留（我的变成新副本）”；先尝试自动合并，合不动才问。
- **拒绝写保存**：被 409 拒过的路径记进 `refused` 集合，之后的强行覆盖被标记为“已知选择”（`chosen`），历史里记录其 `base`，供 Bring back 使用。

### 3.4 权限

- **角色链接**：`share <root>` 输出三条链接——`editor`（编辑+评论）/ `commenter`（只评论）/ `viewer`（只看）（`GUEST_ROLES`，server.mjs:1528）。token ≥16 字符，`timingSafeEqual` 比较；链接可关闭/重置（重置使旧链接失效）。
- **访客身份**：打开链接时输个名字即加入，服务器发 cookie（id + 24 字符 secret）；guest 卡在“其角色对应的链接”上——改角色、关链接、重置都会掉线（server.mjs:1596–1652）。
- **Owner 管理面板**：谁加入了、谁在线、逐人改角色/移除、总开关（仅本机 / 网络上任何有链接的人）；guest 也能看到并转发“自己角色及以下”的链接。导出（含整包 zip）**仅 owner**。
- **没有账号体系、没有加密**：plain http，“链接即权限”，仅限同一 Wi‑Fi/LAN（Tailscale 地址单独提示）。角色落到每个路由：commenter/viewer 进只读模式，viewer 看不到评论，只有 owner 能把评论“发给 agent”。

### 3.5 在线状态（presence）

- Share 面板列出已加入/在线的人；comments 模块有“agent 是否在听”的 presence（server.mjs:286–554，5s 心跳）。
- **没有共享光标、选区、awareness**——这是与 Figma/Yjs 路线最大的差距，也是它保持简单的代价。

### 3.6 持久化与历史

- 磁盘文件即事实；服务器自有状态放 `.artifact-server.json` / `.sharing.json`（链接、guests，被写进它生成的 `.gitignore`）；评论在 `comments.json`。
- **版本历史**（`history/`，约 v2.5 引入）：内容寻址对象库 `history/objects/<sha256>` + `index.json`（版本号、作者 = guest 名字/owner/Agent、角色、每版变更 path→sha）；同一人的连续改动合并为一个版本（30s 空闲 / 5min 跨度，server.mjs:2560 附近 `record`）；最多 500 版，超出折叠进 base 并 GC 孤儿对象；支持按版本 diff、整版或单文件恢复（恢复本身成为新版本）。`restoreTo`/`fold`（server.mjs:2690–2740）。

## 4. 成熟度与风险评估

| 维度 | 评价 |
|---|---|
| 活跃度 | 极高：5 个月 5.9k star，v2.8.2 当天发布，几乎每几天一个版本 |
| 工程质量 | 协作引擎自测覆盖（`archive/baoyu-design/agents/tests/`）、原子写、timing-safe 比较、路径/大小上限等防御性代码完善 |
| 协作成熟度 | LAN 规模（≤ ~十人）可用；无账号、无加密、无实时光标；README 明确“不是实时协作设计工具” |
| 风险点 | plain http 明文；编辑器/SKILL 文本的法律状态（Anthropic 素材）使其**不能作为代码依赖整体复用**，只能借鉴 MIT 部分 |

## 5. 与 tingly-design 的对比

tingly-design 已有的（引用）：

- **版本哈希 + 409 + 编辑函数重放**：每个文件的版本是内容哈希；保存带上基版本，不匹配则 409 返回新内容，编辑器把“从 source 到新 source 的函数”在新版本上重放再保存——“两个人同时编辑同一个文件，改动都保住”（`docs/en/architecture.md` §4）。**这比 baoyu 的整文件覆盖更强**：baoyu 在编辑器外改动的场景要靠通知+合并兜底，tingly 的重放模型对编辑器发起的改动天然收敛。
- **按项目事件流 + journal**：`apps/server/src/hub.ts` 的 `HubEvent`（`file`/`delete`/`journal`/`delegate`/`assets`，带 `Actor`），`.journal.jsonl` 一行一改、记录 actor（`packages/core/src/canvas.ts:188`：`human|jquery|fast-edit|claude|external|undo`），编辑器订阅后原地更新（`apps/editor/src/store.ts:311`），并区分自己写/外部写（`apps/server/src/store.ts:825`）。
- **撤销按上下文定位**：别人改过同一文件后仍能撤销自己的改动（architecture.md §4）。
- docs 已有 `.history/` 快照（`apps/server/src/history.ts`，仅 `tabs/*.md`，1 分钟一个、留 40 个）。

tingly-design 缺的（相对 baoyu 的协作面）：

1. **人的身份**：Actor 是“角色类型”不是“人”；journal 里有 actor 没有用户名/访客。
2. **分享与权限**：服务器无任何鉴权，绑定 localhost；没有 LAN 分享模式、角色链接、访客 cookie。
3. **在线面板 / presence**：hub 有订阅者，但没有“谁在线”的产品面。
4. **人类冲突的产品面**：409+重放是自动的、静默的；没有 Compare / Bring back、没有“两份都留”、没有覆盖通知；`.history/` 只覆盖 docs tabs，其它 kind 被覆盖的内容没有留存（虽有 git commit 机制可兜底）。
5. **评论**：baoyu v2.1 起全类型评论且能“发给 agent”（评论驱动 agent 改稿）；tingly 只有 docs comments（`.design/docs-comments.md`）。

## 6. 对 tingly-design 的落地建议（分阶段 + 工作量/风险）

总体判断：**沿 baoyu 验证过的“文件优先 + 保存级同步”路线走，不引入 CRDT/Yjs。** 理由：tingly 的核心承诺是“plain files, two-way editing”（终端、git、Claude Code、手改同一个文件夹）；Yjs 需要把文档状态变成二进制/持久会话，会与 git 提交、外部修改检测、`.journal.jsonl`、写回引擎全面冲突，改造是伤筋动骨的（大写 L，高风险），而且 baoyu 5.9k star 证明保存级粒度对设计稿场景够用。若未来真要“双人同时拖同一个元素”，再评估 per-file CRDT 层（仅画布 JSON）作为叠加，而不是替换。

### 阶段 1：身份与 journal（小，~2–4 天，低风险）

- 编辑器会话引入“我叫什么、我的角色”（本地存储 + 一次性输入即可，学 baoyu“输个名字就进”）。
- `JournalEntry` 增加 `user`（名字/id），hub 事件、`.journal.jsonl`、历史面板带人名。跨 kind 天然成立（journal 是共享层）。
- 验收：两个浏览器打开同一项目，journal 的每条改动署各自的名。

### 阶段 2：LAN 分享 + 角色链接（中，~1 周，中风险——安全边界）

- 服务器加“分享开关”：默认仅 localhost，开启后绑定 LAN 地址（学 baoyu 的 `share`/`--off`/`--reset` 语义：只有无参 `share` 打开网络，`--disable` 不再顺手把网络打开——他们为此修过 bug，CHANGELOG 第 28 行）。
- 角色链接（editor/commenter/viewer）+ 访客 cookie + 逐路由的角色闸门：读路由全放，写路由按角色，导出/zip 仅 owner，delegate（Claude Code 触发）仅 owner。tingly 的路由按 area 分文件（`apps/server/src/routes/`），加一个共享的 viewer 中间件即可。
- UI：TopBar 的“more”菜单或新 Share 按钮（跨 kind 共享组件，符合“one TopBar”约定）；`.design/` 新增一篇协作 note。
- 可参考 **MIT 部分**：baoyu `server.mjs` 的 Sharing/Guests 类（1528–1660）、hub 的 Host/Origin 校验（2009–2156）。**不可拷贝 editor/ 代码。**
- 风险：tingly 常嵌在 Tingly Box 里，分享边界要和宿主的鉴权协商（embedded 模式下的 share 需要一个明确的决策：宿主代理 or 本地直连）。

### 阶段 3：presence + 在线面板（小–中，~3–5 天，低风险）

- hub 增加 `presence` 事件（join/leave/心跳，复用 SSE 通道），Share 面板列出在线的人与角色。
- 可选加分项：每 kind 的“谁在看哪个文件/页”高亮（journal 已有 path），暂不做光标。

### 阶段 4：人类冲突的产品面（中，~1–2 周，中风险——跨 kind）

- 把 409+重放保不住的场景（双方都改了同一行/同一元素、或一方是整文件写）补上 baoyu 式兜底：
  - 覆盖通知（谁盖了谁的哪一版）+ Compare / Bring back（只找回丢的部分）；
  - “两份都留”（我的变成副本——画布的新 artboard、slides 的新页）。
- 把 `.history/` 从 docs-only 推广为**按写保留被替换内容**（`history.ts` 的 `keepReplaced` 已有骨架，`watched()` 放宽即可），或挂在现有 git commit 机制上（`.design/project-git.md`）。
- 这是跨 kind 特性：按 CLAUDE.md 的要求走 `Record<ProjectKind, …>` 表，e2e 覆盖表（`e2e/coverage.json`）每 kind 给套件；建议先 canvas + slides 两个最痛的 kind，docs 已有 history 基础。

### 不建议做的

- **CRDT/Yjs/OT**：与文件优先架构冲突，见上。
- **账号体系 / 云服务**：baoyu 证明了“链接即权限”的 LAN 模式足够覆盖小团队；云端多租户是另一个产品，应归 Tingly Box 的宿主职责。

### 总量估算

阶段 1–3（能“多人同时编辑一个项目、知道谁在改什么”）约 **2–3 人周**，风险低–中；阶段 4（冲突体验对齐 baoyu）再加 **1–2 人周**。全部做完仍无共享光标——那是要放弃 plain-files 架构才买得起的东西，不是第一版该追的。

## 7. 来源

- 仓库与 README：<https://github.com/JimLiu/baoyu-design> · 中文 README：<https://github.com/JimLiu/baoyu-design/blob/main/README.zh-CN.md>
- NOTICE（许可三分法）：<https://github.com/JimLiu/baoyu-design/blob/main/NOTICE.md>
- CHANGELOG（分享/历史/角色的时间线）：<https://github.com/JimLiu/baoyu-design/blob/main/CHANGELOG.md>
- 协作引擎源码（本地克隆 v2.8.2，commit `609638d`）：`skills/claude-design/scripts/server.mjs`（Sharing 1528–1660、merge 1080–1113、History 2424–2760、publish/ifMatch 4180–4260、watch 4397–4470）、`artifact.mjs`、`scripts/editor/share-ui.js`
- GitHub 统计：GitHub API `repos/JimLiu/baoyu-design`（2026-11-03：5944★/458 forks/1 open issue/v2.8.2）
- 宝玉的公告帖（v2.1 评论、PPT 动画等）：<https://x.com/dotey/status/2116060639533969759>
- tingly-design 侧引用：`docs/en/architecture.md` §4、`apps/server/src/hub.ts`、`apps/server/src/history.ts`、`apps/server/src/store.ts:825`、`apps/editor/src/store.ts:311`、`packages/core/src/canvas.ts:188`、`.design/docs-history.md`、`.design/project-git.md`
