# Slides：薄 brief 下的样式与版式多样性；模板与 prompt 作为素材

状态：**已实施**（指导、新 deck 识别、起始封面上色、示例 deck）；设计系统承载版式与方向（§4）是**方案**，未实施。调研在 `.research/slides-variety.md`。

## 1. 要解决的问题

"做一个关于 X 的 deck"这样的薄 brief，生成的幻灯片几乎都是同一个样子：浅底 + 眉题 + `h2` + 一段话 + 一排圆角卡片，每页、每个 deck 之间都差不多。原因不在格式（固定 1920×1080 的封闭子集足够表达大字报、满版图、数字墙、引言、对比、时间线），而在四件事：喂给模型的设计指导少、新建 deck 的起点是一个会被"保持"的固定样式、没有从一句话生成整个 deck 的路径、可参照的例子只有一个卡片排。另外，一个好的结果由"模板"（做好的样子）和"prompt"（方向）组成，两者都该能被保存和引用，而当时没有地方管理它们（§4）。

## 2. 决定

| 问题 | 决定 | 为什么 |
|---|---|---|
| 指导放在哪 | `.claude/skills/slides/SKILL.md` 的 "Creating a deck"（先设计系统，再方向/大纲/长度/字体/配色，薄 brief 自己决定并说明假设）与 "Designing the deck"（方向、配色、字阶、一页一个想法、按 deck 尺寸排版、页脚带、节奏）；版式库在 `reference/`（layout、styles、fonts、diagrams、craft、questions）。`SLIDES_SYSTEM`（`apps/server/src/delegate.ts`）不重复这些，只指向它们，并补一句"先定方向，相邻页换版式和背景色调，一个模板不连排三页" | Claude Code 每次都会读 skill；system prompt 保持短，两者不漂移 |
| 唯一的例子 | SKILL.md 里的完整示例从卡片排换成一个深底大数字页（流式布局、pinned 页脚、备注都保留） | 模型对单个例子锚定很强；唯一的例子是卡片排，生成的就都是卡片排 |
| 起点是什么 | 新 deck 的封面仍是 `newSlideSource` 写的素样式（`DEFAULT_SECTION_STYLE`）：它是**空白起点，不是人选的样子**。skill、`SLIDES_SYSTEM`、fast AI 三处都这样说 | 起点一旦被当成选择，"两种背景色调 + 一张强调页"的节奏就不会出现 |
| 识别新 deck | 委托路径：`SLIDES_SYSTEM` 写明"(only the starter cover)"，Claude 按 "Creating a deck" 走（方向、大纲、假设、重写封面）。fast AI 路径：`deckOutline`（`apps/editor/src/fastedit.ts`）在 deck 只剩一张**未被改过的**起始封面时，给 outline 加一行"这个 deck 是新的，空白起点，按请求设计而不是保持起始样式" | 两个生成路径都要能分辨"人选的样子"和"起始模板的样子"；`isStarterCover`（core `deck.ts`）用字节级比较，人改过任何一点就不再算起始 |
| fast AI 保持样子 | `FAST_EDIT_SLIDES`（core `prompt.ts`）加一条：起始样式和占位文案不是人的选择，outline 说 deck 是新的就按请求设计。`FAST_EDIT_SYSTEM` 的 "Keep the person's look" 保持不变（画布没有这个问题） | 覆盖只写在 slides 一节，不动画布的规则 |
| 装入即上色 | 新建对话框给 deck 装入一个设计系统或内置风格时（`POST …/design-systems`），若 deck 只剩一张未被改过的起始封面，就用 `dsGlance`（core `designSystem.ts`，页面色 paper/表面色、ink、标题字体栈）把这张封面重写一遍（`newSlideSource` 的新 `paint` 参数），记一条 journal；已设计过的 deck 一页都不动 | 人挑了风格，打开看到的第一页就该是那个风格（具体值优于别名）；重装是幂等的（上色后的封面不再匹配起始字节）。这是"几套对比鲜明的起始系统"的落地方式——36 个内置风格 + 已有项目系统都走这一个入口 |
| 相邻页复制 | 编辑器"新页"继续复制邻页样式（`addSlide`）：deck 有了真样子之后这是对的一致性；起始样式的传播由前面三条拦住 | 不为起始状态引入第二套新页行为 |
| 例证 deck | `projects/tingly-intro` 重排：8 页 8 种版式（封面 / 图文分栏+实时图 / 深底声明+分栏 / 表格 / 分栏索引 / 编号流程 / 强调色声明页 / 深底收尾），背景节奏 深-浅-深-浅-浅-浅-强调-深，内容、页 id、`faces`、box 页的 `h2` 与 `x-embed` 不变（e2e 依赖） | 样例 deck 是生成时最直接的锚；它自己先做到"一个 deck 一个方向，页页不重样" |

## 3. 取舍

- **字节级比较判断起始封面**：不看"样式是否等于默认值"，而是整体等于 `starterCoverSource(deck)`。人改过一个字、调过一像素，就视为已选择，装入不再动它。宁可少上色，不能覆盖人的设计。
- **只上色，不重排**：装入把起始封面的背景、文字色、字体换成系统的，版式仍是"标题一行的空白起点"。风格是给人改和给 Claude 读的种子，不是替人做完第一页。
- **命令行 `new slides` 不加 look 参数**：新建对话框的装入入口已覆盖；命令行需要时先 `new` 再 `POST …/design-systems`。避免两个做同一件事的入口。
- **快速 AI 不承担整 deck 生成**：它一次只看一页；"做一个 deck"仍交给 Claude Code（委托上下文带 "Project settings now"，装好的设计系统由 skill 让 Claude 去读 `ds/*/tokens.json`）。

## 4. 还开着的问题（模板与 prompt 作为素材，下一步）

- **设计系统承载版式**：`layouts/<id>.html`（deck 的 section 骨架，带占位文本），装入时一起复制，"新页"菜单列出这些版式替代固定的 `h2 + p`，Claude 生成时从中挑选组合——Keynote 母版的路子。
- **设计系统承载方向**：README 的"方向"一节（语气、版式节奏、用什么不用什么）就是可保存的"prompt"，随系统被安装、被版本记录，Claude 生成时读它。
- **任何项目可被引用为模板**：prompt 栏 @ 一个项目（给人复制、给 Claude 只读引用），"一个做好的 deck 当模板"就是这条路。
- **提炼**：让 Claude 把一个做好的 deck 的样子做成设计系统（token + 版式 + 方向说明）。
- 图片来源依赖 #32（图片生成）。

## 5. 验证

- `pnpm test`（core 单测：`paint`、`isStarterCover`）、`pnpm typecheck`、`tingly-design check tingly-intro --snapshots`（8 页无警告）。
- e2e：`launcher.py` 的内置风格装入断言加了"起始封面已上色"；`slides`、`layers`、`embed`、`follow_up` 覆盖示例 deck 与 deck 面板。
- 两个薄 brief 通过真实委托路径（`tingly-design prompt`，server 起的 Claude Code 读同一份 skill + `SLIDES_SYSTEM`）各生成一个 deck，逐页截图比对版式种类与背景节奏，结果与输出路径记录在 `.research/slides-variety.md`。
