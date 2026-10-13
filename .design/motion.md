# Motion: a sixth project kind for promo videos and animated assets

Status: **research; phase 0 spike done** (§11). This note looks at whether Tingly Design should have a "motion" kind (short animated videos such as a product launch or a feature explainer, and animated assets such as a title card, a looping hero or a UI animation), how it differs from slides, what comparable tools do, which source format fits our two-way editing, how export and AI would work, and what it would cost. It ends with a recommendation and a phased plan.

Decisions from the owner so far (§10): both promo videos and animated assets are in scope; render on the server first, in the browser if it can be done; several sizes of the same piece live in one project.

Facts about this repository are from `5efd911`. Facts about other tools come from their public docs and READMEs as of October 2026, linked in §3; anything inferred rather than read is marked as such.

## 1. What people mean by "motion"

"Motion" covers three different deliverables. They share a timeline but almost nothing else:

| | Promo / explainer video | Animated asset and UI motion | Interactive (stateful) UI motion |
|---|---|---|---|
| Example | "Tingly Box in 30 seconds", a release video, a feature walkthrough for social | An animated title card, a looping hero for a website, a chart that builds, a logo sting, a loading or success animation, an onboarding illustration | A button with hover and pressed states, an onboarding illustration that reacts |
| Length | 15 to 90 s, several scenes | 2 to 10 s, one scene, often looping | No fixed length; driven by state |
| Audio | Usually music, often a voiceover and captions | Rarely | No |
| Delivered as | MP4 (16:9, 9:16, 1:1) | Lottie / dotLottie, WebM with alpha, animated SVG, GIF, MP4, or embedded in a page or deck | Rive, Lottie with state machines, code |
| Typical tools | After Effects, Canva, Jitter, Remotion, HyperFrames | Jitter, Figma Motion, Lottie Creator | Rive, Lottie Creator |

The first two columns are in scope. They share one format: an animated asset is a one-scene piece that loops, and what differs is mainly the export (Lottie and transparent video rather than MP4). The third column is a different product (a state machine plus a runtime in someone else's app) and stays out of scope; a linear or looping UI animation belongs to the second column.

## 2. How motion differs from slides

A motion piece looks like "a deck that plays itself", and scenes really are close to slides: a fixed-size canvas, a few large elements, a design system. That overlap is why it fits this repository. The differences are what make it a separate kind rather than a slides option:

| | Slides | Motion |
|---|---|---|
| Primary axis | Order. The viewer advances with a click. | Time. Every element has a start, a duration and an easing, measured in seconds or frames. |
| Who sets the pace | The presenter | The author, once, for every viewer |
| Where it is consumed | Presented live, or read as a PDF | A file played somewhere else: social feeds, a landing page, a launch post, inside another video |
| Density | Readable text, tables, notes | Little text, large type, one idea per beat; text on screen for 1 to 3 s |
| Animation | Decoration: builds and transitions, "Present only" in the original format | The content itself: kinetic type, camera moves, morphs, numbers counting up |
| Sound | None | Music, voiceover, captions, cuts on the beat |
| Canvas | 1920×1080 | 1920×1080, 1080×1920, 1080×1080, 1080×1350, plus fps |
| "Done" means | The deck file | A rendered video, and still being able to change one word and render again |
| Rendering | What the browser shows now | Every frame must be reproducible: seek to t, get the same pixels |

Two consequences shape the rest of this note:

1. **Determinism is a format requirement, not an export detail.** A slide's `<x-embed>` can run any animation loop because the browser just shows it. A video renderer seeks to frame *n* and captures it, so every moving thing must be a function of the playhead. Free-running `requestAnimationFrame`, `setTimeout`, `Date.now()` and `Math.random()` break export. Claude Design's own exporter has the same rule (see §3.1).
2. **The editor needs a timeline**, and the timeline must write back to source the same way the properties panel does today. Whatever format we pick has to keep timing where both a person dragging a bar and a model writing jQuery can change it with a one-attribute patch.

## 3. What the market does

### 3.1 AI design tools

**Claude Design** makes animations today. From public walkthroughs: the output is HTML, CSS and JavaScript; the editor shows a timeline split into named chapters ("Opening", "Context"…) that you can refer to in chat; edits go through chat or by commenting on an element; creators export 1080p video and finish it in Premiere or Resolve. Anthropic's help page lists ZIP, PDF, PPTX, Canva, HTML and Claude Code handoff, not video, so video export may be newer than the docs or limited. The open-source [claude-video-export](https://github.com/dawoodtrumboo/claude-video-export) project shows the underlying model: projects built on an `animations.jsx` `<Stage>` starter, where every change derives from `useTime()` or `<Sprite start end>` windows, and the exporter seeks headless Chromium frame by frame. It explicitly rejects CSS `@keyframes`, GSAP, Lottie, `<video>` and wall-clock timers. So Claude Design treats motion as a React program over time, not as a separate artifact type with its own file format. *Inferred:* the timeline is a view of that program, not an editor of it.

Sources: [whytryai](https://www.whytryai.com/p/claude-design-animations), [Kevin Stratvert](https://kevinstratvert.com/2026/08/10/how-to-create-motion-graphics-with-claude-ai/), [João Queirós](https://www.ai.joaoqueiros.com/blog/claude-design-motion-graphics-transcript-synced-animation-workflow).

**Open Design** (nexu-io, Apache-2.0, ~100k stars) has `video` and `hyperframes` modes, eleven HyperFrames templates (a 30 s SaaS promo, a karaoke talking head, a bar-chart race, a logo outro, website-to-video), MP4 among its exports, and routes to generative video and music models (Seedance, Veo, Sora, Kling, Suno, Lyria). Its `motion-frames` template is a looping CSS hero "rendered as a hero video poster" through HyperFrames. So Open Design does not have its own motion format either: it delegates to HyperFrames for authored motion and to generative models for footage. Source: [README](https://github.com/nexu-io/open-design), [motion-frames](https://open-design.ai/templates/motion-frames/).

### 3.2 Code-first video frameworks

| | Source | How time works | Editor | Render | License |
|---|---|---|---|---|---|
| **[HyperFrames](https://github.com/heygen-com/hyperframes)** (HeyGen, 2026) | One HTML file per composition. Clips carry `data-start`, `data-duration`, `data-track-index`; the root carries `data-composition-id`, `data-width`, `data-height` | Any seekable animation: GSAP timelines registered on `window.__timelines`, CSS, WAAPI, Lottie, Three.js, Anime.js or a custom adapter | `preview` with live reload; a browser Studio "available, evolving" | Puppeteer seeks each frame, FFmpeg encodes, audio mixing; AWS Lambda for distributed renders. Node ≥ 22 | Apache-2.0 |
| **[Remotion](https://www.remotion.dev)** | React components | A pure function of `useCurrentFrame()` | Studio (props, timeline view) | Headless Chromium + FFmpeg, Lambda | Source-available; companies need a paid license (free for individuals and very small teams) |
| **[Motion Canvas](https://motioncanvas.io) / Revideo** | TypeScript generators drawing on one `<canvas>` | Imperative: `yield* circle().x(300, 1)` adds steps to the timeline | Editor with time events and audio sync | In the browser (canvas only) | MIT |

HyperFrames is the closest thing to what we would build. It is HTML-first, aimed at agents (21 installable skills such as `/product-launch-video`, `/pr-to-video`, `/embedded-captions`, plus a one-way Remotion importer), deterministic, and permissively licensed. Its weakness, from our point of view, is that timing for anything beyond a clip's start and duration lives in a GSAP script, which a person cannot edit by dragging and which our write-back engine cannot patch.

### 3.3 Design-first motion tools

| Tool | What it is good at | AI | Exports |
|---|---|---|---|
| **Jitter** | Fast UI and social motion, Figma import with editable layers | AI keyframe generation | MP4, GIF, WebM, Lottie, ProRes |
| **Figma Motion** (beta, June 2026) | Animating on the canvas where the design already is | None listed | MP4, GIF, WebM, animated SVG; Lottie via plugin |
| **Lottie Creator** | Lottie authoring and interactive state machines | Motion Copilot: text to editable keyframes | dotLottie, Lottie JSON, SVG, GIF, MP4, MOV, WebM |
| **Rive** | Interactive, stateful UI components | A coding agent | `.riv` plus a runtime per platform |
| **Cavalry** (Canva, free for individuals since 2.7) | Procedural, data-driven motion | None listed | MP4, GIF, Lottie |
| **After Effects** | Broadcast compositing | Firefly next to it | Everything; Lottie via Bodymovin |

Source: [LottieFiles' 2026 tool guide](https://lottiefiles.com/blog/design-guides-and-tips/best-motion-design-tools-ranked-by-use-case).

### 3.4 Generative video

Runway, Veo, Sora, Kling and Seedance produce footage from prompts. They are good for b-roll and mood, and poor at exact brand type, exact numbers and a one-word change. They are complements, not competitors: a motion project could place a generated clip as a `<video>` layer, the way Open Design pairs them.

### 3.5 What this tells us

- Every AI-native tool converged on **HTML in a headless browser, seeked frame by frame, piped to FFmpeg**. That pipeline is settled; we should reuse it, not invent one.
- Nobody has **two-way editing of timing**. Claude Design and HyperFrames keep timing in code; Jitter and Figma keep it in a proprietary document the AI barely touches. A format where the timeline bar, the properties panel, fast AI and Claude Code all edit the same attribute is the gap Tingly Design is built to fill, and it is the reason to build this rather than tell people to use HyperFrames.
- **Lottie is an export, never a source** anywhere AI is involved. Its JSON is unreadable for people and unreliable for models.

## 4. Candidate source formats

The criteria come from how this repository already works (`docs/en/architecture.md`): plain files a person can write by hand; every on-screen operation maps to one place in the source; minimal write-back so the git diff is the change; fast AI edits by jQuery statements; Claude Code edits whole files; and, new for motion, every frame is reproducible.

| | A. HTML + CSS `@keyframes` | B. HTML + GSAP script (HyperFrames style) | C. React over time (Claude Design `<Stage>`, Remotion) | D. Timeline JSON (Lottie-like scene graph) | E. HTML + declarative timing attributes |
|---|---|---|---|---|---|
| Example | `<style>@keyframes rise{…}</style>` and `animation: rise .6s .4s both` | `tl.from('#title', {y: 40, opacity: 0, duration: .6}, 0.4)` | `<Sprite start={0.4} end={3}>` and `opacity = interp(t, …)` | `{"layers":[{"id":"title","ks":{"o":[[0,0],[0.4,100]]}}]}` | `<h1 data-in="rise 600ms @0.4s">` |
| Hand-writable | Good | Good | Good for developers | Poor | Good |
| Models write it well | Good | Very good (GSAP is everywhere in training data) | Good | Poor | Good once the vocabulary is in the skill |
| Timeline drag writes back | Hard: timing split between a rule and a declaration | No: it would mean patching JS | No | Yes | Yes: one attribute |
| Fits our parser and write-back | Partly; `<style>` is outside the slides subset | Only the markup half | No (our canvas is template + `DCLogic`, not JSX) | No (new engine) | Yes, same as `data-build-in` today |
| Deterministic seek | Yes, through the Web Animations API (`getAnimations()`, `currentTime`) | Yes (`tl.seek`) | Yes | Yes | Yes (compiled to WAAPI) |
| Expressiveness | Medium | High | High | High | Medium; escape hatch needed |
| Reuses slides | Little | Little | No | No | Most: subset, checker, shapes, design system, magic move, builds |

**E is the only one where all three editors meet on the same characters.** It is also a direct extension of something we already have: the slides format already says `data-build-in="fade|rise|drop|left|right|scale|pop [order] [auto]"` and `data-transition="fade|push|magic"`. Motion turns "order" into "time".

E alone is not expressive enough for everything (a particle field, a chart drawing itself, a 3D logo). The answer is the same as in slides: an `<x-embed>` layer for arbitrary code, with one extra rule, that it must be seekable. That gives B's expressiveness exactly where it is needed and keeps everything else editable.

## 5. Proposed format

A sketch to make the recommendation concrete. Names are provisional.

```
projects/<name>/
  motion.json            title, formats, fps, speed, scene order, cover, audio, design system
  scenes/<id>.html       one file per scene: exactly one <section>, the slides subset plus timing attributes
  audio/                 music, voiceover
  assets/                images, video clips, fonts
  renders/               output files (not in git)
```

`motion.json`:

```json
{
  "v": 1,
  "title": "Tingly Box in 30 seconds",
  "formats": {
    "wide":   { "size": [1920, 1080] },
    "tall":   { "size": [1080, 1920] },
    "square": { "size": [1080, 1080] }
  },
  "fps": 30,
  "order": ["hook", "problem", "gateway", "teams", "cta"],
  "speed": 1.25,
  "cover": "poster",
  "audio": [
    { "src": "audio/track.mp3", "start": 0, "gain": -6, "beats": "auto" },
    { "src": "audio/voice.mp3", "start": 0.5, "captions": "audio/voice.srt" }
  ]
}
```

`scenes/gateway.html`:

```html
<section id="gateway" data-duration="6s" data-transition="magic 500ms" style="display:flex;flex-direction:row;…;background:#0B0D12" data-tall="flex-direction:column">
  <h2 data-in="rise 500ms @0.2s" data-out="fade 300ms @5.4s" style="font-size:96px;…" data-tall="font-size:120px">One endpoint for every agent</h2>
  <x-icon id="logo" name="tingly" data-in="pop 400ms @0.8s" style="position:absolute;…"></x-icon>
  <p data-in="type 1.2s @1.4s" style="…">localhost:12580</p>
  <x-embed data-seek style="position:absolute;…"><!-- routing diagram, exposes seek(t) --></x-embed>
</section>
```

The rules:

- **A scene's length is `data-duration`**; the video is the scenes in `order`, overlapped by their transitions. A scene is the unit people talk about ("make the gateway scene shorter"), as Claude Design's named chapters show.
- **Timing lives on the element**: `data-in` and `data-out` take `<preset> [duration] [@start] [easing]`, with times relative to the scene. Presets extend the slides build list with motion staples: `type` (typewriter), `count` (numbers count up), `draw` (SVG stroke), `blur`, `wipe`, `zoom`, `slam` (lands on a beat from 2.4× scale), `spin`. Defaults (500 ms, ease-out, staggered by source order) mean most elements need only a preset name.
- **Keyframes for anything a preset can't say**: `data-keys="x: 0@0 120@2s ease-in-out; scale: 1@2s 1.2@3s"`. One attribute, readable, and still a one-attribute patch when a key moves.
- **Camera**: the `<section>` itself can take `data-keys` (`scale`, `x`, `y`, `rotate`), which is how pan and push-in are done without a new concept.
- **Scene transitions** reuse slides' `fade`, `push` and `magic` (same `id` on both scenes), with a duration.
- **`<x-embed data-seek>`** is the escape hatch: arbitrary HTML/JS in the existing sandbox, which must export `seek(t)` (or register a GSAP timeline, HyperFrames-style). An embed without it plays in preview but is flagged by the checker as "not exportable", with the reason.
- **Video and audio layers**: `<video src="assets/clip.mp4" data-start="1s" data-trim="2s 6s">`, seeked like everything else.
- **Assets are one-scene projects.** `motion.json` takes `"loop": true` and `"background": "transparent"`; nothing else changes. A loop's last frame must equal its first, which the checker verifies by comparing the two.

### Speed is one knob

Timing attributes are written at reading pace. `"speed"` in `motion.json` (0.25 to 4, default 1) plays everything that much faster or slower: scene lengths, entrances, holds and transitions together, so "faster" is one change rather than editing every attribute. The runtime applies it to its clock (`seek(t)` shows authored time `t × speed`); the renderer has `--speed` for a one-off, and the player has a speed menu. In the editor it is a control next to the play button, and the timeline can show either authored or video time. Two follow-ups: the "text on screen under 0.8 s" check should judge video time, not authored time; and music should keep its pitch, so audio is not sped up with it (a beat-synced piece wants speed 1 or a re-cut).

### Several formats, one project

The same piece often ships as 16:9, 9:16 and 1:1 at once, with one style and one timing. HTML layout is already responsive, so the formats live in one project rather than as copies that drift apart:

- **`formats` in `motion.json`** lists the sizes; the first is the primary. Scenes, timing, audio and transitions are shared, so all formats have the same length and hit the same beats.
- **Flex and grid do most of the work.** A row of three cards in 16:9 becomes a column in 9:16 by overriding one property on the parent. Pinned offsets and sizes may be written in `%` (an addition to the slides subset), so a pinned logo stays in its corner at every size.
- **Exceptions are one attribute per format**: `data-tall="flex-direction:column"` holds only the declarations that differ in that format, merged over `style`. `data-only="wide square"` drops an element from the other formats. Timing can be overridden the same way (`data-in-tall`), but rarely needs to be.
- *Why attributes and not media queries:* a `<style>` block with `@media` rules is outside the subset and puts a property in two places the write-back engine would have to reconcile. One override attribute next to `style` keeps every change a one-attribute patch and keeps the difference visible where the element is.

The runtime compiles the attributes to Web Animations API animations created paused, and drives one clock: play, scrub and render all set `currentTime`. The same compiler serves the editor stage, the HTML player export and the renderer, so preview and output cannot drift.

*Compatibility note:* where it costs nothing, attribute names follow HyperFrames (`data-start`, `data-duration`, `data-track-index` for media), so a later HyperFrames import or export is mostly a mapping.

## 6. The editor

The slides editor is the starting point: thumbnails become the scene strip, the stage, layers, properties and code panels stay, and the subset checker and minimal write-back apply unchanged. What is new:

- **Timeline under the stage.** One row per scene in the strip and, for the current scene, one bar per animated element (its `data-in` to its `data-out`). Drag a bar's ends to change start or duration; drag the scene's right edge to change `data-duration`. Every drag is a one-attribute patch, so it goes through the same queue, 409 replay and undo as every other edit.
- **Playhead and play.** Space plays, J/K/L shuttle, ←/→ step one frame. Clicking an element selects it at the current time; elements not on screen at the playhead are dimmed in the layers panel rather than hidden.
- **Animation section in properties.** Preset, duration, delay and easing as concrete values ("rise · 500 ms · @0.2 s · ease-out"), never an alias (UX principle 5). A keyframe toggle per property records a key at the playhead.
- **Audio lane.** Waveform, beat markers when `beats` is set, caption blocks from the SRT; bars snap to beats and caption starts.
- **Formats.** A switcher above the stage (16:9 · 9:16 · 1:1) and an "all formats" view that shows them side by side at the playhead, like artboards on the canvas. Where an edit lands follows the surface you are on (UX principle 12): in the primary format or the all-formats view it changes the shared `style`; in another format it goes to that format's override. Overridden properties carry a marker in the properties panel with "use shared value", so a divergence is always visible and reversible.

Smart defaults over options (principle 6): a new motion project opens on a 1920×1080, 30 fps, five-scene skeleton with a music slot, not a settings dialog (principle 2).

## 7. AI

The three editing speeds map onto motion naturally:

- **Claude Code (minutes)** does the authoring that needs a plan: brief to script, script to storyboard (one line per scene: what is on screen, what is said, how long), storyboard to `scenes/*.html`, then a timing pass against the voiceover's SRT or the music's beats. A `motion` skill in `.claude/skills/` documents the format, the presets and the rules for pacing (text on screen at least ~1.5 s, one idea per scene, 2 to 6 s per scene). It can also convert: an existing deck into a motion piece (slides are already the subset), or a GitHub PR or release notes into a launch video, which is HyperFrames' `/pr-to-video` idea applied to our files.
- **Fast AI (seconds)** gets the playhead time, the current format and the scene's timing table in its context (so "bigger title in the vertical one" becomes a `data-tall` patch), and edits with the same jQuery statements: `$('#dc7').attr('data-in', 'rise 400ms @1.2s')`. "Make this land on the beat", "slower", "stagger these" become attribute patches. The checker gains timing rules (an element that never appears, text on screen for under 0.8 s, an out before its in), and a violation is fed back to the model exactly as slide subset errors are today.
- **Direct manipulation** is the timeline above.

Generative footage and music (Veo, Seedance, Suno…) stay out of this repository's scope. A person or Claude Code can add the files they produce to `assets/` and `audio/`, and they become ordinary layers.

## 8. Export

| Output | How | Phase |
|---|---|---|
| **Single-file HTML player** | Same as slides' HTML download: inlined assets, the runtime, play/scrub controls. Also the way to embed a motion piece in a web page or in a deck's `<x-embed>` | 1 |
| **MP4 (H.264 + AAC)** | Server-side: headless Chromium opens the scene with the runtime in render mode, seeks frame by frame, screenshots, pipes to FFmpeg; audio mixed by FFmpeg. Rendered at 2× and downsampled for crisp type | 1 |
| **GIF** | From the same frames, FFmpeg `palettegen` / `paletteuse`, capped at 720 px and 15 fps by default | 1 |
| **Cover image** | See "The cover" below: a fully written still per format, as a PNG, as the MP4's cover art and as its first frame | 1 |
| **All formats at once** | One render job per entry in `formats`, same frames timeline, files named `<title>-wide.mp4`, `-tall`, `-square` | 1 |
| **WebM with alpha, PNG sequence, ProRes** | Transparent background; for overlaying on footage in an NLE or on a web page | 2 |
| **Lottie / dotLottie** | For animated assets and UI motion. Format E is what makes this tractable: presets and `data-keys` are already keyframes on transform, opacity and a few properties, which is what Lottie layers hold. Shapes and SVG paths map to shape layers, images to image layers, text to glyph outlines (opentype.js) so no font is needed at playback. Anything in an `<x-embed>`, video, CSS filters and blend modes cannot go; the checker lists them before export, and "Lottie-safe" can be a project setting that warns as you edit | 2 |
| **Animated SVG** | Same mapping as Lottie, written as CSS animations inside one SVG; no runtime needed | 2 |
| **HyperFrames composition** | Compile scenes to one HyperFrames HTML (clips with `data-start` / `data-duration`, presets as GSAP tweens), for people who want its Lambda renders or Studio | 3 |

Dependencies are the real cost of export:

- The server has neither Chromium nor FFmpeg today (PDF is the browser's print). Playwright with its Chromium is ~150 MB; FFmpeg is a static binary or `ffmpeg-static`.
- For Tingly Box hosting (`.design/tingly-box-integration.md`), the bundle already needs Node, but shipping Chromium and FFmpeg inside a single-binary product is heavy. Phase 1 downloads them on first render, the way Playwright's own installer does, with progress shown in the export dialog.

### The cover

A promo almost always opens on an empty or half-built frame, because everything enters. Chat apps, social feeds and file browsers thumbnail a video from its first frame or its cover art, so a shared video looks blank. Motion therefore needs a cover as its own concept, separate from the timeline:

- **Where it comes from**: `"cover"` in `motion.json` is either a time (`"2.2s"`, a frame of the video, good enough when one frame says it all) or the id of a scene file outside `order` (`"poster"`), a page designed to be read standing still: the name, the promise, the features, the product on screen. A cover scene has no timing attributes; if it has some, it is drawn at its end state. The editor shows it as a separate card before scene 1, with "Use this frame as the cover" on the playhead's menu.
- **Where it goes**: a PNG per format; the MP4's cover art (an attached picture stream, which Finder, Explorer and most players use); and, unless `"coverFirstFrame": false`, the video's first frame, for the apps that only look at frame 0. One frame at 30 fps is 33 ms, so playback barely shows it. The HTML player shows the cover until play or scrub.
- **Per format**: the cover follows the same format overrides as scenes, so 16:9 and 9:16 each get their own still.
- **AI**: "make a cover" is a natural first ask once a piece exists; the AI writes the cover scene from the piece's own scenes.

### Rendering in the browser

The owner would prefer browser rendering where it works. It is feasible for most of what format E produces, and worth doing in phase 2:

- **Frames**: the runtime seeks the scene, serializes it into an SVG `foreignObject` and draws that onto a canvas, the same technique Claude's Slides uses for its PDF export (`artifact/claude-slides/FINDINGS.md`). Fonts and images must be inlined as data URLs first, or they are missing from the frame.
- **Encoding**: WebCodecs `VideoEncoder` (H.264, or VP9 with alpha for WebM) and an MP4/WebM muxer in JavaScript; audio mixed with `OfflineAudioContext` and encoded with `AudioEncoder`. GIF from the same frames with a JS quantizer. No server, no install.
- **Limits**: an `<x-embed>` is a separate sandboxed iframe that `foreignObject` cannot capture. A canvas-based embed can hand its frame over (`seek(t)` returns an `ImageBitmap` through postMessage); a DOM-based one cannot. `<video>` layers need `requestVideoFrameCallback` seeking, which is slow. Some CSS (backdrop filters, a few blend modes) renders differently in `foreignObject`.
- **How the two fit**: the export dialog renders in the browser when the scene uses only what the browser path supports, and otherwise on the server, saying why ("the routing diagram embed needs the server renderer"). A test renders every sample project both ways and compares frames, so the browser path cannot quietly drift from the reference.
- Render time: at 2× supersampling, expect roughly real time to a few times real time for a 30 s video on a laptop (*inferred* from the Playwright screenshot cost; to measure in phase 0).

## 9. Effort

Rough, for one person who knows this codebase. Most of the cost is in the runtime and the timeline; the file plumbing is reused.

| Piece | Reuse | New work | Estimate |
|---|---|---|---|
| Project kind, `motion.json`, scene files, launcher card | `deck.ts`, server file handling, journal | Kind detection, index file | 2 to 3 days |
| Scene rendering and checking | Slides subset checker, `slideArt.ts`, design-system install | Timing attribute parser and rules | 3 to 4 days |
| Timing runtime (attributes to WAAPI, one clock, seek) | Sandbox iframe and protocol | Compiler, presets, keyframes, transitions incl. magic move over time | 1.5 to 2 weeks |
| Timeline editor | Write-back queue, undo, properties panel | Timeline component, playhead, drag-to-retime, animation section | 2 weeks |
| Render service (MP4, GIF, poster) | Server job handling, SSE for progress | Playwright seek-and-capture, FFmpeg, audio mixing | 1 week |
| Audio lane (waveform, beats, SRT captions) | | Decoding, beat detection, caption layer | 1 week |
| Formats (overrides, `%` pins, switcher, all-formats view) | Canvas artboard view | Override merge in the runtime and write-back, per-format edit routing | 1 week |
| Lottie and animated SVG export | `slideArt.ts` shapes | Layer mapping, glyph outlines, "Lottie-safe" checks | 1.5 to 2 weeks |
| Browser renderer | The timing runtime | `foreignObject` capture, inlining, WebCodecs, muxing, frame comparison test | 1.5 weeks |
| `motion` skill, fast AI prompt and timing checks, sample project | Slides skill and prompts | Pacing rules, examples | 3 to 4 days |
| e2e tests | Playwright e2e harness | Timing write-back, render smoke test | 3 days |

About **10 to 12 weeks** for phases 0 to 2 below; phase 3 is open-ended.

## 10. Recommendation

Build motion as a **sixth project kind, built on the slides format**, with timing as **declarative attributes on the elements** (format E), a **seekable `<x-embed>`** for anything the vocabulary can't say, and **server-side seek-and-capture rendering** to MP4 and GIF.

Why not the alternatives:

- **Not a slides option** ("autoplay with timings"): the primary axis, the output and the editor are all different (§2). Sharing the format and renderer gets the reuse without forcing the slides UI to grow a timeline it doesn't need. A "turn this deck into a video" action covers the overlap.
- **Not GSAP or React as the source**: they are what HyperFrames and Claude Design already do well, and both lose the thing that makes Tingly Design worth using, that a person, fast AI and Claude Code all edit the same characters. Keeping GSAP available inside a seekable embed means we lose none of its power where it matters.
- **Not wrapping HyperFrames as the editor's format**: its timing beyond clip boundaries is in script. But we should stay compatible where it is cheap, and treat it as an export target and a source of ideas for skills.
- **Not Lottie or Rive as the source**: Lottie is an export of format E (§8), which serves animated assets and UI motion without a second editor. Stateful, interactive UI motion (Rive's territory) stays out of scope (§1).

### Decisions so far

| Question | Owner's answer | Consequence in this plan |
|---|---|---|
| Promo videos only, or UI motion too? | Both | Animated assets are one-scene, looping, optionally transparent projects; Lottie, dotLottie and animated SVG export move into phase 2 |
| Where does rendering happen? | Server for now; browser if possible | Server render is the reference in phase 1; a browser renderer for the supported subset follows in phase 2, with the server as fallback (§8) |
| A new size: new project or same project? | A new size is usually a new piece, but one style often ships in several sizes at once, and HTML is good at adapting | One project holds several formats with shared scenes and timing and per-format override attributes (§5); formats are in the MVP |

### Phased plan

**Phase 0, spike (about 1 week).** One hand-written scene with `data-in`, `data-keys`, a `data-tall` override and a seekable embed; the runtime compiling it to WAAPI; a script that renders it to MP4 in two formats through Playwright and FFmpeg. Measure render time and check that preview and render match frame for frame. Exit: the format holds up, or we learn which part of E needs to change before building UI on it.

**Phase 1, MVP (about 4 to 5 weeks).** The kind, files and launcher card; the slides editor reused for scenes; the timeline with drag-to-retime; preset animations, keyframes, transitions and magic move; formats with the switcher, the all-formats view and override routing; music track (no beats yet); server export to HTML player, MP4, GIF and poster, for all formats in one go; the `motion` skill; a sample project, "Tingly Box in 30 seconds" in 16:9 and 9:16, built from the `tingly-intro` deck. Exit: someone can go from a brief to rendered MP4s with Claude Code, then change a word and a timing by hand and re-render every format.

**Phase 2, assets, sound and the browser (about 4 to 5 weeks).** Loops and transparent backgrounds; Lottie, dotLottie, animated SVG and WebM with alpha; a second sample, an animated asset such as a looping Tingly logo or a "request routed" UI animation; voiceover with SRT captions, beat detection and snapping; fast AI timing edits and timing checks; the browser renderer with server fallback; deck-to-motion conversion.

**Phase 3, as asked for.** HyperFrames export, generated clips as layers, and interactive states if UI motion turns out to need them.

## 11. Phase 0 results

The spike is in this branch. It has no editor UI; it proves the format, the runtime and the render path.

| Piece | Where |
|---|---|
| Timing grammar, format overrides, scene timeline, checks | `packages/core/src/motion.ts`, 16 unit tests in `packages/core/test/motion.test.ts` |
| Runtime: lays out one format, compiles attributes to paused Web Animations on one clock, `seek(t)`, `play()` | `packages/sandbox/src/motion.ts` → `dist/motion.js` |
| Renderer: MP4 per format, GIF, poster, single-file HTML player, `--verify` | `scripts/motion-render.mjs` (Playwright's Chromium + ffmpeg) |
| Sample: "Tingly Design", a 36 s product promo in twelve scenes (authored at reading pace, played at `"speed": 1.5`), 16:9 and 9:16 from the same files | `projects/design-motion/` (not listed in the launcher yet: no editor for the kind) |

```bash
pnpm --filter @dc/sandbox build
node scripts/motion-render.mjs design-motion --verify --player
```

What the sample shows: the product story, with no code on screen. Its cover is a separate page (`scenes/poster.html`: the mark and the name, large enough to read as a thumbnail; a busier version with the promise, the six kinds and the product on screen was dropped for this), used as the PNG, the MP4's cover art and its first frame. (0) An animated opening: the name, the promise and four things it makes floating around it. (1) An idea typed into the prompt ("A landing page for a coffee subscription") and the AI building the page. (2) A cursor clicking the headline, then a text caret backspacing over it and typing a new one, character by character: editing by hand, in place. (3) A second prompt ("Make it warmer and add a pricing section") and the AI changing the same page. (4) The six kinds of project, one scene each: canvas, slides, design systems, dashboards, docs, and motion itself (marked new). (5) A recap and the brand close ("Coming soon"). It exercises `rise`, `pop`, `fade`, `wipe`, `type`, `count`, `spin`, `slam`; cursor paths with `data-keys` (holds, then eased glides) with a separate path per format (`data-keys-tall`); state changes drawn as overlays that fade or type in over the old state; `data-tall` turning the artboard into a phone layout. Earlier samples (a dark one about Tingly Box, a fast beat-cut one, and one showing the source file and a git diff) were dropped after review: too fast, too technical, or not about the product's features.

**Findings:**

- **The format holds.** Every animation in the sample is one attribute, and the tall version needed only `data-tall` / `data-keys-tall` overrides on the elements that differ, no copied scene. A fast, beat-driven cut needed nothing beyond two more presets (`slam`, `spin`). Nothing pushed us toward a script.
- **Pointing at things needs anchors.** A cursor that travels to the button, or a label next to a changed line, needs that element's position, which depends on layout and differs per format. The spike measured positions in the browser and wrote pixel offsets into the scene files. Phase 1 should add an anchor instead (for example `data-path="#btn @1.4s, #blue @2.6s"` resolved by the runtime after layout), so moving the button doesn't strand the cursor.
- **Typing needs a caret, by character.** `type` clips the element's width in equal steps, so a proportional font shows half letters and a wrapped line reveals both lines at once. The sample's hand edit instead wraps each character in a span with its own 1 ms `fade` and moves a caret with stepped `data-keys` to measured character positions (about 50 spans and two 50-key tracks). Phase 1 should make `type` reveal by character in reading order and add a caret option (`type caret`), plus a matching `erase`.
- **"Change of state" is a pattern.** Most demo beats are "this becomes that". Drawing the new state as an overlay that fades or types in over the old one works, but costs a copy of the element. A `data-to` attribute (the new text or style, applied at a time) would make it one attribute; worth adding in phase 1.
- **Determinism needs two things the first version lacked.** (1) Fonts: `document.fonts.ready` resolves before a hidden scene's faces are requested, so early frames were drawn in the fallback face; the runtime now loads every face/weight the scenes use before the first frame. (2) Paint: after setting `currentTime`, the next animation frame can still be the old one on composited layers; `seek` now waits two frames. With both, all 16 frames seeked in reverse are byte-identical to forward, in both formats. A third source showed up with the cover: a logo entering with `slam` (scale from 2.4×) left one 5 px column of its edge up to 21/255 off depending on seek order, because Chromium keeps a scaled layer's raster from the frame before; entering with `drop` (no scale) removed it. `--verify` now names the time of the worst frame. (The first sample left 5 of 16 vertical frames differing on at most 68 pixels by at most 4/255 around one line of text: Chromium's raster cache, invisible; `--verify` accepts that as antialiasing.)
- **Speed: 6 to 15 frames per second**, depending on content, on a 4-core container with ffmpeg encoding in parallel. This sample (light, flat colours) renders 36.4 s at 30 fps in 80 s per format (14 fps); the first, dark sample with large radial gradients and a long-running embed took 53 to 57 s for 10.9 s (6 fps). Rendering at 2× took the same time as 1×, so the cost is per frame (a page round trip, two animation frames, PNG encoding), not per pixel. Ways to go faster, in order of effort: render several time ranges in parallel pages and concatenate; JPEG frames; drive frames with `HeadlessExperimental.beginFrame` instead of waiting on animation frames.
- **Sizes**: MP4 2.4 MB (16:9) and 2.3 MB (9:16) for 36 s. GIF at 720 px, 15 fps came to 2.3 MB and 4.6 MB for a 14 s cut, so GIF is for short loops, not promos.
- **Not covered yet**: magic move falls back to a fade; audio mixing is wired in the renderer but untested with a real file; `count` and `type` assume one text node; the editor, the timeline UI and fast AI are phase 1.

## 12. Shader effects with vgpu

What `<x-embed data-seek>` was for (§5): the things attributes can't do, here a field of noise or a glow, as a WGSL fragment shader drawn with [vgpu](https://github.com/vercel-labs/vgpu) (Vercel, MIT, 0.3.1 pinned). Sample: `projects/vgpu-motion/`, 12 s in three scenes, an aurora behind the title, an orbit of glowing points with alpha around the mark, the aurora again behind the close.

```html
<x-embed data-seek style="position:absolute;left:0;top:0;width:100%;height:100%">
  <canvas data-quality="0.5"></canvas>
  <script type="text/wgsl">struct Fx { time: f32, aspect: f32 } @group(0) @binding(0) var<uniform> fx: Fx; …</script>
  <script>/* the effect runtime, the same in every effect */</script>
</x-embed>
```

- **Contract.** The shader is `fs_main(uv)`, reads `fx.time` (seconds into the scene) and `fx.aspect`, and writes premultiplied alpha. Nothing else moves it, so it is seekable by construction.
- **Two paths, one shader.** The runtime posts a probe to its parent. The renderer's page answers with a URL, and each `seek(t)` then POSTs `{wgsl, t, w, h}` there; `scripts/motion-fx.mjs` draws that frame with `vgpu/node` (Dawn; Mesa's software renderer where there is no GPU) and returns raw RGBA, which the embed puts on its canvas. With no answer in 250 ms (the player, later the editor), the embed draws itself with vgpu in the browser's WebGPU. Headless Chromium in our container exposes `navigator.gpu` but cannot create a device (SwiftShader, every flag combination tried), which is why export does not rely on it.
- **`data-quality`** is the share of the layer's device pixels the shader draws (default 0.5, upscaled by the canvas): soft effects lose nothing, and it cuts both shading and transfer by 4×.
- **Warm-up.** Starting Dawn and compiling a shader takes about 0.8 s on the CPU, near the embed's 1 s seek timeout, so the renderer starts the GPU and compiles every shader in the scenes before the first frame.

**Results (4-core container, no GPU):** `--verify` 16/16 frames byte-identical when seeked in reverse. 12 s at 30 fps in 106 to 111 s per format (3.2 to 3.4 fps), against 6 to 14 fps without effects: each frame pays about 35 ms of software shading and about 60 ms to move the pixels into the page. A GPU would remove most of the first; JPEG or a smaller `data-quality` the second.

**Open:** the browser path is unverified here (no WebGPU in the container) and loads vgpu from jsDelivr, which the editor would bundle instead; the runtime is copied into each effect until the runtime or the editor injects it from `data-fx`; shader parameters (colours, speed) are constants in the WGSL, not attributes yet; `vgpu check` could join the motion checker so a model's broken shader comes back as an error.
