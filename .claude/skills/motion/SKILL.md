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

- `formats`: the first is the primary one. Names are lower-case letters and digits.
- `speed` (0.25 to 4, default 1) plays all timing faster or slower. Write timing at reading pace and change `speed` to change the pace; never retime every attribute.
- `order`: the scenes, in play order. Adding a scene means writing its file and adding its id here.
- `cover`: the still that stands for the video (thumbnail, first frame, the player before play): a time such as `"2.2s"`, or the id of a scene file that is **not** in `order`, designed to be read standing still, usually with no timing attributes.

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

The editor lists problems it finds: an exit before the entry, text on screen under 0.8 s, an `<x-embed>` without `data-seek` (it cannot be exported).

## Pictures and files people brought in

Files people brought in (attachments, imported pictures) live under `uploads/`. A scene shows one by its path from the folder, `<img src="uploads/…">` or `url(uploads/…)`; the editor, the player and the renderer all resolve it. Don't move or rename them.

## Several formats

Scenes are shared by all formats; elements that need a different layout carry overrides named after the format:

- `data-tall="flex-direction:column;font-size:64px"` — declarations merged over `style` in the `tall` format.
- `data-keys-tall`, `data-in-tall`, … — any timing attribute for one format.
- `data-only="wide"` — the element exists only in the formats named.

## Rendering

`pnpm --filter @dc/sandbox build && node scripts/motion-render.mjs <name> [--format wide] [--speed 2] [--gif] [--player] [--verify]` writes MP4s (and the cover PNG, a GIF, a single-file HTML player) to `projects/<name>/renders/`. It needs Chromium and ffmpeg.
