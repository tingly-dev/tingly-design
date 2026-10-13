#!/usr/bin/env node
/**
 * Render a motion project to video (phase 0 spike, see .design/motion.md).
 *
 *   node scripts/motion-render.mjs <project> [options]
 *
 *   --format wide,tall   formats to render (default: all in motion.json)
 *   --scale 2            render at 2× and downsample (sharper type, slower)
 *   --speed 1.5          play the authored timing this much faster (default: motion.json "speed", else 1)
 *   --gif                also write a GIF per format
 *   --poster 2.5         use the frame at 2.5 s as the cover, whatever motion.json says
 *   --player             also write a single-file HTML player
 *   --verify             seek frames in two orders and check they match
 *   --out <dir>          output folder (default: projects/<project>/renders)
 *
 * The cover (motion.json "cover": a time such as "2.2s", or a scene file outside
 * "order" such as "poster") is written as <project>-<format>-cover.png, embedded
 * in the MP4 as its cover art, and used as the video's first frame unless
 * "coverFirstFrame" is false, so apps that thumbnail frame 0 don't show a blank.
 *
 * Needs Chromium (DC_CHROME, or Playwright's browsers) and ffmpeg on PATH.
 * Every frame is a seek on the runtime's single clock, then a screenshot, so
 * the same source always gives the same video.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { disposeFx, FX_HOST, hostFx, warmFx } from './motion-fx.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
};
const VALUED = ['--format', '--scale', '--speed', '--poster', '--out'];
const project = args.find((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
if (!project) {
  console.error('usage: node scripts/motion-render.mjs <project> [--format wide,tall] [--scale 2] [--speed 1.5] [--gif] [--poster 2.5] [--player] [--verify] [--out dir]');
  process.exit(2);
}

const projectsDir = process.env.DC_PROJECTS ? resolve(process.env.DC_PROJECTS) : join(REPO, 'projects');
const dir = existsSync(project) ? resolve(project) : join(projectsDir, project);
const motion = JSON.parse(readFileSync(join(dir, 'motion.json'), 'utf8'));
const scenes = Object.fromEntries(
  (motion.order ?? []).filter((id) => existsSync(join(dir, 'scenes', `${id}.html`))).map((id) => [id, readFileSync(join(dir, 'scenes', `${id}.html`), 'utf8')]),
);
function seconds(v) {
  const m = /^(\d+(?:\.\d+)?|\.\d+)(ms|s)?$/.exec(String(v ?? '').trim());
  return m ? Number(m[1]) * (m[2] === 'ms' ? 1 : 1000) : null;
}
const coverOpt = opt('poster', '') ? `${opt('poster', '')}s` : motion.cover;
const coverAt = seconds(coverOpt);
const coverScene = coverAt == null && typeof coverOpt === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(coverOpt) && existsSync(join(dir, 'scenes', `${coverOpt}.html`)) ? coverOpt : null;
const coverHtml = coverScene ? readFileSync(join(dir, 'scenes', `${coverScene}.html`), 'utf8') : null;
if (coverOpt && coverAt == null && !coverScene) console.error(`cover "${coverOpt}" is neither a time nor a scene file; no cover`);
const hasCover = coverAt != null || !!coverScene;
const runtimePath = join(REPO, 'packages/sandbox/dist/motion.js');
if (!existsSync(runtimePath)) {
  console.error('packages/sandbox/dist/motion.js is missing: run `pnpm --filter @dc/sandbox build` first');
  process.exit(1);
}
const runtime = readFileSync(runtimePath, 'utf8');
const formats = (opt('format', '') || Object.keys(motion.formats ?? { wide: 1 }).join(',')).split(',').filter(Boolean);
const scale = Math.max(1, Math.min(4, Number(opt('scale', '1')) || 1));
const speed = opt('speed', '') ? Number(opt('speed', '')) : undefined;
const out = resolve(opt('out', join(dir, 'renders')));
mkdirSync(out, { recursive: true });
const stem = basename(dir);

function chromePath() {
  if (process.env.DC_CHROME) return process.env.DC_CHROME;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    const p = join(root, d, 'chrome-linux', 'chrome');
    if (existsSync(p)) return p;
  }
  return undefined;
}

const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
/** A page holding the runtime and the project; `player` adds controls. */
function pageHtml(player) {
  const controls = player
    ? `<div id="bar"><button id="play">Play</button><input id="scrub" type="range" min="0" step="1" value="0"><span id="time">0.00 s</span><select id="fmt"></select><select id="spd" title="Speed"></select></div>`
    : '';
  const css = player
    ? `body{margin:0;background:#111;color:#ddd;font:14px system-ui;display:flex;flex-direction:column;height:100vh}#wrap{flex:1;display:grid;place-items:center;overflow:hidden}#root,#dc-cover{grid-area:1/1}#bar{display:flex;gap:12px;align-items:center;padding:10px 16px;background:#1b1b1b}#scrub{flex:1}#issues{color:#f5a524;padding:0 16px 8px;white-space:pre-wrap}`
    : `html,body{margin:0;background:transparent}`;
  const boot = player
    ? `const motion=${json(motion)},scenes=${json(scenes)},coverAt=${json(coverAt)},coverScene=${json(coverScene)},coverHtml=${json(coverHtml)};let stage,cover,started=false;const coverRoot=document.getElementById('dc-cover');const wrap=document.getElementById('wrap'),root=document.getElementById('root');
const fmt=document.getElementById('fmt'),scrub=document.getElementById('scrub'),time=document.getElementById('time'),play=document.getElementById('play');
const spd=document.getElementById('spd'),base=motion.speed||1;for(const v of [...new Set([base,0.75,1,1.25,1.5,2])].sort((a,b)=>a-b)){const o=document.createElement('option');o.value=v;o.textContent=v+'×'+(v===base?' (project)':'');o.selected=v===base;spd.appendChild(o)}
for(const f of Object.keys(motion.formats)){const o=document.createElement('option');o.value=f;o.textContent=f+' '+motion.formats[f].size.join('×');fmt.appendChild(o)}
function fit(){if(!stage)return;const s=Math.min(wrap.clientWidth/stage.width,wrap.clientHeight/stage.height);for(const r of [root,coverRoot]){r.style.transform='scale('+s+')';r.style.transformOrigin='center'}}
const uncover=()=>{if(!started){started=true;coverRoot.style.display='none'}};
const show=t=>{scrub.value=t;time.textContent=(t/1000).toFixed(2)+' s / '+(stage.duration/1000).toFixed(2)+' s'};let playing=false;
async function load(f){stage&&stage.destroy();cover&&cover.destroy();cover=null;stage=await dcMotion.mount({motion,scenes,format:f,speed:+spd.value,root});scrub.max=stage.duration;
if(!started&&coverScene){cover=await dcMotion.mount({motion:{...motion,order:[coverScene]},scenes:{[coverScene]:coverHtml},format:f,root:coverRoot});cover.seek(cover.duration)}
if(!started&&coverAt!=null)stage.seek(coverAt);fit();show(0);
document.getElementById('issues').textContent=stage.issues.map(i=>i.level+': '+i.scene+' '+i.message).join('\\n')}
fmt.onchange=spd.onchange=()=>{playing=false;play.textContent='Play';load(fmt.value)};addEventListener('resize',fit);
play.onclick=()=>{uncover();playing=!playing;play.textContent=playing?'Pause':'Play';if(playing){const from=+scrub.value>=stage.duration?0:+scrub.value;stage.play(from,t=>{show(t);if(t>=stage.duration&&!motion.loop){playing=false;play.textContent='Play'}})}else stage.pause()};
scrub.oninput=()=>{uncover();playing=false;play.textContent='Play';stage.pause();stage.seek(+scrub.value);show(+scrub.value)};load(fmt.value);`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${(motion.title ?? stem).replace(/</g, '&lt;')}</title><style>${css}</style></head><body>${
    player ? '<div id="wrap"><div id="root"></div><div id="dc-cover"></div></div>' + controls + '<div id="issues"></div>' : '<div id="root"></div>'
  }<script>${runtime.replace(/<\/script/gi, '<\\/script')}</script>${player ? `<script>${boot}</script>` : `<script>${FX_HOST}</script>`}</body></html>`;
}

function run(cmd, argv, input) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, argv, { stdio: [input ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
    p.on('error', fail);
    p.on('close', (code) => (code === 0 ? ok() : fail(new Error(`${cmd} exited ${code}\n${err}`))));
    if (input) input(p.stdin);
  });
}

/** ffmpeg arguments: frames on stdin, the project's audio mixed in, H.264 out. */
function encodeArgs(fps, w, h, seconds, file) {
  const a = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-'];
  const audio = (motion.audio ?? []).filter((x) => existsSync(join(dir, x.src)));
  for (const x of audio) a.push('-i', join(dir, x.src));
  const filters = [`[0:v]${scale > 1 ? `scale=${w}:${h}:flags=lanczos,` : ''}format=yuv420p[v]`];
  audio.forEach((x, i) => {
    const ms = Math.round((x.start ?? 0) * 1000);
    filters.push(`[${i + 1}:a]adelay=${ms}|${ms},volume=${x.gain ?? 0}dB[a${i}]`);
  });
  if (audio.length) filters.push(`${audio.map((_, i) => `[a${i}]`).join('')}amix=inputs=${audio.length}:normalize=0[a]`);
  a.push('-filter_complex', filters.join(';'), '-map', '[v]');
  if (audio.length) a.push('-map', '[a]', '-c:a', 'aac', '-b:a', '192k');
  a.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', String(fps), '-t', seconds.toFixed(3), '-movflags', '+faststart', file);
  return a;
}

/** Pixels that differ between two PNGs, and the largest channel difference, measured in the page. */
function pngDiff(page, a, b) {
  return page.evaluate(
    async ([a, b]) => {
      const load = async (s) => createImageBitmap(await (await fetch('data:image/png;base64,' + s)).blob());
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const px = (img) => {
        const c = new OffscreenCanvas(img.width, img.height);
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, img.width, img.height).data;
      };
      const da = px(ia);
      const db = px(ib);
      let pixels = 0;
      let max = 0;
      for (let i = 0; i < da.length; i += 4) {
        const m = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
        if (m) pixels++;
        if (m > max) max = m;
      }
      return { pixels, max };
    },
    [a.toString('base64'), b.toString('base64')],
  );
}

// a cold GPU or shader compile can outlast an embed's seek timeout, so get them out of the way
if ((await warmFx([...Object.values(scenes), coverHtml ?? ''])) > 0) console.log('shader effects: GPU ready');
const browser = await chromium.launch({ executablePath: chromePath() });
let failed = false;
try {
  for (const format of formats) {
    const size = motion.formats?.[format]?.size;
    if (!size) {
      console.error(`no format "${format}" in motion.json`);
      failed = true;
      continue;
    }
    const [w, h] = size;
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
    await hostFx(page);
    page.on('pageerror', (e) => console.error(`[page] ${e.message}`));
    await page.setContent(pageHtml(false), { waitUntil: 'load' });
    const info = await page.evaluate(
      async ({ motion, scenes, format, speed }) => {
        window.__stage = await window.dcMotion.mount({ motion, scenes, format, speed, root: document.getElementById('root') });
        return { duration: window.__stage.duration, fps: window.__stage.fps, speed: window.__stage.speed, issues: window.__stage.issues };
      },
      { motion, scenes, format, speed },
    );
    for (const i of info.issues) console.log(`  ${i.level}: ${format} ${i.scene} ${i.message}`);
    const cdp = await page.context().newCDPSession(page);
    const shot = async (ms) => {
      await page.evaluate((t) => window.__stage.seek(t), ms);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
      return Buffer.from(data, 'base64');
    };

    if (flag('verify')) {
      // the same time must give the same frame, whatever was shown before it
      const times = Array.from({ length: 16 }, (_, i) => Math.round((info.duration * (i + 0.5)) / 16));
      const forward = [];
      for (const t of times) forward.push(await shot(t));
      let same = 0;
      let worst = { pixels: 0, max: 0, at: 0 };
      for (const i of times.map((_, i) => i).reverse()) {
        const again = await shot(times[i]);
        if (again.equals(forward[i])) {
          same++;
          continue;
        }
        const d = await pngDiff(page, forward[i], again);
        if (d.pixels > worst.pixels) worst = { ...d, at: times[i] };
      }
      const share = worst.pixels / (w * h * scale * scale);
      const ok = same === times.length || (worst.max <= 16 && share < 0.001);
      console.log(
        `${format}: ${same}/${times.length} frames byte-identical when seeked in reverse` +
          (same < times.length ? `; the rest differ on at most ${worst.pixels} pixels by at most ${worst.max}/255, worst at ${(worst.at / 1000).toFixed(2)} s (${ok ? 'antialiasing' : 'FAIL'})` : ''),
      );
      if (!ok) failed = true;
    }

    let coverPng = null;
    if (coverAt != null) coverPng = await shot(Math.min(coverAt, info.duration));
    else if (coverScene) {
      const cp = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
      await hostFx(cp);
      await cp.setContent(pageHtml(false), { waitUntil: 'load' });
      await cp.evaluate(
        async ({ motion, id, html, format }) => {
          const s = await window.dcMotion.mount({ motion: { ...motion, order: [id] }, scenes: { [id]: html }, format, root: document.getElementById('root') });
          await s.seek(s.duration);
        },
        { motion, id: coverScene, html: coverHtml, format },
      );
      coverPng = await cp.screenshot({ type: 'png' });
      await cp.close();
    }
    const coverFile = join(out, `${stem}-${format}-cover.png`);
    if (coverPng) writeFileSync(coverFile, coverPng);
    const firstIsCover = coverPng && motion.coverFirstFrame !== false;

    const frames = Math.round((info.duration / 1000) * info.fps);
    const file = join(out, `${stem}-${format}.mp4`);
    const t0 = performance.now();
    await run('ffmpeg', encodeArgs(info.fps, w, h, info.duration / 1000, file), async (stdin) => {
      try {
        for (let i = 0; i < frames; i++) {
          const buf = i === 0 && firstIsCover ? coverPng : await shot((i * 1000) / info.fps);
          if (!stdin.write(buf)) await new Promise((r) => stdin.once('drain', r));
        }
      } finally {
        stdin.end();
      }
    });
    if (coverPng) {
      // cover art: an attached picture stream, which Finder, Explorer and most players show as the thumbnail
      const tmp = file.replace(/\.mp4$/, '.cover.mp4');
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-i', coverFile, '-map', '0', '-map', '1', '-c', 'copy', '-c:v:1', 'png', '-disposition:v:1', 'attached_pic', tmp]);
      renameSync(tmp, file);
    }
    const secs = (performance.now() - t0) / 1000;
    console.log(
      `${format}: ${w}×${h}${scale > 1 ? ` (rendered at ${scale}×)` : ''}, ${frames} frames, ${(info.duration / 1000).toFixed(2)} s of video${info.speed !== 1 ? ` at ${info.speed}× speed` : ''} in ${secs.toFixed(1)} s (${(frames / secs).toFixed(1)} frames/s) → ${file}`,
    );

    if (flag('gif')) {
      const gif = join(out, `${stem}-${format}.gif`);
      const gw = Math.min(720, w);
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vf', `fps=15,scale=${gw}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, gif]);
      console.log(`${format}: GIF → ${gif}`);
    }
    if (coverPng) console.log(`${format}: cover (${coverScene ? `scene ${coverScene}` : `frame at ${(coverAt / 1000).toFixed(2)} s`}${firstIsCover ? ', also the first frame' : ''}) → ${coverFile}`);
    await page.close();
  }
  if (flag('player')) {
    const html = join(out, `${stem}.html`);
    writeFileSync(html, pageHtml(true));
    console.log(`player → ${html}`);
  }
} finally {
  await browser.close();
  disposeFx();
}
process.exit(failed ? 1 : 0);
