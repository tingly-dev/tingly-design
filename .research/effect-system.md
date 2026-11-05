# 效果系统：像设计系统一样，给动效（和别的类型）一套可复用的效果

状态：**研究**，不改产品代码。回答"效果放在哪、一个效果是什么文件、各类型怎么引用、模型怎么知道有哪些"。结论落地时写进 `.design/motion-effects.md`（着色器效果层，尚在分支上）和 `.design/project-kinds.md` 的矩阵。

**一句话**：不新建项目类型。效果是品牌的一部分（用品牌色、品牌节奏），所以放进设计系统：`tokens.json` 加一族 `motion`（时长、缓动），设计系统目录里加 `effects/<id>/`（着色器效果，按 `motion-effects.md` 的 `<x-embed data-seek>` 契约），随"装入设计系统"一起复制到项目的 `ds/<folder>/` 下；场景用 `data-fx="<folder>/<id>"` 和具名缓动引用。产品自带一小套内置效果，作为没有设计系统时的默认。

## 1. 问题

动效现在的"效果"散在三处，彼此不通：入场出场预设和缓动写死在代码里；场景转场是固定的四种；着色器效果每个场景各抄一份 GLSL 和运行时。一个品牌想要"我们的入场就是这种节奏、我们的背景就是这种光"，没有地方存，也没法在下一个视频、下一份幻灯片里复用。设计系统解决了颜色和字体的同一个问题，效果还没有对应物。

## 2. 现状（已核对）

- **预设和缓动是代码常量**：`packages/core/src/motion.ts` 的 `MOTION_PRESETS`（14 个：`fade rise … type count`）、`presetHidden()` 写死每个预设的起止状态，`EASINGS` 有 `smooth snap spring` 三个具名曲线；`parseAnim()` 遇到不认识的词就报错。不能由文件扩展。
- **转场**：动效 `TRANSITION_KINDS = cut fade push magic`（`motion.ts`），幻灯片 `TRANSITIONS = fade push magic`、`BUILDS = fade rise drop left right scale pop`（`packages/core/src/slides.ts`）。两套词表是同一组词的子集，但分开定义。
- **画面**：`packages/sandbox/src/sceneAnim.ts` 把计划编成暂停的 Web Animations，`setTime(t)` 精确到帧；播放器和编辑舞台共用。`SEEK_BRIDGE` 让 `<x-embed data-seek>` 跟着时间走。
- **示例的用量**：`projects/design-motion` 里 `rise` 45 次、`fade` 41、`pop` 22、`wipe` 12；转场只有 `fade`、`push`。即实际只用到很小一组，适合做成"品牌的几种动作"。
- **设计系统明确拒绝动效族**：`packages/core/src/designSystem.ts` 对 `tokens.json` 的 `motion` 键报 "There is no motion family."；技能 `.claude/skills/design-system/SKILL.md` 也这么写。其他 `{tokens:[…]}` 族（`opacity`、`zIndex`）会成为自己的一节。
- **装入**：`POST /api/projects/:p/design-systems`（`apps/server/src/index.ts`）只允许画布和幻灯片，复制 `tokens.json` 和字体到 `ds/<folder>/`，在索引的 `designSystems` 里记一条；是快照，重装才更新。矩阵里动效、看板、文档都是 ✗；`motion-editing.md` 把"动效装入设计系统"排在第四期。
- **看板已有自己的时长 token**：`packages/sandbox/src/dash.ts` 定义 `--cds-dur-slow: 400ms; --cds-ease-out: …`，`projects/box-usage/files/index.html` 在用。
- **着色器效果（分支上，未合并）**：`.design/motion-effects.md` 定义契约（`time`、`aspect`、`uv` 输入，预乘 alpha，`data-quality`，WebGL2 为主、vgpu 为辅），示例 `projects/webgl-motion/`、`projects/vgpu-motion/`，渲染侧 `scripts/motion-fx.mjs`。它自己列的开放问题正好是本文要回答的：`data-fx` 由运行时注入、编辑器把效果列成预设、第一批预设库（aurora、edge glow、film grain、gradient mesh、light sweep）。现在每个场景都内联一份运行时（`orbit.html` 约 70 行里一半是运行时）。
- **模型怎么知道**：快速 AI 的动效提示（`packages/core/src/prompt.ts` 第 63–64 行）和 Claude Code 的 `MOTION_SYSTEM`（`apps/server/src/delegate.ts`）都是静态字符串，预设名逐个写死。

## 3. 方案

| | A 新项目类型"效果系统" | B 设计系统里的一节（推荐） | C 每个项目自己的 `fx/` | D 只做内置库（代码里） |
|---|---|---|---|---|
| 存在哪 | `projects/<fx>/effect-system.json` + `effects/` | 设计系统的 `tokens.json` `motion` 族 + `effects/<id>/` | 动效项目的 `fx/<id>.html` | `packages/sandbox` 里的常量 |
| 跨项目复用 | 能，另装一次 | 能，随设计系统一次装入 | 不能，只能复制 | 能，但人改不了 |
| 品牌一致 | 要再和设计系统配对（颜色从哪来？） | 天然：效果读同一份颜色 token | 各自为政 | 没有品牌 |
| 接线成本 | 高：`project-kinds.md` §2 的十几处登记、新编辑器、新启动页卡片 | 中：设计系统编辑器加一节、装入接口放开动效、运行时认 `data-fx` | 低 | 低 |
| 人能看到、能改 | 能 | 能（设计系统编辑器里有预览） | 能 | 不能 |
| 违反"一词一义" | "系统"有两个，用户要选装哪个 | 否 | 否 | 否 |

一个效果是什么文件（B 下，推断，待定）：

| 种类 | 形式 | 谁引用 |
|---|---|---|
| 节奏 token | `tokens.json` `motion.tokens`：`{name:"brand-ease", value:"cubic-bezier(.2,.8,.2,1)", usage}`、`{name:"beat", value:"600ms"}`；生成进 `tokens.css` 为 `--brand-ease` | 动效 `data-in="rise beat brand-ease"`；画布、看板的 CSS `var(--brand-ease)` |
| 入场"配方" | `effects/<id>/effect.json`：`{"in":"rise 600ms brand-ease","stagger":"120ms"}` 之类，是现有预设的组合，不是新动画引擎 | 动效、幻灯片的 build |
| 着色器效果 | `effects/<id>/effect.html`（`motion-effects.md` §2 的 `<x-embed>` 内容，不含运行时）+ `README.md`（第一句是"什么时候用"，对应该文 §5）；参数是着色器顶部常量，可声明哪些暴露为属性、哪些取颜色 token | 动效 `<x-embed data-fx="tingly/edge-glow" data-fx-hue="…">`；幻灯片、画布作背景 |
| 转场 | 先不做自定义转场；着色器转场（擦除、光扫）要改 `motionTimeline` 的重叠绘制，单列 | — |

## 4. 推荐：B，加上 D 作为默认

1. **效果依附品牌**。`motion-effects.md` §5 自己就说"用品牌色，不要彩虹"；效果要读颜色 token，和设计系统分开放就得再配对。用户也只需"装一个设计系统"，不必在两种"系统"之间选（原则：去掉模式选择、一词一义）。
2. **装入路径已经有了**。`POST /design-systems` 已经在复制 `tokens.json` 和字体，再复制 `effects/` 是同一件事；放开动效是第四期本来就要做的。
3. **新类型代价大、收益小**。效果没有自己的"作品"（单看一段光没有意义），只在别的作品里出现；A 要在十几处登记，换来的只是一个独立的启动页卡片。
4. **D 不可省**。没有设计系统的项目也要有效果用：把分支上的第一批着色器效果和现有 14 个预设作为内置库放在 `packages/sandbox`，`data-fx="edge-glow"`（不带前缀）指内置的；设计系统里的同名效果覆盖内置的。运行时只有一份，注入到场景里，解决"每个场景抄一份运行时"。
5. **C 不推荐作为主路径**，但 `data-fx` 的路径解析可以顺带接受项目内的相对路径，作为逃生口。

## 5. 各类型

| 类型 | 用不用 | 理由 |
|---|---|---|
| 动效 | ✓ 主要用户 | 节奏 token、配方、着色器效果都用；先要能装入设计系统 |
| 设计系统 | ✓ 拥有者 | 新增"动效"一节：节奏 token 用一段示意动画展示，着色器效果用循环预览，像组件的 `preview.html` |
| 幻灯片 | ✓ 部分 | 节奏 token 和配方用在 `data-build-in`、`data-transition`（今天是写死的子集）；着色器效果只作为页背景的 `<x-embed>`；放映不需要 seek，循环播即可 |
| 画布 | ✓ 少量 | 只用 `tokens.css` 里的 `--*-ease`/时长写原型的 hover、过渡；着色器作背景可选，优先级低 |
| 看板 | ✗ 先不做 | 看板不装设计系统（服务端拒绝），已有自己的 `--cds-dur-*`；数据页面不需要装饰光效（原则：减少视觉噪音）。以后看板能装设计系统时，只取节奏 token |
| 文档 | ✗ 不适用 | Markdown 标签页没有动画和背景层 |

模型怎么知道（推断）：设计系统技能写 `motion` 族和 `effects/` 的格式；动效、幻灯片技能写"先看 `ds/*/effects/*/README.md` 有哪些可用"；`delegate.ts` 的系统提示同步。快速 AI 的提示目前是静态的，需要在 `/fast-edit` 时把已装入的效果 id 和一句用途拼进 `FAST_EDIT_MOTION`，否则快速 AI 只会用内置名字。

## 6. 需要的决定

1. 效果放进设计系统（B）还是另立一种项目类型（A）？
2. 撤销 "There is no motion family"：`tokens.json` 接受 `motion` 族（时长、缓动），`data-in` 能用 token 名代替数字和曲线？
3. 第一期的效果包括哪几种：只着色器效果，还是连同节奏 token 和入场配方？自定义场景转场（着色器擦除）是否单独排期？
4. `data-fx` 注入：运行时放在 `packages/sandbox` 的唯一一份；第一期只做 WebGL2，vgpu 的渲染端（`scripts/motion-fx.mjs`）是否随后再接？
5. 装入接口放开到动效（和幻灯片一样快照复制 `effects/`），看板是否也放开（只取节奏 token）？
6. 着色器参数怎么接颜色 token：装入时把 token 值写成 uniform 默认值，还是运行时从 `tokens.css` 读？要不要允许按属性覆盖（`data-fx-<param>`）？
7. 快速 AI 是否动态列出已装入的效果，还是效果只交给 Claude Code 用？
8. 内置库的第一批名单（`motion-effects.md` §6 的五个）由谁定，示例设计系统 `tingly-ds` 是否同时带一两个品牌效果作示范？
