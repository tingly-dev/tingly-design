// Spike: can a sandboxed (opaque-origin) embed frame paint itself and hand the
// pixels to the page around it, with no server? Run: node spike-frame-snapshot.mjs
import { chromium } from 'playwright';

const inner = `<!doctype html><html><body style="margin:0">
<div id="root" style="width:200px;height:100px;position:relative;background:#ff0000">
  <div style="position:absolute;left:100px;top:0;width:100px;height:50px;background:#00ff00"></div>
  <canvas id="c2d" width="100" height="50" style="position:absolute;left:100px;top:50px"></canvas>
  <canvas id="gl" width="100" height="50" style="position:absolute;left:0;top:50px"></canvas>
</div>
<script>
const g = document.getElementById('c2d').getContext('2d'); g.fillStyle = '#0000ff'; g.fillRect(0,0,100,50);
const gl = document.getElementById('gl').getContext('webgl', { preserveDrawingBuffer: true });
let glOk = !!gl; if (gl) { gl.clearColor(1,1,0,1); gl.clear(gl.COLOR_BUFFER_BIT); }
addEventListener('message', async (e) => {
  if (e.data?.snap == null) return;
  const root = document.getElementById('root');
  // DOM: the frame's own tree through foreignObject (what packages/export does for the page)
  const clone = root.cloneNode(true);
  clone.querySelectorAll('canvas').forEach((c) => c.remove());
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><foreignObject width="100%" height="100%">' +
    new XMLSerializer().serializeToString(clone) + '</foreignObject></svg>';
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const out = new OffscreenCanvas(200, 100), o = out.getContext('2d');
  o.drawImage(img, 0, 0);
  // canvases (2D and WebGL) drawn straight in, at their box
  for (const c of root.querySelectorAll('canvas')) o.drawImage(c, c.offsetLeft, c.offsetTop);
  let bitmap, err = null;
  try { bitmap = out.transferToImageBitmap(); } catch (x) { err = String(x); }
  parent.postMessage({ snapped: e.data.snap, bitmap, err, glOk, origin: location.origin }, '*', bitmap ? [bitmap] : []);
});
parent.postMessage({ ready: true }, '*');
</script></body></html>`;

const outer = `<!doctype html><html><body>
<iframe id="f" sandbox="allow-scripts" width="200" height="100"></iframe>
<canvas id="dst" width="200" height="100"></canvas>
<script>
window.result = new Promise((resolve) => {
  const f = document.getElementById('f');
  addEventListener('message', (e) => {
    if (e.data?.ready) f.contentWindow.postMessage({ snap: 1 }, '*');
    if (e.data?.snapped) {
      if (!e.data.bitmap) return resolve({ err: e.data.err });
      const c = document.getElementById('dst').getContext('2d');
      c.drawImage(e.data.bitmap, 0, 0);
      let px, tainted = false;
      try { px = (x, y) => Array.from(c.getImageData(x, y, 1, 1).data); } catch { tainted = true; }
      try { document.getElementById('dst').toDataURL(); } catch { tainted = true; }
      resolve({ origin: e.data.origin, glOk: e.data.glOk, tainted,
        dom_red: px(50, 25), dom_green: px(150, 25), canvas2d_blue: px(150, 75), webgl_yellow: px(50, 75) });
    }
  });
  f.srcdoc = ${JSON.stringify(inner).replace(/<\//g, "<\\/")};
});
</script></body></html>`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setContent(outer);
console.log(JSON.stringify(await page.evaluate(() => window.result), null, 1));
await browser.close();
