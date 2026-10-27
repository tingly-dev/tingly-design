# Slides 生成为什么单调，以及模板和 prompt 怎么当素材管理

状态：**研究**（issue #145）。§5 第 1 步已做，方式改为直接用原版的设计指导：原版参考页去掉平台专用和不支持的部分后放进 `.claude/skills/slides/reference/`，SKILL.md 加了新建流程和设计要点；其余步骤未做。

## 1. 问题

提示很少时（"做一个关于 X 的 deck"），生成的幻灯片几乎都是同一个样子：浅色底 + 一个 eyebrow + `h2` + 一段话 + 一排圆角卡片，配色、字体、版式在每页、每个 deck 之间都差不多。要判断这是原始格式的限制、模型能力，还是我们自己的实现把它约束住了。

追加的问题：一个好的结果由"模板"和"prompt"两部分决定，而这两样东西本身既是成品也是素材，我们没有办法管理和引用它们。

## 2. 结论

**主要是我们的实现约束，不是格式，也基本不是模型能力。** 格式（固定 1920×1080、内联样式的封闭子集）足够表达大字报、满版图、数字墙、引言、对比、时间线、图表等版式，原版 Slides 类型的样例 deck 和我们自己的 `tingly-intro` 都证明了这一点。单调来自四个地方，按影响从大到小：

1. **喂给模型的设计指导被砍掉了大半，只剩格式规范和一个卡片排例子。**
2. **新建 deck 和新建页的起点是一个固定样式，后续生成会"保持现有的样子"。**
3. **没有"从一句话生成整个 deck"的路径：没有方向选择、没有大纲步骤、没有追问。**
4. **可用的素材太少：没有图片来源、图标 30 个、装好的设计系统不会被读到。**

模型能力只在快速 AI（Haiku，一次只改一页）上是真实限制，那条路本来就不该承担"从零设计一个 deck"。

## 3. 证据

### 3.1 设计指导：我们 vs 原版

| | 原版 Slides 类型（`artifact/claude-slides/type/`） | 我们（`.claude/skills/slides/SKILL.md` + `delegate.ts` `SLIDES_SYSTEM`） |
|---|---|---|
| 总量 | SKILL.md 153 行 + 12 篇参考约 1000 行 | SKILL.md 116 行，其中"Craft"5 条 |
| 设计方向 | 明确要求"为这份 brief 选定一个方向"，它决定版式习惯、字体和配色 | 没有 |
| 配色 | 一深一浅 + 1–2 个强调色；两种背景色调 + 一张强调色的声明页；对比度规则 | 没有 |
| 字体 | `fonts.md`：默认推荐、按情绪的搭配、"避免看起来像模板"的规则 | 只有"1–3 个字体" |
| 版式库 | `layout.md`：大数字、KPI 网格、条形图、矩阵、图上标注、居中声明页、页脚带等写法 | 没有 |
| 效果 | `styles.md`：渐变、阴影、模糊、双色调各自什么时候用 | 没有 |
| 图表 | `diagrams.md` + `diagram-recipes.md` | 没有 |
| 薄 brief | `questions.md`：先问 1 轮能改变结果的问题，否则自己决定并说明假设 | 没有 |
| 例子 | 多个版式 | **只有一个：标题 + 卡片 + 图片的一排** |

模型对单个例子的锚定很强：唯一的例子是卡片排，示例项目 `tingly-intro` 的 8 页里 7 页是同一个浅底 `#F7F7F4` + eyebrow + 衬线 `h2` + 卡片的模板（统计见下），所以 Claude Code 在没有其他线索时就复制这个结构。

```
tingly-intro/slides  背景            卡片数  其他
cover                深色径向渐变    0
box                  #F7F7F4         1       x-embed
design               #F7F7F4         5
powerups             #F7F7F4         0       table
start                #F7F7F4         2
team                 #F7F7F4         3
together             #F7F7F4         1
writeback            #F7F7F4         0
```

原版的样例 deck 也是一个统一的深色渐变，所以"统一"本身不是问题；问题是我们只给了一个统一的样子，没给"换一个方向"的指导。

### 3.2 起点是固定样式，并且会被延续

- `apps/server/src/store.ts` `createProject` 新建 deck 时写一张 `#fbfbf8` 底、Noto Sans SC、纵向 flex 的封面（`packages/core/src/deck.ts` `DEFAULT_SECTION_STYLE`）。
- 编辑器里新加一页走 `newSlideSource(id, { like })`，复制邻页 section 的 `background / color / font-family / padding / display / flex-direction / gap`，内容永远是 `h2` + `p`。所以一个 deck 一旦有了第一张，后面每页的底色和骨架都一样，"两种背景色调 + 一张声明页"这种节奏不会自然出现。
- skill 里写了"新 deck 的封面是空白起点，不要照抄"，但快速 AI 的 system prompt（`packages/core/src/prompt.ts` `FAST_EDIT_SYSTEM`）写的是 **"Keep the person's look: colours, typefaces, sizes and spacing stay unless the request asks otherwise"**，它分不出"人选的样子"和"起始模板的样子"，于是把起始样式当成用户的选择保留下来。

### 3.3 没有生成整个 deck 的路径

- 快速 AI（默认 `claude-haiku-5-5`，`max_tokens: 4096`）一次只看一页、只输出 jQuery 语句，`FAST_EDIT_SLIDES` 只有格式子集，没有一句设计指导。它适合"把这页改好看点"，不适合"做一个 deck"。
- Claude Code 委托（`delegate.ts`）拿到的是请求原文 + 当前页 + 最近改动，不知道这是一个空的新 deck，也不会先选方向、先写大纲、先问问题。
- 原版在"创建"流程里有明确步骤：先设计系统 → 再决定大纲、长度、受众、要重复的版式、字体和配色 → 说一行假设 → 再三页一批地写。我们没有这一层。

### 3.4 素材

- 图片：只有用户上传的。原版有图库（`photo-library.md`），我们没有，图片生成（#32）还没做。没有图片，版式只能在文字和卡片之间变化。
- 图标：`x-icon` 只有 30 个名字。
- 设计系统：deck 可以安装设计系统（`ds/<folder>/tokens.json`，`deck.json` `designSystems`），但 `SLIDES_SYSTEM` 和 slides skill 都没让 Claude 去读装好的 tokens 和 README，所以装了也不会被用到生成里。

### 3.5 模型能力

同一个模型在原版的指导下能做出有方向感的 deck；我们给的上下文少一个数量级。没有做 A/B 实测（这里没有可用的 Claude Code 登录），所以"模型不是主因"是读 prompt 推出来的结论，建议第一步就用 §5 的实验确认。

## 4. 模板和 prompt 作为素材

### 4.1 现在有什么

| 东西 | 现在的形态 | 能被引用吗 |
|---|---|---|
| 设计系统 | 一种项目类型；安装到 canvas/deck 时复制 `tokens.json` 和字体，记录 `{title, namespace, artifact, version, copiedAt}` | 能，但只有 token，没有版式；Claude 不读 |
| 一个做好的 deck / canvas | 一个项目 | 只能"从项目导入"canvas 的 artboard 作为 `x-embed`（`.design/import-from-project.md`）；不能把别的 deck 当模板 |
| 一段好用的 prompt | 不存在；只在 journal 里留一行 | 不能 |
| skill（`.claude/skills/<kind>`） | 产品内置，给 Claude Code 看的格式说明 | 用户不能改、不能加 |

### 4.2 外部怎么做

- **Keynote / PowerPoint / Google Slides**：主题 = 配色字体 + 一组母版版式（标题页、章节页、两栏、大数字…）。新建页时选版式，内容填进占位。
- **Pitch / Gamma / Tome**：模板库 + 主题；AI 生成时先出大纲，再按主题里的版式组合排版，每页从版式库里挑而不是从零写。
- **Figma**：库（library）发布组件和样式，文件引用库，库更新后文件收到"有更新"提示。
- **Cursor rules / Claude Code skills**：prompt 以文件形式放在项目里，按名字或路径被引用，随项目进 git。

共同点：**"样子"和"版式"打包在一起作为一个可安装的东西；prompt 不单独存在，而是写成那个东西的说明书。**

### 4.3 选项

| 选项 | 说明 | 问题 |
|---|---|---|
| A. 新增一种"模板"项目类型 | 专门放模板 deck | 和"一个做好的 deck"是同一个东西，多一个词多一个概念（违反"一个词一个意思"） |
| B. 独立的 prompt 库 | 用户保存命名 prompt，在 prompt 栏里选 | 一个只有名字没有值的 prompt 是"别名"，看不到它会产出什么（违反"具体值优于别名"）；和设计系统各管一半样子 |
| **C. 设计系统扩展成"样子 + 版式 + 说明"，任何项目都可以被引用为参考** | 见下 | 设计系统要多两部分内容 |

### 4.4 建议（C）

两个概念，不新增类型：

1. **设计系统 = 可复用的样子。** 在现有 token 之外加两样：
   - `layouts/<id>.html`：按 kind 的版式骨架（deck 的 section、motion 的 scene），带占位文本，就是 Keynote 的母版。安装到 deck 时一起复制到 `ds/<folder>/layouts/`；编辑器的"新页"菜单列出这些版式（替代现在固定的 `h2 + p`）；Claude 生成时从中挑选组合。
   - README 里的"方向"一节（语气、版式节奏、用什么不用什么）：这就是"prompt"。它和 token、版式放在一起，所以看得到具体值，也会随设计系统被安装、被版本记录。Claude 生成时读它。
   - 内置几套风格差异明显的起始设计系统（随 bundle 发），新建 deck 时以缩略图形式直接选，或者不选由 Claude 根据 brief 选方向。
2. **任何项目都可以被引用为参考。** 在 prompt 栏里 @ 一个项目（或"从项目导入"一页），给人用时是复制（和现在导入 artboard 一样，记录 `from` 和 `copiedAt`，再导入可更新），给 Claude 用时是只读引用（委托上下文加一句"参考 projects/<x> 的样子和版式，先读它"）。"一个做好的 deck 当模板"就是这条路：从它新建一个项目（复制并记录来源），或者在生成时引用它。

这样"成品"和"素材"不需要分开管理：成品就是项目，素材就是设计系统，项目可以被提炼成设计系统（让 Claude "把这个 deck 的样子做成设计系统"，产出 token + 版式 + 方向说明）。

开放问题：
- 版式骨架的占位怎么表示（纯文本占位 vs `data-slot` 属性），编辑器怎么"套用版式到已有页"。
- 设计系统更新后已安装的副本怎么提示（现在要手动重装）。
- 内置风格的数量和来源：必须是我们自己做的，不能拿原版材料。

## 5. 建议的顺序

1. **补指导（最便宜，影响最大）。** 用我们自己的话重写 slides skill 的设计部分：选方向、配色和背景节奏、字体搭配、版式库（封面、章节页、声明页、大数字、KPI、引言、满版图、对比、流程/时间线、表格、图表、结尾），"相邻两页不用同一种版式"，多个风格不同的例子；并让 skill 和 `SLIDES_SYSTEM` 读装好的设计系统（`ds/*/tokens.json`、README）。
2. **识别新 deck。** 委托时如果 deck 只有起始封面，告诉 Claude 这是新 deck：先选方向和大纲、说明假设、重写封面；快速 AI 的"保持现有样子"对起始样式不生效，"做一个 deck"直接交给 Claude Code。
3. **实验确认。** 同一组 5 个薄 brief，现状 vs 补指导后各生成一次，截图对比版式种类数、背景色调数、相邻重复率；结果补进本文。
4. **多样化示例项目。** `tingly-intro` 之外再放一两个风格完全不同的 deck。
5. **设计系统加版式和方向（§4.4）**，新页菜单用版式，内置几套起始风格。
6. 图片来源（#32 图片生成）。

---

## 6. 结果（2026-10-27，#145 修复后）

研究写就之后、本次修复之前，main 上已经落地了第 1 步的大部分（#169 把原版指导改写进 skill 与 `reference/`，#328 让 Claude 读项目设置）。本次修复补齐其余：相邻页版式变化写进 skill 与 `SLIDES_SYSTEM`、skill 的唯一示例从卡片排换成深底大数字页、起始封面被明确为"空白起点"（`isStarterCover` 字节级识别，fast AI 的 outline 标注新 deck）、给新 deck 装入设计系统/内置风格时起始封面按 `dsGlance` 上色、示例 deck `tingly-intro` 重排为 8 页 8 种版式。设计与决定见 `.design/slides-variety.md`。

**薄 brief 实验**（研究 §5 第 3 步）：两个 brief 各自通过真实委托路径生成（server 起的 Claude Code 读同一份 skill + `SLIDES_SYSTEM`，`DC_DELEGATE_MODEL=cc[1m]`）：

| | Brief A：『Make a short deck about switching our team's weekly meeting to async written updates.』 | Brief B：『Make a deck introducing Aurora, our new sleep-tracking app.』 |
|---|---|---|
| 输出 | `/tmp/briefs/async-shift/`，7 页 | `/tmp/briefs/aurora-intro/` |
| 方向（回复自述） | 编辑出版风：Source Serif 4 + IBM Plex Sans，暖纸底、teal/ember 强调；说服性的内部提案，先说假设与占位符 | （见下方补录） |
| 版式 | 纸底封面+元信息行 / 大数字等式+三卡 / 样例更新卡 / 双栏对比表 / 分栏陈述 / 四周时间线 / 深绿收尾声明页 | |
| 背景 | 浅纸底为主 + 深色收尾，强调色点 eyebrow 与数字 | |

与旧默认（`#fbfbf8` + 无衬线 + 卡片排）相比，方向、字体、配色、版式均不再雷同；每个 deck 内部相邻页不重排。**首轮瑕疵**（`check --snapshots` 如实抓到，属"做完再看"的正常回路，不是单调问题）：A 用了子集外的 `border-collapse`（error）、多处 `padding-top`（自动治愈警告）、大数字等式在占位符 `[60]` 处折行、收尾页胶囊与标题叠压；B 见下。

环境备注：委托子进程的模型名来自环境别名展开（`ANTHROPIC_DEFAULT_OPUS_MODEL=opus[1m]` 会让 CLI 报 `unrecognized_model` 而整轮无输出），以 `DC_DELEGATE_MODEL` 固定为可用模型后可靠；同模型偶发一次同样的失败，重试即过，疑似 CLI 侧模型列表竞态，与本仓库代码无关。
