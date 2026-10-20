import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DS_COVER, SLIDE_H, SLIDE_W, parseCardMarker, sandboxDoc, speedOf, type DsTokens, type FromRuntime, type MotionJson, type ProjectPreview } from '@dc/core';
import { api } from '../../api';
import { SERVER } from '../../base';
import { MotionFrame } from '../motion/MotionFrame';
import { htmlLang } from '../../i18n';
import { Specimen } from '../ds/Specimen';
import { previewDoc } from '../ds/ds';
import { useElementSize } from '../../hooks';

/** Calls back once the element has scrolled near the viewport. */
function useNear<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === 'undefined') return setNear(true);
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return [ref, near];
}

/** A board or slide rendered by the sandbox runtime, read only, scaled to the card. */
function LiveFrame({ file, source, w, h, width, slide, base }: { file: string; source: string; w: number; h: number; width: number; slide?: { head: string; base: string }; base?: string }) {
  const { t: tr } = useTranslation();
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [shown, setShown] = useState(false);
  const srcdoc = useMemo(() => sandboxDoc(SERVER, 'runtime', htmlLang()), []);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const m = e.data as FromRuntime;
      if (m?.dc === 'ready') setReady(true);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  useEffect(() => {
    if (!ready) return;
    frame.current?.contentWindow?.postMessage(
      { dc: 'render', file, source, files: {}, props: {}, mode: 'play', selected: null, ...(slide ? { slide: { ...slide, still: true } } : {}), ...(base ? { base } : {}) },
      '*',
    );
    const t = setTimeout(() => setShown(true), 150);
    return () => clearTimeout(t);
  }, [ready, file, source, slide, base]);
  const scale = width / w;
  const top = Math.max(0, ((width * 10) / 16 - h * scale) / 2);
  return (
    <div className={`lframe${shown ? ' on' : ''}`} style={{ paddingTop: top }}>
      <div style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
        <iframe ref={frame} title={tr('launcher.preview.frame', { file })} sandbox="allow-scripts" srcDoc={srcdoc} tabIndex={-1} aria-hidden="true" />
      </div>
    </div>
  );
}

function Minimap({ boards }: { boards: { x: number; y: number; w: number; h: number; title: string }[] }) {
  const { t } = useTranslation();
  if (!boards.length) return <div className="lp-empty">{t('launcher.preview.emptyCanvas')}</div>;
  const x0 = Math.min(...boards.map((b) => b.x));
  const y0 = Math.min(...boards.map((b) => b.y));
  const x1 = Math.max(...boards.map((b) => b.x + b.w));
  const y1 = Math.max(...boards.map((b) => b.y + b.h));
  const pad = Math.max(x1 - x0, y1 - y0) * 0.06;
  return (
    <svg className="lp-mini" viewBox={`${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {boards.map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx={(x1 - x0) / 120} />
      ))}
    </svg>
  );
}

/** The typefaces a system's sample is set in, loaded once for the launcher page. */
function useHostedFonts(hrefs: string) {
  useEffect(() => {
    for (const href of hrefs.split('\n').filter(Boolean)) {
      if (document.head.querySelector(`link[data-ds-font="${CSS.escape(href)}"]`)) continue;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.dsFont = href;
      document.head.appendChild(link);
    }
  }, [hrefs]);
}

export function Preview({ p, project, width }: { p: ProjectPreview; project: string; width: number }) {
  const { t } = useTranslation();
  const hosted = p.kind === 'design-system' ? p.hosted.join('\n') : '';
  useHostedFonts(hosted);
  const [ref, near] = useNear<HTMLDivElement>();
  let body: ReactNode;
  if (p.kind === 'design') {
    body =
      near && p.board && width > 0 ? (
        <>
          <Minimap boards={p.boards} />
          <LiveFrame file={p.board.file} source={p.board.source} w={p.board.w} h={p.board.h} width={width} base={api.rawBase(project)} />
        </>
      ) : (
        <Minimap boards={p.boards} />
      );
  } else if (p.kind === 'slides') {
    body =
      near && p.cover && width > 0 ? (
        <LiveFrame file={p.cover.file} source={p.cover.source} w={SLIDE_W} h={SLIDE_H} width={width} slide={{ head: p.cover.head, base: api.rawBase(project) }} />
      ) : (
        <div className="lp-empty">{p.cover ? '' : t('launcher.preview.noSlides')}</div>
      );
  } else if (p.kind === 'design-system') {
    body = (
      <div className="lp-ds">
        {p.cover ? (
          <CoverFrame cover={p.cover} project={project} near={near} />
        ) : (
          <Specimen glance={p.glance} alt={p.alt} themeName={p.glance.themes[0]} title={p.glance.headingFont?.split(',')[0].replace(/["']/g, '').trim() || 'Aa'} />
        )}
        <div className="foot">
          <div className="faces">
            {[p.glance.headingFont, p.glance.bodyFont]
              .filter((f, i, a) => f && a.indexOf(f) === i)
              .map((f) => (
                <span key={f} style={{ fontFamily: f }}>
                  {f!.split(',')[0].replace(/["']/g, '').trim()}
                </span>
              ))}
          </div>
          <div className="sw">
            {(p.colors.length ? p.colors : ['#e4e3df', '#d6d4ce', '#9a9892']).slice(0, 6).map((c, i) => (
              <span key={i} style={{ background: c }} />
            ))}
          </div>
        </div>
      </div>
    );
  } else if (p.kind === 'dashboard') {
    body = (
      <div className="lp-dash">
        <svg viewBox="0 0 120 36" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 30 L12 26 L24 28 L36 20 L48 22 L60 14 L72 17 L84 9 L96 12 L108 5 L120 7" />
        </svg>
        <ul>
          {p.datasets.map((d) => (
            <li key={d}>{d}</li>
          ))}
          {!p.datasets.length && <li className="faint">{t('launcher.preview.noDatasets')}</li>}
        </ul>
      </div>
    );
  } else if (p.kind === 'motion') {
    const f = p.formats[0];
    body = (
      <div className="lp-motion">
        {near && p.still && f && width > 0 && <MotionStill still={p.still} format={f.name} width={width} base={api.rawBase(project)} />}
        {!p.still && <div className="lp-empty">{t('launcher.preview.noScenes')}</div>}
        <div className="lp-mmeta">
          <span>{p.seconds} s</span>
          {p.formats.map((x) => (
            <span key={x.name}>{x.w}×{x.h}</span>
          ))}
        </div>
      </div>
    );
  } else {
    body = (
      <div className="lp-doc">
        <div className="page">
          <ul>
            {p.tabs.map((tab, i) => (
              <li key={i} style={{ paddingLeft: tab.depth * 10 }}>
                {tab.title}
              </li>
            ))}
          </ul>
          {p.excerpt && <p>{p.excerpt}</p>}
        </div>
      </div>
    );
  }
  return (
    <div ref={ref} className={`lpreview k-${p.kind}`}>
      {body}
    </div>
  );
}

let coverSeq = 0;

/**
 * A design system's cover, drawn the way its overview draws it (tokens.css, then components/bundle.css) and
 * scaled to fill the card, so the card shows the system's own look: border weight, gradient text, glow, grid.
 * Scripts in the cover still run, but bundle.js and the libraries are not loaded here, to keep the list light.
 */
function CoverFrame({ cover, project, near }: { cover: { html: string; tokens: DsTokens; css?: string }; project: string; near: boolean }) {
  const { t } = useTranslation();
  const [box, size] = useElementSize<HTMLDivElement>();
  const [id] = useState(() => `lc${++coverSeq}`);
  const marked = parseCardMarker(cover.html).height ?? 400;
  const [h, setH] = useState(marked);
  const theme = cover.tokens.themes[0]?.id ?? '';
  const doc = useMemo(
    () => previewDoc({ html: cover.html, comp: 'Cover', theme, tokens: cover.tokens, title: '', bundleCss: cover.css, libraries: [], libFiles: {}, frameId: id, project }),
    [cover, theme, id, project],
  );
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.dsPreview === id && typeof e.data.height === 'number') setH(Math.min(4000, Math.max(40, e.data.height)));
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [id]);
  // laid out at a width that keeps the cover's own proportions in the card, then scaled to cover it (no strip of page below)
  const w = size.h ? Math.min(1440, Math.max(720, (h * size.w) / size.h)) : 960;
  const scale = Math.max(size.w / w, size.h / h);
  return (
    <div ref={box} className="lp-cover">
      {near && size.w > 0 && (
        <div style={{ width: w, height: Math.max(h, size.h / scale), transform: `scale(${scale})`, transformOrigin: '0 0' }}>
          <iframe title={t('launcher.preview.frame', { file: DS_COVER })} sandbox="allow-scripts" srcDoc={doc} tabIndex={-1} aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

/** A still of a motion piece: its cover scene at the end of its entrances, its cover frame, or most of the way through its first scene. */
function MotionStill({ still, format, width, base }: { still: { motion: MotionJson; id: string; source: string; at?: number }; format: string; width: number; base: string }) {
  const { t } = useTranslation();
  const motion = useMemo(() => ({ ...still.motion, order: [still.id] }), [still]);
  const scenes = useMemo(() => ({ [still.id]: still.source }), [still]);
  const cover = !still.motion.order.includes(still.id);
  // the preview sits 6px in from the card on each side, at 16:10
  const bw = width - 12;
  return <MotionFrame motion={motion} scenes={scenes} format={format} at={cover ? 'end' : still.at !== undefined ? still.at / speedOf(still.motion.speed) : 'still'} base={base} box={{ w: bw, h: (bw * 10) / 16 }} title={t('launcher.preview.cover', { title: still.motion.title })} />;
}
