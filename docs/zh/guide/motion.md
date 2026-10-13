<p align="right"><a href="../../en/guide/motion.md">English</a> · <b>简体中文</b></p>

# 动效

新建项目时类型选“动效”。示例 [`?p=design-motion`](http://localhost:5173/?p=design-motion) 是 36 秒的 Tingly Design 宣传片，同一套场景出 16:9 和 9:16，带独立封面。

![动效编辑器：舞台上是封面，下面是时间轴和场景条，顶栏切换尺寸和速度](../../images/motion.png)

```
projects/<name>/
  motion.json          标题、尺寸 formats、帧率 fps、速度 speed、场景顺序 order、封面 cover
  scenes/<id>.html     每个场景一个文件：正好一个 <section id="<id>">，和幻灯片相同的封闭子集
  renders/             导出的视频（不进 git）
```

- **舞台和播放器**：暂停时，舞台显示播放头所在的场景在这一刻的样子，可以像幻灯片一样直接改。空格播放：播放器接过去，连同转场播完整条时间线；暂停后舞台回来，停在刚才的位置。← / → 逐帧，按住 Shift 每次一秒。时间轴下的场景条按时长等比画出，点一个场景就跳到它的元素都已到位的时刻。打开时停在封面，也就是视频缩略图会显示的样子。
- **在舞台上改**：单击选中，双击改字，拖手柄改尺寸（Shift 保持比例，Alt 从中心缩放，边缘会吸附到其他元素）。右侧面板：选中元素时是它的样式；选中场景时是场景时长、转场和背景；什么都没选时是作品的尺寸。播放头这一刻不在画面上的元素点不到，可以从图层里选，图层会标出它们何时入场。选中的元素显示它落定的位置，而不是入场到一半。撤销和其他类型一样。
- **尺寸**：`motion.json` 里的每种尺寸都用同一套场景播放，在顶栏切换，在面板里添加、改尺寸或删除（横版 16:9、竖版 9:16、方形、竖图 4:5，或自定义）。看着第一种尺寸时的改动对所有尺寸生效；在别的尺寸里改，会写成这个尺寸的覆盖（`data-tall="…"`），面板会写明改到哪里。点覆盖标签可以退回共用的值。
- **速度**：时间按阅读节奏来写，`motion.json` 的 `speed` 决定视频播多快。速度菜单可以试别的节奏，不改任何文件。
- **检查**：列出时间上的问题，比如退场早于入场、文字停留不到 0.8 秒、导不出的嵌入。
- **AI**：底部输入框针对播放头所在的场景，或选中的元素。小改动选快速 AI，马上落在舞台上；大改动选 Claude Code，它会知道你看的是哪个场景、哪一刻、哪种尺寸。
- **导出**：`pnpm --filter @dc/sandbox build && node scripts/motion-render.mjs <name> [--format wide] [--gif] [--player]` 把 MP4、封面 PNG、GIF 和单文件 HTML 播放器写进 `renders/`，需要 Chromium 和 ffmpeg。

时间写在元素上：`<section>` 上的 `data-duration`、`data-transition`，以及里面任意元素的 `data-in` / `data-out` 预设（`rise`、`drop`、`type`、`count`…）和 `data-keys` 关键帧。

格式说明：[`.claude/skills/motion/SKILL.md`](../../../.claude/skills/motion/SKILL.md) · 设计方案：[`.design/motion.md`](../../../.design/motion.md)

---

返回 [README](../../../README.zh-CN.md)
