<p align="right"><a href="../../en/guide/motion.md">English</a> · <b>简体中文</b></p>

# 动效

新建项目时类型选“动效”。示例 [`?p=design-motion`](http://localhost:5173/?p=design-motion) 是 36 秒的 Tingly Design 宣传片，同一套场景出 16:9 和 9:16，带独立封面。

![动效播放器：舞台上是封面，下面是时间轴和场景条，顶栏切换尺寸和速度](../../images/motion.png)

```
projects/<name>/
  motion.json          标题、尺寸 formats、帧率 fps、速度 speed、场景顺序 order、封面 cover
  scenes/<id>.html     每个场景一个文件：正好一个 <section id="<id>">，和幻灯片相同的封闭子集
  renders/             导出的视频（不进 git）
```

- **播放器**：打开时停在封面，也就是视频缩略图会显示的样子。空格播放/暂停；← / → 逐帧，按住 Shift 每次一秒。时间轴下的场景条按时长等比画出，点一个场景就跳过去。
- **尺寸**：`motion.json` 里的每种尺寸都用同一套场景播放，在顶栏切换。需要不同排版的元素带 `data-tall="…"` 这样的覆盖。
- **速度**：时间按阅读节奏来写，`motion.json` 的 `speed` 决定视频播多快。速度菜单可以试别的节奏，不改任何文件。
- **检查**：列出时间上的问题，比如退场早于入场、文字停留不到 0.8 秒、导不出的嵌入。
- **编辑**：在底部输入框交给 Claude Code，它会拿到播放头所在的场景。文件在磁盘上改好，播放器原地刷新。
- **导出**：`pnpm --filter @dc/sandbox build && node scripts/motion-render.mjs <name> [--format wide] [--gif] [--player]` 把 MP4、封面 PNG、GIF 和单文件 HTML 播放器写进 `renders/`，需要 Chromium 和 ffmpeg。

时间写在元素上：`<section>` 上的 `data-duration`、`data-transition`，以及里面任意元素的 `data-in` / `data-out` 预设（`rise`、`drop`、`type`、`count`…）和 `data-keys` 关键帧。

格式说明：[`.claude/skills/motion/SKILL.md`](../../../.claude/skills/motion/SKILL.md) · 设计方案：[`.design/motion.md`](../../../.design/motion.md)

---

返回 [README](../../../README.zh-CN.md)
