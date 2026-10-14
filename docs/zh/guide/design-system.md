<p align="right"><a href="../../en/guide/design-system.md">English</a> · <b>简体中文</b></p>

# 设计系统

示例 [`?p=tingly-ds`](http://localhost:5173/?p=tingly-ds) 是 Tingly 设计系统：控制台界面稿、幻灯片和看板共用的颜色（亮暗两套）、字体、字号、间距和组件，取自 Tingly Box 官网和控制台。

| 概览：封面 + 品牌手册 | 颜色：用法与对比度 |
|---|---|
| ![设计系统概览](../../images/design-system.png) | ![设计系统颜色页](../../images/design-system-colors.png) |

```
projects/<name>/
  design-system.json      索引：标题、namespace、资源分组
  tokens.json             颜色（按主题）、文字、间距、圆角、阴影……都是 {name, value, usage} 列表
  tokens.css              由 tokens.json 自动生成（编辑器、Claude Code、终端改 tokens.json 都会重新生成）
  README.md、*.md          品牌手册
  components/<C>/         README.md（使用说明）和 preview.html（实时预览）；Cover 是封面
  components/bundle.js    组件实现，挂在 window.<namespace>；bundle.css、index.d.ts
  assets/<分组>/、fonts/   标志、图标、图片和字体文件
```

- **页面**：概览（顶部是这套系统的样张、字体、形状、主题和数量，再往下是完整色板、封面和品牌手册，可直接编辑 Markdown；启动页的卡片画的是同一张样张，两套系统的差别一眼可见）、颜色（按主题切换；用法里写“on surface”就显示在那个底色上的对比度；别名显示指向谁）、文字（每个样式按自己的字体和字号渲染）、间距与圆角与阴影、组件（每个预览都在沙箱里先加载 tokens.css、bundle.css、bundle.js 再运行）、资源（按分组上传、下载、删除）。
- **原地改 token**：点一行展开，改值、改名（别名会跟着改）、写用法、增删。保存的是 tokens.json 的数据，tokens.css 随之重建，只改真正变了的那几行。
- **检查**：tokens.json 里不符合原版语法的部分（颜色名、`var()`、不存在的别名、循环别名、DTCG 的 map 写法……）会被丢弃并在“问题”里写明原因。
- **装进画布或幻灯片**：在画布或幻灯片的面板里（不选中任何东西时）选择“设计系统 → 装入”。tokens.json 复制到那个项目的 `ds/<folder>/`，索引的 `designSystems` 记一条；之后所有颜色输入框旁边有 ◆ 可以选它的颜色、并标出当前值是哪个 token，文字样式菜单列出它的样式；幻灯片还会拿到它的字体。幻灯片里写的是颜色值本身（子集不允许 `var()`）。
- **托管字体**：`tokens.json` 的 `type.hosted: [{family, href}]` 是这里的扩展（原版只认字体文件），用 Google Fonts 的 css2 链接；预览和装入的幻灯片都会加载。
- **AI**：原版设计系统页面没有页内模型，这里也只交给 Claude Code。
- **导入**：左栏底部的导入按钮，或把文件拖进来。字体文件加进字体（写进 `tokens.json`），图片和 SVG 加进素材的 Other 分组。

格式说明：[`.claude/skills/design-system/SKILL.md`](../../../.claude/skills/design-system/SKILL.md)

---

返回 [README](../../../README.zh-CN.md)
