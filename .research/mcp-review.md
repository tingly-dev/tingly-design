# MCP 流程与工具开销审查

研究（未决：精简方案等 YZ 拍板）。起因：担心 MCP 内置工具太多、代价大。现状见 [`.design/cli.md`](../.design/cli.md) §4 的 MCP 一节；§6 已决定不做服务端推送和 `prompts`，本文不重议。数字都是在本仓库里实测的（`handleMcp` 直接调 `initialize` / `tools/list` / `tools/call`），token 按"英文约 4 字符、中文约 1.5 字符一个"估。

## 1. 结论

1. **工具数不是问题。** 只有 7 个工具，`initialize` 的说明加 `tools/list` 共约 6.5K 字符，约 **1.6K token**，是一次会话固定付一次的钱。同类里 pen.dev 4 个、Excalidraw MCP 26 个（`.research/cli-service.md` 的对比表）。砍工具数省不了多少，还会和 UX 原则 2（不要模式选择器）冲突。
2. **真正的代价在调用结果里**，按大小排：
   - `check` 带 `snapshots` 时内联图片：最多 12 张、长边 1200px，一次约 **10–14K token**，改一次查一次就重复付。
   - `read_skill`：每种类型的格式说明 6–16K 字符（约 **1.6–4K token**），幻灯片还有 8 篇参考页（共约 85K 字符，按需读）。
   - 结果 JSON 用两格缩进排版，`list <项目>` 实测比紧凑格式多 **72%**，`list` 多 28%。
3. **和命令行、skill 的重叠是文字重叠，不是能力重叠。** 同一件事（先 `check`、再 `export`）在 MCP 工具说明、`cli.md`、每个 skill 的"怎么运行"段落里各写了一遍，维护成本大于 token 成本。
4. **建议：保留 7 个工具，做五处瘦身（§5），固定开销从约 1.6K 降到约 1.1K，每次 `check` 省一半以上，其余不动。** 其中合并参数（5.2、5.3）改了 MCP 的接口，等 YZ 确认。

## 2. 完整流程

两个入口，一个处理函数 `handleMcp`（`apps/server/src/mcp.ts`），工具本体都是命令行的同一批函数（`apps/server/src/commands.ts`）：

| 入口 | 谁用 | 怎么连 |
|---|---|---|
| 编辑器的 `POST /mcp`（`app.ts`） | 编辑器已经在跑，agent 用 HTTP 连 | `claude mcp add --transport http tingly-design http://127.0.0.1:8787/mcp`；带 `Origin` 的请求只收本机或自己地址；只回 JSON，不开 SSE、不要会话 |
| `tingly-design mcp`（`cli.ts`） | agent 自己起进程，stdio | `claude mcp add tingly-design -- npx -y tingly-design mcp`；要画图时找同一个项目文件夹上正在运行的编辑器，没有就临时起一个 |

一次典型任务（外部 agent，比如 Claude Code 在别的仓库里）：

1. `initialize`：拿到 730 字符的说明（"先 `list` 找项目，改之前 `read_skill`，改完 `check`，要成品 `export`"）。
2. `list`（无项目）：启动页上的项目，约 1.2K 字符。`new` 建一个，或 `list <项目>` 看里面的画板、幻灯片、场景。
3. `read_skill <kind>`：读格式说明（必要时再用 `page` 读参考页）。
4. **agent 用自己的文件工具直接改项目文件夹**：没有"写文件"的 MCP 工具，这是刻意的。监听把改动记进改动记录、推给打开着的编辑器。
5. `check`（`snapshots: true`）：问题清单，加最多 12 张缩小的图，模型当场看到画出来的样子；改，再查，循环。
6. `export`：写进项目的 `renders/`，返回路径。
7. （可选）`history --since <编号>`：人在这之后改了什么；`prompt`：把活交给编辑器自己的 Claude Code，等它跑完（几分钟）。

不走 MCP 的路径：**编辑器里启动的 Claude Code**（`delegate.ts`）不连 MCP，它读 `.claude/skills/<kind>/SKILL.md`，用 `node cli.mjs` / `pnpm tingly-design` 敲命令。所以 MCP 只服务"外部 agent"这一类人，里面的重叠对编辑器自己的用户没有代价。

命令行有、MCP 没有的：`open`（打开浏览器，agent 没用）、`serve`、`import`（导入 zip）、`skills add`（把 skill 装进别的仓库，MCP 里 `read_skill` 已经能读）。这个取舍合理，不建议补。

## 3. 实测：固定开销

| 部分 | 字符 | 约 token |
|---|---|---|
| `initialize` 的说明 | 730 | 190 |
| `tools/list`（7 个工具） | 5 776 | 1 450 |
| `resources/list`（6 个 skill 资源） | 2 244 | 不进上下文（客户端按需列出、按 @ 引用才读） |

各工具（说明 + 参数 schema）：

| 工具 | 说明 | schema | 合计 | 备注 |
|---|---|---|---|---|
| `prompt` | 391 | 895 | 1 335 | 6 个参数，`session` / `new` 两个说的是同一件事 |
| `export` | 436 | 835 | 1 320 | 7 个参数，`board` / `slide` / `tab` / `view` 四个是"只要哪一个" |
| `check` | **777** | 191 | 1 052 | 说明最长：把每种警告的名字都列了一遍 |
| `read_skill` | 189 | 327 | 605 | |
| `new` | 128 | 394 | 568 | |
| `history` | 113 | 286 | 485 | |
| `list` | 173 | 137 | 393 | |

## 4. 实测：每次调用的开销

| 调用 | 大小 | 说明 |
|---|---|---|
| `read_skill` canvas / slides / design-system / dashboard / docs / motion | 9.9K / 15.6K / 9.1K / 14.0K / 6.3K / 10.3K 字符 | 约 1.6–4K token，一个任务读一次。幻灯片的 8 篇参考页另算，按需 |
| `check` + 快照图 | 12 张 × 约 1.1K token（1200×675） | 约 13K token，是单次最大的开销；每改一轮都付 |
| `list <项目>` | 排版 2 561，紧凑 1 487 字符 | 结果都是 `JSON.stringify(v, null, 2)`，缩进白白占 token |
| `prompt` | 结果只有最后一段话和改动记录 | 对调用方上下文便宜；真正的代价是第二个 Claude Code 在编辑器里跑（时间和费用，不在调用方上下文） |

## 5. 精简建议

按"省得多、风险小"排序，前三项不改接口：

1. **图片少而准（`check`）。** 默认最多内联 6 张、长边 1000px，约 4.5K token，是现在的三分之一；其余只给路径，要看哪一张再读文件，或者用 `export png --board` 单画一张。理由：agent 要看的是"有没有坏"，布局探针和 `pageError` 已经用文字报了问题，图是第二道确认；想看全部的，路径里都有。
2. **结果用紧凑 JSON。** 把 `json()` 去掉缩进。`list <项目>` 少 42%，`export`、`prompt`、`check` 的结果同理。零风险。
3. **缩短 `check` 的说明（777 → 约 300 字符）。** 警告的种类（`layout`、`contrast`、`blank`、`seek`）在结果里本来就带名字和文字说明，不必在说明里重列；把"带 `snapshots` 会画什么"一句话讲清楚即可。
4. **合并 `export` 的 `board` / `slide` / `tab` / `view` 为一个 `pick`。** 命令行里 `commands.ts` 内部本来就是一个 `pick`，一个类型一次只会用到其中一个，说明里写"画板、幻灯片、标签页或设计系统视图的名字或序号"。省约 150 token，也少一个"该用哪个"的疑问。**改接口。**
5. **合并 `prompt` 的 `session` / `new`**：`session` 填会话编号接着说，填 `new` 开新会话，省一个参数。**改接口，收益小，可以不做。**

不建议做的：

- **合并工具**（比如 `list`+`history`+`new` 做成一个带 `action` 的工具）。省不到 500 token，却是模式选择器，模型要多猜一步。
- **删 `read_skill` 或删 `resources`。** `read_skill` 是模型真正会调用的路径；资源列表不进上下文，留着给支持 @ 引用的客户端，成本为零。
- **删 `prompt`。** 它对调用方上下文很便宜，价值在"让编辑器自己的 Claude Code 干活并记在改动记录里"；说明里已经写了"能自己改就自己改"。
- **补 `open`、`import`、`skills add`、写文件工具。** 理由见 §2。

按 skill 的重叠：每个 skill 里"怎么运行"段落（约 1K 字符，motion、dc-canvas 里都有）把命令行和 MCP 两条路写全，是对的，因为 skill 要同时服务编辑器里的 Claude Code（命令行）和外部 agent（MCP）。可以缩的是措辞：把"用 `node cli.mjs` / `pnpm tingly-design` / 已装的 `tingly-design`、不要 `npx`"这段共同的话抽成一处，各 skill 引用，而不是六份拷贝。收益是维护，不是 token，建议和别的 skill 改动一起做，不单独开 PR。

## 6. 预计效果

| | 现在 | 做完 1–5 项 |
|---|---|---|
| 固定开销（说明 + 工具） | 约 1.6K token | 约 1.1K token |
| 一次 `check --snapshots` 内联图 | 约 13K token | 约 4.5K token |
| `list <项目>` | 1 487–2 561 字符 | 约 1 490 字符 |
| 工具数 | 7 | 7 |

## 7. 开着的问题

- 第 4、5 项改 MCP 参数名，外部 agent 里已有的提示词若写死了 `board` 等就会失效。目前没有已知用户依赖，版本还很早；是否趁现在改，请 YZ 定。
- 图片上限（6 张 / 1000px）是估出来的，没有拿真实模型做"看不清"的对照。落实时用 `tingly-design-ui` 的画板各看一遍，确认 1000px 下小字还能读，不行就保持 1200px，只降张数。
- `check` 要不要加 `pick`（只画一个画板）？能让 agent 改一个板子只看一个板子，比降低张数更省。没有这个参数的原因是命令行 `check --snapshots` 一直是整份项目；若要加，命令行和 MCP 一起加。
