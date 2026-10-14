import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { IconChartBar, IconComponents, IconFileImport, IconFileText, IconLayoutDashboard, IconMovie, IconPlus, IconPresentation, IconSearch, type IconProps } from '@tabler/icons-react';
import { SLIDE_H, SLIDE_W, sandboxDoc, type FromRuntime, type MotionJson, type ProjectCard, type ProjectKind, type ProjectPreview } from '@dc/core';
import { api } from '../api';
import { toast } from '../store';
import { Appearance, LanguageMenu } from './Appearance';
import { ISSUES_URL, REPO_URL } from '../links';
import { goTo } from '../host';
import { SERVER } from '../base';
import { NAME_RE, freeName, slugOf } from '../projectName';
import { ImportDialog } from './ImportDialog';
import { MotionFrame } from './motion/MotionFrame';
import { droppedFiles, pickedFromText, readPicked, type Picked } from '../importer';
import { htmlLang } from '../i18n';

/** The six project kinds, in the order the launcher lists them. Their words are launcher.kind.<kind>.* */
export const KINDS: { kind: ProjectKind; tone: string }[] = [
  { kind: 'design', tone: 'blue' },
  { kind: 'slides', tone: 'purple' },
  { kind: 'design-system', tone: 'teal' },
  { kind: 'dashboard', tone: 'orange' },
  { kind: 'docs', tone: 'green' },
  { kind: 'motion', tone: 'pink' },
];
const KIND = Object.fromEntries(KINDS.map((k) => [k.kind, k])) as Record<ProjectKind, (typeof KINDS)[number]>;

const RECENT_KEY = 'dc:recent-projects';

export function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function open(name: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([name, ...readRecent().filter((n) => n !== name)].slice(0, 20)));
  } catch {
    // private mode: nothing to remember
  }
  goTo(name);
}

function ago(t: TFunction, iso: string | null): string {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return t('launcher.ago.now');
  if (s < 3600) return t('launcher.ago.minutes', { count: Math.floor(s / 60) });
  if (s < 86400) return t('launcher.ago.hours', { count: Math.floor(s / 3600) });
  if (s < 86400 * 30) return t('launcher.ago.days', { count: Math.floor(s / 86400) });
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const KIND_ICONS: Record<ProjectKind, ComponentType<IconProps>> = {
  design: IconLayoutDashboard,
  slides: IconPresentation,
  'design-system': IconComponents,
  dashboard: IconChartBar,
  docs: IconFileText,
  motion: IconMovie,
};

export function KindIcon({ kind, size = 16 }: { kind: ProjectKind; size?: number }) {
  const I = KIND_ICONS[kind];
  return <I size={size} stroke={1.6} aria-hidden="true" />;
}

function Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 88 88" aria-hidden="true">
      <rect width="88" height="88" rx="24" fill="var(--ink)" />
      <rect x="25" y="25" width="38" height="9" rx="2" fill="var(--panel)" />
      <rect x="39.5" y="25" width="9" height="39" rx="2" fill="var(--panel)" />
    </svg>
  );
}

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

function Preview({ p, project, width }: { p: ProjectPreview; project: string; width: number }) {
  const { t } = useTranslation();
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
        <div className="sw">
          {(p.colors.length ? p.colors : ['#e4e3df', '#d6d4ce', '#9a9892']).map((c, i) => (
            <span key={i} style={{ background: c }} />
          ))}
        </div>
        {p.fonts.length > 0 && <div className="aa" style={{ fontFamily: p.fonts[0] }}>Aa {p.fonts[0]}</div>}
        <div className="chips">
          {p.components.map((c) => (
            <span key={c}>{c}</span>
          ))}
          {!p.components.length && <span className="faint">{t('launcher.preview.noComponents')}</span>}
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

/** A still of a motion piece: its cover scene at the end of its entrances, or most of the way through its first scene. */
function MotionStill({ still, format, width, base }: { still: { motion: MotionJson; id: string; source: string }; format: string; width: number; base: string }) {
  const { t } = useTranslation();
  const motion = useMemo(() => ({ ...still.motion, order: [still.id] }), [still]);
  const scenes = useMemo(() => ({ [still.id]: still.source }), [still]);
  const cover = !still.motion.order.includes(still.id);
  // the preview sits 6px in from the card on each side, at 16:10
  const bw = width - 12;
  return <MotionFrame motion={motion} scenes={scenes} format={format} at={cover ? 'end' : 'still'} base={base} box={{ w: bw, h: (bw * 10) / 16 }} title={t('launcher.preview.cover', { title: still.motion.title })} />;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function Card({ p, recent }: { p: ProjectCard; recent: boolean }) {
  const { t } = useTranslation();
  const [ref, width] = useWidth<HTMLButtonElement>();
  const k = KIND[p.kind];
  const kindName = t(`launcher.kind.${p.kind}.name`);
  return (
    <button ref={ref} className={`lcard t-${k.tone}`} data-project={p.name} data-kind={p.kind} onClick={() => open(p.name)} aria-label={t('launcher.card.open', { title: p.title, kind: kindName })}>
      <Preview p={p.preview} project={p.name} width={width} />
      <div className="lbody">
        <div className="ltitle">
          <span className="name">{p.title || p.name}</span>
          {recent && <span className="recent">{t('launcher.card.recent')}</span>}
        </div>
        <div className="lmeta">
          <span className="kbadge">
            <KindIcon kind={p.kind} size={12} />
            {kindName}
          </span>
          <span>{t(`launcher.kind.${p.kind}.count`, { count: p.count })}</span>
          {p.updatedAt && <span>{ago(t, p.updatedAt)}</span>}
        </div>
        <div className="lpath">projects/{p.name}</div>
      </div>
    </button>
  );
}

function NewTile({ kind, onClick }: { kind: ProjectKind; onClick: () => void }) {
  const { t } = useTranslation();
  const k = KIND[kind];
  return (
    <button className={`lcard lnew t-${k.tone}`} onClick={onClick} data-new={kind}>
      <span className="ic">
        <KindIcon kind={kind} size={22} />
      </span>
      <span className="txt">
        <span className="name">{t(`launcher.kind.${kind}.new`)}</span>
        <span className="blurb">{t(`launcher.kind.${kind}.blurb`)}</span>
      </span>
    </button>
  );
}

function ImportTile({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button className="lcard lnew t-blue" onClick={onClick} data-new="import">
      <span className="ic">
        <IconFileImport size={22} stroke={1.7} />
      </span>
      <span className="txt">
        <span className="name">{t('launcher.importTile.name')}</span>
        <span className="blurb">{t('launcher.importTile.blurb')}</span>
      </span>
    </button>
  );
}

export function NewDialog({ initial, taken, onClose }: { initial: ProjectKind; taken: Set<string>; onClose: () => void }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<ProjectKind>(initial);
  const [title, setTitle] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  useEffect(() => titleRef.current?.focus(), []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  // the folder is a detail: it follows the title, falls back to the type's name for a title with no
  // letters (Chinese, say), and steps aside for a name that is taken, until the person edits it
  const auto = freeName(slugOf(title) || kind, taken);
  const name = folder ?? auto;
  const problem = !name ? '' : !NAME_RE.test(name) ? t('launcher.new.folderInvalid') : taken.has(name) ? t('launcher.new.folderTaken', { name }) : '';
  const submit = async () => {
    if (!name || problem || busy) return;
    setBusy(true);
    try {
      await api.createProject(name, title.trim() || name, kind);
      open(name);
    } catch (err) {
      setBusy(false);
      toast((err as Error).message, 'error');
    }
  };
  return (
    <div className="lmodal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="ldialog"
        role="dialog"
        aria-label={t('launcher.new.title')}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <header>
          <h2>{t('launcher.new.title')}</h2>
          <button type="button" className="tb" aria-label={t('common.close')} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="kinds" role="radiogroup" aria-label={t('launcher.new.kind')}>
          {KINDS.map((k) => (
            <button type="button" key={k.kind} role="radio" aria-checked={kind === k.kind} data-kind={k.kind} className={`kopt t-${k.tone}`} onClick={() => setKind(k.kind)}>
              <KindIcon kind={k.kind} size={16} />
              <span className="name">{t(`launcher.kind.${k.kind}.name`)}</span>
            </button>
          ))}
        </div>
        <p className="kblurb">{t(`launcher.kind.${kind}.blurb`)}</p>
        <input ref={titleRef} className="input" placeholder={t(`launcher.kind.${kind}.example`)} aria-label={t('launcher.new.titleField')} value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="where">
          {folder === null ? (
            <>
              <span className="path" data-folder={name}>
                projects/{name}
              </span>
              <button
                type="button"
                className="linkish"
                onClick={() => {
                  setFolder(name);
                  setTimeout(() => folderRef.current?.focus());
                }}
              >
                {t('launcher.new.folderEdit')}
              </button>
            </>
          ) : (
            <span className="folder">
              <span className="pre">projects/</span>
              <input ref={folderRef} className="input" aria-label={t('launcher.new.folderLabel')} value={folder} onChange={(e) => setFolder(e.target.value.trim())} />
            </span>
          )}
        </div>
        <div className={`problem${problem ? ' on' : ''}`} role="alert">
          {problem}
        </div>
        <footer>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" type="submit" disabled={!name || !!problem || busy}>
            {t(`launcher.kind.${kind}.create`)}
          </button>
        </footer>
      </form>
    </div>
  );
}

/** Move focus between cards with the arrow keys, by where they sit on screen. */
function arrowNav(e: React.KeyboardEvent<HTMLElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('.lcard')];
  const i = cards.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  e.preventDefault();
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    cards[Math.max(0, Math.min(cards.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))]?.focus();
    return;
  }
  const r = cards[i].getBoundingClientRect();
  const down = e.key === 'ArrowDown';
  let best: HTMLElement | null = null;
  let bestD = Infinity;
  for (const c of cards) {
    const q = c.getBoundingClientRect();
    if (down ? q.top <= r.top + 4 : q.top >= r.top - 4) continue;
    const d = Math.abs(q.top - r.top) * 4 + Math.abs(q.left - r.left);
    if (d < bestD) [best, bestD] = [c, d];
  }
  best?.focus();
}

export function Launcher() {
  const { t } = useTranslation();
  const [list, setList] = useState<ProjectCard[] | null>(null);
  const [tab, setTab] = useState<ProjectKind | 'all'>('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const [creating, setCreating] = useState<ProjectKind | null>(null);
  const [importing, setImporting] = useState<{ picked?: Picked } | null>(null);
  const [dropping, setDropping] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const recent = useMemo(readRecent, []);

  useEffect(() => {
    api.projects().then(setList, (e) => {
      setList([]);
      toast(e.message, 'error');
    });
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const a = document.activeElement;
      if (e.key === '/' && !(a instanceof HTMLInputElement) && !creating && !importing) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    // SVG on the clipboard (Figma: Copy as SVG) pasted onto the launcher opens the import with it
    const paste = (e: ClipboardEvent) => {
      if (creating || importing || document.activeElement instanceof HTMLInputElement) return;
      const picked = pickedFromText(e.clipboardData?.getData('text/plain') ?? '');
      if (!picked) return;
      e.preventDefault();
      setImporting({ picked });
    };
    window.addEventListener('keydown', key);
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('paste', paste);
    };
  }, [creating, importing]);

  const counts = useMemo(() => {
    const c = { all: list?.length ?? 0 } as Record<ProjectKind | 'all', number>;
    for (const k of KINDS) c[k.kind] = list?.filter((p) => p.kind === k.kind).length ?? 0;
    return c;
  }, [list]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rank = (p: ProjectCard) => {
      const i = recent.indexOf(p.name);
      return i < 0 ? Infinity : i;
    };
    return (list ?? [])
      .filter((p) => (tab === 'all' || p.kind === tab) && (!needle || p.title.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle) || t(`launcher.kind.${p.kind}.name`).toLowerCase().includes(needle)))
      .sort((a, b) =>
        sort === 'name'
          ? (a.title || a.name).localeCompare(b.title || b.name)
          : rank(a) - rank(b) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.name.localeCompare(b.name),
      );
  }, [list, tab, q, sort, recent, t]);
  const taken = useMemo(() => new Set((list ?? []).map((p) => p.name)), [list]);
  const lastOpened = recent.find((n) => taken.has(n));

  return (
    <div
      className={`launcher${dropping ? ' dropping' : ''}`}
      data-drop-hint={t('launcher.dropHint')}
      onDragOver={(e) => {
        if (creating || importing || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => e.currentTarget.contains(e.relatedTarget as Node) || setDropping(false)}
      onDrop={(e) => {
        if (!dropping) return;
        e.preventDefault();
        setDropping(false);
        void droppedFiles(e.dataTransfer)
          .then(readPicked)
          .then((picked) => (picked.entry ? setImporting({ picked }) : toast(t('launcher.dropNoEntry'), 'error')));
      }}
    >
      <header className="lhead">
        <div className="brand">
          <a className="mark" href={REPO_URL} target="_blank" rel="noopener noreferrer" title={t('launcher.brand.title')} aria-label={t('launcher.brand.title')}>
            <Mark />
          </a>
          <div>
            <h1>Tingly Design</h1>
            <div className="sub">{list ? t('launcher.subtitle', { count: list.length }) : t('launcher.subtitleLoading')}</div>
          </div>
        </div>
        <div className="tools">
          <label className="lsearch">
            <IconSearch size={15} stroke={1.7} aria-hidden="true" />
            <input
              ref={search}
              placeholder={t('launcher.search.placeholder')}
              aria-label={t('launcher.search.label')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && shown[0]) open(shown[0].name);
                if (e.key === 'Escape') setQ('');
              }}
            />
            <kbd>/</kbd>
          </label>
          <select className="lsort" aria-label={t('launcher.sort.label')} value={sort} onChange={(e) => setSort(e.target.value as 'recent' | 'name')}>
            <option value="recent">{t('launcher.sort.recent')}</option>
            <option value="name">{t('launcher.sort.name')}</option>
          </select>
          <LanguageMenu className="btn lbtn" />
          <Appearance className="btn lbtn" />
          <button className="btn primary lnewbtn" onClick={() => setCreating(tab === 'all' ? 'design' : tab)}>
            <IconPlus size={15} stroke={2} aria-hidden="true" /> {t('launcher.new.title')}
          </button>
        </div>
      </header>

      <nav className="ltabs" role="tablist" aria-label={t('launcher.tabs.label')}>
        {(['all', ...KINDS.map((k) => k.kind)] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} data-tab={k} className={k === 'all' ? '' : `t-${KIND[k].tone}`} onClick={() => setTab(k)}>
            {k !== 'all' && <KindIcon kind={k} size={14} />}
            {k === 'all' ? t('launcher.tabs.all') : t(`launcher.kind.${k}.name`)}
            <span className="n">{counts[k]}</span>
          </button>
        ))}
      </nav>

      <main className="lmain" onKeyDown={arrowNav}>
        {list === null && <div className="lhint">{t('launcher.loading')}</div>}
        {tab === 'all' && !q.trim() && (
          <section className="lstart" aria-label={t('launcher.start')}>
            <h2>{t('launcher.start')}</h2>
            <div className="lstrip">
              {KINDS.map((k) => (
                <NewTile key={k.kind} kind={k.kind} onClick={() => setCreating(k.kind)} />
              ))}
              <ImportTile onClick={() => setImporting({})} />
            </div>
          </section>
        )}
        {list !== null && !q.trim() && lastOpened && (tab === 'all' || list.find((p) => p.name === lastOpened)?.kind === tab) && (
          <div className="lcontinue">
            <span>{t('launcher.continue')}</span>
            <button className="linkish" onClick={() => open(lastOpened)}>
              {list.find((p) => p.name === lastOpened)?.title || lastOpened}
            </button>
          </div>
        )}
        {list !== null && (
          <section className="lall" aria-label={t('launcher.projects')}>
            <h2>{tab === 'all' ? t('launcher.allProjects') : t(`launcher.kind.${tab}.name`)}</h2>
            <div className="lgrid">
              {shown.map((p) => (
                <Card key={p.name} p={p} recent={p.name === lastOpened} />
              ))}
              {tab !== 'all' && <NewTile kind={tab} onClick={() => setCreating(tab)} />}
            </div>
            {!shown.length && <div className="lhint">{q.trim() ? t('launcher.notFound', { q: q.trim() }) : tab === 'all' ? t('launcher.noProjects') : t(`launcher.kind.${tab}.empty`)}</div>}
          </section>
        )}
      </main>
      <footer className="lfoot">
        <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer">
          {t('launcher.links.report')}
        </a>
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          {t('launcher.links.star')}
        </a>
      </footer>
      {importing && <ImportDialog initial={importing.picked} taken={taken} onClose={() => setImporting(null)} onDone={open} />}
      {creating && <NewDialog initial={creating} taken={taken} onClose={() => setCreating(null)} />}
    </div>
  );
}
