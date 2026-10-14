# Export: motion video, and every kind in several formats

Status: **research**. The decision (browser first, as its own package) is recorded in `.design/export.md`; this note keeps the options weighed. Answers issues #55 (a low-dependency way to export motion) and #56 (multi-format export for every kind, without heavy local installs). Both issue bodies are title-only, so the scope below is read from the titles and from `.design/motion.md` §8. Once a decision lands, the conclusion moves into `.design/`.

## 1. Where we are

| Kind | Export today | Where | Needs |
|---|---|---|---|
| canvas | PNG at 1× / 2×, the `.dc.html` source | `Board.tsx` → sandbox `exportPng` (html-to-image, `skipFonts: true`) | nothing |
| slides | self-contained HTML, PDF (the browser's Print), speaker notes | `slides/exportDeck.ts` | nothing |
| docs | Markdown (tab or all), HTML, PDF (Print) | `DocsApp.tsx` | nothing |
| dashboard | CSV of a query result only; no export of the page | `dash/Sources.tsx` | nothing |
| design system | download single assets; no export of the system | `ds/ComponentViews.tsx` | nothing |
| motion | MP4 per format, GIF, cover PNG, HTML player, **CLI only** (no button in the editor) | `scripts/motion-render.mjs` | Playwright's Chromium (~150 MB), `ffmpeg` on PATH |

Two facts shape everything below.

1. **Five kinds already export with zero installs**, because the user's own browser does the work. Motion is the only one that needs a server, a downloaded Chromium and ffmpeg. The question is how far the browser-does-the-work model can be pushed, not how to slim the server.
2. **There is no shared export code.** Each kind has its own `download()` helper and its own menu. Adding PNG to slides, or MP4 to the editor, today means a fifth copy.

## 2. Measured in this container

Open-source Chromium 1194 (the build Playwright ships), headless, WebCodecs `isConfigSupported` at 1280×720:

| Codec | Encodable |
|---|---|
| H.264 (`avc1.42001f`, `avc1.640028`) | **no** |
| AAC (`mp4a.40.2`) | **no** |
| VP9, VP8, AV1 | yes |
| Opus | yes |

So a browser-side pipeline writes MP4 only where the browser ships H.264 and AAC encoders: Chrome, Edge and Safari do (from vendor documentation, not measured here); Chromium builds and some Linux Firefox/Chrome setups do not. Everywhere, it can write WebM (VP9 + Opus). Not measured: capture speed and fidelity of the foreignObject path against the CDP screenshot path (the existing render does about 6–14 frames/s per `.design/motion.md`); that is the first spike in §6.

## 3. Options for motion (#55)

| | Idea | Install | Fidelity | Notes |
|---|---|---|---|---|
| **A** | Today: Playwright Chromium + ffmpeg | Chromium ~150 MB, ffmpeg | reference (what the player shows) | CLI only; deterministic; `--verify` exists |
| **B** | Same loop, but drive the Chrome/Edge already on the machine over CDP, no Playwright download | ffmpeg only (or none, see C) | same as A | `chromePath()` already honours `DC_CHROME`; the gap is detection (Chrome/Edge paths per OS) and a clear message when none is found. Drops the 150 MB, keeps ffmpeg |
| **C** | **The editor tab renders**: seek the stage, rasterize the frame to a canvas, encode with WebCodecs, mux with [Mediabunny](https://mediabunny.dev/guide/introduction) (pure TypeScript, zero dependencies, MPL-2.0, writes MP4/WebM/MOV, tree-shakable) | none | good for what the runtime draws; weaker for embeds, video layers, `backdrop-filter`, a few blend modes (foreignObject limits, as `motion.md` already notes) | zero install, progress and cancel in the UI. MP4 needs an H.264-capable browser (§2); otherwise WebM |
| **D** | Capture the live tab with `getDisplayMedia` / `captureStream` | none | exact pixels | real-time, a permission prompt every time, not deterministic. Rejected |
| **E** | [HTML-in-Canvas](https://developer.chrome.com/blog/html-in-canvas-ot-changes) (`drawElementImage`): the browser's own rasterizer into a canvas | none | best | **Origin trial through Chrome 160, API renamed between 150 and 155**, Chrome only. Watch, do not build on it; keep the capture behind one function so it can replace foreignObject later |
| **F** | ffmpeg.wasm in the page | a multi-MB wasm download | n/a | WebCodecs already encodes in hardware; wasm ffmpeg is slower and heavier. Not needed (inferred) |
| **G** | Go host (chromedp + `os/exec`), `tech-stack/motion-go.md` §4 | same as A | same as A | A language change, not a dependency change. Parked with the Go decision |
| **H** | Cloud renderer | none locally | same as A | a service to run and pay for; out of scope |

### Recommendation for motion: C first, B as the headless and exact route

- **C in the editor** is the one-click default: "Export video" in the motion toolbar, picks MP4 when the browser can, WebM otherwise, says why. No server, no install, and the same stage code that plays is the code that renders.
- **B stays for CLI, CI and anything C refuses.** The export dialog routes per piece: the checker already knows which scenes use a non-seekable embed, a `<video>` layer or an effect the foreignObject path draws differently, and says "this piece needs the exact renderer" with a one-line way to get it. `motion-render.mjs` keeps its role and gains Chrome/Edge detection, so Playwright's browser download is optional.
- **One implementation, two hosts.** Write the frame loop (seek, rasterize, encode, mux) once as a module the sandbox page runs. The editor calls it in the user's tab; `motion-render.mjs` opens the same page in headless Chrome and calls the same function. The CLI then needs ffmpeg only for H.264/AAC when its Chrome lacks them, and can fall back to WebM without it.
- **Keep the check that C does not drift:** render every sample project both ways and compare frames with the existing `--verify` metric.

Costs and risks: Mediabunny is MPL-2.0 (file-level copyleft; fine to bundle unmodified, list it in `THIRD_PARTY_LICENSES`); AAC encode is missing in some browsers (Mediabunny offers an AAC encoder polyfill, `@mediabunny/aac-encoder`; or ship video-only/Opus there); the PR #25 shader embeds are WebGL/WebGPU canvases that foreignObject cannot capture, so they route to B (or hand their frame over through `seek(t)` returning an `ImageBitmap`, as `motion.md` suggests).

## 4. Multi-format export for every kind (#56)

Principle: **render in the user's browser from one shared rasterizer, and add a server only where a format cannot be made there.** Group the formats by what they need:

| Format | Needs | How | Kinds |
|---|---|---|---|
| **HTML** (self-contained) | nothing | what slides and docs already do: inline images and fonts, one file | all six (dashboard: with its `data/` inlined) |
| **Markdown / source files** | nothing | already there for docs; a project as a `.zip` of its plain files (the format *is* the export) | all |
| **PNG / JPEG / WebP** | nothing | `rasterize(node, size, scale)`, today's html-to-image call, with fonts embedded (the canvas path passes `skipFonts: true`, which a video needs fixed) | canvas artboard, each slide, each doc page, dashboard, design-system overview, motion frame |
| **SVG** | nothing | foreignObject-wrapped; only for canvas, as an editable-in-Figma-or-not decision | canvas (open question) |
| **PDF, vector text** | a browser print engine | today the Print dialog; one-click needs `Page.printToPDF` on a system Chrome (the same B host) | slides, docs, canvas pages, dashboard |
| **PDF, images** | nothing | pages as PNGs in [pdf-lib](https://pdf-lib.js.org/) (MIT); text is not selectable | fallback when no Chrome: say so in the menu |
| **PPTX** | nothing | [pptxgenjs](https://gitbrent.github.io/PptxGenJS/) (MIT): one image per slide first, native text boxes for the slides subset later | slides |
| **MP4 / WebM / GIF** | WebCodecs; a JS GIF encoder such as gifenc (MIT) | §3 | motion |
| **Lottie / animated SVG** | nothing | the mapping in `motion.md` §8, phase 2 | motion |
| **CSV / JSON data** | nothing | exists for dashboard results | dashboard |

(Library names and licenses above are from their public pages and my recollection, not re-verified; check licenses when one is picked.)

### One shared module

Build it once, the way `CLAUDE.md` asks for cross-kind features, and plug each kind in:

```
packages/export (or apps/editor/src/export/)
  targets.ts     per kind: [{ id, label key, mime, needs: 'browser' | 'chrome' | 'webcodecs-h264', run(ctx) }]
  rasterize.ts   the one capture function; foreignObject now, HTML-in-Canvas later
  video.ts       the frame loop: seek → rasterize → VideoEncoder → mediabunny
  zip.ts         plain-file project download
apps/editor: one ExportMenu used by every kind's toolbar, replacing the four download() copies
```

Each target declares what it needs; the menu greys out one it cannot run **with the reason and the fix** ("MP4 needs Chrome, Edge or Safari; this browser can save WebM"), the same way the motion checker reports problems. That follows `ux-principles`: hand over the artifact for the next action, diagnostics on the real path, smart defaults over toggles (the format list is by what the person wants to do: share a link, post a video, print, edit elsewhere).

Cross-kind matrix impact: `.design/project-kinds.md` gains an "Export" column with these targets; dashboard and design system start with HTML + PNG, and any kind that skips a target says why.

## 5. Decisions for YZ

1. **Motion route.** Recommended: C in the editor + B as the exact/headless route (above). Alternatives: B only (smallest change, keeps ffmpeg), or A as is.
2. **MP4 where the browser cannot encode H.264.** Recommended: offer WebM and say why; use the AAC polyfill only if audio matters. Alternative: require ffmpeg for MP4 (needs the server route).
3. **Scope of the shared module.** Recommended order: shared menu + PNG for every kind → motion video in the browser → PDF one-click via Chrome → PPTX. Alternative: motion video only, kinds later.
4. **PDF.** Keep Print for vector text and add "PDF (images)" only as a no-Chrome fallback, or drop the image PDF.

## 6. First spikes once an option is picked

1. foreignObject frames vs CDP screenshots on `design-motion` and `tingly-intro`: speed (frames/s) and pixel difference, with fonts embedded. This decides how much of C's fidelity gap is real.
2. A 30 s piece through Mediabunny to WebM and to MP4 in desktop Chrome, with audio; memory use.
3. Chrome/Edge detection on macOS, Windows and Linux for B, and the failure message.

## Sources

- [Mediabunny: introduction](https://mediabunny.dev/guide/introduction), [supported formats and codecs](https://mediabunny.dev/guide/supported-formats-and-codecs)
- [HTML-in-Canvas updates](https://developer.chrome.com/blog/html-in-canvas-ot-changes) (page updated 2026-09-29)
- In-repo: `scripts/motion-render.mjs`, `.design/motion.md` §8, `tech-stack/motion-go.md` §4, `tech-stack/vgpu-for-motion.md`
