<p align="right"><a href="../en/development.md">English</a> · <b>简体中文</b></p>

# 开发与测试

```bash
pnpm test           # 单元测试：core（解析、回写、jQuery 会话、语句切分、撤销重定位、幻灯片、设计系统、看板、文档）、导入器、导出器（浏览器能写什么、字体内联）、界面文字（两种语言的键一致、占位符一致、代码里的键都存在、代码里没有写死的中文）
pnpm typecheck
```

其他套件按中文的标签找元素，所以浏览器用 `zh-CN` 语言运行；英文由 `i18n.py` 覆盖。

端到端测试需要先 `pnpm dev`，以及 Python 版 Playwright（`pip install playwright`）。用别的浏览器时设置 `DC_CHROME=/path/to/chrome`；在无界面环境里请用 Playwright 的 `chromium_headless_shell`，完整版 Chromium 无头运行时点击缩放后的画板会点偏。

| 命令 | 覆盖 |
|---|---|
| `python3 e2e/e2e.py` | 画布：面板、图层、样式、改字、结构操作、剪贴板、拖动/拖出、画布工具、页面、导出、并发、撤销、播放（40 项） |
| `python3 e2e/slides.py` | 幻灯片：缩略图与分节、改字、删除与撤销、拖动钉住的元素、备注、新建/复制/排序/删除、格式检查、jQuery、放映、导出（20 项） |
| `python3 e2e/ds.py` | 设计系统：封面与品牌手册、改颜色/改名带别名/增删、文字与圆角、组件预览、上传资源、外部改坏后的提示、新建、装进幻灯片后选 token 与文字样式、移除（22 项） |
| `python3 e2e/dash.py` | 看板：查询/CSV/JSON 加载、标注核对、筛选与点行筛选、数据模式、改查询（拒绝写入）、停止与恢复自动刷新、外部改数据文件与页面、失败状态、`.runs.json`、代码面板、新建（25 项） |
| `python3 e2e/docs.py` | 文档：标签页与大纲、浏览不写盘、打字/勾待办/改单元格都只改一行、`/` 菜单、格式菜单、外部改动实时进来且不被覆盖、评论（回复/解决/新建）、标签页增删改、版式、AI 改写（有模拟模型时）、导出 HTML、新建（25 项） |
| `python3 e2e/image_gen.py` | 图片生成：要先用没有 `ANTHROPIC_*`、`DC_IMAGE_*` 变量、`DC_CONFIG` 指向临时文件的 `pnpm dev`，再起 `python3 e2e/mock_anthropic.py` 和 `python3 e2e/mock_images.py <日志>`；对话框里的“图片生成”一块（Anthropic 没有、跟着 Tingly Box 的地址、OpenAI 风格地址加单独的密钥和模型、错地址被拒）、生成一张图和改一张图都存进 `uploads/`、网关的拒绝原样转给人、`uploads/` 之外的路径被拒、密钥不回传 |
| `python3 e2e/export_menu.py` | 共用的导入 / 导出菜单：每种类型的栏里都有，列出这种类型收什么、能存什么；幻灯片和文档一键存成 PDF（真的 PDF，页数对）、服务端没有 Chrome 时回到打印窗口、状态条（28 项检查） |
| `python3 e2e/export_image.py` | 每种类型保存图片（PNG）：文档（当前标签页）、幻灯片（当前页、每一页）、看板、设计系统、动效（播放头所在的帧）；每个文件都是真的 PNG，尺寸不小于页面（7 项检查） |
| `python3 e2e/motion.py` | 动效：示例停在封面并可在舞台上编辑；播放时换成播放器，暂停或点一下画面回到舞台；跳到场景时停在开头并按落定的样子画出整页；点选、双击改字、拖手柄改尺寸；竖版里的改动写进 `data-tall`，点覆盖标签可撤回；还没出场的元素点不到，选中的元素显示落定位置，图层标出何时入场；添加、改、删尺寸；竖版、改速度、新建（21 项） |
| `python3 e2e/layers.py` | 图层树：画布、幻灯片、动效同样的行和隐藏/锁定；隐藏写 `data-hide` 且元素离开舞台，锁定写 `data-lock` 且点击落到外一层；画板通过 `canvas.json` 隐藏和锁定（25 项） |
| `python3 e2e/launcher.py` | 启动页：六种类型和全部项目都列出、封面、画板与动效实时预览、按类型筛选、搜索与 `/`、回车打开、继续上次的项目、方向键、排序、新建对话框（文件夹名跟着标题走、平时不占地方，没有字母的标题也能建，拒绝重名和非法名）、logo 和反馈链接、每种类型编辑器里一键回首页和项目菜单、手机宽度（43 项） |
| `python3 e2e/theme.py` | 主题：跟随系统、外观菜单与记住选择、深色画布和看板、`?theme=` 传预设或 JSON、派生 token、`tinglyDesign` 脚本接口、Tingly Box palette、丢弃不安全的值、宿主页面用 postMessage 设主题并收到回报（25 项） |
| `python3 e2e/i18n.py` | 界面语言：按浏览器语言选英文或中文（带地区的标签也认，其余用英文）、六种类型的示例在英文界面里不剩一个汉字、语言按钮写出当前语言、用各语言自己的名字列出并记住选择、`?lang=` 只管当前标签页、`tinglyDesign` 脚本接口、服务端报错按请求的语言措辞并带固定的 `code`、宿主用 `?lang=` 嵌入、用 postMessage 切换并收到 `language-changed`（26 项） |
| `python3 e2e/export.py` | 在浏览器里导出：动效在标签页里生成视频文件（按钮显示进度和取消，文件按作品和尺寸命名，尺寸和时长对，帧里有内容），对话框只有摘要、选项折起来，小尺寸、帧率和质量生效，GIF，取消导出，含嵌入内容的作品由服务端的 Chrome 画成 MP4、嵌入内容在画面上（对话框说明原因而不摆出选项） |
| `python3 e2e/embed.py` | 嵌入，先跑 `pnpm bundle`；它自己启动打包好的服务端：清单和就绪行、新项目文件夹放入示例、一切都在 `/design` 之下、编辑写进宿主的文件夹、另一个源上的宿主页面打开项目并收到 `ready` 和 `location`、宿主传主题、stdin 关闭和 SIGTERM 时退出（27 项） |
| `python3 e2e/attach.py` | 附件，先跑 `pnpm build`；它自己启动带模拟模型和替身 `claude` 的服务端：粘贴、选择、拖入文件，拒收和最多 6 个的限制，模型收到的内容块，重试时保留附件，存进 `uploads/`（原图、同一文件只存一份、能读回来），Claude Code 读到的路径，文档页的输入框，幻灯片显示存下的图片，服务端的校验（36 项） |
| `python3 e2e/run_feed.py` | 请求栏的运行卡片，先跑 `pnpm build`；它自己启动带模拟模型和替身 `claude` 的服务端：请求回显、快速 AI 的语句数和撤销，Claude Code 的步骤（相对路径、说的话）、计时、停止按钮、忙时按 Enter 保留输入、画板徽标、结果和改动文件、步骤收起展开、撤销整次运行、失败后放回输入框、中途打开的编辑器看到已做的步骤、停止，其余五种类型各跑一次，动效的播放位置只告诉 Claude Code 不回显、运行时动效舞台不动、请求历史、请求接着或不接上一次 Claude Code 对话、把请求栏收成药丸（40 项） |
| `python3 e2e/import_here.py` | 往打开的项目里导入，先跑 `pnpm build`；它自己在示例项目的副本上启动服务端：每种类型的导入按钮、拖到任何地方、粘贴，网页文件夹变成画布上已有内容旁边的新画板（原文件留在 `uploads/`），粘贴 SVG，图片放到画布和幻灯片上，带图片的 Markdown 变成文档标签页，CSV 变成看板数据集，字体和 SVG 进设计系统，拒收，动效不收（29 项） |
| `python3 e2e/ai_settings.py` | AI 模型设置：要先用没有 `ANTHROPIC_*` 变量、`DC_CONFIG` 指向临时文件的环境跑 `pnpm dev`，再跑 `python3 e2e/mock_anthropic.py`；请求栏的提示、从启动页和项目里打开对话框、Tingly Box / 自定义地址、拒绝不合法地址、经模拟模型测试、保存后不回传密钥、Claude Code 用自己登录的选项 |
| `python3 e2e/fast.py` | 快速 AI：流式执行、报错撤销、重试、回写 |
| `python3 e2e/fast_slides.py` | 幻灯片上的快速 AI：报错重试、越出幻灯片格式时撤销并把原因告诉模型 |
| `python3 e2e/fast_motion.py` | 动效场景上的快速 AI：模型看到作品尺寸和播放头所在的场景、报错重试、越出格式时撤销并说明、保留时间属性 |
| `python3 e2e/delegate.py` | 真的调用本机 `claude` CLI |

快速 AI 的两项测试使用模拟模型（第一次故意给一行会报错的语句）：

```bash
python3 e2e/mock_anthropic.py &
ANTHROPIC_API_KEY=x ANTHROPIC_BASE_URL=http://127.0.0.1:8790 pnpm dev
```

## 发版

推一个 `vX.Y.Z` tag 就发布这个版本；tag 必须和根 `package.json` 的 `version` 一致，所以先在 main 上改版本。`.github/workflows/release.yml` 跑单元测试和 typecheck，打出 bundle，像宿主那样启动一次（`.github/scripts/smoke-bundle.sh`），再打成 `tingly-design-<ver>.tgz`。这一个文件连同它的 `.sha256` 附到 tag 上的 GitHub release，同时以 `@tingly-dev/tingly-design` 和 `tingly-design` 两个名字发到 npm（内容相同）。`v0.2.0-rc.1` 这样的 tag 发预发布版，npm dist-tag 是 `next`。

npm 发布只走 Trusted Publishing：哪里都不存 token，两个包也拒绝 token，所以 CI 之外只有维护者输入一次性密码才能发。第一次发版前，维护者在自己机器上跑一次 `scripts/npm-bootstrap.sh`（占位版本、trusted publisher、要求 2FA），并在 GitHub 上建好 `production` environment。

`.github/workflows/ci.yml` 在每个 PR 上跑同样的检查，再用 `npm pack --dry-run` 列出包里会有什么。为什么这样做、npm 发布怎么鉴权，见 `.design/release.md`。

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
