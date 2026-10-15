// Bench: a motion piece with embeds, drawn three ways at the same moments.
//   ref   the server route: seek, then a screenshot of the page (what apps/server/src/render.ts does)
//   snap  the proposed browser route: each embed frame rasterizes itself and posts an ImageBitmap,
//         the page puts it where the frame is, then the page is rasterized as today (FrameRasterizer)
//   fast  the same, made cheaper: canvases drawn straight in, a JPEG handed over when the frame is opaque (PNG when not), only frames on screen at t
//   base  today's browser route: the page rasterized with the frames left blank
// Prints per-scene fidelity (against ref) and per-frame time, and writes side-by-side pictures.
//
// node bench-snap.mjs <piece dir> <sandbox dist> <rasterizer bundle> <out dir> [samples per scene]
// Needs playwright (Chromium) resolvable from the working directory.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [dir, dist, frBundle, out, perScene = '6'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const motion = JSON.parse(readFileSync(join(dir, 'motion.json'), 'utf8'));
const scenes = Object.fromEntries(motion.order.map((id) => [id, readFileSync(join(dir, 'scenes', id + '.html'), 'utf8')]));
const files = {};
for (const s of Object.values(scenes)) for (const m of s.matchAll(/<x-embed\b[^>]*?\bsrc="([^"]+)"/g)) if (existsSync(join(dir, m[1]))) files[m[1]] = readFileSync(join(dir, m[1]), 'utf8');
const boardRuntime = Object.keys(files).length ? { inline: readFileSync(join(dist, 'runtime.js'), 'utf8') } : undefined;
const fr = readFileSync(frBundle, 'utf8');
const esc = (s) => s.replace(/<\/script/gi, '<\\/script');
const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
const [W, H] = Object.values(motion.formats)[0].size;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--enable-unsafe-swiftshader', '--hide-scrollbars'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, bypassCSP: true });
const page = await ctx.newPage();
page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()));
await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent}</style></head><body><div id="root"></div><script>${esc(readFileSync(join(dist, 'motion.js'), 'utf8'))}</script><script>${esc(fr)}</script></body></html>`);
const info = await page.evaluate(
  `(async()=>{window.__stage=await window.dcMotion.mount({motion:${json(motion)},scenes:${json(scenes)},files:${json(files)},boardRuntime:${json(boardRuntime ?? null)}||undefined,format:${json(Object.keys(motion.formats)[0])},root:document.getElementById('root')});window.__stage.pause();return{duration:window.__stage.duration,scenes:window.__stage.scenes,errors:window.__stage.effectErrors}})()`,
);
console.error('mounted', info.duration, 'ms', info.errors.length ? info.errors : '');

// every embed frame learns to rasterize itself (in the product this lives in runtime.js / embed.html)
const inFrame = `(() => {
  if (window.__snapReady) return; window.__snapReady = true;
  let fr = null, fast = null;
  addEventListener('message', async (e) => {
    if (e.data?.dcMotion !== 'snap') return;
    const t0 = performance.now();
    const w = innerWidth, h = innerHeight;
    const c = new OffscreenCanvas(w, h);
    const g = c.getContext('2d');
    if (e.data.fast) {
      // the DOM through foreignObject without its canvases, then each canvas drawn straight in (no PNG round trip);
      // a frame that is only a canvas (a shader) skips foreignObject altogether
      const cvs = [...document.querySelectorAll('canvas')];
      const onlyCanvas = cvs.length && document.body.innerText.trim() === '' && !document.querySelector('img,svg,video,#dc-app *');
      if (!onlyCanvas) {
        fast ??= new __FR({ width: w, height: h, filter: (n) => n.nodeName !== 'CANVAS' });
        const f = await fast.begin(document.body);
        await f.ready;
        f.draw(c);
      }
      for (const cv of cvs) { const r = cv.getBoundingClientRect(); g.drawImage(cv, r.left, r.top, r.width, r.height); }
      // JPEG is cheap but has no alpha: use it when the picture is opaque (checked on a small copy), else PNG
      const probe = new OffscreenCanvas(48, 27).getContext('2d', { willReadFrequently: true });
      probe.drawImage(c, 0, 0, 48, 27);
      const px = probe.getImageData(0, 0, 48, 27).data;
      let opaque = true;
      for (let i = 3; i < px.length; i += 4) if (px[i] < 255) { opaque = false; break; }
      const blob = await c.convertToBlob(opaque ? { type: 'image/jpeg', quality: 0.92 } : { type: 'image/png' });
      const url = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(blob); });
      e.source.postMessage({ dcMotion: 'snapped', n: e.data.n, url, w, h, ms: performance.now() - t0 }, '*');
      return;
    }
    fr ??= new __FR({ width: w, height: h });
    const f = await fr.begin(document.body);
    await f.ready;
    f.draw(c);
    const bitmap = c.transferToImageBitmap();
    e.source.postMessage({ dcMotion: 'snapped', n: e.data.n, bitmap, ms: performance.now() - t0 }, '*', [bitmap]);
  });
})()`;
let frames = 0;
for (const f of page.frames()) {
  if (f === page.mainFrame()) continue;
  await f.evaluate(fr + ';' + inFrame);
  frames++;
}
console.error('embed frames', frames);

await page.evaluate(() => {
  let n = 0;
  const pr = new __FR({ width: innerWidth, height: innerHeight });
  const root = document.getElementById('root');
  const visible = (el) => { for (let p = el; p && p !== root; p = p.parentElement) { const cs = getComputedStyle(p); if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false; } return true; };
  const snapFrame = (frame, fast) => new Promise((ok) => {
    const id = ++n;
    const on = (e) => { if (e.source === frame.contentWindow && e.data?.dcMotion === 'snapped' && e.data.n === id) { removeEventListener('message', on); ok(e.data); } };
    addEventListener('message', on);
    frame.contentWindow.postMessage({ dcMotion: 'snap', n: id, fast }, '*');
    setTimeout(() => ok(null), 3000);
  });
  const toData = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const canvas = () => Object.assign(document.createElement('canvas'), { width: innerWidth, height: innerHeight });
  // the frames worth asking: visible, and (fast) in a scene that is on screen at t
  const onAt = (frame, t) => {
    const id = frame.closest('.dc-slide-host')?.dataset.scene;
    const w = window.__stage.scenes.find((s) => s.id === id);
    return !w || (t >= w.start && t < w.start + w.duration + (w.transition?.duration ?? 0));
  };
  window.__draw = async (mode, t) => {
    const t0 = performance.now();
    const swaps = [];
    let frameMs = 0, count = 0;
    if (mode !== 'base') {
      const fast = mode === 'fast';
      const live = [...root.querySelectorAll('x-embed > iframe')].filter((f) => visible(f) && (!fast || onAt(f, t)));
      const shots = await Promise.all(live.map((f) => snapFrame(f, fast)));
      live.forEach((frame, i) => {
        const s = shots[i];
        if (!s) return;
        frameMs = Math.max(frameMs, s.ms); count++;
        let c;
        if (s.url) {
          c = document.createElement('img');
          c.src = s.url;
        } else {
          c = document.createElement('canvas');
          c.width = s.bitmap.width; c.height = s.bitmap.height;
          c.getContext('2d').drawImage(s.bitmap, 0, 0);
        }
        c.style.cssText = frame.style.cssText;
        const cs = getComputedStyle(frame);
        c.style.width = cs.width; c.style.height = cs.height; c.style.display = 'block';
        frame.style.visibility = 'hidden';
        frame.after(c);
        swaps.push([frame, c]);
      });
      await Promise.all(swaps.map(([, c]) => (c.decode ? c.decode().catch(() => {}) : null)));
    }
    const t1 = performance.now();
    const f = await pr.begin(root);
    await f.ready;
    const c = canvas();
    f.draw(c);
    const t2 = performance.now();
    for (const [frame, cv] of swaps) { cv.remove(); frame.style.visibility = ''; }
    window.__last = c;
    return { snapMs: t1 - t0, frameMs, pageMs: t2 - t1, totalMs: t2 - t0, embeds: count };
  };
  window.__diff = async (refUrl) => {
    const img = new Image(); img.src = refUrl; await img.decode();
    const r = canvas(); r.getContext('2d').drawImage(img, 0, 0);
    const a = toData(r), b = toData(window.__last);
    let sum = 0, bad = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      sum += (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
      if (d > 32) bad++;
    }
    return { mae: sum / (a.length / 4), badPct: (100 * bad) / (a.length / 4) };
  };
  window.__png = () => window.__last.toDataURL('image/png');
});

const cdp = await ctx.newCDPSession(page);
const rows = [];
for (const sc of info.scenes) {
  const k = Number(perScene);
  for (let i = 0; i < k; i++) {
    const t = Math.round(sc.start + (sc.duration * (i + 0.5)) / k);
    await page.evaluate((t) => window.__stage.seek(t), t);
    const r0 = performance.now();
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
    const refMs = performance.now() - r0;
    const ref = 'data:image/png;base64,' + data;
    const snap = await page.evaluate((t) => window.__draw('naive', t), t);
    const snapDiff = await page.evaluate((u) => window.__diff(u), ref);
    const fast = await page.evaluate((t) => window.__draw('fast', t), t);
    const fastDiff = await page.evaluate((u) => window.__diff(u), ref);
    const fastPng = i === Math.floor(k / 2) ? await page.evaluate(() => window.__png()) : null;
    const base = await page.evaluate((t) => window.__draw('base', t), t);
    const baseDiff = await page.evaluate((u) => window.__diff(u), ref);
    if (fastPng) {
      const basePng = await page.evaluate(() => window.__png());
      for (const [name, url] of [['ref', ref], ['snap', fastPng], ['base', basePng]]) writeFileSync(join(out, `${sc.id}-${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
    }
    rows.push({ scene: sc.id, t, refMs, ...snap, snapMae: snapDiff.mae, snapBad: snapDiff.badPct, fastMs: fast.totalMs, fastFrameMs: fast.frameMs, fastPageMs: fast.pageMs, fastEmbeds: fast.embeds, fastMae: fastDiff.mae, fastBad: fastDiff.badPct, baseMs: base.totalMs, baseMae: baseDiff.mae, baseBad: baseDiff.badPct });
  }
}
await browser.close();

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const f1 = (x) => x.toFixed(1);
const by = {};
for (const r of rows) (by[r.scene] ??= []).push(r);
const lines = ['| scene | ref (server) ms | naive snap ms (frame / page) | fast snap ms (frame / page) | base ms | naive vs ref | fast vs ref | base vs ref |', '|---|---|---|---|---|---|---|---|'];
const d = (rs, k) => `${f1(avg(rs.map((r) => r[k + 'Mae'])))} / ${f1(avg(rs.map((r) => r[k + 'Bad'])))}%`;
for (const [s, rs] of Object.entries(by))
  lines.push(`| ${s} | ${f1(avg(rs.map((r) => r.refMs)))} | ${f1(avg(rs.map((r) => r.totalMs)))} (${f1(avg(rs.map((r) => r.frameMs)))} / ${f1(avg(rs.map((r) => r.pageMs)))}) | ${f1(avg(rs.map((r) => r.fastMs)))} (${f1(avg(rs.map((r) => r.fastFrameMs)))} / ${f1(avg(rs.map((r) => r.fastPageMs)))}) | ${f1(avg(rs.map((r) => r.baseMs)))} | ${d(rs, 'snap')} | ${d(rs, 'fast')} | ${d(rs, 'base')} |`);
console.log(lines.join('\n'));
writeFileSync(join(out, 'rows.json'), JSON.stringify(rows, null, 1));
