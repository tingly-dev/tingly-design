import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sandboxDoc, type LinkSource, type ProjectKind, type SourcePage } from '@dc/core';
import { api } from '../api';
import { SERVER } from '../base';
import { htmlLang } from '../i18n';
import { useStore } from '../store';
import { Dialog } from './Dialog';
import { KindIcon } from './launcher/kinds';

type Page = SourcePage & { moving?: boolean };

const THUMB_W = 196;

/**
 * Taking a page of another project (.design/cross-kind-embedding.md): every project this one can take
 * a page from, its pages drawn small where that is cheap (a canvas's artboards run in the artboard runtime,
 * a moving one plays while the pointer is on it; the others are a titled card). The projects inside this
 * one come first, then those in the same folder, then the rest. Nothing asks "picture or live": the page's
 * kind and this kind decide, and the panel changes it afterwards.
 */
export function PagePicker({
  kind,
  what,
  onPick,
  onClose,
}: {
  /** the kind taking the page */
  kind: ProjectKind;
  what: string;
  onPick: (source: LinkSource, page: Page) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const project = useStore((st) => st.project);
  const [sources, setSources] = useState<LinkSource[] | null>(null);
  const [files, setFiles] = useState<Record<string, Record<string, string>>>({});
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const kindName = t(`launcher.kind.${kind}.name`).toLowerCase();

  useEffect(() => {
    let live = true;
    void (async () => {
      const r = project ? await api.linkSources(project).catch(() => ({ sources: [] as LinkSource[] })) : { sources: [] as LinkSource[] };
      if (!live) return;
      setSources(r.sources);
      // a canvas's artboards are drawn small: their files
      for (const s of r.sources.filter((x) => x.kind === 'design')) {
        const f = await api.files(s.name).catch(() => null);
        if (!live || !f) continue;
        setFiles((cur) => ({ ...cur, [s.name]: Object.fromEntries(Object.entries(f.files).map(([k, v]) => [k, v.content])) }));
      }
    })();
    return () => {
      live = false;
    };
  }, [project]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!sources) return [];
    return sources
      .map((s) => ({ ...s, pages: s.pages.filter((p) => !q || s.title.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || p.title.toLowerCase().includes(q)) }))
      .filter((s) => s.pages.length);
  }, [sources, q]);
  const groups: { id: string; title: string; list: LinkSource[] }[] = [
    { id: 'inside', title: t('linked.picker.inside'), list: shown.filter((s) => s.inside) },
    { id: 'folder', title: t('linked.picker.sameFolder'), list: shown.filter((s) => !s.inside && s.sameFolder) },
    { id: 'others', title: t('linked.picker.others'), list: shown.filter((s) => !s.inside && !s.sameFolder) },
  ].filter((g) => g.list.length);

  const pick = async (s: LinkSource, p: Page) => {
    if (busy) return;
    setError('');
    setBusy(p.title);
    try {
      await onPick(s, p);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy('');
    }
  };

  return (
    <Dialog label={t('linked.picker.title')} className="bpick" onClose={busy ? () => {} : onClose}>
      <p className="hint">{what}</p>
      <input className="bpick-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('linked.picker.search')} aria-label={t('linked.picker.search')} disabled={!!busy} />
      {busy && (
        <p className="bpick-busy" role="status">
          {t('linked.picker.drawing', { title: busy })}
        </p>
      )}
      {error && (
        <p className="bpick-error" role="alert">
          {error}
        </p>
      )}
      {sources === null ? (
        <p className="hint">{t('linked.picker.loading')}</p>
      ) : sources.length === 0 ? (
        <p className="hint">{t('linked.picker.none', { kind: kindName })}</p>
      ) : groups.length === 0 ? (
        <p className="hint">{t('linked.picker.noMatch', { query })}</p>
      ) : (
        groups.map((g) => (
          <section key={g.id} className="bpick-group" data-group={g.id}>
            <h3>{g.title}</h3>
            {g.list.map((s) => (
              <div key={s.name} className="bpick-project">
                <div className="bpick-ptitle">
                  <KindIcon kind={s.kind} size={13} />
                  <span>{s.title || s.name}</span>
                </div>
                <div className="bpick-grid">
                  {s.pages.map((p) => (
                    <button key={p.page} className="bpick-item" data-pick={p.page} data-project={s.name} disabled={!!busy} onClick={() => void pick(s, p)} title={t('linked.picker.pick', { title: p.title })}>
                      {s.kind === 'design' && files[s.name] && p.size ? (
                        <BoardThumb from={s.name} file={p.page} files={files[s.name]} size={p.size} moving={!!p.moving} />
                      ) : (
                        <span className="bpick-card" style={p.size ? { aspectRatio: `${p.size[0]} / ${p.size[1]}` } : undefined}>
                          <KindIcon kind={s.kind} size={20} />
                        </span>
                      )}
                      <span className="bpick-name">
                        {p.title}
                        {p.moving && <span className="badge ai">{t('linked.picker.moves')}</span>}
                      </span>
                      <span className="faint">{p.size ? `${p.size[0]}×${p.size[1]}` : t(`launcher.kind.${s.kind}.name`)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))
      )}
    </Dialog>
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
