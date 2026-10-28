# 设计系统的“怎么用”：README 末尾的生成段与 .ttc 字体

状态：**已实施**。生成在 `packages/core/src/dsGuide.ts`（`consumingGuide`、`withConsumingGuide`），写入在服务端 `regenTokensCss`（`apps/server/src/store.ts`）。上游参照：原版 Design System 类型 2026-10-28 版重写的同名附录。

## 1. 要解决的问题

Claude（或任何 agent）拿一套设计系统去做页面时，先读的是它的 README。README 是品牌手册，写声音、视觉原则和例子，不会告诉读者：样式表链哪一个、放哪里；暗色主题怎么切；某个颜色该用哪个变量、没有变量时写什么值；色阶长什么样；字体族是什么变量；文字样式的字号、行高、斜体和字距是多少。这些都在 `tokens.json` 里，但一份 JSON 要读者自己拼，拼错就是写死了一个近似值。

另一个小问题：字体集合 `.ttc` 在 `type.fonts` 里被当作无效项丢掉，人带来一个 `.ttc` 什么也没发生。

## 2. 决定

| 问题 | 决定 | 为什么 |
|---|---|---|
| 写在哪 | README 末尾，两行注释标记之间；标题沿用原版的“Consuming this system (generated — do not edit)” | agent 本来就读 README；沿用原版的标题，读过原版的模型认得 |
| 谁来写 | 由 `tokens.json` 生成，和 `tokens.css` 同一时刻重写（编辑器、Claude Code、终端改 `tokens.json` 都一样） | 手写会和 tokens 漂开；放在同一处，两份生成物不会各自过期 |
| 没有 README 的系统 | 不创建 | README 是人的文件，生成段只追加 |
| 人或 Claude 在标记里改了 | 下次重写时盖掉 | 标题已写明；SKILL 和委托提示都说“写在标记上面” |
| 内容 | 怎么链接、主题与 `data-theme`；颜色（变量带备用值、色阶合一行、交互状态单列）；字体族与变量；文字样式（含斜体、字距）；字体文件；间距、圆角、阴影 | 逐项对应“读者要拼的东西” |
| 画布和幻灯片怎么用 | 说明画板和幻灯片的沙箱不能链接样式表（它只加载内联样式和 Google Fonts），直接用表里的值，或把 `:root {…}` 抄进画板的 `<helmet><style>` | 上游那一段教的是链接 `tokens.css`；我们的沙箱 CSP 不允许，写进去只会让 agent 做出一个不生效的链接 |
| 光学尺寸（`opsz`） | 不做 | 我们的 tokens 语法没有这一项；以后加语法时一起加 |
| `.ttc` | `type.fonts` 接受，文件原样保留（上传、导出、zip 都认），`tokens.css` 声明 `format("collection")`；不转成资源，也不假装浏览器能加载 | 上游同样接受但不入资源库；浏览器的 `@font-face` 不加载集合，所以生成段直接这么说，并建议换同一字体的 woff2；`format()` 不被识别时浏览器不会去请求，所以不会在检查里报“字体没加载” |

## 3. 还开着的问题

- 画布的画板能不能链接项目里的样式表（放开 CSP、或由运行时把样式表内联进去）。放开以后这一段就能改成上游那样的“链接 `tokens.css`”，并且安装时把 `tokens.css` 一起复制到 `ds/<folder>/`。
- 把 `.ttc` 的成员拆成 woff2（不转的话它在网页里不能用，只能给本机渲染的流程用）。
