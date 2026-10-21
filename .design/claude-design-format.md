# 和原版 Claude Design 互相搬作品：按原版的文件格式导入和导出

状态：**已实施**（编辑器、启动页、命令行）；§6 是没做的。

## 1. 问题

画布、幻灯片、设计系统、看板是照 Claude 的 Design、Slides、Design System、Dashboard 复刻的，文件格式一路跟着原版走（[five-kinds.md](./five-kinds.md) 的对齐表）。可是作品只能留在一边：在 claude.ai 上做好的设计，想拿到这里手改、在终端里改、交给 Claude Code 继续，没有入口；这里做的项目想发布成原版的作品，也没有入口。人只能自己对着原版的 SKILL.md 重排文件，这正是要避免的事。

原版没有"整件作品下载"：Design、Slides、Design System 的内容是 `project/` 下的文件，Dashboard 的内容是作品自带数据库里的文档（`dash/meta`、`dash/params`、`datasets/<id>`、`files/<名字>`），Docs 的内容在独立的服务里。人拿到原版作品的唯一办法是让 Claude Code 把作品读进一个文件夹（它存下 `project/…`，素材按 id 命名），发布时也是 Claude Code 把一个文件夹发布成作品。所以"原版格式"就是这个文件夹。

## 2. 考虑过的做法

| 做法 | 问题 |
|---|---|
| 只在文档里写"怎么手工对应" | 重排文件正是要消灭的步骤；图片和数据的对应最容易错 |
| 导入时让人先选"来自原版的画布 / 幻灯片…" | 模式选择器（ux-principles §2）：系统看文件就知道是哪一种 |
| 单独做一个"Claude Design"入口、对话框和命令 | 又多一处；这件事和"整个项目导出 / 导入"是同一类动作（把项目整个带出去、再带回来） |
| **导入并进现有的入口，导出和"整个项目"并排**（采用） | 导入不问类型；导出紧挨着已有的两个 .zip 项，人本来就在那里找 |
| 在 claude.ai 上直接发布 | 要登录和授权，不是这个产品能做的；交给手里已经有权限的 Claude Code，包里附一份说明 |

## 3. 决定

**包就是原版的布局，不加任何自己的东西。** 不写清单文件：从文件本身认类型，所以人手里原版作品读出来的文件夹和这里导出的包是同一种东西，互相都能用。

| 我们的类型 | 原版 | 包里 | 导入时 |
|---|---|---|---|
| 画布 | Design | `project/canvas.json`、`project/*.dc.html` | `project/` 里的整个内容就是项目 |
| 幻灯片 | Slides | `project/deck.json`、`project/slides/<id>.html` | 同上 |
| 设计系统 | Design System | `project/design-system.json`、`tokens.json`、`README.md`、`components/`、`assets/`、`fonts/` | 同上 |
| 看板 | Dashboard | 存储文档一份一个文件：`dash/meta.json`、`dash/params.json`、`datasets/<id>.json`、`files/<名字>`；附加的数据放 `blobs/<名字>` | 合成 `dash.json`，页面放 `files/`，数据放 `data/` |
| 文档 | Docs | 原版没有文件 | 原版的"导出为 Markdown"导入成一份新文档（一个标签页，标题取第一个 `#`）；导出走 Markdown 本身 |
| 动效 | 无 | — | — |

- **认类型**：看有没有 `project/` 下的 `deck.json`、`canvas.json`、`design-system.json`，有 `dash/meta` 就是看板；没有 `dash/meta` 时，同一层里有 `datasets/` 和页面（`index.html` 或 `files/index.html`）也算看板，但那一层有 `dash.json` 的是自己的看板文件夹（手工压的 zip、按文件夹导入），不认作原版；包可以被一层文件夹包着（Claude Code 存下来的目录）。有 `tingly-design.json` 的是自己的 .zip，先按它走，所以两种 .zip 共用同一个“导入项目包（.zip）…”，不冲突。
- **图片**：原版把图片放进素材库，引用写 `/_blob/<id>`，Claude Code 读素材时存成 `<id>.<扩展名>`。导入时在包里找这些文件，放进 `uploads/`（人带进来的东西放 `uploads/`，[import-into-project.md](./import-into-project.md)）并改写引用；找不到的不改，数一数告诉人。
- **看板的数据**：原版的文件数据集指向 `/_blob/<id>`，按同样的办法在包里找；找不到的数据集原样保留，由检查器在"问题"里列出，接上文件即可。导出时数据放 `blobs/`，数据集的 `url` 指向它，`README.md` 里写"上传后把 url 换成返回的"。
- **导出不带**：改动记录、`.git`、`renders/`、本机的运行记录（和 [project-archive.md](./project-archive.md) 一致）；也不带本地的 SQLite 数据库：原版 Dashboard 读不了。
- **命名**：导入的项目按作品标题起名；标题里没有字母数字（中文）才退回文件或文件夹名。
- **告诉人什么**：不阻止，也不弹对话框，用 toast 逐条说：缺了几张图、几个数据文件、查询的连接器另一边未必有、设计系统写的是本地路径、幻灯片的图片是 `uploads/` 下的文件。措辞在 `claudeDesign` 词条区，核心只返回数据（键和数量）。
- **给 Claude Code 的交接**：包里的 `README.md` 用英文写给模型：这个文件夹是什么、对应原版的哪个类型、怎么发布（从类型创建、`root` 指向它、`project/…` 发哪些）、发布前要先做的（上传幻灯片的图片、装真正的设计系统）。看板写的是 `write_db` 的步骤。人看到的下一步就是把文件夹交给 Claude Code（ux-principles §11：把下一步要用的东西交到手里）。

## 4. 入口

- 画布、幻灯片、设计系统、看板的"导入 / 导出"菜单：**Claude Design 包（.zip）**，排在"整个项目"和"仅项目文件"前面（这两项仍是菜单最后两项，别的测试靠这个顺序）。文档和动效没有这一项，原因见上表。
- 启动页“新建”菜单的“导入项目包（.zip）…”接受 Tingly Design 和 Claude Design 两种包，自动识别项目类型；Claude Docs 的 `.md` 从相邻的“导入 Markdown（.md）…”导入为新文档。每个动作直接打开对应格式的文件选择器，不先选模式；与 PowerPoint 的入口分开，见 [launcher.md](./launcher.md)。
- 命令行：`export <项目> --as claude-design`；`import` 多认包的 .zip、原版作品读出来的文件夹和 `.md`。MCP 的 `export` 同一个格式名。

## 5. 代码在哪

| 位置 | 内容 |
|---|---|
| `packages/core/src/claudeDesign.ts` | 纯函数：`detectClaudeDesign`、`fromClaudeDesign`、`toClaudeDesign`、`docFromMarkdown`，返回文件和说明数据；没有文件系统，单元测试覆盖（`packages/core/test/claudeDesign.test.ts`） |
| `apps/server/src/archive.ts` | `packClaudeDesign`、`importFiles`（.zip 和文件夹共用，先看清单文件再看包）、`readTree` |
| `apps/server/src/app.ts` | `GET /api/projects/:p/claude-design`；导入仍是 `POST /api/archive` |
| `apps/editor/src/projectArchive.ts`、`FileMenu.tsx` | 保存、导入和 toast；菜单项由 `claudeDesign` 参数打开 |
| `e2e/claude_design.py` | 菜单、保存、按原版方式存下来的包、`.md`、拒绝没有项目的 zip |

## 6. 没做的

- **整个 Docs 的往返**：原版的 Docs 在服务里，我们只收 Markdown 的导出；评论、多个标签页的结构、图表和图示块都不在 Markdown 里。
- **看板的查询数据集**：原版查的是自己的连接器（如 BigQuery），本地的 SQLite 数据库带不过去；现在只提醒，没有把查询结果物化成 CSV 一起导出。
- **从 claude.ai 直接拉取**：要登录，交给 Claude Code。
- **导入时重装设计系统**：包里 `designSystems` 记录的 `artifact` 是原版的地址，这里没有对应的项目；`ds/<folder>/` 下的 tokens 和字体够画，要换系统时再装。
