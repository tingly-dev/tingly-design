# 编辑器状态：现在和切片之后

状态：**方案**的配图；配合 [store-slices.md](./store-slices.md) 看，冲突时以正文为准。

## 现在：一个文件，一个 `State`

```
                       apps/editor/src/store.ts（约 750 行）
┌────────────────────────────────────────────────────────────────────────────┐
│ useStore = create<State>  ── 46 个字段 ──────────────────────────────────  │
│                                                                            │
│  项目与编辑 12    project kind loaded files drafts journal undo redo …     │
│  画布舞台   15    selection tool view page panelTab inspect menu …         │
│  请求栏对话 13    fast delegates turns conversation barMode chatTab …      │
│  幻灯片 2 / 动效 1 / 外壳 3   slide present · motionView · toasts …        │
│                                                                            │
│  + 读取用的选择器 · openProject（加载 + 订阅事件，文件事件和运行事件同一个 set） │
│  + 编辑引擎 edit / undo / redo / enqueueResult / deleteFile                 │
└────────────────────────────────────────────────────────────────────────────┘
        ▲           ▲            ▲             ▲
   73 个文件  useStore((s) => s.x)，不分哪一块
```

## 之后：几片拼成同一个 `useStore`

```
 store.ts（只剩拼装 + 选择器，二三百行）
 ┌──────────────────────────────────────────────────────────────────────┐
 │ useStore = create<State>(() => ({ ...core, ...stage, ...agent, ... })) │  ← 消费方不变
 └──────▲───────────▲───────────▲───────────▲───────────▲──────────────┘
        │           │           │           │           │
  project.ts    store.ts     store/agent.ts  components/   editEngine.ts
  openProject   核心 + 画布   请求栏与对话    slides/ motion/  edit · undo ·
  文件事件      舞台（各类型   13 个字段       slide present   enqueueResult
                都在用，留下） setBarMode …    motionView
```

## 为什么只拆这几块

```
 各目录里读这一组字段的文件数

                    请求栏对话        画布舞台
 共用部件 shared      29                12
 src 根下模块          8                17
 canvas                1                27
 slides                0                 6
 motion                1                 4
 docs                  0                 4
 dash                  0                 3
 panel                 1                 8

 请求栏对话：几乎只被共用部件读 → 边界干净，先拆
 画布舞台：  每种类型都在读       → 不是画布专属，不能挪进画布目录
```
