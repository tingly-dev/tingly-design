# 对话里选技能

状态：**已实施**（六种类型共用的请求栏和对话记录；e2e 在 `e2e/skills.py`）。§5 是没做的。

## 1. 问题

编辑器里的聊天由服务端起一个 `claude` 进程完成（[agent-panel.md](./agent-panel.md)）。这个仓库里一项“技能”就是 `.claude/skills/<文件夹>/SKILL.md`：YAML frontmatter 里一个 `name` 和一句 `description`，正文是 Claude Code 动手前要读的说明。六种类型各有一份格式说明（`dc-canvas`、`slides`、`design-system`、`dashboard`、`docs`、`motion`），每种类型的系统提示里已经点名让它读；`issue-resolve` 是维护者用的，不进发布包。

这留下了两个缺口：

- 人已经写了自己的技能，或者项目里带了一个专门给这次对话用的技能，却没有地方交给它。Claude Code 在 `ROOT` 下跑，自己会发现 `ROOT/.claude/skills` 和 `~/.claude/skills`，但**发现不了项目文件夹里的 `.claude/skills`**；而且“发现了”也不等于“这次请求要用它”。
- 一次运行读了哪个技能，人是看不见的：运行卡片上只有请求、步骤和改动。

所以要做的是：发现这台机器上的技能（项目、内置、用户），在请求栏里让人挑，选中的跟着项目里这个对话走到每次请求，并在运行卡片和对话记录里写清楚这次读了什么。

## 2. 技能的发现

服务端扫三个位置，同名文件夹以靠后的为准：

| 顺序 | scope | 目录 | 说明 |
|---|---|---|---|
| 1 | `user` | `~/.claude/skills/<id>/SKILL.md` | 人自己的技能 |
| 2 | `builtin` | `ROOT/.claude/skills/<id>/SKILL.md` | 仓库或发布包自带；发布包只带六份类型说明，`issue-resolve` 不带 |
| 3 | `project` | `projects/<p>/.claude/skills/<id>/SKILL.md` | 跟着项目走，可以进 git |

技能 id 就是文件夹名，必须匹配 `^[\w.-]+$`（核心的 `isSkillId`），所以它永远是一个名字，不会变成路径。`name` 取 frontmatter 的 `name`，没有就取文件夹名；`description` 取 frontmatter 的一行，界面上用。`path` 是 SKILL.md 的路径，在仓库/发布包里面时写成相对根目录的路径（`fromRoot`）。

核心（`packages/core/src/skills.ts`）只有纯规则：`KIND_SKILL`（每种类型的那份格式说明）、`SkillScope`、`SkillInfo`、`isSkillId`，以及把一组 id 过滤成真能用的技能、保持选择顺序、去掉重复和未知名字的 `chosenSkills`。扫盘、路径和读写都在服务端（`apps/server/src/skills.ts`）。

## 3. 选择存在哪里

选择是**项目的一次对话**的，不是每次请求的临时参数。存在项目文件夹里的 `.claude-skills.json`：

```json
{ "skills": ["brand-voice", "our-tokens"] }
```

- 和其它本机状态一样（`.references.json`、`.image.json`）：不进项目的 `.zip`（`archiveKeeps` 不写任何以 `.` 开头的路径段），也不进提交（`apps/server/src/git.ts` 的 `LOCAL`）。
- 不放进 `.claude-session.json`。那个文件是“接着上次”的会话状态（会话号、上一条请求），新对话会把它整个换掉；技能选择应该在对话换掉之后仍然在。
- 选在项目文件夹里而不是浏览器里，所以刷新、换窗口、命令行和 MCP 的请求都读同一份；命令行和 MCP 这次还没有自己的开关（§5）。

## 4. 怎么交给 Claude Code

`claude` 命令行没有一个“用这些技能”的参数（这一版没有 `--skills`），所以只有一条确定的路：把选中的技能写进 `--append-system-prompt`。每次请求都追加一段：

```
The person chose these skills for this request. Read each one's SKILL.md before you start and follow it: it adds to the format reference above, and the request stays the task.
- Brand voice: Write in the brand's voice. (projects/<p>/.claude/skills/brand-voice/SKILL.md)
```

为什么是这一段而不是只写路径：

- 项目里的技能 Claude Code 自己找不到（cwd 是 `ROOT`），路径写全才能读；用户和内置技能虽然它自己会发现，但“这次要用”是人的意思，明说比指望它自己挑更可靠。
- 类型自己的格式说明（`KIND_SKILL[kind]`）已经在系统提示里点名要读了，所以从选中列表里过滤掉，避免同一份说两遍；它在选择框里显示为勾上且不能关（“每次必读”）。

请求可以带 `skills: string[]`；不带（`undefined`）时服务端读项目里存的选择，带了就以请求为准。**显式的空数组是“这次不要”**，不是“用存的”。编辑器在发送时把当前选择一起带上（`fastedit.ts` 的 `delegateToClaude`），这样点完技能马上发送、和保存请求赛跑时不至于用上旧值。服务端再用 `chosenSkills` 按当前磁盘上真有的技能过滤一遍。

## 5. 人看到的

- **请求栏的选项排**：`SkillsChip`（`components/Skills.tsx`），画布 / 幻灯片 / 动效用 `PromptBar`，设计系统 / 看板 / 文档用 `AskClaude`，两处都是同一颗 chip：没选时“技能”，选了“技能 · N”，选中状态用强调色。点开是 `SkillsDialog`：一句说明、搜索框（id、名字、描述）、按项目 / 内置 / 你自己的分组、每行一个头像、名字和描述（`title` 里有完整描述和路径）、勾选即保存、底部 Done。类型自己的格式说明勾上并禁用。
- **运行卡片**：`RunFeed` 的 `SkillChips` 在请求下方列一行“技能”和本次读到的技能名（读不到时退回 id），标签的 `title` 是描述或路径。对话列里 `Transcript` 的同一行用同一个部件。
- **对话记录**：服务端 `transcript` 的每一轮带 `skills`，所以底部栏的历史列表、左侧对话列、刷新之后都能看到。
- 文案在 `@dc/i18n` 的 `prompt.skills`（中英两份），样式在 `apps/editor/src/styles/skills.css`（放在 `references.css` 之后、`agent-dock.css` 之前）。

## 6. 还开着的

- 命令行和 MCP 没有 `--skills`：命令行的 `prompt` 和 MCP 的 `prompt` 读项目里存的选择，但没法给单个请求换一组。
- 一次请求换一组技能在界面上没有：选择是对话级的，改了就影响之后每次请求（这是刻意的，见 §3；单次覆盖的入口会再开）。
- 项目技能的编辑、生成和校验没有：人们自己写 SKILL.md，界面只负责读和选；frontmatter 写坏了就当没有名字或描述。
- 技能之间的冲突（两份都说同一件事）和依赖不处理；它们就是按顺序追加的一段文字。
- 一个没被任何类型使用的内置技能（比如将来的通用技能）没有“推荐”逻辑：列表里都在，人来挑。