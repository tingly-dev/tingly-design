<p align="right"><a href="../en/development.md">English</a> · <b>简体中文</b></p>

# 开发与测试

```bash
pnpm test           # 单元测试：core（解析、回写、jQuery 会话、语句切分、撤销重定位、幻灯片、设计系统、看板、文档）、导入器、导出器（浏览器能写什么、字体内联）、界面文字（两种语言的键一致、占位符一致、代码里的键都存在、代码里没有写死的中文），以及跨类型矩阵（`.design/project-kinds.md` §3）的每个 ✓ 在 `e2e/coverage.json` 里写了测它的 e2e 套件，或者为什么还没有
pnpm typecheck
pnpm knip           # 死代码：没用到的文件、导出和依赖
pnpm depcheck       # 哪个包可以引用哪个包
pnpm tingly-design --help   # 从源码运行命令行（文档：cli.md）
```

## PPTX 模块 smoke 语料

独立转换模块的固定语料位于 [`packages/core/test/fixtures/pptx-smoke/`](../../packages/core/test/fixtures/pptx-smoke/README.md)。目录 README 说明逐页特性、成功/拒绝预期、确定性重建方法及合法性验证边界。不启动编辑器即可运行：

```bash
pnpm --filter @dc/core exec vitest run test/pptxSmoke.test.ts
```

可选的独立 schema 校验使用 .NET 和 Open XML SDK，见 [`scripts/validate-pptx/README.md`](../../scripts/validate-pptx/README.md)。这是开发工具，不是产品运行或 CI 的必需依赖。

这不是产品 e2e：PPTX 菜单和 CLI 接入尚未启用。包/XML 检查和转换断言不能代替独立 Office 渲染。支持项与暂不支持项各自成包，因为当前一个不支持对象会使整份导入原子失败。

## 端到端套件

其他套件按中文的标签找元素，所以浏览器用 `zh-CN` 语言运行；英文由 `i18n.py` 覆盖。

`pnpm e2e` 一条命令跑完下表里除 `delegate` 以外的所有套件：按组先起好各自要的东西（带 mock 模型的 `pnpm dev`；给 `ai_settings` 用的不配模型的 `pnpm dev`；自己起服务的套件先 `pnpm build`；`embed` 先 `pnpm bundle`），逐个跑完，最后打印一张表（`--jobs 4` 把整套切成四片同时跑，每片用自己的一份仓库副本和自己的端口；`--shard 2/4` 只跑其中一片，CI 就是这样把整套分到四台机器上）；哪些检查没过写在 `e2e/out/report.md` 和 `report.json`，每个套件的输出在 `e2e/out/logs/`。`pnpm e2e slides docs` 只跑这几个，`--smoke` 跑 PR 用的小集合，`--list` 列出分组，`--real` 加上 `delegate`。套件会改示例项目，再用 `git checkout` 改回去，所以 `projects/` 里有没提交的改动时它不开跑（`--force` 强制跑）。整套串行大约十四分钟，切四片并行大约是它的四分之一。

`pnpm eval` 是另一种检查：让无头的 Claude Code 把同一个设计任务各做一遍，一遍用 skill 加命令行，一遍用 MCP 服务，再给它留下的东西打分，出一张对照表（过不过、工具调用数、`check` 和 `look` 的轮数、费用、用时）。需要登录好的 `claude` 和 Chrome，花几美元、要几分钟，所以不在 `pnpm test`、`pnpm e2e` 和 CI 里。`pnpm eval -- --list` 列出任务，`--task`、`--route`、`--runs`、`--model`、`--judge`（再请一次评审看最终的图）和 `--cli "node dist/tingly-design/cli.mjs"`（评测 bundle 或 npm 包，而不是源码）选跑什么，结果在 `evals/out/`。它的纯函数部分（读 transcript、打分）由 `pnpm test` 做单元测试；设计见 `.design/agent-evals.md`。

单个套件仍然可以单独跑。端到端测试需要先 `pnpm dev`，以及 Python 版 Playwright（`pip install -r e2e/requirements.txt`）。用别的浏览器时设置 `DC_CHROME=/path/to/chrome`（装了 Playwright 的无头版时 `pnpm e2e` 会自动用它）；在无界面环境里请用 Playwright 的 `chromium_headless_shell`，完整版 Chromium 无头运行时点击缩放后的画板会点偏。

| 命令 | 覆盖 |
|---|---|
| `python3 e2e/e2e.py` | 画布：面板、图层、样式、改字、结构操作、剪贴板、拖动/拖出、画布工具、页面、导出、并发、撤销、播放（40 项） |
| `python3 e2e/slides.py` | 幻灯片：缩略图与分节、改字、删除与撤销、拖动钉住的元素、备注、新建/复制/排序/删除、格式检查、jQuery、放映、导出、文本框（24 项） |
| `python3 e2e/ds.py` | 设计系统：封面与品牌手册、改颜色/改名带别名/增删、文字与圆角、组件预览、上传资源、外部改坏后的提示、新建、装进幻灯片后选 token 与文字样式、移除（22 项） |
| `python3 e2e/dash.py` | 看板：查询/CSV/JSON 加载、标注核对、筛选与点行筛选、数据模式、改查询（拒绝写入）、停止与恢复自动刷新、外部改数据文件与页面、失败状态、`.runs.json`、代码面板、新建（25 项） |
| `python3 e2e/docs.py` | 文档：标签页与大纲、浏览不写盘、打字/勾待办/改单元格都只改一行、`/` 菜单、格式菜单、外部改动实时进来且不被覆盖、评论（回复/解决/新建）、标签页增删改、版式、AI 改写（有模拟模型时）、导出 HTML、新建（25 项） |
| `python3 e2e/image_gen.py` | 图像生成：要先用没有 `ANTHROPIC_*`、`DC_IMAGE_*` 变量、`DC_CONFIG` 指向临时文件的 `pnpm dev`，再起 `python3 e2e/mock_anthropic.py` 和 `python3 e2e/mock_images.py <日志>`；对话框里的 ImageGen 一块（Anthropic 没有、跟着 Tingly Box 的地址、OpenAI 风格地址加单独的密钥和模型、错地址被拒）、生成一张图和改一张图都存进 `uploads/`、网关的拒绝原样转给人、`uploads/` 之外的路径被拒、密钥不回传 |
| `python3 e2e/export_menu.py` | 共用的导入 / 导出菜单：每种类型的栏里都有，列出这种类型收什么、能存什么；幻灯片和文档一键存成 PDF（真的 PDF，页数对）、服务端没有 Chrome 时回到打印窗口、状态条（28 项检查） |
| `python3 e2e/pptx.py` | 通过真实启动页与幻灯片菜单测试 PowerPoint 交换：picker/drop/API 导入，保留原件/报告/媒体/备注，编辑并重开，失败原子性与重名，整份原生对象导出与不支持内容的诊断；英文/中文、浅色/深色截图；只使用本套件创建的项目 |
| `python3 e2e/archive.py` | 整个项目导出成 .zip：每种类型导入 / 导出菜单最后的两项；整个项目带改动记录、并排带上设计系统和清单，仅文件两样都不带，都不带本机状态；从启动页“新建”菜单导入、重名换名（没变的设计系统不重复导入）；启动页卡片的导出；没有项目的 zip 会说明原因；英文浅色和中文深色（23 项检查） |
| `python3 e2e/claude_design.py` | Claude Design 包：画布、幻灯片、设计系统、看板的菜单里“Claude Design 包”排在“整个项目”前面，文档和动效没有；各类型包的布局和 README；保存；打开按 Claude Code 存下原版画布的方式做出的包（按标题起名，`/_blob` 图片进 `uploads/`）；Claude Docs 的 `.md` 变成文档；没有项目的 zip 会说明原因；英文浅色和中文深色（23 项检查） |
| `python3 e2e/export_image.py` | 每种类型保存图片（PNG）：文档（当前标签页）、幻灯片（当前页、每一页）、看板、设计系统、动效（播放头所在的帧）；每个文件都是真的 PNG，尺寸不小于页面（9 项检查） |
| `python3 e2e/motion.py` | 动效：示例停在封面并可在舞台上编辑；播放时换成播放器，暂停或点一下画面回到舞台；跳到场景时停在开头并按落定的样子画出整页；点选、双击改字、拖手柄改尺寸；竖版里的改动写进 `data-tall`，点覆盖标签可撤回；还没出场的元素点不到，选中的元素显示落定位置，图层标出何时入场；添加、改、删尺寸；竖版、改速度、新建（42 项） |
| `python3 e2e/layers.py` | 图层树：画布、幻灯片、动效同样的行和隐藏/锁定；隐藏写 `data-hide` 且元素离开舞台，锁定写 `data-lock` 且点击落到外一层；画板通过 `canvas.json` 隐藏和锁定（25 项） |
| `python3 e2e/tweak_text.py` | 模板管理的文字：内容只是一个文字属性（`{{heading}}`）的文字，双击会改这个属性、模板保留占位，混有文字的仍为只读，微调页列出 `data-props` 的所有属性并按默认值类型编辑（7 项） |
| `python3 e2e/template_values.py` | 画布的模板值：什么都没选时右侧面板按画板分组列出所有 `data-props` 值（没声明的画板不出现），修改写回那块画板的默认值并可撤销，点组名选中画板并显示它的微调页，组可折叠，超过 30 个值出现过滤框，没有声明时说明怎么声明（18 项） |
| `python3 e2e/launcher.py` | 启动页：六种类型和全部项目都列出、封面、画板与动效实时预览、按类型筛选、搜索与 `/`、回车打开、继续上次的项目、方向键、排序、新建对话框（文件夹名跟着标题走、平时不占地方，没有字母的标题也能建，拒绝重名和非法名，画布、幻灯片、看板的起步选项）、logo 和反馈链接、每种类型编辑器里一键回首页和项目菜单、手机宽度（72 项） |
| `python3 e2e/dialogs.py` | 每个对话框的键盘：新建项目、打开文件夹、导入、AI 模型设置、提交、导出视频、从项目导入，都从人平时打开它的地方打开；是模态框、焦点在框内、Tab 和 Shift+Tab 留在框内、Esc 关闭、关闭后焦点回到页面；英文浅色和中文深色（58 项检查） |
| `python3 e2e/folders.py` | 项目文件夹之外的项目：六种类型各一个外部文件夹以自己的名字登记并在编辑器里打开，同一个文件夹再登记一次，拒绝的路径，写回落在外部文件夹里、那里的外部改动被看到，“打开文件夹”（边输边说那里是什么），没有项目的文件夹转到新建并填好位置，新文档写进那个文件夹，有别的文件的文件夹被拒绝，从列表移除和撤销；中文浅色、英文深色各一遍（42 项） |
| `python3 e2e/git.py` | 提交到 git：不在仓库里的项目先说会在哪里新建，确认后第一次提交才建（不经同意不建），没有改动时提交按钮不可点，在代码仓库里的项目写出那个仓库和分支并且只提交自己的文件夹，六种类型的改动记录里都有提交，新建项目时可选同时建仓库（只在不在仓库里时出现）；中文浅色、英文深色各一遍（24 项） |
| `python3 e2e/theme.py` | 主题：跟随系统、外观菜单与记住选择、深色画布和看板、`?theme=` 传预设或 JSON、派生 token、`tinglyDesign` 脚本接口、Tingly Box palette、丢弃不安全的值、宿主页面用 postMessage 设主题并收到回报（25 项） |
| `python3 e2e/i18n.py` | 界面语言：按浏览器语言选英文或中文（带地区的标签也认，其余用英文）、六种类型的示例在英文界面里不剩一个汉字、语言按钮写出当前语言、用各语言自己的名字列出并记住选择、`?lang=` 只管当前标签页、`tinglyDesign` 脚本接口、服务端报错按请求的语言措辞并带固定的 `code`、宿主用 `?lang=` 嵌入、用 postMessage 切换并收到 `language-changed`（26 项） |
| `python3 e2e/export.py` | 在浏览器里导出：动效在标签页里生成视频文件（按钮显示进度和取消，文件按作品和尺寸命名，尺寸和时长对，帧里有内容），对话框只有摘要、选项折起来，小尺寸、帧率和质量生效，GIF 和菜单里的 GIF… 入口，取消导出，含嵌入内容的作品由服务端的 Chrome 画成 MP4 或 GIF、嵌入内容在画面上（对话框说明原因，尺寸和帧率同样生效），以及没有 Chrome 时同一个作品和一个导入的画板在标签页里导出、嵌入内容在画面上（每个框架交出自己的画面） |
| `python3 e2e/embed.py` | 嵌入，先跑 `pnpm bundle`；它自己启动打包好的服务端：清单和就绪行、新项目文件夹放入示例、一切都在 `/design` 之下、编辑写进宿主的文件夹、另一个源上的宿主页面打开项目并收到 `ready` 和 `location`、宿主传主题、stdin 关闭和 SIGTERM 时退出（27 项） |
| `python3 e2e/attach.py` | 附件，先跑 `pnpm build`；它自己启动带模拟模型和替身 `claude` 的服务端：粘贴、选择、拖入文件，拒收和最多 6 个的限制，模型收到的内容块，重试时保留附件，存进 `uploads/`（原图、同一文件只存一份、能读回来），Claude Code 读到的路径，文档页的输入框，幻灯片显示存下的图片，服务端的校验（36 项） |
| `python3 e2e/external_edit.py` | 页面之外的改动（Claude Code、终端、git）不用重载就出现在六种类型打开着的编辑器里：改写每个示例的一个文件，等新文字出现在屏幕上；画板和幻灯片里显示的 `uploads/` 图片被替换后，等新图片出现 |
| `python3 e2e/run_feed.py` | 请求栏的运行卡片，先跑 `pnpm build`；它自己启动带模拟模型和替身 `claude` 的服务端：请求回显、快速 AI 的语句数和撤销，Claude Code 的步骤（相对路径、说的话）、计时、停止按钮、忙时按 Enter 保留输入、画板徽标、结果和改动文件、步骤收起展开、撤销整次运行、失败后放回输入框、中途打开的编辑器看到已做的步骤、停止，其余五种类型各跑一次，动效的播放位置只告诉 Claude Code 不回显、运行时动效舞台不动、请求历史、请求接着或不接上一次 Claude Code 对话、把请求栏收成药丸（40 项） |
| `python3 e2e/import_board.py` | 从项目导入，先跑 `pnpm build`；它自己在示例项目的副本上启动服务端：把示例特效画板（box-console 的 Glow）经"从项目导入…"放进幻灯片和动效，副本在 `uploads/`、来源记进索引，舞台和播放器都画出来、同一时刻同一帧，参数写进嵌入块、还原、从原画板更新，以及画布的时间滑块（24 项） |
| `python3 e2e/chat_panel.py` | 对话列，先跑 `pnpm build`；它自己启动带模拟模型和替身 `claude` 的服务端：默认在底部、运行卡片收成一行，历史列表的一行点开是回答，位置菜单把请求栏搬到左边一列、作品往右让，记录留着（步骤折成一个数、回答、文件名片、只有最新一轮能撤销、放回输入框、新对话是一条分隔线、来自命令行的请求有标注），刷新后一样、存在项目文件夹里但不在项目文件里，拖动、方向键和双击列的边，窗口太窄就把请求栏放回底部，旧的右侧设置读作左侧，以及每种类型里作品在列旁边、幻灯片 / 设计系统 / 文档的列成为第一个页签、发送自动切到对话、别处发来的运行点亮页签上的点、动效没有空槽位 |
| `python3 e2e/side_resize.py` | 侧栏宽度，先跑 `pnpm build`；它自己启动服务端：每种类型里每一列（右侧面板、幻灯片缩略图列、文档的标签页和批注、设计系统的导航、看板的数据来源）的边都能拖动、用方向键、双击调整宽窄，刷新后宽度还在，页面不会横向滚动 |
| `python3 e2e/import_here.py` | 往打开的项目里导入，先跑 `pnpm build`；它自己在示例项目的副本上启动服务端：每种类型的导入按钮、拖到任何地方、粘贴，网页文件夹变成画布上已有内容旁边的新画板（原文件留在 `uploads/`），粘贴 SVG，图片放到画布和幻灯片上，带图片的 Markdown 变成文档标签页，CSV 变成看板数据集，字体和 SVG 进设计系统，拒收，动效不收（29 项） |
| `python3 e2e/check_snapshots.py` | `check --snapshots` 查版面，先 `pnpm build`；在自己的项目文件夹上跑命令行：示例幻灯片的副本里放一行超出页面边缘的字、一行被框裁掉的字、一行淡色说明和一页空白，每样都报警告，原样的示例幻灯片一条也不报，每页照样画出来（7 项） |
| `python3 e2e/baseline.py` | 截图基线：要先 `pnpm dev`；启动页和每种类型的示例，以及请求栏挪到左侧对话列后的同一批示例，明暗 × 中英（52 张，1440×900），每张和 `e2e-baselines` 分支上的那张比；超过 0.2% 的像素变了就算失败，截图和差异图留在 `e2e/out/baseline/`；`DC_RECORD=1` 把新截图写到 `e2e/out/baselines-new/`，`DC_BASELINES=<文件夹>` 改成和一个文件夹比 |
| `python3 e2e/ai_settings.py` | AI 模型设置：要先用没有 `ANTHROPIC_*` 变量、`DC_CONFIG` 指向临时文件的环境跑 `pnpm dev`，再跑 `python3 e2e/mock_anthropic.py`；请求栏的提示、从启动页和项目里打开对话框、Tingly Box / 自定义地址、拒绝不合法地址、经模拟模型测试、保存后不回传密钥、Claude Code 用自己登录的选项 |
| `python3 e2e/conversation.py` | 项目保存的 Claude Code 对话：要先用 `e2e/fake-claude` 排在 `PATH` 最前面启动 `pnpm dev`，由一个冒充 `claude` 的脚本记录每次调用：第一条请求开一段对话、服务端把会话号存在项目文件夹里，下一条接着说，`fresh` 开新的，显式给的会话优先，Claude Code 已不认识的会话自动改开新对话（11 项）|
| `python3 e2e/follow_up.py` | 手动改了设置之后的提议：要先用 `e2e/fake-claude` 排在 `PATH` 最前面启动 `pnpm dev`；幻灯片尺寸小改不出提议，改成形状差很多时请求栏上方出现“重新排版”提议且不自动运行，“改写请求”把准备好的请求放进输入框，“忽略”收起，改回原样不出提议，装入设计系统会提议换成这套风格，接受则把它连同改了什么、项目设置一起交给 Claude Code（15 项）|
| `python3 e2e/fast.py` | 快速 AI：流式执行、报错撤销、重试、回写 |
| `python3 e2e/fast_slides.py` | 幻灯片上的快速 AI：报错重试、越出幻灯片格式时撤销并把原因告诉模型 |
| `python3 e2e/fast_motion.py` | 动效场景上的快速 AI：模型看到作品尺寸和播放头所在的场景、报错重试、越出格式时撤销并说明、保留时间属性 |
| `python3 e2e/delegate.py` | 真的调用本机 `claude` CLI |

快速 AI 的两项测试使用模拟模型（第一次故意给一行会报错的语句）：

```bash
python3 e2e/mock_anthropic.py &
ANTHROPIC_API_KEY=x ANTHROPIC_BASE_URL=http://127.0.0.1:8790 pnpm dev
```

## CI 里的 e2e

`.github/workflows/e2e.yml` 按三种节奏跑 `pnpm e2e`，因为全量太慢，不适合每个 PR 都跑：每晚在 main 上跑，也可以在 Actions 页手动触发，都经过 `e2e-patrol.yml`（全量；每晚的那次红了就开一个 `e2e-patrol` 标签的 issue，已有就追加评论，转绿后自动关掉；手动跑的只出报告）；每次发布前（全量，红了拦住发布）；PR 改了 `apps/`、`packages/`、`e2e/` 或 `projects/` 时跑 `--smoke`。报告和日志是这次运行的 `e2e-report-<片号>` 产物（全量切成四片，每片一个作业）。全量里有 `baseline`：编辑器截图和 `e2e-baselines` 分支上的比。界面是有意改的时候，先在红了的那次运行的报告里看差异图，再手动运行 E2E patrol 这个 workflow 并勾上 "record baselines"，它会在同样的机器上重新截图，推到那个分支。为什么这样分：`.design/harness.md`。

## 发版

推一个 `vX.Y.Z` tag 就发布这个版本；workflow 会先把 tag 的版本号写进根 `package.json` 再构建，所以不用先在 main 上改版本。`.github/workflows/release.yml` 先跑全部 e2e 套件（`e2e.yml`，红了就停下不发），再跑单元测试和 typecheck，打出 bundle，像宿主那样启动一次（`.github/scripts/smoke-bundle.sh`），再打成 `tingly-design-<ver>.tgz`。这一个文件连同它的 `.sha256` 附到 tag 上的 GitHub release，同时以 `@tingly-dev/tingly-design` 和 `tingly-design` 两个名字发到 npm（内容相同）。带后缀的 tag（如 `v0.2.0-rc.1`）发预发布版，npm dist-tag 是 `rc`；其余发到 `latest`。

npm 发布只走 Trusted Publishing：哪里都不存 token，两个包也拒绝 token，所以 CI 之外只有维护者输入一次性密码才能发。第一次发版前，维护者在自己机器上跑一次 `scripts/npm-bootstrap.sh`（占位版本、trusted publisher、要求 2FA），并在 GitHub 上建好 `production` environment。

`.github/workflows/ci.yml` 在每个 PR 上跑同样的检查，再用 `npm pack --dry-run` 列出包里会有什么。为什么这样做、npm 发布怎么鉴权，见 `.design/release.md`。

`.github/workflows/pages.yml` 构建主页（`site/`），在 main 上部署到 GitHub Pages。主页上的 design-motion 宣传片由这个任务从 `projects/design-motion` 渲染（`scripts/build-site.sh`），不提交进仓库。维护者需要手动开启一次 Pages：Settings → Pages → Source 选 GitHub Actions。

## 服务端日志

服务端把每个事件写成一行输出到 stderr，不用打开编辑器就能看到快速 AI 和 Claude Code 在做什么：

```
2026-10-14T09:12:03.120Z INFO  fast.start project=demo kind=design model=claude-haiku-5-5 messages=3
2026-10-14T09:12:04.870Z INFO  fast.done project=demo kind=design model=claude-haiku-5-5 messages=3 ms=1750 chars=212 inputTokens=4120 outputTokens=96
2026-10-14T09:12:30.004Z INFO  delegate.start run=3f9a project=demo kind=slides model=default promptChars=48 attachments=0
2026-10-14T09:12:58.331Z INFO  delegate.finish run=3f9a project=demo kind=slides outcome=done ms=28327 steps=6
```

| 事件 | 级别 | 字段 |
|---|---|---|
| `fast.start` / `fast.done` / `fast.aborted` / `fast.error` | info（`fast.error` 为 error） | project、kind、model、messages、ms、chars、token 数、error |
| `fast.unavailable`、`delegate.unavailable` | warn | project、reason（没有 API key、没有 `claude` 命令） |
| `delegate.start` / `delegate.finish` | info（`outcome=error` 时 warn） | run、project、kind、model、promptChars、attachments、outcome（`done`、`stopped`、`error`）、ms、steps、error |
| `delegate.step` | debug | run、tool、n |
| `request.failed`、`watcher.failed` | error | method、path、file、error |

提示词和回复从不写进日志，只记长度。用环境变量设置：

- `DC_LOG_LEVEL`：`error`、`warn`、`info`（默认）、`debug` 或 `silent`。
- `DC_LOG_FORMAT=json`：每行一个 JSON 对象（`at`、`level`、`event` 加字段），方便宿主收集。

---

返回 [README](../../README.zh-CN.md)
