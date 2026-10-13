<p align="right"><b>English</b> · <a href="../../zh/guide/motion.md">简体中文</a></p>

# Motion

Choose "动效" (motion) when creating a project. The sample [`?p=design-motion`](http://localhost:5173/?p=design-motion) is a 36 s promo for Tingly Design in 16:9 and 9:16 from the same scenes, with its own cover.

![Motion player: the cover on the stage, the timeline and scene strip below, formats and speed in the top bar](../../images/motion.png)

```
projects/<name>/
  motion.json          title, formats and their sizes, fps, speed, scene order, cover
  scenes/<id>.html     one file per scene: exactly one <section id="<id>">, the same closed subset as a slide
  renders/             exported videos (not tracked)
```

- **Player**: opens on the cover, so you see what a thumbnail of the video will show. Space plays and pauses; ← / → step one frame, with Shift one second. The scene strip below the timeline is drawn to scale; click a scene to jump to it.
- **Formats**: every format in `motion.json` plays from the same scenes; switch between them in the top bar. Elements that need a different layout carry overrides such as `data-tall="…"`.
- **Speed**: timing is written at reading pace and `speed` in `motion.json` sets how fast the video plays. The speed menu tries another pace without touching any file.
- **Check**: lists timing problems such as an exit before the entry, text on screen for less than 0.8 s, or an embed that cannot be exported.
- **Editing**: hand a change to Claude Code from the box at the bottom; it gets the scene under the playhead. Files change on disk and the player reloads in place.
- **Export**: `pnpm --filter @dc/sandbox build && node scripts/motion-render.mjs <name> [--format wide] [--gif] [--player]` writes MP4s, the cover PNG, a GIF and a single-file HTML player to `renders/`. It needs Chromium and ffmpeg.

Timing lives on the elements: `data-duration` and `data-transition` on the `<section>`, `data-in` / `data-out` presets (`rise`, `drop`, `type`, `count`…) and `data-keys` keyframe tracks on anything inside.

Format reference: [`.claude/skills/motion/SKILL.md`](../../../.claude/skills/motion/SKILL.md) · Design notes: [`.design/motion.md`](../../../.design/motion.md)

---

Back to the [README](../../../README.md)
