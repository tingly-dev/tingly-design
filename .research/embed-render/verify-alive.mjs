// Is today's blank picture the export, or a dead effect? At each moment:
//   before  page screenshot (the frames as the screen shows them)
//   today   the product's own browser export of that moment (dcMotionExport.exportFrame, export.js)
//   after   page screenshot again, right after the export
// plus a look inside every embed frame on screen: a shader's canvas pixels, an artboard's drawn nodes.
// node verify-alive.mjs <piece dir> <sandbox dist> <out dir>
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [dir, dist, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const motion = JSON.parse(readFileSync(join(dir, 'motion.json'), 'utf8'));
const scenes = Object.fromEntries(motion.order.map((id) => [id, readFileSync(join(dir, 'scenes', id + '.html'), 'utf8')]));
const files = {};
for (const s of Object.values(scenes)) for (const m of s.matchAll(/<x-embed\b[^>]*?\bsrc="([^"]+)"/g)) if (existsSync(join(dir, m[1]))) files[m[1]] = readFileSync(join(dir, m[1]), 'utf8');
const boardRuntime = Object.keys(files).length ? { inline: readFileSync(join(dist, 'runtime.js'), 'utf8') } : undefined;
const esc = (s) => s.replace(/<\/script/gi, '<\\/script');
const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
const [W, H] = Object.values(motion.formats)[0].size;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--enable-unsafe-swiftshader', '--hide-scrollbars'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent}</style></head><body><div id="root"></div><script>${esc(readFileSync(join(dist, 'motion.js'), 'utf8'))}</script><script>${esc(readFileSync(join(dist, 'export.js'), 'utf8'))}</script></body></html>`);
const info = await page.evaluate(`(async()=>{window.__stage=await window.dcMotion.mount({motion:${json(motion)},scenes:${json(scenes)},files:${json(files)},boardRuntime:${json(boardRuntime ?? null)}||undefined,format:${json(Object.keys(motion.formats)[0])},root:document.getElementById('root')});window.__stage.pause();return{scenes:window.__stage.scenes,errors:window.__stage.effectErrors}})()`);
console.log('effect errors:', JSON.stringify(info.errors));

await page.evaluate(() => {
  const canvas = () => Object.assign(document.createElement('canvas'), { width: innerWidth, height: innerHeight });
  const load = async (u) => { const i = new Image(); i.src = u; await i.decode(); const c = canvas(); c.getContext('2d').drawImage(i, 0, 0, c.width, c.height); return c.getContext('2d').getImageData(0, 0, c.width, c.height).data; };
  window.__cmp = async (a, b) => {
    const x = await load(a), y = await load(b);
    let bad = 0;
    for (let i = 0; i < x.length; i += 4) if (Math.max(Math.abs(x[i] - y[i]), Math.abs(x[i + 1] - y[i + 1]), Math.abs(x[i + 2] - y[i + 2])) > 32) bad++;
    return (100 * bad) / (x.length / 4);
  };
  window.__today = async (t) => { const b = await window.dcMotionExport.exportFrame(window.__stage, document.getElementById('root'), { t }); return await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(b); }); };
});

const cdp = await ctx.newCDPSession(page);
const shot = async () => 'data:image/png;base64,' + (await cdp.send('Page.captureScreenshot', { format: 'png' })).data;
// what each embed frame holds right now: a shader canvas's lit pixels, an artboard's drawn elements
const inside = async () => {
  const r = [];
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    r.push(await f.evaluate(() => {
      const cv = document.querySelector('canvas');
      if (cv) {
        const c = Object.assign(document.createElement('canvas'), { width: 64, height: 36 });
        const g = c.getContext('2d'); g.drawImage(cv, 0, 0, 64, 36);
        const d = g.getImageData(0, 0, 64, 36).data; let lit = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
        return { kind: 'shader', litPct: Math.round((100 * lit) / (64 * 36)) };
      }
      return { kind: 'artboard', drawnNodes: document.querySelectorAll('#dc-app *').length };
    }));
  }
  return r;
};
const rows = [];
for (const sc of info.scenes) {
  const t = Math.round(sc.start + sc.duration / 2);
  await page.evaluate((t) => window.__stage.seek(t), t);
  const before = await shot();
  const inBefore = await inside();
  const today = await page.evaluate((t) => window.__today(t), t);
  const after = await shot();
  const inAfter = await inside();
  const row = { scene: sc.id, t, beforeVsAfterPct: await page.evaluate(([a, b]) => window.__cmp(a, b), [before, after]), todayVsBeforePct: await page.evaluate(([a, b]) => window.__cmp(a, b), [today, before]), framesBefore: inBefore, framesAfter: inAfter };
  rows.push(row);
  console.log(JSON.stringify(row));
  for (const [n, u] of [['before', before], ['today', today], ['after', after]]) writeFileSync(join(out, `${sc.id}-${n}.png`), Buffer.from(u.split(',')[1], 'base64'));
}
writeFileSync(join(out, 'alive.json'), JSON.stringify(rows, null, 1));
await browser.close();
