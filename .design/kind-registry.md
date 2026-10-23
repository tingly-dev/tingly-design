# 项目类型的登记：从散落的分支到按层的表

状态：**已实施**（三层的主要分派点都是表；`claudeDesign.ts` 与 `store.ts` 还开着，见 §6）。方案 B 已定。现行的登记清单以 [project-kinds.md](./project-kinds.md) §2 为准；这份讲怎么让"加一种类型"不再靠记忆。

## 1. 问题

六种类型（`ProjectKind`）的差别，现在写在二三十个文件的 `if (kind === 'slides')` 里。按出现次数，最集中的几处是：

| 文件 | 分支数 | 分支在管什么 |
|---|---|---|
| `apps/server/src/commands.ts` | 约 15 | `new` 的尺寸、`export` 的格式、`list` 的输出 |
| `apps/editor/.../launcher/NewDialog.tsx`（拆前） | 约 14 | 新建时每种类型各自的选项（尺寸、风格、数据文件）；现在在 `newKinds.tsx` 的 `KIND_NEW` |
| `packages/core/src/project.ts` | 约 11 | `outlineProject`、`checkProject` 各按类型走一条 |
| `packages/core/src/claudeDesign.ts` | 约 8 | 和原版 Claude Design 互转 |
| `launcher/Preview.tsx`、`core/launcher.ts` | 各 5–6 | 启动页卡片和预览 |
| `server/store.ts`、`delegate.ts`、`routes/ai.ts` | 各 4–5 | 新建的最小内容、系统提示、快速 AI 提示 |

这带来两个后果：

- **漏一处不报错**。`kind === 'x'` 链写成 `if / else if` 时，新类型会悄悄落到最后的默认分支（常常是画布的行为）。
- **同一个"类型有什么"分散在三层**。core 知道索引文件和大纲，server 知道新建内容和提示词，editor 知道界面。没有一处能回答"类型 X 都要什么"。

只有少数几处是对 `Record<ProjectKind, …>` 的穷尽表（`INDEX_FILE`、`KIND_ICONS`）：新加类型时它们编译不过，正是我们想要的。

## 2. 约束

- 包边界由 `pnpm depcheck` 守着：core 不依赖任何包，server 只依赖 core / export / i18n，editor 才能碰界面。**一份"跨层的类型清单"没有地方可放**：放在 core 里就得包含界面，放在 editor 里 server 又读不到。
- 类型之间有真实差异，并不都能抽成一张表（画布的画板树和文档的 Markdown 标签页是两种东西）。目标不是抹平差异，而是让"每种类型必须回答哪些问题"成为类型检查的一部分。
- 重构要保持行为不变，且每一步都能用现有 e2e 验证。

## 3. 考虑过的方案

**A. 维持现状，加一个检查测试。** 写一个单元测试，要求 `projectKind` 返回的每个值都出现在若干指定文件里（按文本查）。便宜，但是查文本很脆，也不能保证分支里写对。

**B. 每层一张穷尽表（推荐）。** 在各层各建一个 `Record<ProjectKind, X>`：
- core：`KindCore`（索引文件、`outline`、`check`、启动页卡片的取数）。现在的 `INDEX_FILE` 是它的雏形。
- server：`KindServer`（`createProject` 的初始内容、Claude Code 系统提示、快速 AI 提示或"不支持"、`export` 能出的格式）。
- editor：`KindUi`（编辑器组件、预览、新建对话框里的选项块、图标）。

新类型漏填任何一层，TypeScript 在那一层直接报错；每层的 `if` 链换成 `KIND[kind].xxx`。不跨层，所以 `depcheck` 的规则不变。

**C. 每种类型一个跨层的"插件"清单。** 一份文件同时声明 core、server、editor 三层的内容。最接近"一处总表"，但要么破坏包边界，要么用字符串路径去懒加载，两者都比今天更难读，也让 knip 的死代码检查失效。不建议。

## 4. 做法

走 B（已定），分三步，每步一个小 PR，行为不变：

1. **core**：把 `project.ts` 的 `outlineProject`、`checkProject`、`launcher.ts` 的 `projectCard` 改成穷尽表。这是最纯的一层，单测就能验证。
2. **server**：把 `store.ts` 的 `createProject`、`delegate.ts` 和 `routes/ai.ts` 的提示词、`commands.ts` 的格式表改成 `KindServer`。用现有 e2e（每种类型一个）验证。
3. **editor**：把 `App.tsx` 的类型分派（`KIND_APP`）、`Preview.tsx`（`PREVIEW`）和 `NewDialog.tsx` 的选项块（`KIND_NEW`）改成表；没有合成一张 `KindUi`，因为这三处的参数各不相同。

每步之后更新 [project-kinds.md](./project-kinds.md) §2：登记位置合并成"每层一张表"，行数会明显减少。

## 5. 实施状态

已转成表：core 的 `OUTLINE`、`CHECK`、`CARD`；server 的 `STARTER`、`DELEGATE`、`FAST_PROMPT`、`commands.ts` 的 `KIND_CLI`（`new --size` 能带什么、`export --as` 的格式、`--pick` 填哪个选项、`--fast` 可不可用、`check --snapshots` 怎么画和怎么认文件、导出要点哪些菜单项）；editor 的 `KIND_APP`、`PREVIEW`，以及新建对话框的 `KIND_NEW`（`launcher/newKinds.tsx`：每种类型的选择器、选项行、起始尺寸、是否还没选好、新建后要做什么；对话框持有六种类型的全部状态，这样切换类型再切回来，选择还在）。

没有转的：`commands.ts` 的 `wizardGiven` 只问画布和动效的尺寸，这是新建向导的取舍，不是类型表的缺口。

## 6. 没有决定的

- `claudeDesign.ts` 的互转规则是否进表：原版只有四种类型，另两种是有意不支持，写成表里的 `null` 比现在的缺省分支更清楚。
- `apps/editor/src/store.ts`（六种类型共用的 zustand store）的拆分依赖这件事的结论：先有"每种类型自己的状态切片"的位置，才好拆。这里不一并讨论。
