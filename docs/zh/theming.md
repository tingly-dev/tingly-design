<p align="right"><a href="../en/theming.md">English</a> · <b>简体中文</b></p>

# 主题

编辑器的外观是一组有名字的 token（颜色、阴影、字体、圆角），以 CSS 自定义属性写在 `<html>` 上。可以在启动页的 **外观** 菜单里选，也可以从外部传入。主题只改编辑器本身；画布、幻灯片、看板和设计系统预览保留各自的颜色，因为那些就是你正在设计的文件。

## 预设

预设就是 Tingly Box 自己的主题，名字也相同：编辑器单独运行或嵌在 Tingly Box 里，看起来都和 Tingly Box 一致，宿主也可以把自己的模式名原样传进来。

| 名字 | 样子 |
|---|---|
| `system` | 跟随操作系统，在 `light` 和 `dark` 之间切换（默认） |
| `light` | Tingly Box 的浅色主题：近白底上的石板灰，蓝色强调色 |
| `dark` | Tingly Box 的深色主题：近黑的石板色阶，更亮的蓝 |
| `claude` | Anthropic 的米白与橙色，即 Tingly Box 的 `claude` 主题 |
| `ds` | 雾蓝画布上的 DeepSeek 蓝，即 Tingly Box 的 `ds` 主题 |
| `sunlit` | 天空蓝，即 Tingly Box 的 `sunlit` 主题 |

### 和 Tingly Box 保持同步

Tingly Box 的调色板和字体栈原样拷贝在 `apps/editor/src/tingly-box/`（`SOURCE.json` 记着来源提交）。`theme.ts` 用映射宿主调色板的同一套规则（见下文）把它们变成 token，另有三处编辑器需要的调整：半透明颜色先叠到它所在的底色上，所以每个 token 都是实色；`ds` 和 `sunlit` 的页面背景是渐变，画布取其中一个颜色；菜单和对话框的阴影、6 px / 12 px 圆角取自 Tingly Box 的组件样式。Tingly Box 的主题变了时：

```bash
node scripts/sync-tingly-box-theme.mjs ../tingly-box   # tingly-box 检出的路径
pnpm typecheck && python3 e2e/theme.py
```

## 传入主题

四种方式接受同一种值：一个预设名，或一个对象。

```jsonc
{
  "base": "dark",          // 起点预设；默认取 palette.mode，否则 light
  "name": "Rose",          // 在外观菜单里显示的名字
  "tokens": { "accent": "#e11d48" },
  "palette": { ... }       // 或者直接给 Tingly Box 的 palette（MUI 结构），见下文
}
```

| 位置 | 用法 | 保留多久 |
|---|---|---|
| URL | `?theme=dark` 或 `?theme=` 加 URL 编码的 JSON | 整个浏览器标签页，切换项目也保留 |
| 脚本 | `window.tinglyDesign.setTheme(theme)`；另有 `getTheme()` 和 `presets()` | 直到页面刷新 |
| 宿主页面 | 嵌入编辑器的页面（或打开它的页面）调用 `iframe.contentWindow.postMessage({ type: 'tingly-design:set-theme', theme }, '*')` | 直到页面刷新 |
| 服务端 | `DC_THEME=claude pnpm dev`；也可以是内联 JSON 或 `.json` 文件路径 | 用户没有自己选时的默认值 |

启动时 URL 优先于用户在菜单里的选择，用户选择优先于 `DC_THEME`，`DC_THEME` 优先于 `system`。之后以最近一次改动为准。在菜单里选的会被记住，并清掉 URL 带来的主题。

被嵌入时，编辑器每次换主题都会通知父页面：`{ type: 'tingly-design:theme-changed', theme: { id, mode, scheme, name } }`。

### Token

`canvas` `panel` `panel-2` `hover` `line` `line-2` `ink` `ink-2` `muted` `faint` `accent` `accent-ink` `accent-soft` `on-accent` `danger` `danger-soft` `ok` `ok-soft` `warn` `warn-soft` `backdrop` `float-shadow` `lift-shadow` `ui` `mono` `r` `r-float`

只设需要的即可。由某个 token 推导出来的 token 会跟着它变，除非你也显式设置：改了 `accent`，`accent-soft`、`accent-ink`、`on-accent` 会从它算出来；改了 `panel` 或 `ink`，线条、悬停色和灰色文字会由它们混合得到。可能加载外部资源（`url(`、`image(`）或截断声明（`;`、`{`、`}`）的值会被忽略。

### 来自 Tingly Box

Tingly Box 的主题是 MUI palette。作为 `palette` 传入时，映射如下：

| Palette | Token |
|---|---|
| `mode` | 起点：`light` 或 `dark` |
| `primary.main` / `primary.dark` / `primary.contrastText` | `accent` / `accent-ink`（仅浅色）/ `on-accent` |
| `background.default` / `background.paper` | `canvas` / `panel`（`transparent` 会被跳过） |
| `text.primary` / `text.secondary` / `text.disabled` | `ink` / `muted` / `faint` |
| `divider`、`action.hover` | `line`、`hover` |
| `error.main` / `success.main` / `warning.main` | `danger` / `ok` / `warn` |

```js
editorFrame.contentWindow.postMessage({ type: 'tingly-design:set-theme', theme: { name: 'Tingly Box', palette: theme.palette } }, '*');
```

---

返回 [README](../../README.zh-CN.md)
