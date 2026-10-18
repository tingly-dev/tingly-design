# 画布检查器

状态：核心函数和 `tingly-design check` 已实施；编辑器里的提示是方案。

## 问题

`dc-canvas` 技能里有一批"写错了不报错"的规则：根元素尺寸和 `canvas.json` 的 `w`/`h` 不一致、整块画成一个 `<svg>`、`order` 和 `boards` 对不上、属性没加引号、标签没闭合。幻灯片有 `checkSlide`，动效有 `checkScene`，画布没有，只能等有人在编辑器里打开才发现。编辑器之外的 agent（云端的 Claude Code、别的仓库的会话）写完画布没有办法自己确认（issue #125 的第一步）。

## 决定

- **纯文本进、数据出。** `checkCanvas({ canvas, boards })` 吃 `canvas.json` 的文本和每个画板的源码，不依赖 DOM、浏览器、编辑器或文件系统，所以命令行、服务端、测试和编辑器都能调。读文件是调用方的事。
- **不用 `parseDc`。** 幻灯片的检查器建在 `parseDc` 的树上，那棵树面向可写回的编辑。画布的规则大多是"文件有没有写坏"，坏的文件正是解析最不可靠的时候，所以这里只做一遍轻量的标签扫描（跳过注释和 `<script>` / `<style>` 正文，属性里的 `>` 不算标签结束），不修复、不推断。
- **核心不带措辞。** 返回 `{ file, line, rule, level, params }`：`rule` 是规则 id，`params` 是措辞要用的值（文件名、实际尺寸）。命令行和编辑器各自用 i18n 词条说话。这和 `AgentStep.op` 的做法一致。
- **只报技能里写明的规则**，不加风格意见（对比度、占位符等）。`error` 是编辑器里一定会出问题的，`warning` 是不一定（有画板文件但没登记、`order` 漏了某个画板，解析时会自动补上）。
- **`expand: "fill"` 的画板不比尺寸**：它本来就跟着画布铺满。

## 规则

`canvas-json`、`board-file-missing`、`board-unlisted`、`order-unknown`、`order-missing`、`order-duplicate`、`no-x-dc`、`no-support-script`、`root-missing`、`root-size-missing`、`root-size`、`preview-size`、`whole-svg`、`unquoted-attr`、`unclosed-tag`、`stray-close`。

`whole-svg` 的判断：根元素下只有一个 `<svg>`，或者有一个 `<svg>` 的宽高都达到画板的 90%。画板里一个个小的箭头 `<svg>` 是允许的。

`root-size` 是错误：根元素的宽高和 `canvas.json` 里这块板子的 `w`×`h` 不一样，画出来的就不是登记的尺寸。`preview-size` 是警告：`data-props` 的 `$preview` 和根元素不一样，别的文件嵌入这块板子时会按 `$preview` 画，尺寸就错了；它不影响这块板子自己，所以不算错误。三处（根元素、`canvas.json`、`$preview`）要一起改，skill 里写明了。

## 接入

`checkProject('design', …)` 调 `checkCanvas`，结果变成 `code: 'canvas'` 加 `rule` 和 `params`，措辞在 `cli` 区的 `canvasRules`（见 [cli.md](./cli.md)）。画板没登记、登记了但文件不在这两条由 `checkProject` 自己的列表检查负责，不重复报。

## 没定的

- 是否在编辑器里显示（画板列表的角标）；要显示就走 i18n。
- 要不要再覆盖 `{{}}` 只能是点路径、`<dc-import>` 缺 `hint-*`、模板洞里写了表达式这类规则；需要的话要对模板做真正的解析。
