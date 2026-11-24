# 删除：项目进回收站，页面带"撤销"

状态：**已实施**。测试是 `e2e/delete.py`。

## 1. 要解决的问题

启动页的卡片没有"删除"：在启动页里建的项目永远删不掉（`launcher.md` 把它列为"需要回收站和撤销，另议"），只有从别处添加的项目能"从列表移除"。项目里的页面（画板、幻灯片、文档标签页、动效场景）倒是能删，但入口不齐：文档标签页和动效场景按 Delete 键没反应，画布能把最后一块画板也删掉，剩一张空画布。

"画布"和"页面"在用户嘴里是两层：**项目**（启动页上的一张卡，各类型都有）和**项目里的一页**（画布的画板、幻灯片的页、文档的标签页、动效的场景）。两层各补一遍，规矩沿用 [cross-kind-consistency.md](./cross-kind-consistency.md) §4.3：**能撤销的直接做，toast 带"撤销"；撤销不回来的才问。**

## 2. 决定

| 问题 | 决定 | 为什么 |
|---|---|---|
| 删项目放哪 | 卡片和列表行的"⋯"菜单最后一项"移到回收站"（危险色），不问；项目文件夹（含历史、会话记录）整个 `rename` 进 `projects/.trash/<id>/`，所属分组记在旁边的 `<id>.json`；toast 带"撤销" | 删项目是整个文件夹，内存里留不下副本，所以不能像页面那样"把文字写回去"；移动文件夹是原子的，撤销就是移回来，一个字节都不丢。事前一次确认换成事后一次反悔（§4.3 的取舍） |
| 回收站放哪 | `<项目文件夹>/.trash/`，点号开头：不是项目名，启动页、文件监视、导出包都看不见；`.gitignore` 里忽略 `projects/.trash/` | 和 `.groups.json`、`.links.json` 一样是这台机器的整理状态，跟着项目文件夹走，不另设数据目录 |
| 找回 | 回收站里有东西时，启动页列表标题行出现"最近删除 N"，打开是一个对话框：每项"恢复"和"彻底删除"，另有"清空回收站" | 回收站空着时不占位（少一点噪声）；有东西时 toast 消失后仍找得到 |
| 恢复重名 | 绝不覆盖：原名被占（删后又建了同名项目）就用下一个空名（`name-2`），并告诉用户；原名能用时分组一并恢复 | 用户在删除之后做的工作比被删的更新，不能被盖掉 |
| 唯一要问的一步 | "彻底删除"（单项和清空）用 `askConfirm`；这是整个流程里唯一撤销不回来的 | 同 §4.3：只有无法恢复的才问 |
| 不删什么 | 从别处添加的项目（有 `path`）仍然只是"从列表移除"，文件夹不动；打开成分组的文件夹里的成员也一样（服务端 `notInProjects` 409）；Claude Code 正在这个项目上跑时拒绝（`projectBusy` 409） | 外面的文件夹不是 Tingly Design 的，不能替用户挪；运行中的进程还在往里写 |
| 页面：Delete 键 | 文档标签页上按 Delete / Backspace（焦点在标签名上）、动效时间轴里的场景块上按 Delete / Backspace，走原来的 `deleteTab` / `deleteScene`（toast 的撤销、文档标签页的"已删除的标签页"），键事件 `stopPropagation`，不会连带删掉舞台上选着的元素 | 画布和幻灯片本来就有；这两处只有"⋯"和右键菜单，键盘够不着 |
| 页面：最后一页留下 | 画布与幻灯片、文档、动效一致：最后一块画板不能删，toast 说明（`app.board.lastBoard`） | 一张没有画板的画布没法再选中任何东西，只能靠撤销或终端救回来 |
| 动效删场景的提示 | 删掉旧的"场景的新建、复制和删除还没有放进编辑器"提示（早就过时了：右键菜单能删） | 提示说谎 |

## 3. 实现位置

- 服务端：`apps/server/src/trash.ts`（`trashProject`、`listTrash`、`restoreTrash`、`purgeTrash`）；`app.ts` 的 `DELETE /api/projects/:p`、`GET /api/trash`、`POST /api/trash/:id/restore`、`DELETE /api/trash/:id`、`DELETE /api/trash`。
- 编辑器：`launcher/ProjectCards.tsx` 的 `ProjectActions`、`launcher/Launcher.tsx` 的 `remove`、`launcher/TrashDialog.tsx`；`api.ts` 的 `trashProject` / `trash` / `restoreTrashed` / `purgeTrashed`。
- 页面：`editEngine.ts` 的 `deleteBoard`（最后一块画板）、`DocsApp.tsx` 的 `TabRow`、`motion/Timeline.tsx` 的场景块。
- `core` 里的 `TrashedProject` 是卡片加 `id`、`deletedAt`。

## 4. 没做的

- 回收站不自动清理，也没有保留期；用户在"最近删除"里自己清空。
- 编辑器里（项目菜单、顶栏）没有"删除当前项目"，只在启动页；命令行和 MCP 也没有 `delete` / `restore`。
- 设计系统的视图是固定集合、看板只有一页，没有"删一页"；设计系统卸载（`DsInstall`）仍然没有撤销。
- 从别处添加的项目没有"删除文件夹"，只有移除。
