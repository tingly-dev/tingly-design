# Motion effects: which engine draws a shader layer

Status: **research**. The decision (WebGL2 inside the page) is recorded in `.design/motion-effects.md`; this note keeps the options weighed, what was measured, and why WebGPU through vgpu was not adopted. A working vgpu implementation is kept on the branch `claude/project-thread-1cfqn6` (frame host `scripts/motion-fx.mjs`, sample `projects/vgpu-motion/`) for when compute effects are wanted; it is not merged.

## 1. The question

Motion scenes are HTML, and CSS covers type, layout and most entrances. It cannot draw noise fields, light along an edge, grain or particles. The format already has an escape hatch for this: `<x-embed data-seek>`, a sandboxed page that exposes `window.seek(t)` and is screenshotted after it resolves. The question is what draws inside that embed so that the editor, the player and the exact renderer (`apps/server/src/render.ts`, the machine's Chrome) all show the same frame for the same time, on machines without a GPU.

## 2. Options weighed

| Option | Runs in the page everywhere | Compute | Export path | Verdict |
|---|---|---|---|---|
| CSS / SVG filters | yes | no | same as any element | too weak for fields and light |
| Canvas 2D | yes | no | same as any element | per-pixel work on the CPU in JS, too slow at 1080p |
| **WebGL2 fragment shader** | yes, including headless Chromium (ANGLE + SwiftShader) | no | same as any element | **adopted** |
| WebGPU in the page | browser yes; headless Chromium no (see §3) | yes | needs a different path | not reliable for export |
| **vgpu** (WebGPU, browser + Node) | browser yes; export through a Node frame host | yes | Node draws each frame, the page shows it | works, kept on a branch |
| three.js / regl / ogl | yes (on WebGL) | no | same as WebGL2 | a dependency for a fullscreen triangle; no gain |
| Pre-rendered video in a scene | yes | n/a | needs frame-exact video seeking | loses "edit the shader, see it"; not a live layer |

## 3. vgpu

[vercel-labs/vgpu](https://github.com/vercel-labs/vgpu): MIT, 0.x, a TypeScript WebGPU library. `init()` → `effect(gpu, wgsl)` → `frame(gpu, f => f.pass(target, effect))`, uniforms through `effect.set()`. The same API runs in the browser, in Node (`vgpu/node`, Dawn, with Mesa's llvmpipe when there is no GPU) and in a mock. It is written for agents: `vgpu check` validates WGSL, `vgpu docs`, `vgpu examples`, an MCP server and `llms.txt`. `@vgpu/wgsl-std` has hash, noise, colour and lighting functions, but there is no effect library; every effect is hand-written WGSL. No WebGL fallback: without `navigator.gpu`, `init()` throws.

Measured on 4 CPU cores, no GPU:

| Test | Result |
|---|---|
| Headless Chromium with `--enable-unsafe-webgpu` | `navigator.gpu` and a SwiftShader adapter exist, but creating a device or pipeline fails ("A valid external Instance reference no longer exists"). Seven flag sets tried (Vulkan, llvmpipe ICD, no sandbox, in-process GPU); raw WebGPU fails the same way, so it is the browser, not vgpu |
| WebGL2 in the same Chromium | works |
| `vgpu/node`, 1920×1080 gradient | 15 ms a frame including readback |
| `vgpu/node`, 1920×1080 five-octave fbm | 30 ms a frame; two renders at the same time are byte-identical |

So export cannot count on WebGPU in the page. The implementation on the branch works around it: the renderer serves a frame host on a routed URL; the embed asks it for each frame, Node draws the same WGSL at the same time and returns raw RGBA, and the embed puts it on its canvas. With no host (editor, player) the embed draws with the browser's WebGPU. What that cost:

- **Cold start.** Starting Dawn and compiling a shader on the CPU takes about 0.8 s, close to the embed's 1 s seek timeout, so the first frames came out blank until the renderer compiled every shader before the first frame.
- **Transfer.** Every frame crosses from Node into the page. Base64 through `postMessage` was slow; raw bytes through a routed `fetch` halved it.
- **Speed.** The sample piece rendered at 2.6–3.4 fps with vgpu against 4.4–4.6 fps with WebGL2 (plain motion: 6–14).
- **A second renderer to keep in step.** The exact renderer moved into the server (`render.ts`, driving the machine's Chrome); the frame host would have to follow it there, plus Dawn's prebuilt binaries and llvmpipe as a download.
- **Browser path untested.** The in-browser WebGPU path was not exercised in a real browser here, and loads vgpu from a CDN.

## 4. Why WebGL2

- **One path.** The shader draws itself inside the page in the editor, the player and the server renderer (the browser exporter cannot picture an embed and hands such pieces to the server, `.design/export.md`). Nothing runs beside the page, so any renderer that drives a browser carries it, including a Go one (chromedp plus ffmpeg) if the server ever moves off Node; vgpu would need a Node sidecar or Go wgpu bindings there.
- **Faster without a GPU**, and nothing to download.
- **What it gives up is compute** (fluid, many-particle simulation, feedback that needs storage buffers). Every effect on the shortlist (aurora, edge glow, grain, gradient mesh, light sweep) is a fragment shader that is a function of time.
- The contract is written so an effect can move to WGSL line by line (same inputs, same `uv` origin, same units), so adding vgpu later as a second engine for compute effects stays open; the branch shows it can be done.

## 5. Cross-renderer determinism

Found while comparing the two engines on the same piece: the aurora pattern differed between llvmpipe and SwiftShader. Built-in `sin` of large arguments is implementation-defined, so the usual `fract(sin(x) * 43758.5)` hash differs per renderer. Same renderer, same picture held 16/16 in both engines and both formats; across machines it needs an integer hash (PCG). Recorded as a rule in `.design/motion-effects.md` §4.
