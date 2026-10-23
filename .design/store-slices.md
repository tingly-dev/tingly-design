# 编辑器的状态：把一个大 store 按"谁用它"分成几片

状态：**实施中**（方案已确认；第 1、3 步已实施；第 2、4 步暂不做，见 §5）。图见 [store-slices.pencil.md](./store-slices.pencil.md)；类型登记的做法见 [kind-registry.md](./kind-registry.md)，这份是它留下的最后一块。

## 1. 问题

`apps/editor/src/store.ts` 约 750 行，一个 zustand store（`useStore`）装着 46 个字段，73 个文件在读它。它同时是：

- 项目本身：打开的项目、文件内容、草稿、改动记录、撤销栈、与服务端的连接；
- 画布舞台：选中、工具、缩放、当前页、右栏、图层悬停……；
- 请求栏和对话：快速 AI 的进度、Claude Code 的运行、历史对话、栏的位置和折叠、对话列的页签；
- 个别类型自己的状态：幻灯片的当前一页和放映、动效的当前画幅和场景；
- 外壳：提示条、AI 设置对话框、改动记录浮层。

另外，`openProject` 里一边加载项目、一边订阅服务端事件，文件事件和 Claude Code 的运行事件在同一个 `set` 里更新；编辑引擎（`edit`、撤销、重做、排队写回）也在同一个文件。

后果：

- 读代码时分不清一个字段属于谁。要改请求栏，得在 750 行里找散落的几段；
- 新加一种类型，要把它的状态塞进这个共用的 `State`，又没有地方说"这是动效的"；
- 类型和初始值各写一处，字段一多就容易漏改。

## 2. 先量一下：哪些字段是谁在用

我按字段统计了各目录里读它的文件数（`components/<目录>`；"shared"是 `components/` 根目录下各类型共用的部件，"src"是 `apps/editor/src` 根下的模块）：

| 一组字段 | 个数 | 谁在读 | 结论 |
|---|---|---|---|
| 请求栏和对话：`fast`、`delegates`、`lastRun`、`runHidden`、`feeds`、`barCollapsed`、`barMode`、`historyOpen`、`turns`、`chatTab`、`chatNote`、`conversation`、`freshNext` | 13 | shared 29 个、src 8 个，各类型目录合计只有 3 个 | **几乎只被共用部件用，边界最干净** |
| 画布舞台：`selection`、`tool`、`mode`、`panelOpen`、`panelTab`、`inspect`、`counts`、`layerHover`、`page`、`focused`、`editingNote`、`menu`、`view`、`viewport`、`jqDraft` | 15 | canvas 27、src 17、shared 12、panel 8，另外 slides 6、motion 4、docs 4、dash 3 | **各类型都在用**：幻灯片和动效共用画布的选中和舞台模型 |
| 项目与编辑：`project`、`kind`、`loaded`、`files`、`drafts`、`journal`、`connected`、`assetRev`、`undo`、`redo`、`health`、`runtimeErrors` | 12 | 到处都有 | 这是核心，留在原处 |
| 幻灯片：`slide`、`present` | 2 | slides 只有 10 个文件，其余几乎没有 | 属于类型自己的 |
| 动效：`motionView` | 1 | motion 3、panel 2 | 同上 |
| 外壳：`toasts`、`aiSettingsOpen`、`journalOpen` | 3 | shared 4 个，另有零散几处 | 小，留着 |

两个事实决定了做法：

1. 请求栏和对话这一组，和任何一种类型都没有耦合；它是最大、也最容易单独成片的一块。
2. 画布舞台这一组**不能**当成"画布专属"拆走：幻灯片、动效、文档和看板都在读它。把它挪进画布目录，等于让其他类型反过来依赖画布。

## 3. 考虑过的方案

**A. 维持现状。** 不动。代价是上面的后果会随每种新类型继续累积。

**B. 切片，仍是一个 store（推荐）。** 用 zustand 的 slices 写法：每一片是一个文件，导出自己的"字段类型 + 初始值 + 动作"，`store.ts` 把它们拼成同一个 `useStore`。

- 读写的方式不变：`useStore((s) => s.turns)`、`useStore.setState(...)` 全都照旧，**73 个调用方一行都不用改**；
- 一次 `set` 能同时改几片的字段，所以"打开项目时一次重置"和"一个事件同时更新文件和运行记录"仍是原子的；
- 每一片的字段和动作在一个文件里，类型自己的状态有了落脚处。

**C. 拆成几个独立的 store（`useAgent`、`useCanvas`……）。** 最彻底，能让一片的变化不触发别片的重渲染。但：

- 73 个读 `useStore` 的文件里，请求栏那一组约 37 个要改；
- 打开项目、服务端事件里"同时更新几片"的地方变成多次 `set`，中间会被渲染出一个不一致的瞬间（比如文件已更新、运行记录还没有）；
- 收益（少量重渲染）目前没有任何性能问题要解，不值得换这个代价。

**D. 把类型自己的状态各自放进类型目录，用单独的 store。** 只有幻灯片和动效三个字段，开一个 store 过重，用 B 的切片放进各自目录即可。

## 4. 决定和原因

走 **B**，不碰消费方，只搬定义。原因：

- 风险最低：纯搬家，每一步都能用现有的 e2e 验证；
- 回头路最短：如果将来真的需要隔离重渲染，在切片的基础上再拆成独立 store 是机械的；
- 符合已有的做法：类型登记已经是"每层一张表"，状态也是"每一块一个文件"，同一个思路。

不动画布舞台那一组（原因见 §2 第 2 条），也不动 `files`、`undo` 等核心字段。

## 5. 分步

每一步一个小 PR，行为不变，验证是 typecheck、knip、depcheck、单测和相关 e2e：

1. **请求栏与对话（已实施）**：`apps/editor/src/store/agent.ts` 放这 13 个字段的类型（`AgentState`）、`FastState`、`DelegateState`、`LastRun`、`BarMode`、初始值 `agentInitial()`、打开项目时的重置 `agentReset()`，以及两个**纯函数补丁**：Claude Code 运行事件对 `delegates` 的更新（`delegateEventPatch`）和一次运行结束后并入对话轮次（`endTurnPatch`）。`State` 继承 `AgentState`，`useStore` 用 `...agentInitial()` 拼进来。
   - 切片不 import `useStore`：`setBarMode`、`setBarCollapsed`、`undoDelegate` 要调 `set`/`edit`，仍留在 `store.ts`，切片只给补丁。这样避免 `store.ts ⇄ store/agent.ts` 的循环引用，切片也能脱离 store 单测。
   - 消费方只改了类型的 import 路径（5 个文件）；字段读写一行没动。
2. **类型自己的状态**：幻灯片的 `slide`、`present` 放进 `components/slides/`，动效的 `motionView` 放进 `components/motion/`，同样导出字段、初始值和动作，由 `store.ts` 拼进来。
3. **编辑引擎（已实施）**：`apps/editor/src/editEngine.ts` 放 `edit`、`enqueueResult`、保存队列（`pump`）、`editElement`、`retypeText`、`editCanvas`、`undo` / `redo`、`deleteFile`、`deleteBoard`、`inertDocument`、`isSaving`。状态、读取用的选择器（`display`、`canvasOf`、`deckOf`……）和 `toast` 仍在 `store.ts`。
   - `store.ts` 再导出引擎的公开函数，所以约 30 个调用方的 import 不变；代价是 `store.ts ⇄ editEngine.ts` 互相引用。这是安全的，前提是 `editEngine.ts` 在模块加载时不碰 `useStore`（它的 `get` / `set` 是函数，不是 `useStore.getState` 的别名；曾经写成别名，页面直接报 "Cannot access 'useStore' before initialization"）。文件头注释写了这条。
   - 要彻底去掉这个环，得把 `State`、`display`、`toast` 等放进一个不依赖引擎的叶子模块；那时再让调用方直接 import `editEngine`。
4. **项目加载与事件订阅（暂不做）**：`openProject` 和文件事件处理搬到 `project.ts`。

做完 1、3 后 `store.ts` 约 390 行（状态、选择器、加载、事件）。第 2 步只有三个字段；第 4 步要再造一个和 `store.ts` 互相引用的文件，而 `openProject` 和事件处理本来就是 store 的入口，收益小于代价，等有新的需求（例如要隔离重渲染）再做。

状态标为"实施中"是因为这两步还留着；若决定不再做，改为"已实施"。

## 6. 还没有决定的

- `store.ts` 与 `store/` 同名并存：'./store' 现在由解析器优先取文件。TypeScript、Vite、esbuild、knip 都没问题；第 3、4 步完成后可以把 `store.ts` 挪成 `store/index.ts` 消除歧义。
- 步骤 2 要不要做：只有三个字段，搬进类型目录的收益主要是"类型状态有落脚处"；如果第 1 步之后觉得已经够清楚，可以不做。
- 将来如果要隔离重渲染，请求栏这一片是第一个候选，因为它更新最频繁（流式输出时每个事件都会写）。
