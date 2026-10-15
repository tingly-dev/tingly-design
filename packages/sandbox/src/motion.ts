/**
 * The motion runtime (phase 0 spike, see .design/motion.md). It lays a
 * project's scenes out for one format and turns their timing attributes into
 * paused Web Animations on a single clock, so `seek(t)` shows exactly frame t.
 * The renderer, the HTML player and (later) the editor stage all use it.
 *
 * window.dcMotion.mount({ motion, scenes, format, root }) → Promise<MotionStage>
 */
import { resolveSrc, urlsAgainst } from './urls';
import { attrsForFormat, drawSlideArt, faceMarkup, motionTimeline, sceneBaseCss, speedOf, SLIDE_BASE_CSS, type DeckJson, type MotionJson, type SceneWindow } from '@dc/core';
import { animateScene, SEEK_BRIDGE, type SceneAnim } from './sceneAnim';
import type { ExportOutcome, ExportRequest } from './motionExport';
import type { AudioClip } from '@dc/export';

export interface MountOptions {
  motion: MotionJson;
  /** Scene id → the scene file's source. */
  scenes: Record<string, string>;
  format?: string;
  root: HTMLElement;
  /** Overrides motion.json's speed (a preview at 2×, a render at another pace). */
  speed?: number;
  /** Where the project's files are served: relative src and url() (uploads/…) resolve against it. */
  base?: string;
}

export interface MotionStage {
  width: number;
  height: number;
  fps: number;
  /** Milliseconds of video, after speed. */
  duration: number;
  /** Playback rate over the authored timing. `scenes` stay in authored time. */
  speed: number;
  scenes: SceneWindow[];
  issues: { scene: string; message: string; level: string }[];
  /** `ms` is video time; the authored time shown is `ms × speed`. */
  seek(ms: number): Promise<void>;
  play(from?: number, onTime?: (ms: number) => void): void;
  pause(): void;
  destroy(): void;
}

interface Embed {
  frame: HTMLIFrameElement;
  sceneStart: number;
  ready: Promise<void>;
}

const EMBED_HEAD = '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden;background:transparent}</style>';

let seekCounter = 0;

/** The file this script was loaded from, so the exporter beside it can be fetched when needed. */
const SELF = typeof document !== 'undefined' ? (document.currentScript as HTMLScriptElement | null)?.src : undefined;
type FrameRequest = { t: number; scale?: number; fontCss?: string };
type Exporter = {
  exportVideo: (stage: MotionStage, root: HTMLElement, req: ExportRequest) => Promise<ExportOutcome>;
  exportFrame: (stage: MotionStage, root: HTMLElement, req: FrameRequest) => Promise<Blob>;
};
let exporter: Promise<Exporter> | null = null;

/** The exporter (video and picture), fetched on first use: it carries the encoders, which a player never needs. */
function loadExporter(): Promise<Exporter> {
  const w = window as unknown as { dcMotionExport?: Exporter };
  exporter ??= new Promise((resolve, reject) => {
    if (w.dcMotionExport) return resolve(w.dcMotionExport);
    if (!SELF) return reject(new Error('the exporter is not loaded'));
    const el = document.createElement('script');
    el.src = SELF.replace(/[^/]*$/, 'export.js');
    el.onload = () => (w.dcMotionExport ? resolve(w.dcMotionExport) : reject(new Error('the exporter did not start')));
    el.onerror = () => ((exporter = null), reject(new Error('the exporter could not be loaded')));
    document.head.appendChild(el);
  });
  return exporter;
}
const exportVideo = async (stage: MotionStage, root: HTMLElement, req: ExportRequest) => (await loadExporter()).exportVideo(stage, root, req);
const exportFrame = async (stage: MotionStage, root: HTMLElement, req: FrameRequest) => (await loadExporter()).exportFrame(stage, root, req);

export async function mount(opts: MountOptions): Promise<MotionStage> {
  const { motion, root } = opts;
  const formats = Object.keys(motion.formats);
  const format = opts.format && motion.formats[opts.format] ? opts.format : formats[0];
  const [W, H] = motion.formats[format].size;
  const speed = speedOf(opts.speed ?? motion.speed);
  root.innerHTML = '';
  root.classList.add('dc-motion-root');

  const style = document.createElement('style');
  style.textContent =
    sceneBaseCss(W, H, SLIDE_BASE_CSS) +
    `.dc-motion-root{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${motion.background ?? '#000'}}` +
    `.dc-motion-root>.dc-slide-host{position:absolute;left:0;top:0;visibility:hidden}` +
    `.dc-slide-host x-embed>iframe{display:block;width:100%;height:100%;border:0;background:transparent}`;
  root.appendChild(style);
  const faces = faceMarkup({ faces: motion.faces } as DeckJson);
  const faceLinks: Promise<unknown>[] = [];
  if (faces) {
    const tpl = document.createElement('template');
    tpl.innerHTML = faces;
    for (const n of Array.from(tpl.content.childNodes)) {
      if (n instanceof HTMLLinkElement) faceLinks.push(new Promise((r) => ((n.onload = r), (n.onerror = r))));
      document.head.appendChild(n);
    }
  }

  // read each scene's section (in this format) to learn durations and transitions first
  const parsed = motion.order
    .filter((id) => opts.scenes[id] != null)
    .map((id) => {
      const tpl = document.createElement('template');
      tpl.innerHTML = drawSlideArt(opts.scenes[id]);
      const section = tpl.content.querySelector('section') ?? document.createElement('section');
      section.querySelectorAll('aside').forEach((a) => a.remove());
      applyFormat(section, format, formats);
      if (opts.base) resolveUrls(section, opts.base);
      return { id, section };
    });
  const timeline = motionTimeline(
    parsed.map(({ id, section }) => ({ id, duration: section.getAttribute('data-duration') ?? undefined, transition: section.getAttribute('data-transition') ?? undefined })),
  );

  const hosts: { host: HTMLElement; win: SceneWindow }[] = [];
  const anims: SceneAnim[] = [];
  const embeds: Embed[] = [];
  const issues: MotionStage['issues'] = [];

  parsed.forEach(({ id, section }, i) => {
    const win = timeline.scenes[i];
    const host = document.createElement('div');
    host.className = 'dc-slide-host';
    host.dataset.scene = id;
    root.appendChild(host);
    // embeds keep their markup as a string; what's inside them is not part of the scene's DOM
    const embedHtml = new Map<Element, string>();
    for (const x of Array.from(section.querySelectorAll('x-embed'))) {
      embedHtml.set(x, x.innerHTML);
      x.innerHTML = '';
    }
    host.appendChild(section);

    const els = [section, ...Array.from(section.querySelectorAll('*'))];
    const anim = animateScene(els, win.start, win.duration);
    for (const is of anim.issues) issues.push({ scene: id, level: is.level, message: `<${els[is.index].tagName.toLowerCase()}> ${is.message}` });
    anims.push(anim);
    for (const [x, html] of embedHtml) {
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('title', 'embed');
      const seekable = x.hasAttribute('data-seek');
      const ready = seekable
        ? new Promise<void>((resolve) => {
            const onMsg = (e: MessageEvent) => {
              if (e.source === frame.contentWindow && e.data?.dcMotion === 'embed-ready') {
                window.removeEventListener('message', onMsg);
                resolve();
              }
            };
            window.addEventListener('message', onMsg);
            setTimeout(resolve, 3000);
          })
        : Promise.resolve();
      frame.srcdoc = EMBED_HEAD + html + (seekable ? SEEK_BRIDGE : '');
      x.appendChild(frame);
      if (seekable) embeds.push({ frame, sceneStart: win.start, ready });
    }
    hosts.push({ host, win });
  });

  // scene transitions: the next scene comes in over the one leaving
  hosts.forEach(({ win }, i) => {
    const next = hosts[i + 1];
    if (!next || win.transition.kind === 'cut') return;
    const at = next.win.start;
    const opts2: KeyframeAnimationOptions = { delay: at, duration: win.transition.duration, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' };
    if (win.transition.kind === 'push') {
      next.host.animate([{ transform: `translateX(${W}px)` }, { transform: 'translateX(0px)' }], opts2).pause();
      hosts[i].host.animate([{ transform: 'translateX(0px)' }, { transform: `translateX(${-W}px)` }], { ...opts2, fill: 'forwards' }).pause();
    } else {
      // fade; magic move falls back to it in the spike
      next.host.animate([{ opacity: 0 }, { opacity: 1 }], opts2).pause();
    }
  });

  await Promise.all(embeds.map((e) => e.ready));
  await Promise.all(faceLinks);
  await loadFonts(root);

  let raf = 0;
  const stage: MotionStage = {
    width: W,
    height: H,
    fps: motion.fps,
    duration: timeline.duration / speed,
    speed,
    scenes: timeline.scenes,
    issues,
    async seek(ms) {
      const t = Math.max(0, Math.min(ms * speed, timeline.duration));
      setTime(t);
      const live = embeds.filter((e) => {
        const h = hosts.find((h) => h.win.start === e.sceneStart);
        return h && t >= h.win.start && t <= h.win.start + h.win.duration;
      });
      await Promise.all(live.map((e) => seekEmbed(e.frame, t - e.sceneStart)));
      // the frame after next is the first one painted with the new time on every layer
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
    },
    play(from, onTime) {
      cancelAnimationFrame(raf);
      const t0 = performance.now() - (from ?? 0);
      const tick = () => {
        let t = (performance.now() - t0) * speed;
        if (t > timeline.duration) {
          if (!motion.loop) {
            setTime(timeline.duration);
            onTime?.(timeline.duration / speed);
            return;
          }
          t %= timeline.duration;
        }
        setTime(t);
        for (const e of embeds) e.frame.contentWindow?.postMessage({ dcMotion: 'seek', t: t - e.sceneStart, n: -1 }, '*');
        onTime?.(t / speed);
        raf = requestAnimationFrame(tick);
      };
      tick();
    },
    pause() {
      cancelAnimationFrame(raf);
    },
    destroy() {
      cancelAnimationFrame(raf);
      root.innerHTML = '';
    },
  };

  function setTime(t: number) {
    for (const a of anims) a.setTime(t);
    // scene transitions are on the hosts
    for (const { host } of hosts) for (const a of host.getAnimations()) a.currentTime = t;
    for (const { host, win } of hosts) {
      const last = win === timeline.scenes[timeline.scenes.length - 1];
      const on = t >= win.start && (t < win.start + win.duration || (last && t <= win.start + win.duration));
      host.style.visibility = on ? 'visible' : 'hidden';
    }
  }

  await stage.seek(0);
  return stage;
}

/**
 * Load every face the scenes use before the first frame. `document.fonts.ready`
 * alone resolves before a face is first needed, and hidden scenes need none
 * yet, so early frames would be drawn in the fallback font.
 */
async function loadFonts(root: HTMLElement) {
  const specs = new Map<string, string>();
  for (const el of Array.from(root.querySelectorAll('section, section *'))) {
    const text = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? '')
      .join('')
      .trim();
    if (!text) continue;
    const cs = getComputedStyle(el);
    const spec = `${cs.fontStyle} ${cs.fontWeight} 16px ${cs.fontFamily}`;
    specs.set(spec, (specs.get(spec) ?? '') + text);
  }
  await Promise.all(Array.from(specs, ([spec, text]) => document.fonts.load(spec, text).catch(() => [])));
  await document.fonts.ready;
}

/** Rewrite an element tree's attributes for one format; drop what the format leaves out. */
function applyFormat(section: Element, format: string, formats: string[]) {
  for (const el of [section, ...Array.from(section.querySelectorAll('*'))]) {
    if (!el.isConnected && el !== section && !section.contains(el)) continue;
    const attrs = Object.fromEntries(Array.from(el.attributes).map((a) => [a.name, a.value]));
    const next = attrsForFormat(attrs, format, formats);
    if (!next) {
      el.remove();
      continue;
    }
    for (const name of Object.keys(attrs)) if (!(name in next)) el.removeAttribute(name);
    for (const [k, v] of Object.entries(next)) if (attrs[k] !== v) el.setAttribute(k, v);
  }
}

/** Point relative image paths and url()s at the project's files, as the editing stage does. */
function resolveUrls(section: Element, base: string) {
  for (const el of [section, ...Array.from(section.querySelectorAll('*'))]) {
    for (const name of ['src', 'poster', 'href']) {
      const v = el.getAttribute(name);
      if (v === null || (name === 'href' && el.tagName.toLowerCase() !== 'image')) continue;
      const r = resolveSrc(v, base) as string;
      if (r !== v) el.setAttribute(name, r);
    }
    const style = el.getAttribute('style');
    if (style) {
      const r = urlsAgainst(style, base);
      if (r !== style) el.setAttribute('style', r);
    }
  }
}

function seekEmbed(frame: HTMLIFrameElement, t: number): Promise<void> {
  const n = ++seekCounter;
  return new Promise((resolve) => {
    const onMsg = (e: MessageEvent) => {
      if (e.source === frame.contentWindow && e.data?.dcMotion === 'seeked' && e.data.n === n) finish();
    };
    const timer = setTimeout(finish, 1000);
    function finish() {
      clearTimeout(timer);
      window.removeEventListener('message', onMsg);
      resolve();
    }
    window.addEventListener('message', onMsg);
    frame.contentWindow?.postMessage({ dcMotion: 'seek', t: Math.max(0, t), n }, '*');
  });
}

(window as unknown as { dcMotion: unknown }).dcMotion = { mount, exportVideo };

/**
 * In the editor the runtime runs in a sandboxed frame (`sandboxDoc(origin, 'motion')`)
 * and the editor drives it over postMessage: load a project, seek, play, pause.
 */
type HostMsg =
  | { dcm: 'load'; motion: MotionJson; scenes: Record<string, string>; format?: string; speed?: number; at?: number | 'end' | 'still'; base?: string }
  | { dcm: 'seek'; t: number }
  | { dcm: 'play'; from?: number }
  | { dcm: 'pause' }
  | ({ dcm: 'export'; id: string; fontCss?: string; audio?: AudioClip[] } & Pick<ExportRequest, 'format' | 'width' | 'height' | 'fps' | 'quality' | 'from' | 'to'>)
  | { dcm: 'export-cancel'; id: string }
  | { dcm: 'snapshot'; id: string; t: number; scale?: number; fontCss?: string };

if (typeof document !== 'undefined' && document.getElementById('dc-app') && window.parent !== window) {
  const root = document.getElementById('dc-app') as HTMLElement;
  let stage: MotionStage | null = null;
  let stageBox: HTMLElement | null = null;
  let loading = 0;
  const exporting = new Map<string, AbortController>();
  const post = (m: Record<string, unknown>) => window.parent.postMessage(m, '*');
  window.addEventListener('message', async (e: MessageEvent) => {
    if (e.source !== window.parent) return;
    const m = e.data as HostMsg;
    if (!m || typeof m !== 'object' || !('dcm' in m)) return;
    if (m.dcm === 'export-cancel') {
      exporting.get(m.id)?.abort();
    } else if (m.dcm === 'export') {
      if (!stage) return post({ dcm: 'export-error', id: m.id, code: 'no-stage' });
      const ctl = new AbortController();
      exporting.set(m.id, ctl);
      const req: ExportRequest = { format: m.format, width: m.width, height: m.height, fps: m.fps, quality: m.quality, from: m.from, to: m.to, fontCss: m.fontCss, audio: m.audio, signal: ctl.signal, onProgress: (done, total) => post({ dcm: 'export-progress', id: m.id, done, total }) };
      try {
        const r = await exportVideo(stage, stageBox!, req);
        const { blob, ...rest } = r;
        post({ dcm: 'exported', id: m.id, blob, ...rest });
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        post({ dcm: 'export-error', id: m.id, code: name === 'AbortError' ? 'aborted' : name === 'NoEncoderError' ? 'no-encoder' : 'failed', message: err instanceof Error ? err.message : String(err) });
      } finally {
        exporting.delete(m.id);
      }
    } else if (m.dcm === 'snapshot') {
      if (!stage) return post({ dcm: 'snapshot-error', id: m.id, message: 'nothing is loaded' });
      try {
        post({ dcm: 'snapshot-done', id: m.id, blob: await exportFrame(stage, stageBox!, { t: m.t, fontCss: m.fontCss }) });
      } catch (err) {
        post({ dcm: 'snapshot-error', id: m.id, message: err instanceof Error ? err.message : String(err) });
      }
    } else if (m.dcm === 'load') {
      const n = ++loading;
      // loads overlap while files are still being written (a generation saves scene after scene);
      // each mounts into its own box, so a stale one finishing late can't wipe the newer one
      const box = document.createElement('div');
      root.appendChild(box);
      try {
        const s = await mount({ motion: m.motion, scenes: m.scenes, format: m.format, speed: m.speed, root: box, base: m.base });
        if (n !== loading) {
          s.destroy();
          return box.remove();
        }
        stage?.destroy();
        stage = s;
        stageBox = box;
        for (const el of Array.from(root.children)) if (el !== box) el.remove();
        const at = m.at === 'end' ? s.duration : m.at === 'still' ? Math.round(s.duration * 0.85) : Math.max(0, Math.min(m.at ?? 0, s.duration));
        if (at) await s.seek(at);
        post({ dcm: 'loaded', width: s.width, height: s.height, duration: s.duration, speed: s.speed, fps: s.fps, scenes: s.scenes, issues: s.issues, t: at });
      } catch (err) {
        box.remove();
        if (n === loading) post({ dcm: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    } else if (!stage) {
      return;
    } else if (m.dcm === 'seek') {
      stage.pause();
      await stage.seek(m.t);
      post({ dcm: 'time', t: m.t });
    } else if (m.dcm === 'play') {
      const s = stage;
      s.play(m.from, (t) => {
        post({ dcm: 'time', t });
        if (t >= s.duration) post({ dcm: 'ended' });
      });
    } else if (m.dcm === 'pause') {
      stage.pause();
    }
  });
  post({ dcm: 'ready' });
}
