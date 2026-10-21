<p align="right"><a href="../../en/guide/claude-design.md">English</a> · <b>简体中文</b></p>

# 和 Claude Design 互相搬作品

Tingly Design 的画布、幻灯片、设计系统和看板，文件格式跟着 Claude 自己的 Design、Slides、Design System、Dashboard 走，所以作品可以双向搬：在 claude.ai 上做的设计带到这里，继续手改、在终端里改或交给 Claude Code；在这里做的项目再交回去，由 Claude Code 发布成原版的作品。

| Tingly Design | Claude 的类型 | 包里是什么 |
|---|---|---|
| 画布 | Design | `project/canvas.json`、`project/*.dc.html` |
| 幻灯片 | Slides | `project/deck.json`、`project/slides/<id>.html` |
| 设计系统 | Design System | `project/design-system.json`、`tokens.json`、`README.md`、`components/`、`assets/`、`fonts/` |
| 看板 | Dashboard | 存储里的文档，一份一个文件：`dash/meta.json`、`dash/params.json`、`datasets/<id>.json`、`files/<名字>`，附加的数据放 `blobs/<名字>` |
| 文档 | Docs | 原版没有文件（Docs 在独立的服务里）：走 Markdown |
| 动效 | 无 | 原版没有这个类型 |

## 把一件作品带进来

1. 让 Claude Code 把作品读进一个文件夹：“读这个作品（链接），把所有文件和素材存到 `~/claude-design/poster`”。Claude Code 会存下 `project/…` 和设计里用到的图片（以 id 命名）。
2. 导入这个文件夹，或它的 `.zip`：
   - 首页 **新建项目 → 导入项目包（.zip）…**；
   - 或在终端里 `tingly-design import ~/claude-design/poster`。

不用选类型：Tingly Design 从文件看出是哪一种，直接打开，名字取作品的标题。以 `/_blob/<id>` 存的图片，如果一起带来了，会放进 `uploads/`；没带来的有几张，会在提示里说。看板的数据文件没带来时，数据集会列在“问题”里，接上文件就能逐个解决。

从 Claude Docs 存下来的 Markdown 文件（**导出 → Markdown**）从 **新建项目 → 导入 Markdown（.md）…** 导入，成为一份新文档。

## 把项目交回去

画布、幻灯片、设计系统或看板里的 **导入 / 导出 → Claude Design 包（.zip）**（或 `tingly-design export <项目> --as claude-design`）把项目存成原版的文件布局，并附一份给 Claude Code 看的 `README.md`，写明怎么发布。把解开的文件夹交给 Claude Code：“把这个文件夹发布成 Slides 作品。”

提示或 README 里会告诉你：

- **幻灯片的图片**是 `uploads/` 下的文件；原版只认上传的素材，所以发布前由 Claude Code 先上传。
- **装自本地项目的设计系统**写的是本地路径。请在 claude.ai 上装入真正的那一个。
- **本地的 SQLite 数据库**不会带上，原版 Dashboard 读不了。查询另一边没有的连接器的数据集，要换成附加的文件。

改动记录、渲染出的视频、git 文件夹和别的本机文件不会进包。想原样留一份项目（含改动记录和设计系统），用 **整个项目（.zip）**。
