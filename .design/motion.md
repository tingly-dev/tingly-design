# Motion: a sixth project kind for animated promo videos

Status: **research, nothing implemented**. This note looks at whether Tingly Design should have a "motion" kind (short animated videos such as a product launch, a feature explainer or an animated title), how it differs from slides, what comparable tools do, which source format fits our two-way editing, how export and AI would work, and what it would cost. It ends with a recommendation and a phased plan.

Facts about this repository are from `5efd911`. Facts about other tools come from their public docs and READMEs as of October 2026, linked in §3; anything inferred rather than read is marked as such.

## 1. What people mean by "motion"

"Motion" covers three different deliverables. They share a timeline but almost nothing else:

| | Promo / explainer video | Animated asset | Interactive UI motion |
|---|---|---|---|
| Example | "Tingly Box in 30 seconds", a release video, a feature walkthrough for social | An animated title card, a looping hero for a website, a chart that builds, a logo sting | A button with hover and pressed states, an onboarding illustration that reacts |
| Length | 15 to 90 s, several scenes | 2 to 10 s, one scene, often looping | No fixed length; driven by state |
| Audio | Usually music, often a voiceover and captions | Rarely | No |
| Delivered as | MP4 (16:9, 9:16, 1:1) | MP4, WebM with alpha, GIF, or embedded in a page or deck | Lottie / dotLottie, Rive, code |
| Typical tools | After Effects, Canva, Jitter, Remotion, HyperFrames | Jitter, Figma Motion, Lottie Creator | Rive, Lottie Creator |

The request that started this note is the first column. The second column comes almost for free if the first is designed well (it is a one-scene video). The third is a different product (a state machine plus a runtime in someone else's app), and it should stay out of scope.

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
  motion.json            title, size, fps, scene order, audio, design system
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
  "size": [1920, 1080],
  "fps": 30,
  "order": ["hook", "problem", "gateway", "teams", "cta"],
  "audio": [
    { "src": "audio/track.mp3", "start": 0, "gain": -6, "beats": "auto" },
    { "src": "audio/voice.mp3", "start": 0.5, "captions": "audio/voice.srt" }
  ],
  "variants": { "vertical": { "size": [1080, 1920] } }
}
```

`scenes/gateway.html`:

```html
<section id="gateway" data-duration="6s" data-transition="magic 500ms" style="display:flex;…;background:#0B0D12">
  <h2 data-in="rise 500ms @0.2s" data-out="fade 300ms @5.4s" style="…">One endpoint for every agent</h2>
  <x-icon id="logo" name="tingly" data-in="pop 400ms @0.8s" style="position:absolute;…"></x-icon>
  <p data-in="type 1.2s @1.4s" style="…">localhost:12580</p>
  <x-embed data-seek style="position:absolute;…"><!-- routing diagram, exposes seek(t) --></x-embed>
</section>
```

The rules:

- **A scene's length is `data-duration`**; the video is the scenes in `order`, overlapped by their transitions. A scene is the unit people talk about ("make the gateway scene shorter"), as Claude Design's named chapters show.
- **Timing lives on the element**: `data-in` and `data-out` take `<preset> [duration] [@start] [easing]`, with times relative to the scene. Presets extend the slides build list with motion staples: `type` (typewriter), `count` (numbers count up), `draw` (SVG stroke), `blur`, `mask-left`, `zoom`. Defaults (500 ms, ease-out, staggered by source order) mean most elements need only a preset name.
- **Keyframes for anything a preset can't say**: `data-keys="x: 0@0 120@2s ease-in-out; scale: 1@2s 1.2@3s"`. One attribute, readable, and still a one-attribute patch when a key moves.
- **Camera**: the `<section>` itself can take `data-keys` (`scale`, `x`, `y`, `rotate`), which is how pan and push-in are done without a new concept.
- **Scene transitions** reuse slides' `fade`, `push` and `magic` (same `id` on both scenes), with a duration.
- **`<x-embed data-seek>`** is the escape hatch: arbitrary HTML/JS in the existing sandbox, which must export `seek(t)` (or register a GSAP timeline, HyperFrames-style). An embed without it plays in preview but is flagged by the checker as "not exportable", with the reason.
- **Video and audio layers**: `<video src="assets/clip.mp4" data-start="1s" data-trim="2s 6s">`, seeked like everything else.

The runtime compiles the attributes to Web Animations API animations created paused, and drives one clock: play, scrub and render all set `currentTime`. The same compiler serves the editor stage, the HTML player export and the renderer, so preview and output cannot drift.

*Compatibility note:* where it costs nothing, attribute names follow HyperFrames (`data-start`, `data-duration`, `data-track-index` for media), so a later HyperFrames import or export is mostly a mapping.

## 6. The editor

The slides editor is the starting point: thumbnails become the scene strip, the stage, layers, properties and code panels stay, and the subset checker and minimal write-back apply unchanged. What is new:

- **Timeline under the stage.** One row per scene in the strip and, for the current scene, one bar per animated element (its `data-in` to its `data-out`). Drag a bar's ends to change start or duration; drag the scene's right edge to change `data-duration`. Every drag is a one-attribute patch, so it goes through the same queue, 409 replay and undo as every other edit.
- **Playhead and play.** Space plays, J/K/L shuttle, ←/→ step one frame. Clicking an element selects it at the current time; elements not on screen at the playhead are dimmed in the layers panel rather than hidden.
- **Animation section in properties.** Preset, duration, delay and easing as concrete values ("rise · 500 ms · @0.2 s · ease-out"), never an alias (UX principle 5). A keyframe toggle per property records a key at the playhead.
- **Audio lane.** Waveform, beat markers when `beats` is set, caption blocks from the SRT; bars snap to beats and caption starts.
- **Aspect variants.** A switch between 16:9 and 9:16 that shows the same scenes reflowed. Layout is flex and grid in the subset, so most scenes reflow on their own; pinned elements may need a per-variant override (open question, §10).

Smart defaults over options (principle 6): a new motion project opens on a 1920×1080, 30 fps, five-scene skeleton with a music slot, not a settings dialog (principle 2).

## 7. AI

The three editing speeds map onto motion naturally:

- **Claude Code (minutes)** does the authoring that needs a plan: brief to script, script to storyboard (one line per scene: what is on screen, what is said, how long), storyboard to `scenes/*.html`, then a timing pass against the voiceover's SRT or the music's beats. A `motion` skill in `.claude/skills/` documents the format, the presets and the rules for pacing (text on screen at least ~1.5 s, one idea per scene, 2 to 6 s per scene). It can also convert: an existing deck into a motion piece (slides are already the subset), or a GitHub PR or release notes into a launch video, which is HyperFrames' `/pr-to-video` idea applied to our files.
- **Fast AI (seconds)** gets the playhead time and the scene's timing table in its context, and edits with the same jQuery statements: `$('#dc7').attr('data-in', 'rise 400ms @1.2s')`. "Make this land on the beat", "slower", "stagger these" become attribute patches. The checker gains timing rules (an element that never appears, text on screen for under 0.8 s, an out before its in), and a violation is fed back to the model exactly as slide subset errors are today.
- **Direct manipulation** is the timeline above.

Generative footage and music (Veo, Seedance, Suno…) stay out of this repository's scope. A person or Claude Code can add the files they produce to `assets/` and `audio/`, and they become ordinary layers.

## 8. Export

| Output | How | Phase |
|---|---|---|
| **Single-file HTML player** | Same as slides' HTML download: inlined assets, the runtime, play/scrub controls. Also the way to embed a motion piece in a web page or in a deck's `<x-embed>` | 1 |
| **MP4 (H.264 + AAC)** | Server-side: headless Chromium opens the scene with the runtime in render mode, seeks frame by frame, screenshots, pipes to FFmpeg; audio mixed by FFmpeg. Rendered at 2× and downsampled for crisp type | 1 |
| **GIF** | From the same frames, FFmpeg `palettegen` / `paletteuse`, capped at 720 px and 15 fps by default | 1 |
| **PNG poster / frame at t** | One seek, one screenshot; also used for thumbnails | 1 |
| **WebM with alpha, PNG sequence, ProRes** | Transparent background; for overlaying on footage in an NLE | 2 |
| **Vertical / square variants** | Same render, other `size` | 2 |
| **HyperFrames composition** | Compile scenes to one HyperFrames HTML (clips with `data-start` / `data-duration`, presets as GSAP tweens), for people who want its Lambda renders or Studio | 3 |
| **Lottie** | Only for a subset: shapes, SVG paths, images and text converted to glyph outlines, with transforms and opacity. Anything in an `<x-embed>`, video, blur or masks cannot go. Useful for the "animated asset" column of §1; not worth doing for promo videos | 3, maybe never |

Dependencies are the real cost of export:

- The server has neither Chromium nor FFmpeg today (PDF is the browser's print). Playwright with its Chromium is ~150 MB; FFmpeg is a static binary or `ffmpeg-static`.
- For Tingly Box hosting (`.design/tingly-box-integration.md`), the bundle already needs Node, but shipping Chromium and FFmpeg inside a single-binary product is heavy. Two ways out: download them on first render (like Playwright's own installer), or render in the browser that is already open, with WebCodecs `VideoEncoder` and an MP4 muxer, capturing frames by drawing the scene into a canvas. The browser path has no install but loses fidelity on `<x-embed>` content and fonts in SVG `foreignObject`. *Recommendation:* server render as the reference path; browser render as a later fallback for hosts without the binaries.
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
| `motion` skill, fast AI prompt and timing checks, sample project | Slides skill and prompts | Pacing rules, examples | 3 to 4 days |
| e2e tests | Playwright e2e harness | Timing write-back, render smoke test | 3 days |

About **7 to 9 weeks** for phases 0 to 2 below; phase 3 is open-ended.

## 10. Recommendation

Build motion as a **sixth project kind, built on the slides format**, with timing as **declarative attributes on the elements** (format E), a **seekable `<x-embed>`** for anything the vocabulary can't say, and **server-side seek-and-capture rendering** to MP4 and GIF.

Why not the alternatives:

- **Not a slides option** ("autoplay with timings"): the primary axis, the output and the editor are all different (§2). Sharing the format and renderer gets the reuse without forcing the slides UI to grow a timeline it doesn't need. A "turn this deck into a video" action covers the overlap.
- **Not GSAP or React as the source**: they are what HyperFrames and Claude Design already do well, and both lose the thing that makes Tingly Design worth using, that a person, fast AI and Claude Code all edit the same characters. Keeping GSAP available inside a seekable embed means we lose none of its power where it matters.
- **Not wrapping HyperFrames as the editor's format**: its timing beyond clip boundaries is in script. But we should stay compatible where it is cheap, and treat it as an export target and a source of ideas for skills.
- **Not Lottie or Rive**: different deliverable (§1); revisit only if people ask for UI animations.

### Phased plan

**Phase 0, spike (about 1 week).** One hand-written scene with `data-in`, `data-keys` and a seekable embed; the runtime compiling it to WAAPI; a script that renders it to MP4 through Playwright and FFmpeg. Measure render time and check that preview and render match frame for frame. Exit: the format holds up, or we learn which part of E needs to change before building UI on it.

**Phase 1, MVP (about 3 to 4 weeks).** The kind, files and launcher card; the slides editor reused for scenes; the timeline with drag-to-retime; preset animations, keyframes, transitions and magic move; music track (no beats yet); export to HTML player, MP4, GIF and poster; the `motion` skill; a sample project, "Tingly Box in 30 seconds", built from the `tingly-intro` deck. Exit: someone can go from a brief to a rendered MP4 with Claude Code, then change a word and a timing by hand and re-render.

**Phase 2, sound and formats (about 2 to 3 weeks).** Voiceover with SRT captions, beat detection and snapping, fast AI timing edits and timing checks, vertical and square variants, WebM with alpha, deck-to-motion conversion.

**Phase 3, as asked for.** HyperFrames export, browser-side rendering for Tingly Box, a Lottie subset, generated clips as layers.

### Open questions for the owner

1. Is the target the promo video (§1, first column), as assumed here, or also UI animations? The answer decides whether Lottie matters at all.
2. Should rendering need the server, or must it work inside Tingly Box without extra downloads from day one? This moves browser rendering from phase 3 to phase 1.
3. For aspect variants, are per-variant overrides in the scene file acceptable, or should vertical be a separate project generated from the horizontal one?
