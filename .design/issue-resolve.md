# Issue 自动跟进：定时拉取、评估、推进

状态：已实施（skill：[`.claude/skills/issue-resolve/SKILL.md`](../.claude/skills/issue-resolve/SKILL.md)，每 5 小时由 Claude 的定时任务执行一次；不进宿主拿到的 bundle）

## 问题

tingly-design 的 issue 一部分来自团队，一部分来自外部用户。团队的 issue 往往已经说清楚了问题，缺的是有人去复现、定位、出 PR；外部 issue 质量参差，需要先判断是不是 bug、是不是重复、缺什么信息，而方向要由维护者定。人工盯这两类，响应慢且不均匀。

要的是一个定时的流程：拉新的和有更新的 issue，评估，按作者身份决定能推进到哪一步。

## 决定

### 按作者身份分两条路

| | 团队（`author_association` 为 `OWNER` / `MEMBER` / `COLLABORATOR`） | 外部（其他） |
|---|---|---|
| 能做什么 | 复现、定位、实验、写修复，开 draft PR | 只读评估，回一条阶段结论 |
| 什么时候停 | PR 进入评审；或问题够大，写方案等决定 | 回复后等待，直到团队成员在其后发言放行 |

身份用 GitHub 自带的 `author_association` 判断，不另维护名单：仓库协作者变动时自动跟上，也不会把同组织但无关的人算进来。

外部 issue 的"放行"是团队成员在 Claude 的阶段评论之后留言给方向（"可以修"、指出原因、指派）。不用标签开关，是因为维护者本来就会在 issue 里回复，留言就是最自然的动作；明确的"不修 / 先不做"则让流程停在 `stopped`。

### 大改动先出方案

团队 issue 里，改文件格式、协议、嵌入约定或 UX 形态的，以及新的项目类型，不直接实现：调研按 `.research/` 的约定写成 `<主题>.md`，开只含调研的 draft PR，在 issue 里给出建议和需要的决定。直接实现只限 bug 和边界清楚的小功能。理由：方向错了的大 PR 比没有 PR 更费评审时间。

### 状态记在 GitHub 上

每条评论末尾带隐藏标记 `<!-- issue-resolve stage=… -->`。下一轮只看"最近一条带标记的评论之后，有没有别人的动作"来决定要不要再处理。

考虑过的另一种做法是在定时任务的会话里或项目文件里记一张已处理表。没选，因为：会话会被回收或压缩，表会和 GitHub 实际状态脱节；而标记在 issue 上，团队成员也看得见流程停在哪一步。

评论是用用户本人的 GitHub 账号发的，作者区分不出是人还是 Claude，所以以标记为准：没有标记的评论都算人的。

### 表单与标签

issue 通过 `.github/ISSUE_TEMPLATE` 的四种表单提交：Feature / Bug / Feedback / Other，第一项都是"领域"（canvas、slides、design system、dashboard、docs、motion、editor、server，或不确定）。表单只能给固定标签和固定标题前缀，不能随下拉框变，所以 `.github/workflows/issue-area.yml` 在 issue 创建时读出所选领域，加上 `area/<领域>` 标签，并把标题从 `feat: …` 改成 `feat(motion): …`；类型标签是 `enhancement` / `bug` / `feedback` / `other`。

skill 只读这些标签：类型决定走哪条路径，领域决定先读哪一类的代码和笔记，不用再靠标题猜。Feedback 是专给体验和打磨类意见的一类，和 Feature、Bug 可能重叠，这是有意的：已有的很多反馈 issue 就是这样写的。工作流在 issue 里改标签和标题，是对所有人一视同仁的表单整理，不属于 skill"外部 issue 不改标签"的范围。

领域下拉框必填；选了"不确定"就没有领域标签，也不改标题。

### 节奏和上限

- 每 5 小时一轮，拉取窗口 6 小时，多出的一小时用来容忍定时漂移；重复拉到的 issue 被标记规则过滤掉。
- 起点：流程上线之前的存量 issue 不主动处理，有人再次活动（评论、编辑、打标签）才进入。现在仓库还没有 issue，这条规则是为以后接入别的仓库或批量导入留的：一次全推进会同时开出很多 PR，评审接不住。
- 已经有人在做的 issue（有 PR 引用它、项目里另有对话在做，或团队成员自己说过以后再做）不发评论，只在运行报告里列出。GitHub 本来就显示 PR 的关联，再发一条评论只会增加噪音。
- 每轮最多新开 2 个实现 PR，其余团队 issue 先给分析，下一轮接着做。外部评估不设上限，它很便宜。

### 放在哪

skill 放在 `.claude/skills/issue-resolve/`，和各类型的格式说明在一起，Claude Code 在仓库里能直接找到。但 `.claude/skills/` 会被 `scripts/bundle.mjs` 整个拷进宿主拿到的 bundle，那里的 Claude Code 只该看到格式说明，所以 bundle 时跳过这一个目录。

### 对外评论的边界

外部 issue 不关闭、不改标签、不指派、不承诺修复或时间；疑似安全漏洞的不在公开评论里讨论细节，只在运行报告里提醒维护者。

## 开放问题

- 每轮 2 个 PR 的上限是拍的，跑一段时间后按评审吞吐调整。
- 只看 issue，不看 Discussions；需要时再加。
- 只看 tingly-design。Tingly Box 的 issue 量大得多、团队分工也不同，要不要接入另议。
