# Motion effects: shader layers in a motion piece

Status: **two working samples, not yet in the editor.** This note covers the effects layer of the motion kind (`.design/motion.md`): what an effect is, how it renders to video frame-exact, the two engines tried (WebGL2 and Vercel's vgpu on WebGPU), what they cost, and what makes an effect look good rather than like a demo. Samples: `projects/webgl-motion/` and `projects/vgpu-motion/`, the same 12 s piece in 16:9 and 9:16. Measurements are from a 4-core cloud container with no GPU, October 2026.

## 0. Decisions so far

- **An effect is a seekable embed holding a fragment shader.** It is the escape hatch `.design/motion.md` §5 already defines (`<x-embed data-seek>`), not a new element, so the checker, the timeline and export need nothing new to carry it.
- **WebGL2 is the main engine; vgpu (WebGPU) is the second, for effects that need compute.** WebGL2 draws inside the page in every browser and in our headless renderer; WebGPU does not run in the renderer here, so vgpu frames have to be drawn in Node and shipped in (§3). Both samples are kept.
- **Effects support the design; they are never the subject.** The owner rejected the first middle scene (glowing dots orbiting the mark) as ugly and kept the two aurora scenes. The replacement, light flowing around the edge of a card while the AI designs it, is the model for the rest (§5).

## 1. The contract

```html
<x-embed data-seek style="position:absolute;left:0;top:0;width:100%;height:100%">
  <canvas data-quality="0.5"></canvas>
  <script type="x-shader/x-fragment">/* GLSL ES 3.0 */</script>   <!-- or type="text/wgsl" -->
  <script>/* the effect runtime */</script>
</x-embed>
```

- **Inputs:** `time` (seconds into the scene) and `aspect` (width / height), and `uv` with a top-left origin. Nothing else moves the picture, so a frame is a pure function of `time`: seekable by construction, and the same in preview and export.
- **Output:** premultiplied alpha. An effect can be a full background (`a = 1`) or a layer between the page's elements (the halo). Its place in the stack is its place in the DOM, like any other element.
- **Size-independent geometry:** shaders that place something (the halo's card) work in units of the frame's short side, `(uv - c) * vec2(aspect, 1) / min(aspect, 1)`, so 16:9 and 9:16 share one shader. The HTML element it wraps must use the same numbers (the card is 760 × 460 px at 42 % from the top in both formats, 1080 px being the short side of each).
- **`data-quality`:** the share of the layer's device pixels the shader draws, upscaled by the canvas. 0.5 for soft fields (aurora: no visible loss, 4× fewer pixels); 1 when the effect has a sharp edge (the halo's 4 px rim).
- **Parameters** (colours, speed, the card's rectangle) are constants at the top of the shader for now. Phase 1 should lift the ones a person wants to change into attributes shown as concrete values (`hue 0.06/s`, `card 760 × 460 @ 42 %`).

## 2. WebGL2 (main engine)

The runtime compiles the shader once at load, then `seek(t)` sizes the canvas, sets `time` and `aspect`, draws one triangle, and resolves two animation frames later. Headless Chromium has WebGL2 (ANGLE on SwiftShader), so the renderer needs nothing beyond the page.

- **One race, fixed:** a canvas first drawn when its scene comes into view (the second scene fading in over the first) was sometimes captured before its layer was on screen, so 1 frame of 16 differed in about half the early `--verify` runs. Drawing once at load, and resolving `seek` two frames after the draw, made every run 16/16 since.
- **No compute shaders**, so simulations (fluid, many-particle physics) are out of reach.

## 3. vgpu on WebGPU (second engine)

[vgpu](https://github.com/vercel-labs/vgpu) (Vercel, MIT, pinned 0.3.1) runs one WGSL source in the browser, in Node (`vgpu/node`, on Dawn, or Mesa's software renderer without a GPU) and in a mock.

- **Headless Chromium here exposes `navigator.gpu` but cannot create a device** (SwiftShader; seven flag combinations tried, raw WebGPU fails the same way). So export takes a detour: the embed posts a probe to its parent; the render page answers with a URL; each `seek(t)` POSTs `{wgsl, t, w, h}` there; `scripts/motion-fx.mjs` serves it through `page.route`, draws the frame with `vgpu/node` and returns raw RGBA for the canvas. With no answer in 250 ms (the player, later the editor) the embed draws itself with vgpu in the browser's WebGPU. That browser path is unverified here and loads vgpu from jsDelivr; the editor would bundle it.
- **Warm-up:** starting Dawn and compiling a shader takes about 0.8 s on the CPU, near the embed's 1 s seek timeout, so the renderer compiles every shader in the scenes before the first frame. Without it the first frames were captured blank.
- **Transfer** is about 60 ms a frame at 960 × 540 (raw RGBA through `fetch`; base64 through `exposeFunction` and `postMessage` was twice as slow).
- **What it buys:** compute shaders, a typed WGSL module system, and agent tooling (`vgpu check`, `vgpu docs`, an MCP server) that fits the checker loop in `.design/motion.md` §7.

## 4. Results

| 12 s at 30 fps, per format | WebGL2 | vgpu |
|---|---|---|
| Render time | 78 to 84 s (4.4 to 4.6 fps) | 106 to 141 s (2.6 to 3.4 fps) |
| `--verify` (16 frames, reverse order) | 16/16 | 16/16 |
| Moving parts | the embed runtime | the runtime, the probe, the frame host, Dawn and llvmpipe |
| Browser preview | the same path as export | WebGPU, unverified |

For comparison, the motion sample without effects renders at 6 to 14 fps. A GPU would remove most of the shading cost on both paths.

**The same shader is not the same picture across renderers.** The halo and the orbit (only `sin`/`cos` of small values) match between llvmpipe and SwiftShader; the aurora's pattern differs, because its hash, `fract(sin(x) * 43758.5)`, depends on how each computes `sin` of large values. Each renderer is deterministic on its own. Where the picture must match across machines, use an integer hash (PCG).

## 5. What makes an effect look good

Learned from the three effects in the samples, the one the owner rejected included:

- **Give the light a job.** The rejected orbit was 28 glowing dots circling the logo: decoration with nothing to say, in saturated neon, the brightest thing on screen. The halo is the same technique pointed at the content: light runs along the edge of a card while its status says "Designing…", so the effect reads as "the AI is working on this".
- **One accent, restrained.** Light at the edges, darkness elsewhere, the content brighter than the effect. A thin rim (about 4 px) plus a soft falloff (tens of px) plus a faint wide bloom reads as light; a single blurry blob reads as a smudge.
- **Brand colours, not the rainbow.** The halo cycles through four stops (blue, violet, pink, amber) and drifts slowly (0.06 turns per second); the aurora uses the same family on near-black.
- **Uneven, slow motion.** Two sine waves of different speeds multiplied together make the halo breathe unevenly around the edge, which reads as flowing rather than pulsing. Anything that moves faster than the text's entrance competes with it.
- **Ease in with the scene.** The halo's intensity rises over its first second (`smoothstep(0.15, 1.2, time)`) while the card fades in, so the light never appears around nothing. A shader-drawn shape that matches an HTML element should not enter with a scale preset, because the element would grow and the light would not.

## 6. Open

- The runtime is copied into each effect. A `data-fx` attribute, with the motion runtime injecting the code, would remove the copy and let the editor list effects as presets.
- GLSL compile errors and `vgpu check` should reach the motion checker, so a model's broken shader comes back as an error with a line number, like a slide subset error.
- A preset library to start with: aurora, edge halo, film grain, gradient mesh, light sweep across text. Each needs one sentence for when to use it (§5), not just a name.
