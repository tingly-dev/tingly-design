---
name: motion
description: Read before creating or editing a motion piece (an animated video) under projects/ (motion.json and scenes/<id>.html) — the file layout, the timing attributes, per-format overrides, speed and the cover.
---

# Motion pieces

A motion piece is a folder under `projects/<name>/`:

- `motion.json` — title, formats and their sizes, fps, speed, scene order and cover.
- `scenes/<id>.html` — one file per scene: exactly one `<section id="<id>" …>`, written in the same closed HTML/CSS subset as a slide (see `.claude/skills/slides/SKILL.md`), sized to the format instead of a fixed 1920×1080.

The editor (`pnpm dev`, http://localhost:5173/?p=<name>) plays the piece and reloads within a second of a change. People may edit these files too, so **read a file right before you change it** and change only what was asked. `projects/design-motion` is a full example (a 36 s promo in 16:9 and 9:16 with a cover). The design notes are in `.design/motion.md`.

## motion.json

```json
{
  "v": 1,
  "title": "Tingly Design",
  "formats": { "wide": { "size": [1920, 1080] }, "tall": { "size": [1080, 1920] } },
  "fps": 30,
  "speed": 1.5,
  "order": ["idea", "edit", "outro"],
  "cover": "poster",
  "faces": { "inter": { "family": "Inter", "href": "https://fonts.googleapis.com/css2?family=Inter:wght@400;800&display=swap" } }
}
```

- `formats`: the first is the primary one. Names are lower-case letters and digits. A new piece is made in the size its owner picked (`wide` 1920×1080, `tall` 1080×1920, `square` 1080×1080, `portrait` 1080×1350, `upright` 1080×1440, `classic` 1440×1080, or `s<w>x<h>` for a custom one); the starter scene is laid out for it, so don't assume 16:9.
- `speed` (0.25 to 4, default 1) plays all timing faster or slower. Write timing at reading pace and change `speed` to change the pace; never retime every attribute.
- `order`: the scenes, in play order. Adding a scene means writing its file and adding its id here.
- `note` (optional): a note on the whole piece, plain text up to 4000 characters, written by the person (what it is for, who watches it, the tone). Read it before you edit; never draw it, keep it unless asked to change it, and write it only when asked.
- `cover` (optional): the still that stands for the video (thumbnail, first frame, the player before play): the id of a scene file that is **not** in `order`, designed to be read standing still, usually with no timing attributes. The editor shows it as its own clip before 0 s on the timeline. Leave `cover` out for none, and the video's first frame stands in. A time such as `"2.2s"` (a frame of the video) is still read in older files, but don't write one.

## Timing attributes

On the `<section>`:

- `data-duration="4s"` — how long the scene lasts (default 4 s).
- `data-transition="fade 500ms"` — how the **next** scene comes in: `cut` (default), `fade`, `push`, `magic` (falls back to fade for now).

On any element:

- `data-in="<preset> [duration] [@start] [easing]"` — how it enters, e.g. `rise 600ms @0.4s ease-out`. Without `@start`, entrances are staggered in source order from 0.2 s, 0.15 s apart.
- `data-out="<preset> [duration] [@start]"` — how it leaves; without `@start`, at the end of the scene.
- Presets: `fade rise drop left right scale pop zoom slam spin blur wipe type count`. `type` reveals text left to right in steps; `count` counts a number up (keeps grouping, decimals and units).
- `data-keys="x: 0@0 120@2s ease-in-out; scale: 1@2s 1.2@3s"` — keyframe tracks on `x`, `y` (px), `scale`, `rotate` (deg) and `opacity`; the easing after a key eases the segment arriving at it; `steps(1)` makes a jump.
- Times are `500ms`, `0.5s` or `2` (seconds), measured from the start of the scene.

A scene's note is one `<aside>`, the section's last child, plain text up to 4000 characters, the same as speaker notes in a slide (see the slides skill). It is the person's note on that scene: the editor never draws or renders it, so it is safe to keep, and you read it as context, not as extra tasks.

`data-hide` hides an element for the whole scene (in every format, the player and the render too) and `data-lock` stops it being picked or moved on the stage; they are the layers panel's eye and lock, set by hand or by the editor. Keep them.

The editor lists problems it finds: an exit before the entry, text on screen under 0.8 s, an `<x-embed>` without `data-seek` (it cannot be exported).

## Artboards imported from a canvas (effects)

A person can import an artboard of a canvas project into a piece (import menu → From a project). The server copies it, with its sibling artboards and pictures, to `uploads/<canvas>-<board>/` and records it in `motion.json` `imports` (`{path, from, board, copiedAt}`); the editor puts it on the scene under the playhead:

```html
<x-embed src="uploads/box-console-Glow/Glow.dc.html" data-seek data-props='{"accent":"#e8590c"}' style="position:absolute;left:0px;top:0px;width:1920px;height:1080px"></x-embed>
```

- An artboard that declares `"$time"` is an effect: the player hands it the scene's time on every frame (`data-seek`), so it is drawn frame by frame and renders exactly. Keep `data-seek` on every such embed. A moving one usually fills the frame as the scene's first child, so the scene paints over it; it takes `data-in`/`data-out`/`data-keys` like any element.
- `data-props` sets the artboard's tweaks; leave a key out for its default. Change the look through `data-props`, never by editing the copy under `uploads/` (importing again overwrites it). Reuse it in another scene with the same `src`; don't point `src` anywhere else.

## Pictures and files people brought in

Files people brought in (attachments, imported pictures) live under `uploads/`. A scene shows one by its path from the folder, `<img src="uploads/…">` or `url(uploads/…)`; the editor, the player and the renderer all resolve it. Don't move or rename them.

## Shader effects

For light, noise, grain or glow that CSS cannot draw, put a GLSL ES 3.0 fragment shader in a seekable embed (see `projects/motion-effects/` and copy its runtime script as is):

```html
<x-embed data-seek style="position:absolute;left:0;top:0;width:100%;height:100%">
  <canvas data-quality="0.5"></canvas>
  <script type="x-shader/x-fragment">/* uniforms: float time (s), float aspect; in vec2 uv (top-left origin) */</script>
  <script>/* the WebGL2 runtime from the sample */</script>
</x-embed>
```

- The frame must depend only on `time` and `aspect`: no clock, no animation loop, no randomness.
- Output premultiplied alpha; `a = 1` for a background, less for a layer between elements (its DOM position is its place in the stack).
- Work in units of the short side, `(uv - c) * vec2(aspect, 1) / min(aspect, 1)`, so one shader serves wide and tall. When the light wraps an element, give the element the same numbers in both formats.
- `data-quality="0.5"` for soft fields, `1` for anything with a sharp edge.
- Avoid the `fract(sin(x) * 43758.5)` hash where the picture must match across machines; use an integer hash.
- Give the light a job (an edge glow around a card that is "working"), keep it to a few brand colours on near-black, move it slower than the text, and fade it in with the element it frames. See `.design/motion-effects.md`.

## Several formats

Scenes are shared by all formats; elements that need a different layout carry overrides named after the format:

- `data-tall="flex-direction:column;font-size:64px"` — declarations merged over `style` in the `tall` format.
- `data-keys-tall`, `data-in-tall`, … — any timing attribute for one format.
- `data-only="wide"` — the element exists only in the formats named.

## Rendering

`pnpm --filter @dc/sandbox build && node scripts/motion-render.mjs <name> [--format wide] [--speed 2] [--gif] [--player] [--verify]` writes MP4s (and the cover PNG, a GIF, a single-file HTML player) to `projects/<name>/renders/`. It needs Chromium and ffmpeg.
