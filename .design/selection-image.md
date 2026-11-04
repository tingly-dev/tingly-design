# 选中元素存为图片：下载 PNG，图片元素给原文件

状态：**已实施**。整页 / 整板的图片见 [export-image.md](./export-image.md)；把元素本身复制到剪贴板的 "Copy as PNG" 是 #117 那一轮做的，本篇补齐下载和原图。

## 1. 问题

在画布上选中一个元素后交不出去：不能把选中这块存成文件，菜单里只有复制到剪贴板；当选中的本身是一张图片时，更拿不回原文件——只能得到一张从画布重新渲染的 PNG，原字节、原格式（`.jpg`、`.svg`、`.webp`）丢了。

## 2. 决定

- **入口是共用的右键菜单**（`Overlays.ContextMenu`），不加新的工具条按钮、不加快捷键：菜单里已经有 "Copy as PNG"，新的 "Save as PNG" 挨着它；图片元素再多两项（"Copy original image" / "Save original image"，措辞学浏览器图片菜单）。画布、幻灯片、动效共用这一个菜单和同一个 runtime 导出协议（stage 框架都登记在 `frames` 里，`dc:'export'` 按 `tid` 取一个元素），所以三个类型一次到位。文档、看板、设计系统没有元素选择，不涉及。
- **Save as PNG 就是复制走的那条路**：`exportPng(file, 2, tid)` 沙箱里 html-to-image 画 @2x，经 `saveImage` 下载（名字沿用 `板名-tid@2x.png` 的老规矩）。不加 @1x/@2x 的选择，一份默认，要改倍率是后续的事。
- **原图从 `src` 拿，不走渲染**：`<img>` 的 `src` 是空的或带 `{{` 洞时不算原图，不给这两项；相对路径（`uploads/pic.png`）用 `api.rawBase(project)` 拼出服务端的 raw 地址取字节，绝对地址和 data URL 原样取。保存用原文件名（路径的最后一段）和原扩展名，字节一个不动。
- **剪贴板只保证 PNG，其余尽力**：`ClipboardItem` 各浏览器只必收 `image/png`。"复制图片" 先按原格式写，浏览器不收就把原字节解码后重编为 PNG（像素一致，只是格式换了），再不行落回 "下载代替复制" 的老路（`copyFallback`）。保存则永远是原文件。
- **多选没有做**：选择模型只有一个元素（`Selection.kind:'el'` 单 `tid`），成组的导出要联合边界和一棵多元素的画面，留待选择模型支持多选时再说（[#421](https://github.com/tingly-dev/tingly-design/issues/421) 的 open question）。

## 3. 边界

- 原图只在编辑器的页面上取（不受沙箱 CSP 限制），`uploads/` 的文件服务端带 CORS 头；外网图片同样尽力取，取不到就报错提示，不渲染替代。
- 导出元素时沙箱里已经会挑出加载失败的 `<img>` 并报是哪张（export-image.md §3），这条路照旧。

## 4. 还开着的

- 多选联合导出（上面 §2）。
- 文件名用元素自己的（alt / 标题）代替 `板名-tid`。
