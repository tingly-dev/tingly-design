/**
 * Shader effects for motion renders (see .design/motion.md §12).
 *
 * An effect is a `<x-embed data-seek>` holding a `<canvas>`, a WGSL fragment
 * shader in `<script type="text/wgsl">` and a small runtime (see
 * projects/vgpu-motion/scenes/intro.html). In a browser with WebGPU it draws
 * itself with vgpu. Headless Chromium usually has no working WebGPU, so the
 * renderer answers the embed's probe with a URL, and the embed fetches each
 * frame from it: drawn here with vgpu/node (Dawn, or Mesa's software renderer
 * when there is no GPU), from the same shader at the same time. The shader is
 * a function of time only, so every render of a frame is the same picture.
 */

let gpuPromise = null;
const effects = new Map();
const targets = new Map();

async function gpu() {
  gpuPromise ??= (async () => {
    const { init } = await import('vgpu/node');
    try {
      return await init();
    } catch (e) {
      if (e?.code !== 'VGPU-NODE-NO-ADAPTER') throw e;
      try {
        return await init({ adapter: 'software' });
      } catch {
        throw new Error('no WebGPU adapter for shader effects: run `npx vgpu install-software-renderer` once, or render on a machine with a GPU');
      }
    }
  })();
  return gpuPromise;
}

/** One frame of an effect: straight-alpha RGBA, `w × h`. */
export async function fxFrame({ wgsl, t, w, h }) {
  const g = await gpu();
  const { effect, frame, target } = await import('vgpu/node');
  let fx = effects.get(wgsl);
  if (!fx) effects.set(wgsl, (fx = effect(g, wgsl)));
  const key = `${w}x${h}`;
  let tg = targets.get(key);
  if (!tg) targets.set(key, (tg = target(g, { size: [w, h], format: 'rgba8unorm' })));
  fx.set({ fx: { time: t / 1000, aspect: w / h } });
  frame(g, (f) => f.pass(tg, fx));
  const px = Buffer.from(await tg.read());
  // shaders write premultiplied alpha (what a WebGPU canvas composites); ImageData wants it straight
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    if (a === 0 || a === 255) continue;
    px[i] = Math.min(255, Math.round((px[i] * 255) / a));
    px[i + 1] = Math.min(255, Math.round((px[i + 1] * 255) / a));
    px[i + 2] = Math.min(255, Math.round((px[i + 2] * 255) / a));
  }
  return px;
}

const FX_URL = 'http://dc-fx.invalid/frame';

/** Serves a page's effect frames: POST {wgsl, t, w, h} to FX_URL, raw RGBA back. */
export async function hostFx(page) {
  await page.route(`${FX_URL}*`, async (route) => {
    try {
      const px = await fxFrame(JSON.parse(route.request().postData() ?? '{}'));
      await route.fulfill({ body: px, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' } });
    } catch (e) {
      console.error(`[fx] ${e.message}`);
      await route.fulfill({ status: 500, body: String(e.message), headers: { 'access-control-allow-origin': '*' } });
    }
  });
}

/** Goes in the render page: tells effect embeds where to fetch their frames. */
export const FX_HOST = `addEventListener('message',function(e){var d=e.data;if(d&&d.dcFx==='probe'&&e.source)e.source.postMessage({dcFx:'host',url:${JSON.stringify(FX_URL)}},'*')});`;

/** Starts the GPU and compiles every shader in the scenes before the first frame. */
export async function warmFx(htmls) {
  const shaders = new Set();
  for (const html of htmls) for (const m of html.matchAll(/<script type="text\/wgsl">([\s\S]*?)<\/script>/g)) shaders.add(m[1]);
  for (const wgsl of shaders) await fxFrame({ wgsl, t: 0, w: 8, h: 8 });
  return shaders.size;
}

export function disposeFx() {
  gpuPromise?.then((g) => g.dispose()).catch(() => {});
}
