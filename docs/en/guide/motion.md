<p align="right"><b>English</b> · <a href="../../zh/guide/motion.md">简体中文</a></p>

# Motion

Choose "动效" (motion) when creating a project. The sample [`?p=design-motion`](http://localhost:5173/?p=design-motion) is a 36 s promo for Tingly Design in 16:9 and 9:16 from the same scenes, with its own cover.

![Motion editor: the cover on the stage, the timeline and scene strip below, formats and speed in the top bar](../../images/motion.png)

```
projects/<name>/
  motion.json          title, formats and their sizes, fps, speed, scene order, cover
  scenes/<id>.html     one file per scene: exactly one <section id="<id>">, the same closed subset as a slide
  renders/             exported videos (not tracked)
```

- **Stage and player**: while paused, the stage shows the scene under the playhead at that moment and you edit it like a slide. Space plays: the player takes over and runs the whole timeline, transitions included; pause and the stage comes back where it stopped. ← / → step one frame, with Shift one second. The ruler and the scene strip below the stage share one time axis: each scene's block starts where the scene starts and runs until the next one takes over, and the playhead runs through both. Click or drag along the ruler to scrub; click a scene to jump to its start, double-click to jump to its end. To change a scene's length, drag the right edge of its block (0.1 s steps, Esc cancels), type it in the length field above the timeline, or use the panel. On a scene's first moment the stage draws every element where it lands, so the scene reads as a page to edit (the label under the timeline says 落定); step one frame on to see the real frame. The cover is optional and sits before 0 s, in its own slot at the left of the timeline: click it to edit it (it is what a thumbnail of the video shows, and the first frame of the exported file), click “+ Cover” to add one, or × to go back to using the first frame. It opens on the cover when there is one.
- **Editing on the stage**: click to select, double-click to retype, drag a handle to resize (Shift keeps the ratio, Alt resizes from the centre, edges snap to other elements). The panel on the right has the element's styles, the scene's length, transition and background when the scene is selected, and the piece's sizes when nothing is. Elements not on screen at the playhead can't be clicked; pick them from the layers, which say when they come in and have the same hide and lock as the canvas (hidden elements are left out of the player and the render too). A selected element is shown where it lands, not half way through its entrance. Undo works as everywhere else.
- **Sizes**: every size in `motion.json` plays from the same scenes; switch between them in the top bar, and add, resize or remove them in the panel (横版 16:9, 竖版 9:16, 方形, 竖图 4:5 or your own). Edits made while looking at the first size change every size; in another size they are written as that size's override (`data-tall="…"`), and the panel says which. Click an override chip to go back to the shared value.
- **Importing pictures**: drop, paste or use the import button to put pictures and SVGs on the scene under the playhead. They fade in from the playhead (from the start on a scene's landed first moment) and are kept in `uploads/`.
- **Speed**: timing is written at reading pace and `speed` in `motion.json` sets how fast the video plays. The speed menu tries another pace without touching any file.
- **Check**: lists timing problems such as an exit before the entry, text on screen for less than 0.8 s, or an embed that cannot be exported.
- **AI**: the box at the bottom works on the scene under the playhead, or the selected element. Pick the fast AI for a small change, which lands on the stage at once, or Claude Code for a larger one; Claude Code is told which scene, moment and size you are looking at.
- **Export**: the “Export video” button in the top bar saves the size you are looking at as a video. It is made in this tab, with nothing to install: MP4 where the browser can write H.264 and AAC (Chrome, Edge, Safari), otherwise WebM, and the message says which and why. Keep the tab in front until it finishes; the button turns into the progress and a cancel. Fonts and audio files come along. A piece with an embed (`<x-embed>`) or a video layer is drawn by the Chrome or Edge on the machine running the server instead (it needs ffmpeg too), and the message says so; the browser cannot draw those. When the machine has neither, the scenes come out blank and the message names them. For a GIF, the cover PNG or a single-file player, use the command line: `pnpm --filter @dc/sandbox build && node scripts/motion-render.mjs <name> [--format wide] [--gif] [--player]` writes MP4s, the cover PNG, a GIF and a single-file HTML player to `renders/`. That needs Chromium and ffmpeg.

Timing lives on the elements: `data-duration` and `data-transition` on the `<section>`, `data-in` / `data-out` presets (`rise`, `drop`, `type`, `count`…) and `data-keys` keyframe tracks on anything inside.

Format reference: [`.claude/skills/motion/SKILL.md`](../../../.claude/skills/motion/SKILL.md) · Design notes: [`.design/motion.md`](../../../.design/motion.md)

---

Back to the [README](../../../README.md)
