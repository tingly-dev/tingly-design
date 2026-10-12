# Tingly Design 上手手册

这份手册写给刚加入的同事：第一天装好环境、跑起编辑器，第一周能独立改一个功能。

## 它是什么

Tingly Design 是一个**人和 AI 同时编辑**的设计工具。画布、幻灯片、设计系统、看板和文档都存成 `projects/` 下的普通文件：人在界面上改，快速 AI 逐行改，Claude Code 直接改文件，三方改的是同一份源码。

> 每次改动只回写真正变了的那几个字符。所以这些文件可以放进 git，diff 也读得懂。

## 五种项目

| 类型 | 索引文件 | 内容 |
| --- | --- | --- |
| 画布 | `canvas.json` | 每个画板一个 `.dc.html` |
| 幻灯片 | `deck.json` | 每页一个 `slides/<id>.html` |
| 设计系统 | `design-system.json` | `tokens.json`、组件、资源 |
| 看板 | `dash.json` | 数据集、`files/index.html`、`data/` |
| 文档 | `doc.json` | 每个标签页一个 `tabs/<id>.md` |

## 第一天

- [ ] 装好 Node 22 和 pnpm 10
- [ ] 克隆仓库，运行 `pnpm install`
- [ ] 运行 `pnpm dev`，打开 http://localhost:5173
- [ ] 打开每种演示项目看一遍
- [ ] 读一遍 `README.md` 的“工作原理”
