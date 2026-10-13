# Motion effects: shader layers in a motion piece

The effects layer of the motion kind (`.design/motion.md`): what an effect is, how it stays frame-exact in export, which engine draws it, and what makes an effect worth having on screen. Samples: `projects/webgl-motion/` and `projects/vgpu-motion/`, the same piece built with each engine.

## 1. Principles

- **An effect is a seekable embed holding a fragment shader.** It reuses the escape hatch the motion format already has (`<x-embed data-seek>`), not a new element, so the checker, the timeline and export carry it without new concepts.
- **A frame is a pure function of time.** The shader reads only the scene time and the frame's shape. Nothing free-running (no animation loop, no clock, no randomness), so seeking to `t` in preview, in the player and in export shows the same picture.
- **Effects serve the design, never replace it.** An effect earns its place by saying something about the content (§5). Decoration for its own sake reads as a demo.

## 2. The contract

```html
<x-embed data-seek style="position:absolute;left:0;top:0;width:100%;height:100%">
  <canvas data-quality="0.5"></canvas>
  <script type="x-shader/x-fragment">/* GLSL ES 3.0 */</script>   <!-- or type="text/wgsl" -->
  <script>/* the effect runtime */</script>
</x-embed>
```

- **Inputs:** `time` (seconds into the scene), `aspect` (width / height) and `uv` with a top-left origin, the same in GLSL and WGSL so an effect can be ported line by line.
- **Output:** premultiplied alpha. An effect is either a full background (`a = 1`) or a layer between the page's elements; its place in the stack is its place in the DOM, like any other element.
- **One shader for every format.** Geometry is in units of the frame's short side, `(uv - c) * vec2(aspect, 1) / min(aspect, 1)`, so 16:9 and 9:16 share a shader. When an effect wraps an HTML element (a glow around a card), the element uses the same numbers in both formats; the shader and the markup describe one shape.
- **`data-quality`** is the share of the layer's device pixels the shader draws, upscaled by the canvas. Soft fields lose nothing at 0.5 and cost a quarter as much; anything with a sharp edge needs 1.
- **Parameters** (colours, speed, the wrapped shape) are constants at the top of the shader. The ones a person will want to change should become attributes shown as concrete values (`hue 0.06/s`, `card 760 × 460 @ 42 %`), not aliases.

## 3. Engines

**WebGL2 is the main engine.** It runs in every browser and in the headless renderer, so the effect draws itself inside the page: the editor, the player and export take the same path, and there is nothing beside the page to install or keep in step. Its limit is the lack of compute shaders, which rules out simulations (fluid, many-particle physics).

**WebGPU through [vgpu](https://github.com/vercel-labs/vgpu) is the second engine**, for effects that need compute. vgpu (MIT, pinned) runs one WGSL source in the browser, in Node (`vgpu/node`, on Dawn, or Mesa's software renderer without a GPU) and in a mock, and brings agent tooling (`vgpu check`, `vgpu docs`, an MCP server) that fits the checker loop in `.design/motion.md` §7. The cost is that headless Chromium can expose `navigator.gpu` without being able to create a device, so export cannot count on WebGPU in the page. The embed therefore asks its parent for a frame host: in the renderer, `scripts/motion-fx.mjs` answers with a URL, draws each requested frame with `vgpu/node` from the same shader at the same time, and returns raw RGBA for the canvas; with no host (the player, the editor) the embed draws with the browser's WebGPU.

Consequences of the vgpu path, each handled in the renderer:

- **Cold start.** Starting Dawn and compiling a shader on the CPU takes close to a second, about the embed's seek timeout, so the renderer compiles every shader in the scenes before the first frame.
- **Transfer.** Each frame crosses from Node into the page; raw bytes through a routed `fetch` are about half the cost of base64 through `postMessage`. `data-quality` cuts this along with shading.
- **Cost.** With no GPU, the vgpu path renders roughly 2.6 to 3.4 frames a second against 4.4 to 4.6 for WebGL2 (plain motion: 6 to 14). A GPU removes most of the shading cost on both.

## 4. Determinism

- **Draw before the scene shows.** A WebGL canvas drawn for the first time as its scene comes into view can be captured before its layer is on screen. The runtime draws once when the embed loads, and resolves `seek` two animation frames after drawing.
- **Same shader, same renderer, same picture; not across renderers.** Built-in `sin` of large values differs between implementations (llvmpipe, SwiftShader, real GPUs), so the common hash `fract(sin(x) * 43758.5)` gives a different noise pattern on each. Effects built only on small-argument trigonometry match everywhere. Where a picture must match across machines, use an integer hash (PCG).
- `--verify` (16 frames, seeked in reverse) covers effects like any other layer.

## 5. What makes an effect look good

- **Give the light a job.** Glowing dots circling a logo say nothing and draw the eye from everything else. The same glow running along the edge of a card whose status says "Designing…" reads as "the AI is working on this".
- **One accent, restrained.** Light at the edges, darkness elsewhere, the content brighter than the effect. A thin rim (a few px), a soft falloff (tens of px) and a faint wide bloom read as light; a single blurry blob reads as a smudge.
- **Brand colours, not the rainbow.** A few stops from the brand family (blue, violet, pink, amber), drifting slowly, on near-black.
- **Uneven, slow motion.** Two slow waves at different speeds, multiplied, make light breathe unevenly along an edge, which reads as flowing rather than pulsing. Anything moving faster than the text's entrance competes with it.
- **Enter with the content.** An effect that frames an element fades up with it, so light never appears around nothing; and the element must not enter with a scale preset, or it grows while the light stays put.

## 6. Open questions

- **Injecting the runtime.** Today each effect carries a copy of it. A `data-fx` attribute with the motion runtime injecting the code would remove the copy and let the editor list effects as presets.
- **Errors in the checker.** GLSL compile errors and `vgpu check` should reach the motion checker, so a model's broken shader comes back with a line number, like a slide subset error.
- **A first preset library:** aurora, edge glow, film grain, gradient mesh, light sweep across text, each with one sentence on when to use it (§5), not just a name.
- **The browser WebGPU path** of vgpu is not yet exercised in a real browser, and it loads vgpu from a CDN; the editor would bundle it.
