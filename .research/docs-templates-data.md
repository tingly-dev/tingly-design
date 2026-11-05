# 文档：从模板开始，引用看板的数据

状态：**研究**，不改产品代码。回应 issue「docs 太简单：最好是模板优先，并和看板集成（重在数据，不一定是看板本身）」。结论落地时写进 `.design/`（新的 `docs-templates.md`，并更新 [project-kinds.md](../.design/project-kinds.md) 矩阵）。下文【核】= 读代码核对过，【推】= 推断，未验证。

**一句话**：模板做成仓库里的一组按语言的文件，由 `createProject` 复制，新建对话框在类型下面直接摆出这一类的模板（含"空白"），不加步骤；数据做成文档里的一个围栏块 ```` ```data ```` ，按 `项目/数据集` 引用看板的**数据集**（不是页面），编辑器里实时取数，导出时写成静态表格并注明来源和时间。

## 1. 问题

1. 新建文档只得到一个 `# 标题` 的空标签页，人得从零想结构；周报、规格、复盘这类文档结构是固定的，空白页是最差的起点。
2. 文档里要放的数字（本周花费、各渠道占比）已经在某个看板的数据集里，现在只能手抄，抄完就和来源断了，也看不出出处。

## 2. 现状（已核对）

- 新建：`apps/server/src/store.ts` `createProject` 对 `docs` 只写 `tabs/main.md`（`newDocTab` = `# 标题\n\n`，`packages/core/src/docs.ts`）和 `doc.json`，标签页名取 `starter.docTab`。所有类型的占位文案都在 `packages/i18n/src/locales/{en,zh}/starter.ts`，按新建者语言写入（`.design/i18n.md` §新建文案）。【核】
- 新建对话框：`apps/editor/src/components/Launcher.tsx` `NewDialog`：一排类型标签、一句简介、标题、可选文件夹；`POST /api/projects` 只收 `{name, title, kind}`（`apps/server/src/index.ts`）。没有任何模板或"复制项目"的入口。【核】
- 示例项目：`projects/` 六个（文档是 `design-guide`），由 `seedSamples` 在项目目录不存在时整体复制一次；`scripts/bundle.mjs` 把它们打成 `samples/`。示例是"看看能做什么"，不是起点。【核】
- 文档编辑器：`apps/editor/src/components/docs/DocEditor.tsx`，TipTap（StarterKit、任务列表、表格、高亮、图片、`@tiptap/markdown`），斜杠菜单可插代码块、表格等；存盘是整个标签页的 Markdown，经 core `mergeBlocks` 按块合回，围栏代码块是 `code` 类型，变动时按行保留（`refineBlock`）。【核】带语言的围栏块经 TipTap 往返后语言名保留【推，需实测 `data` 这类未知语言名】。
- 文档导出：`DocsApp.tsx` `docHtml` 用 `marked` 把每个标签页转成 HTML，`../assets|uploads` 改成 raw 地址；另有 Markdown 导出和打印。【核】
- 看板数据：`datasets/<id>.json` 的 `source` 是 `file`（`data/` 下的 CSV/TSV/JSON）或 `query`（服务端连接器，目前只有只读 SQLite，`apps/server/src/connectors.ts`）。取数在编辑器 `apps/editor/src/dash.ts` `load()`：绑定**当前打开的项目**，文件走 raw 地址，查询走 `POST /api/projects/:p/query`，而这个接口**只允许看板项目**（`notDashboard`）。`dash.calc` 和 `dash.loader` 写在页面脚本里、只在沙箱 iframe 里跑。【核】
- 跨项目引用的先例：装入设计系统（`POST /api/projects/:p/design-systems`）把另一个项目的 `tokens.json` **复制**进 `ds/<ns>/`，是快照，不是活引用。【核】
- Claude Code：`delegate.ts` 的工作目录是仓库根，能读所有项目；但文档只允许 `Read,Edit,Write,Glob,Grep`，`dash-query.mjs` 只对看板开放；docs 技能没提数据。【核】

## 3. 模板

| 方案 | 做法 | 好 | 不好 |
|---|---|---|---|
| A 示例项目当模板 | 新建时复制 `projects/<sample>` | 零新格式 | 示例只有一种语言、一份内容，带评论和示例数据；示例的职责是演示，混进来两边都改不动 |
| B `templates/` 目录 | `templates/<kind>/<id>/{en,zh}/…` 一套文件 + 一行元数据（名称、一句话、大纲），`createProject` 按语言复制并替换 `{{title}}`、日期 | 人能直接改模板；中英成对；同一机制可给其他类型 | 多一个要打包、要测试的目录；模板正文是"写进新项目的文字"，按 CLAUDE.md 应走 i18n 词条——是放成 `.md` 文件还是词条要定（§6） |
| C 由 Claude 按一句话生成 | 标题即提示，新建后交给 Claude Code 写结构 | 无限多种 | 慢（分钟级）、要配好模型、结果不稳定；不能当默认 |

**倾向 B，C 作为模板之一**：模板行最后一项是"让 Claude 起草"，选它就在新建后带着标题打开 Claude Code 栏（复用 `AskClaude`），不新开流程。【推】

**对话框不加模式选择**（UX 原则"消灭模式选择器""用默认值代替开关"）：类型下面直接一排该类型的模板卡片，每张写名称和两三行大纲（标签页、`##` 小节），第一张是"空白"。选模板只换内容，标题、文件夹不变；标题占位文字随模板变（"第 42 周周报"）。不分"从空白 / 从模板"两步。启动页文档的新建块也直接列 2–3 个常用模板。【推】

首批文档模板（建议）：周报（本周完成 / 数字 / 风险 / 下周）、产品规格（背景 / 目标 / 方案 / 不做的 / 待定）、复盘（经过 / 影响 / 原因 / 行动项任务列表）、会议纪要。周报和复盘是放数据块的天然位置（§4），模板里可以带一个"选一个数据集"的空数据块。

## 4. 数据

| 方案 | 做法 | 好 | 不好 |
|---|---|---|---|
| A 围栏数据块 | 标签页里写 ```` ```data ```` 块，编辑器用 NodeView 画成数字 / 表格 / 小图，存回时仍是那段 Markdown | 文件仍是纯 Markdown，`mergeBlocks` 照旧按块合并；数字有出处、能刷新；Claude Code 和 git 都读得懂 | 要做：块的渲染、跨项目取数接口、导出时求值；GitHub 上直接看是代码块 |
| B Claude 写静态表 | Claude Code 读数据集，写一张普通 Markdown 表 | 今天就能做，零代码 | 数字冻结且无出处，看板技能"每个数都有来源"的要求在文档里失效；改数要再跑一次 |
| C 嵌入看板 | 文档里放整个看板页面的 iframe | 看板怎么画就怎么看 | issue 明说不要看板本身；页面宽度、主题、沙箱、导出、打印都要另处理；`files/index.html` 是给全宽设计的 |

**倾向 A**，B 保留为"冻结"的结果（下面）。块的形状（草案，不是现有格式）：

````
```data
source: box-usage/daily        # 项目/数据集 id；同项目内可写 daily（文档将来有自己的 data/ 时）
show: number                   # number | table | bars | line
field: cost                    # number 时取哪列；table 时 columns: [day, cost]
where: provider=openai         # 同看板 data-where 的写法
agg: sum                       # sum | avg | last | count；无则取单行
format: ",.0f"                 # d3-format，和看板一致
```
````

- **引用的是数据集，不是页面**：`dash.calc` 只活在看板页面的 iframe 里，文档拿不到；所以块里只有简单的 `where` + `agg`，复杂算术应该在看板的 SQL 里做成数据集。这正对应 issue 的"重在数据"。【推】
- **取数**：现在的 `load()` 绑在当前项目、`/query` 只认看板项目。建议服务端加一个按数据集取行的接口（`GET /api/projects/:dash/datasets/:id/rows`，用 core 的 `parseDataFile`、`toTable` 和 `callTool`，参数用 `dash.json` 的默认值），文档和将来的幻灯片都用它；不在编辑器里复制一份 `dash.ts`。【推】
- **实时还是冻结**：默认实时，块下方一行小字"来自 box-usage · 每日用量 · 10:42 更新"，点开到看板。块菜单里"冻结"把当时的值写成块内的 `rows:`（或块后紧跟的一张普通表）加 `at:`，之后不再取数；"恢复实时"删掉它们。周报这类"截至某天"的文档要的就是冻结。【推】
- **数据集被删或改名**：块显示"找不到数据集"，不吞掉内容；被引用的数据集在看板 Sources 里标"被 N 篇文档引用"可以后做。【推】
- **导出**：`docHtml` 改为先把每个数据块按当前值（冻结的用冻结值）渲染成表格或数字，加一行来源和时间；导出的 HTML 不再联网取数。Markdown 导出原样保留围栏块，另给"导出为静态 Markdown"把块换成表格。【推】
- **Claude Code**：docs 技能和 `DOCS_SYSTEM` 要写数据块格式；文档的委派也放开 `dash-query.mjs`，让 Claude 先查列名再写块。【推】

## 5. 各类型

- **模板**：机制（`templates/<kind>/…` + `createProject` + 对话框里的模板行）做一次，各类型接上。先做文档；幻灯片（周会、路演）其次；画布、动效可选；看板模板没有数据就是空架子，等"新建时选数据"一起做；设计系统不做（它从品牌来源生成，模板没意义）。矩阵加一行"新建时的模板"，不做的写原因。【推】
- **数据块**：先只做文档。幻灯片是 HTML 子集，要另一种写法（如 `data-source` 属性），同一个取数接口可复用；画布、动效暂不做。【推】

## 6. 需要的决定

1. 模板放 `templates/<kind>/<id>/{en,zh}/` 的文件，还是作为 `starter` 词条（受 i18n 测试保护，但长 Markdown 写在 TS 字符串里难维护）？文件方式要给 i18n 测试加一条"每个模板中英都在"的检查。
2. 新建对话框默认选"空白"还是第一个模板？issue 说"模板优先"，但默认模板意味着每次都要删内容。
3. "让 Claude 起草"要不要作为模板行的一项（需要已配好 Claude Code）？
4. 首批文档模板定哪几个，是否带示例数据块？
5. 数据块用 ```` ```data ```` 围栏 + 简单键值，接受吗？是否需要正文里的行内数字（如"本周花费 {{data …}}"），还是先只做块？
6. 默认实时还是默认冻结？冻结值写在块内还是块后的普通表格（后者在 GitHub 上可读）？
7. 文档能否有自己的 `data/` 和数据集（不经看板），还是只引用看板？
8. 跨项目引用要不要限制（只读、同一 projects 目录内即可，还是嵌入 Tingly Box 时按宿主权限）？
9. 模板和数据块分两次做（先模板）还是一起？
