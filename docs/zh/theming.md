<p align="right"><a href="../en/theming.md">English</a> · <b>简体中文</b></p>

# 主题

编辑器的外观是一组有名字的 token（颜色、阴影、字体、圆角），以 CSS 自定义属性写在 `<html>` 上。可以在启动页的 **外观** 菜单里选，也可以从外部传入。主题只改编辑器本身；画布、幻灯片、看板和设计系统预览保留各自的颜色，因为那些就是你正在设计的文件。

![外观菜单：宿主传入的主题排在预设之上](../images/theme-appearance-menu.png)

## 预设

名字与 Tingly Box 的主题模式一致，宿主可以把自己的模式名原样传进来。

| 名字 | 样子 |
|---|---|
| `system` | 跟随操作系统，在 `light` 和 `dark` 之间切换（默认） |
| `light` | 纸与墨加一个蓝色强调色；取自 Tingly Design System 示例（`projects/tingly-ds`）的浅色值 |
| `dark` | 同一套设计系统的深色值 |
| `claude` | Anthropic 的米白与橙色，同 Tingly Box 的 `claude` 主题 |
| `ds` | DeepSeek 蓝，同 Tingly Box 的 `ds` 主题 |
| `sunlit` | 天空蓝，同 Tingly Box 的 `sunlit` 主题 |

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
