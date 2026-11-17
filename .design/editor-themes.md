# 编辑器外壳的主题

状态：**已实施**。

编辑器自己的外观（启动页、顶栏、面板、菜单、对话框）有一套主题。作品本身另有主题：[画布和幻灯片的项目主题](./project-theme.md)、[文档穿的设计系统](./doc-design-system.md)。三者互不相干，本文只讲第一件。

## 问题

外壳的主题原来分散在许多地方：`apps/editor/src/tingly-box/palettes/` 里每个预设一份从 Tingly Box 拷来的调色板，`theme.ts` 里的 `TINGLY_BOX` 记录、`PRESET_IDS` 数组、`Preset.label`（代码里的英文名），两份语言词条，`scripts/sync-tingly-box-theme.mjs` 的文件清单，以及文档和测试里的名单。增删一个预设要记住改很多处，漏一处就出现"菜单有、脚本 API 没有"或"文件删了、同步脚本还在拷"这类不一致。

## 决定

1. **一份清单**：`apps/editor/src/theme.ts` 的 `THEMES` 按菜单顺序列出每个预设——id、用哪份调色板、菜单和对话框的阴影、页面本身是渐变时画布取的实色。`PresetId`、`PRESET_IDS`、`PRESETS`、外观菜单（`Appearance.tsx` 的 `MODES`）和脚本 API 的 `presets()` 都从它推出来，没有第二份名单。
2. **名字只在词条里**：预设名是 `appearance.mode.<id>`（`packages/i18n` 的 en / zh），`theme.ts` 不再自带英文名；`presets()` 返回的 label 也读词条，所以界面语言换了名字跟着换。
3. **调色板仍然一份预设一个文件**（`apps/editor/src/tingly-box/palettes/`），值来自 Tingly Box，`SOURCE.json` 记来源提交。同步脚本不再维护自己的文件清单，而是按这个文件夹里现有的 `*.ts` 拷贝；编辑器不读的 `is*` 布尔标记在拷入时去掉，拷贝的内容就是用到的那部分。
4. **首屏靠 CSS，之后靠注册表**：`styles/base.css` 的 `:root` 写着 light 的 token 值，让第一帧（JS 还没跑时）就是对的；`initTheme()` 在 React 渲染前把当前主题写到 `<html>` 上覆盖它。这一层重复是有意的（CSS 先于 JS 生效），改 light 调色板时要一起改 `base.css`。
5. **外部传入的主题不新增路径**：URL、脚本、宿主 `postMessage`、`DC_THEME` 的四条入口共用 `resolve`；只写想改的 token 时，`DERIVED` 从它们派生出线条、悬停和灰色文字，和预设走同一套规则。增删预设不改变这些入口。

## 没做

- `base.css` 的首屏值和 `THEMES` 仍靠人工保持一致，没有生成或校验脚本。
- 调色板文件里 Tingly Box 的 dashboard 等字段还随文件拷进来（编辑器不读），可以按同一套 prune 继续收窄。