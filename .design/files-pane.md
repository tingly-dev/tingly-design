# 画布的文件面板

状态：第一期（列表 + 预览 + 插入画布）已实施；其余类型的接入、编辑写回、拖放、在文件管理器里显示是没做的。

## 问题

一个项目在磁盘上就是一个文件夹。画布项目里除了 `canvas.json` 和一块画板一个 `*.dc.html`，还会有别的东西：人拖进来的图片、导入的整包文件（`uploads/`）、外部工具刚写进来的数据、生成或导出的中间产物。编辑器今天只看得到画板：`/files` 只回它认识的文本文件（`safeRel`），`/assets` 只走 `assets`、`fonts`、`ds`、`data` 四个目录且不含 `uploads/`。于是"我这个文件夹里有什么"这个问题，编辑器答不上来——人得去终端 `ls`，或者在启动页猜。

想做的事：

- 画新东西之前看看手头已有哪些素材，避免让 AI 重复生成。
- 查一次导入或一次生图到底往 `uploads/` 里放了什么。
- 终端或别的工具刚写进文件夹的文件，不离开编辑器就能拿到、用上。
- 按名字找到文件，把它放到画布上。

## 考虑过的做法

**列表放哪**

1. 右侧面板加一个"文件"页签（`RightPanel` 的 props/code/tweaks/theme 再加一个）——页签已经不少，而且文件和"当前选中元素"是两个问题，挤在一个面板里互相抢地方。
2. 启动页卡片或项目菜单里列文件——离画布太远，看到了也用不上。
3. **一个独立的侧面板（`PaneId`），画布专用**——图层树、模板值都是这样并列的面板，顶栏一个按钮开合，互不打扰。选了这条。

**列表怎么来**

1. 扩展 `/files`（它回的是整份内容，目录大了很重）。
2. 扩展 `listAssets` 加上 `uploads/`——还是漏掉放在根目录、自建子目录里的任意文件。
3. **新路由 `GET /api/projects/:p/entries`**：照 `walk()` 的规矩（跳过点开头的文件和 `node_modules`）走一遍项目文件夹，每个文件给 `path`、`size`、`mtime`，不回内容。内容要用时走现成的 `/raw/`。选了这条。

**什么算"内部文件"**：点开头的文件和 `node_modules` 一律不列——这和 `walk()`、归档（`projectArchive`）、git 提交（`git.ts` 的 `LOCAL`）是同一条线：`.git*`、`.runs.json`、`.claude-session.json`、`.transcript.jsonl`、`.image.json`、`.references.json`、`renders/`、`.history/`、`.journal.jsonl` 都不出现。`uploads/` 不藏：它是人真正引用着的内容（附件、导入、生图），按一个普通文件夹列出。

**实时更新**：不新建数据通道，但补了一个空事件。服务端 chokidar 本来就对项目文件夹整体监听（跳过点文件），但它原来把"既不是 tracked 也不是 asset"的文件直接丢掉（`split` 返回 null），工具刚写进根目录的 `note.txt` 不会引起任何事件。现在这类文件（同样不含点段、不含 `node_modules`）发布一个新的空事件 `entries`——它不带内容，只说"文件夹变了"。编辑器里 `file`/`delete`/`assets`/`entries` 都汇成 `assetRev` 的自增（150 ms 合并），文件面板订阅 `assetRev`，变了就重新拉一次 `entries`。

**插入画布**：图片（含 SVG）行上的"放到画布"——把相对路径（`uploads/…`、`assets/…`）直接当 `NoteEntry.src` 建一个图片便签（编辑器里 `Item.tsx` 用 `rawBase` 拼出 `/raw/` 地址来画，沙箱帧用 `frameBase` 的 rev 版本），尺寸从图片真实宽高按 `IMAGE_MAX` 收缩，放在视口中央并选中，一次 `editCanvas` 可撤销。不重新上传：文件已经在文件夹里，复制一份反而制造重复（对比 `ImportHere` 的拖入路径，那是文件还在编辑器外时的上传）。

**预览**：点行开共用的 `Dialog`。图片直接 `<img>`；文本类扩展名（json、md、txt、csv、tsv、css、js、html、svg、xml、yml）经 `/raw/` 拿文本放 `<pre>`（200 KB 截断）；PDF 和其余二进制给"新窗口打开"的链接（`/raw/` 自带正确的 content-type 和 CSP）。第一期只读：文本编辑要过写回引擎（撤销、journal、外部编辑合并）才能不踩人正在改的文件，单列。

**画布之外**：面板按钮是按 `KIND_PANE_IDS` 表登记的，`files` 只登记给 `design` 是刻意的。slides 有 `slides/`、dashboard 有 `data/`、design system 有 `assets/`，形状上没有只属于画布的东西——组件本体（列文件、预览、复制路径）是通用的，插到画布这一步是画布特有。等第二种类型要接时，把"插入"那一步抽成每类型一格的表即可；不预先抽。

## 现行契约

- `apps/server/src/store.ts` 的 `listProjectEntries(name)`：走项目文件夹，跳过点文件与 `node_modules`，回 `{ entries: { path, size, mtime }[] }`，按路径排序；`apps/server/src/routes/assets.ts` 挂 `GET /api/projects/:p/entries`。同一处还有只读的 `GET /api/projects/:p/entry?path=…`（`entryRel` 校验、`entryType` 定 media type），预览、缩略图和"新窗口打开"都走它——`/raw/` 只认 `assetRel` 的目录，够不着根目录里的散文件；只读，写还是走 `/file` 和 `/assets`。
- 监听器（`serve.ts` 的 `onChange`）对编辑器不认识的文件（非 tracked、非 asset、无点段）发布空的 `entries` 事件，只说"文件夹变了"。
- `apps/editor/src/panes.ts`：`PaneId` 加 `'files'`，只登记在 `KIND_PANE_IDS.design`；`components/panes.tsx` 的 `PANE_DEF` 加图标与名字（`common.pane.files`）。
- `apps/editor/src/components/canvas/FilesPane.tsx`：列表（图标按类型、图片行带缩略图、名字 + 所在文件夹 + 大小）、行菜单（放到画布 / 新窗口打开 / 下载 / 复制路径）、点行预览（共用 `Dialog`，底部也有下载和新窗口）、`SideResizer id="files"`（宽度记在本机，`sideWidth.ts` 的 `SIDES.files`）。下载走 `local.ts` 的 `download`（先把 `/entry` 读成 Blob，命令行的 `headless.ts` 能接住）。
- 实时：订阅 store 的 `assetRev`，变化后重新拉 `entries`。
- 词条在 i18n 的 `files` 区（en 与 zh 成对）；端到端套件 `e2e/files.py`。

## 还开着的问题

- 文本预览里直接编辑并写回（要过编辑引擎）。
- 从面板拖文件到画板上的落点插入。
- "在文件管理器里显示"（要服务端开系统调用，第一期没做；下载已做，拿在手上走的是浏览器）。
- 其他类型接入（每个类型一个"插入"动作的表）。
