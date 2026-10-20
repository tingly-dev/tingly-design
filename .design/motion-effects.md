# Motion effects: shader layers in a motion piece

Status: **已实施** (the contract, the WebGL2 runtime, sixteen built-in presets behind `data-fx` with shared values that reshape them with a CSS stand-in when WebGL2 is off, and a sample, `projects/motion-effects/`); checker errors for hand-written GLSL and a preset picker in the editor are open (§6). The engines weighed, and the measurements behind the choice, are in `.research/motion-effects.md`.

The effects layer of the motion kind (`.design/motion.md`): what an effect is, how it stays frame-exact in export, which engine draws it, and what makes an effect worth having on screen.

## 1. Principles

- **An effect is a seekable embed holding a fragment shader.** It reuses the escape hatch the motion format already has (`<x-embed data-seek>`), not a new element, so the checker, the timeline and export carry it without new concepts.
- **A frame is a pure function of time.** The shader reads only the scene time and the frame's shape. Nothing free-running (no animation loop, no clock, no randomness), so seeking to `t` in preview, in the player and in export shows the same picture.
- **Effects serve the design, never replace it.** An effect earns its place by saying something about the content (§5). Decoration for its own sake reads as a demo.

## 2. The contract

```html
<x-embed data-seek style="position:absolute;left:0;top:0;width:100%;height:100%">
  <canvas data-quality="0.5"></canvas>
  <script type="x-shader/x-fragment">/* GLSL ES 3.0 */</script>
  <script>/* the effect runtime */</script>
</x-embed>
```

- **Inputs:** `time` (seconds into the scene), `aspect` (width / height) and `uv` with a top-left origin. The same inputs would carry over to WGSL line by line if a WebGPU engine is added (§3).
- **Output:** premultiplied alpha. An effect is either a full background (`a = 1`) or a layer between the page's elements; its place in the stack is its place in the DOM, like any other element.
- **One shader for every format.** Geometry is in units of the frame's short side, `(uv - c) * vec2(aspect, 1) / min(aspect, 1)`, so 16:9 and 9:16 share a shader. When an effect wraps an HTML element (a glow around a card), the element uses the same numbers in both formats; the shader and the markup describe one shape.
- **Built in or hand-written.** `data-fx="<preset>; key: value; …"` on an empty embed names a built-in effect (§2.1); the markup is generated where the embed is drawn. Hand-written GLSL with the runtime copied in stays possible for a look no preset gives.
- **`data-quality`** is the share of the layer's device pixels the shader draws, upscaled by the canvas. Soft fields lose nothing at 0.5 and cost a quarter as much; anything with a sharp edge needs 1.
- **Parameters** (colours, speed, the wrapped shape) are constants at the top of the shader. In a built-in effect they are the values of `data-fx`, written as concrete values (`colors: #3d7bff #9861ff`, `box: 760x460 @50% 42%`), not aliases, and turned into those constants.

### 2.1 Built-in effects (`data-fx`)

```html
<x-embed data-fx="edge-glow; box: 760x460 @50% 42%; radius: 36" data-seek data-in="fade 1s @0.15s" style="position:absolute;left:0;top:0;width:100%;height:100%"></x-embed>
```

| Preset | What it is | Its place | Values besides `quality` and `region` |
|---|---|---|---|
| `flow` | ink-like currents of colour folding into each other, an opening or closing | background | `colors`, `background`, `speed`, `amount`, `scale`, `direction` |
| `aurora` | curtains of light across the top of a dark frame | background | `colors`, `background`, `speed`, `amount`, `scale` |
| `mesh` | soft fields of colour drifting into each other, calm | background | `colors` (up to 4), `background`, `speed`, `amount`, `scale` |
| `plasma` | bright bands of colour bending through each other, loud | background | `colors`, `background`, `speed`, `amount`, `scale`, `direction` |
| `waves` | contour lines of a slowly changing landscape, technical | background | `colors`, `background`, `speed`, `amount`, `scale`, `direction` |
| `grid` | a perspective floor rolling towards the viewer under a glowing horizon; text goes in the sky | background | `colors` (lines, horizon), `background`, `speed`, `amount`, `scale` |
| `stars` | flying forward through stars streaming from a point | background | `colors`, `background`, `speed`, `amount`, `at` |
| `halftone` | a dot grid growing and shrinking like print | background | `colors`, `background`, `speed`, `amount`, `scale`, `direction` |
| `edge-glow` | light flowing around a card that is working | layer just before the card | `colors`, `speed`, `amount`, `box` (`760x460 @50% 42%`: size in px, centre in % of the frame; give the card the same numbers), `radius` (px) |
| `sweep` | a band of light crossing a title once per period | layer just after the title | `colors` (the first), `speed`, `amount` (0.35), `every` (`3s`), `angle` (deg) |
| `rays` | shafts of light falling from a point, slowly turning | layer over a background | `colors`, `speed`, `amount`, `at` (`50% 0%` for light from above) |
| `ripple` | rings spreading from a point, one every period: behind a mark or a button | layer just before the mark | `colors`, `speed`, `amount`, `scale`, `at`, `every` |
| `particles` | soft points of light drifting and twinkling | layer over a background | `colors`, `speed`, `amount`, `scale`, `direction` (270, up) |
| `light-leak` | warm light spilling in from the edges, as from a lens | layer last, over the text | `colors`, `speed`, `amount` (0.55) |
| `scanlines` | the lines and slow rolling band of an old screen | layer last | `speed`, `amount` (0.25), `scale` |
| `grain` | film grain | layer last | `speed`, `amount` (0.07) |

- **Shared values reshape any preset.** Besides its own values, a preset reads `scale` (the pattern's size), `direction` (where a field drifts, in degrees: 0 right, 90 down) and `at` (the point rays, ripples and stars come from) where they mean something, and every preset reads `region` (`0% 55% 100% 45%`: left, top, width, height): the shader runs as if the region were the whole embed and its edge is feathered, so an effect is fitted into part of the frame rather than cut out of it. These answer "can it look different" without a new preset per variant; what they cannot change is the kind of motion, which is what a preset is. A composable graph (noise, palette, mask, motion as parts) was weighed and left: it covers more, but its values stop being concrete and a person can no longer say what a line does.
- **One attribute, values written out.** The preset name, then `key: value` pairs separated by `;`, the way `data-keys` reads. Values are concrete (`#3d7bff`, `760x460 @50% 42%`, `3s`), never aliases, and a value left out takes the preset's default (brand colours on near-black). `data-fx-<format>` replaces it in one format, like the timing attributes, for a box that sits elsewhere in a tall frame.
- **Generated where it is drawn.** `fxMarkup` in core (`motionFx.ts`) turns the value into the embed's page: a canvas, the preset's shader with the values as constants, and the runtime. The motion player and renderer, the editing stage, a slide and a deck's downloaded HTML and PDF all call it, so the file stays one line and a fix to a preset reaches every piece. The cost is that a preset's look can change under an existing piece when the preset is improved; a person who wants it frozen copies the markup in by hand.
- **Checked like the subset.** An unknown preset, a value the preset does not read or a value that does not parse is an error from `fxIssues`, through the slide checker that scenes share, so a model's typo comes back with a message instead of quietly falling back to a default.
- **Slides too.** A slide's embed takes `data-fx` the same way: editing, the effect stands at 2 s; presenting and in the downloaded HTML it runs on its own clock; the PDF prints it standing still.

## 3. Engine: WebGL2 inside the page

The shader is drawn with WebGL2 by a small runtime inside the embed: a fullscreen triangle, the two uniforms, and `window.seek(t)` that sizes the canvas (device pixels × `data-quality`), draws once and resolves two animation frames later. WebGL2 runs in every browser and in headless Chromium (ANGLE with SwiftShader when there is no GPU), so the effect takes the same path as any other element: the editor, the player and the exact renderer (`apps/server/src/render.ts`) seek the page and screenshot it, and there is nothing beside the page to install or keep in step. The browser exporter cannot picture an embed and hands pieces that have one to the server (`.design/export.md`).

**Where the embed runs.** The motion stage's own page forbids inline scripts, and a `srcdoc` frame inherits that policy, so an embed written into the stage as `srcdoc` never ran its runtime: the editor's player showed no effect in any browser while the exact renderer (a plain page with no policy) drew it. In the editor the embed loads `embed.html`, the same page slides use (inline scripts allowed, no network, opaque origin), and is handed its markup once it is up; the renderer keeps `srcdoc`, since its page has no policy and no server to load from.

**When the layer cannot draw.** A browser can refuse WebGL2 (hardware acceleration off, a blocklisted GPU, a lost context) and a model's shader can fail to compile or link. A canvas that stays blank with nothing said looks like a broken product, so the runtime reports instead of throwing: it posts `effect-error` with a code (`no-webgl2`, `shader` with the GLSL log, `draw`), the motion stage collects them and the editor words them under the stage in the user's language. A built-in effect also draws a CSS stand-in of itself (radial gradients for the fields, a box shadow for the edge glow, a gradient band for the sweep; grain has none), still a function of time, and reports `fallback`, which the editor words as "a simpler version" rather than "off". A hand-written shader has no stand-in: the scene plays on its own background colour, so the piece degrades to the layer's absence rather than to a failure.

**The renderer's Chrome.** The exact renderer, the page exports and the PDF start Chrome with `--disable-gpu --use-angle=swiftshader --enable-unsafe-swiftshader`: WebGL always draws on SwiftShader on the CPU, so a render is the same picture on a machine with a GPU and one without. Since Chrome 137 a headless Chrome no longer falls back to SwiftShader by itself; without the last flag every effect rendered blank on the server while the editor showed it. "Unsafe" is about running untrusted pages on a JIT'd software GPU; the renderer runs the person's own project, and every embed keeps its sandbox. A lost context is rebuilt on `webglcontextrestored` and redraws the last time. The runtime also falls back to `mediump` where the GPU has no fragment `highp`, and binds a vertex array so the attribute-less triangle is legal on every ANGLE backend.

**Only the scenes on screen hold a context.** A page keeps at most 16 live WebGL contexts and drops the oldest past that, and a piece mounts every scene's embeds at once, so a sample with an effect in every scene lost them all. An embed therefore makes its context on its first seek, not at load; the stage seeks only the embeds whose scene is on screen (while playing too); and an embed not sought for 1.5 s copies its last frame onto a 2D canvas and gives the context back (a live one does the same while its slide is hidden). The first seek after that builds the shader again, which takes over a second on SwiftShader, so the stage waits up to 5 s for an embed to answer before it moves on.

Cost: with no GPU, the sample renders at about 4.5 frames a second against 6 to 14 for plain motion; `data-quality` 0.5 on soft fields is most of the saving.

What it gives up is compute shaders, so simulations (fluid, many-particle physics) are out. WebGPU was evaluated as a second engine through [vgpu](https://github.com/vercel-labs/vgpu) and not adopted: headless Chromium cannot create a WebGPU device, so export needed a Node-side frame host beside the page, which was slower and a second renderer to maintain (`.research/motion-effects.md`). If compute effects are wanted, that is the path to revisit.

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

- **Picking a preset in the editor.** Presets are written by hand or by a model today. The import menu could offer them beside "From a project…", and the panel could show a selected effect's values as fields (colours, the box, speed), written back to `data-fx`.
- **Errors in the checker.** GLSL compile errors in a hand-written shader reach the editor at run time (§3) but not the motion checker, so a model's broken shader does not come back with a line number, like a slide subset error. Built-in presets are checked (§2.1).
- **More presets** when a piece needs one: a focus pull, a liquid distortion over the content (needs the scene as a texture, which the page does not have), particles gathering into a shape. Each needs a job (§5), a CSS stand-in or a stated reason for none, and a row in §2.1.
- **CSS stand-ins** are soft gradients for every background preset; the layers that only add light (rays, ripple, particles, scanlines, grain) draw nothing without WebGL2.
