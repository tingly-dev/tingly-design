import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { boardsOf, parseDc, sandboxDoc, timeSpec, type ProjectCard } from '@dc/core';
import { api } from '../api';
import { SERVER } from '../base';
import { htmlLang } from '../i18n';

interface Source {
  project: ProjectCard;
  files: Record<string, string>;
  boards: { file: string; title: string; size: [number, number]; moving: boolean }[];
}

const THUMB_W = 196;

/**
 * Importing from a project: every canvas's artboards, drawn small. An
 * artboard that moves with time (it declares `$time`) is marked and plays
 * while the pointer is on it, so an effect is picked by how it looks.
 */
export function BoardPicker({
  what,
  onPick,
  onClose,
}: {
  what: string;
  onPick: (from: string, board: string, title: string, moving: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [sources, setSources] = useState<Source[] | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const canvases = (await api.projects().catch(() => [])).filter((p) => p.kind === 'design');
      const out: Source[] = [];
      for (const project of canvases) {
        const r = await api.files(project.name).catch(() => null);
        if (!r) continue;
        const files = Object.fromEntries(Object.entries(r.files).map(([k, v]) => [k, v.content]));
        const boards = boardsOf(files).map((b) => {
          const props = parseDc(files[b.file] ?? '').props;
          return { file: b.file, title: b.title, size: b.size ?? ([1280, 720] as [number, number]), moving: !!timeSpec(props) };
        });
        // moving artboards (effects) first: they are what this is mostly for
        boards.sort((a, b) => Number(b.moving) - Number(a.moving));
        if (boards.length) out.push({ project, files, boards });
      }
      if (live) setSources(out);
    })();
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  return (
    <div className="lmodal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ldialog bpick" role="dialog" aria-label={t('importer.board.title')}>
        <header>
          <h2>{t('importer.board.title')}</h2>
          <button type="button" className="tb" aria-label={t('common.close')} onClick={onClose}>
            ×
          </button>
        </header>
        <p className="hint">{what}</p>
        {sources === null ? (
          <p className="hint">{t('common.loading')}</p>
        ) : sources.length === 0 ? (
          <p className="hint">{t('importer.board.none')}</p>
        ) : (
          sources.map((s) => (
            <section key={s.project.name} className="bpick-group">
              <h3>{s.project.title || s.project.name}</h3>
              <div className="bpick-grid">
                {s.boards.map((b) => (
                  <button
                    key={b.file}
                    className="bpick-item"
                    data-pick={b.file}
                    onClick={() => onPick(s.project.name, b.file, b.title, b.moving)}
                    title={t('importer.board.pick', { title: b.title })}
                  >
                    <BoardThumb from={s.project.name} file={b.file} files={s.files} size={b.size} moving={b.moving} />
                    <span className="bpick-name">
                      {b.title}
                      {b.moving && <span className="badge ai">{t('importer.board.moving')}</span>}
                    </span>
                    <span className="faint">
                      {b.size[0]}×{b.size[1]}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

/** One artboard drawn by the artboard runtime, scaled to the thumbnail; a moving one plays while hovered. */
function BoardThumb({ from, file, files, size, moving }: { from: string; file: string; files: Record<string, string>; size: [number, number]; moving: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState(false);
  const srcdoc = useMemo(() => sandboxDoc(SERVER, 'runtime', htmlLang()), []);
  const boards = useMemo(() => Object.fromEntries(Object.entries(files).filter(([k]) => k.endsWith('.dc.html'))), [files]);
  const scale = THUMB_W / size[0];
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source === frame.current?.contentWindow && e.data?.dc === 'ready') setReady(true);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  useEffect(() => {
    if (!ready) return;
    frame.current?.contentWindow?.postMessage({ dc: 'render', file, source: files[file], files: boards, props: {}, mode: 'play', selected: null, base: api.rawBase(from) }, '*');
  }, [ready, file, files, boards, from]);
  useEffect(() => {
    if (!ready || !moving || !hover) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      frame.current?.contentWindow?.postMessage({ dcMotion: 'seek', t: performance.now() - t0, n: -1 }, '*');
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, moving, hover]);
  return (
    <span className="bpick-thumb" style={{ height: Math.round(size[1] * scale) }} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <iframe ref={frame} title={file} sandbox="allow-scripts" srcDoc={srcdoc} tabIndex={-1} style={{ width: size[0], height: size[1], transform: `scale(${scale})` }} />
    </span>
  );
}
