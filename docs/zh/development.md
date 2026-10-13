<p align="right"><a href="../en/development.md">English</a> · <b>简体中文</b></p>

# 开发与测试

```bash
pnpm test           # core 单元测试：解析、回写、jQuery 会话、语句切分、撤销重定位、幻灯片、设计系统、看板、文档
pnpm typecheck
```

端到端测试需要先 `pnpm dev`，以及 Python 版 Playwright（`pip install playwright`）。用别的浏览器时设置 `DC_CHROME=/path/to/chrome`；在无界面环境里请用 Playwright 的 `chromium_headless_shell`，完整版 Chromium 无头运行时点击缩放后的画板会点偏。

| 命令 | 覆盖 |
|---|---|
| `python3 e2e/e2e.py` | 画布：面板、图层、样式、改字、结构操作、剪贴板、拖动/拖出、画布工具、页面、导出、并发、撤销、播放（40 项） |
| `python3 e2e/slides.py` | 幻灯片：缩略图与分节、改字、删除与撤销、拖动钉住的元素、备注、新建/复制/排序/删除、格式检查、jQuery、放映、导出（20 项） |
| `python3 e2e/ds.py` | 设计系统：封面与品牌手册、改颜色/改名带别名/增删、文字与圆角、组件预览、上传资源、外部改坏后的提示、新建、装进幻灯片后选 token 与文字样式、移除（22 项） |
| `python3 e2e/dash.py` | 看板：查询/CSV/JSON 加载、标注核对、筛选与点行筛选、数据模式、改查询（拒绝写入）、停止与恢复自动刷新、外部改数据文件与页面、失败状态、`.runs.json`、代码面板、新建（24 项） |
| `python3 e2e/docs.py` | 文档：标签页与大纲、浏览不写盘、打字/勾待办/改单元格都只改一行、`/` 菜单、格式菜单、外部改动实时进来且不被覆盖、评论（回复/解决/新建）、标签页增删改、版式、AI 改写（有模拟模型时）、导出 HTML、新建（25 项） |
| `python3 e2e/motion.py` | 动效：示例停在封面并可在舞台上编辑；播放时换成播放器，暂停或点一下画面回到舞台；跳到场景时停在都已到位的时刻；点选、双击改字、拖手柄改尺寸；竖版里的改动写进 `data-tall`，点覆盖标签可撤回；还没出场的元素点不到，选中的元素显示落定位置，图层标出何时入场；添加、改、删尺寸；竖版、改速度、新建（20 项） |
| `python3 e2e/launcher.py` | 启动页：六种类型和全部项目都列出、封面、画板与动效实时预览、按类型筛选、搜索与 `/`、回车打开、继续上次的项目、方向键、排序、新建对话框（按标题生成文件夹名、拒绝重名和非法名）、手机宽度（27 项） |
| `python3 e2e/theme.py` | 主题：跟随系统、外观菜单与记住选择、深色画布和看板、`?theme=` 传预设或 JSON、派生 token、`tinglyDesign` 脚本接口、Tingly Box palette、丢弃不安全的值、宿主页面用 postMessage 设主题并收到回报（25 项） |
| `python3 e2e/embed.py` | 嵌入，先跑 `pnpm bundle`；它自己启动打包好的服务端：清单和就绪行、新项目文件夹放入示例、一切都在 `/design` 之下、编辑写进宿主的文件夹、另一个源上的宿主页面打开项目并收到 `ready` 和 `location`、宿主传主题、stdin 关闭和 SIGTERM 时退出（27 项） |
| `python3 e2e/attach.py` | 附件，先跑 `pnpm build`；它自己启动带模拟模型和替身 `claude` 的服务端：粘贴、选择、拖入文件，拒收和最多 6 个的限制，模型收到的内容块，重试时保留附件，存进 `uploads/`（原图、同一文件只存一份、能读回来），Claude Code 读到的路径，文档页的输入框，幻灯片显示存下的图片，服务端的校验（36 项） |
| `python3 e2e/fast.py` | 快速 AI：流式执行、报错撤销、重试、回写 |
| `python3 e2e/fast_slides.py` | 幻灯片上的快速 AI：报错重试、越出幻灯片格式时撤销并把原因告诉模型 |
| `python3 e2e/fast_motion.py` | 动效场景上的快速 AI：模型看到作品尺寸和播放头所在的场景、报错重试、越出格式时撤销并说明、保留时间属性 |
| `python3 e2e/delegate.py` | 真的调用本机 `claude` CLI |

快速 AI 的两项测试使用模拟模型（第一次故意给一行会报错的语句）：

```bash
python3 e2e/mock_anthropic.py &
ANTHROPIC_API_KEY=x ANTHROPIC_BASE_URL=http://127.0.0.1:8790 pnpm dev
```

---

返回 [README](../../README.zh-CN.md)
