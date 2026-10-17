import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { IconChartBar, IconComponents, IconFileImport, IconFileText, IconLayoutDashboard, IconMovie, IconPlus, IconPresentation, IconSearch, type IconProps } from '@tabler/icons-react';
import { SLIDE_H, SLIDE_W, sandboxDoc, type FromRuntime, type MotionJson, type ProjectCard, type ProjectKind, type ProjectPreview } from '@dc/core';
import { api, type FolderInfo } from '../api';
import { toast, useStore } from '../store';
import { Chevron, FileZip, FolderOpen, GridLayout, GroupFolder, ListLayout, More, Rename, Sliders, Unlink } from './icons';
import { chooseProjectArchive, saveProjectArchive } from '../projectArchive';
import { Menu, MenuItem } from './Menu';
import { Appearance, LanguageMenu } from './Appearance';
import { ISSUES_URL, REPO_URL } from '../links';
import { goTo } from '../host';
import { SERVER } from '../base';
import { NAME_RE, freeName, slugOf } from '../projectName';
import { ImportDialog } from './ImportDialog';
import { MotionFrame } from './motion/MotionFrame';
import { SizePicker } from './motion/SizePicker';
import { readSizes, rememberSize, type Size } from '../motionSizes';
import { BOARD_PRESETS, DEFAULT_BOARD_SIZE } from '../boardPresets';
import { applyNewOptions, checkDataFile, type NewOptions } from '../newProject';
import { droppedFiles, pickedFromText, readPicked, type Picked } from '../importer';
import { htmlLang } from '../i18n';
import { Specimen } from './ds/Specimen';
import { readPref, writePref } from '../local';
import { useElementSize } from '../hooks';
import { Dialog } from './Dialog';

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
const VIEW_KEY = 'dc:launcher-view';
const FOLDED_KEY = 'dc:launcher-folded-groups';

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

function Preview({ p, project, width }: { p: ProjectPreview; project: string; width: number }) {
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
        <Specimen glance={p.glance} alt={p.alt} themeName={p.glance.themes[0]} title={p.glance.headingFont?.split(',')[0].replace(/["']/g, '').trim() || 'Aa'} />
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

/** The ⋯ beside a card or row: it sits next to the card, not inside it, since a card is itself a button. */
function MoreButton({ p, onMore }: { p: ProjectCard; onMore: (name: string, at: DOMRect) => void }) {
  const { t } = useTranslation();
  return (
    <button className="lmore" aria-label={t('launcher.rowMenu', { title: p.title || p.name })} data-more={p.name} onClick={(e) => onMore(p.name, e.currentTarget.getBoundingClientRect())}>
      <More />
    </button>
  );
}

function Card({ p, recent, flat, onMore }: { p: ProjectCard; recent: boolean; flat: boolean; onMore: (name: string, at: DOMRect) => void }) {
  const { t } = useTranslation();
  const [ref, { w: width }] = useElementSize<HTMLButtonElement>();
  const k = KIND[p.kind];
  const kindName = t(`launcher.kind.${p.kind}.name`);
  return (
    <div className="lcell">
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
          <div className={`lpath${p.path ? ' far' : ''}`} title={p.path}>
            <span className="lfolder">
              <bdi>{p.path ?? `projects/${p.name}`}</bdi>
            </span>
            {flat && p.group && <span className="lgroup">· {p.group}</span>}
          </div>
        </div>
      </button>
      <MoreButton p={p} onMore={onMore} />
    </div>
  );
}

/** One project as a line: no preview, so a long list stays light. */
function Row({ p, recent, onMore }: { p: ProjectCard; recent: boolean; onMore: (name: string, at: DOMRect) => void }) {
  const { t } = useTranslation();
  const k = KIND[p.kind];
  const kindName = t(`launcher.kind.${p.kind}.name`);
  return (
    <div className="lcell lrowcell">
      <button className={`lrow t-${k.tone}`} data-project={p.name} data-kind={p.kind} onClick={() => open(p.name)} aria-label={t('launcher.card.open', { title: p.title, kind: kindName })}>
        <span className="c-title">
          <span className="kic" title={kindName}>
            <KindIcon kind={p.kind} size={15} />
          </span>
          <span className="name">{p.title || p.name}</span>
          {recent && <span className="recent">{t('launcher.card.recent')}</span>}
        </span>
        <span className={`c-path${p.path ? ' far' : ''}`} title={p.path}>
          <bdi>{p.path ?? `projects/${p.name}`}</bdi>
        </span>
        <span className="c-group">{p.group ?? ''}</span>
        <span className="c-size">{t(`launcher.kind.${p.kind}.count`, { count: p.count })}</span>
        <span className="c-when">{p.updatedAt ? ago(t, p.updatedAt) : ''}</span>
      </button>
      <MoreButton p={p} onMore={onMore} />
    </div>
  );
}

/** A small text box inside a menu: rename a title, or name a group. */
function MenuInput({ value, onChange, onEnter, label, placeholder }: { value: string; onChange: (v: string) => void; onEnter: () => void; label: string; placeholder?: string }) {
  return (
    <input
      className="input menu-input"
      autoFocus
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onEnter();
        }
      }}
    />
  );
}

/** What a project's ⋯ opens: its actions, then the rename box or the group list. */
function ProjectActions({ p, at, groups, onClose, onRename, onMove, onUnlink }: { p: ProjectCard; at: { x: number; y: number }; groups: string[]; onClose: () => void; onRename: (title: string) => void; onMove: (group: string) => void; onUnlink: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<'menu' | 'rename' | 'group'>('menu');
  const [text, setText] = useState(p.title || p.name);
  const typed = text.trim();
  const matches = step === 'group' ? groups.filter((g) => g.toLowerCase().includes(typed.toLowerCase())) : [];
  const exact = groups.find((g) => g.toLowerCase() === typed.toLowerCase());
  const label = step === 'rename' ? t('launcher.rename.label') : step === 'group' ? t('launcher.group.moveTo') : t('launcher.rowMenu', { title: p.title || p.name });
  return (
    <Menu x={at.x} y={at.y} align="right" onClose={onClose} label={label}>
      {step === 'menu' && (
        <>
          <MenuItem label={t('launcher.rename.menu')} icon={<Rename />} onSelect={() => setStep('rename')} />
          <MenuItem label={t('launcher.group.moveTo')} icon={<GroupFolder />} onSelect={() => (setText(''), setStep('group'))} />
          <MenuItem label={t('launcher.archive.export')} icon={<FileZip />} onSelect={() => (onClose(), void saveProjectArchive(p.name, true))} />
          {p.path && (
            <>
              <div className="msep" role="separator" />
              <MenuItem label={t('launcher.folder.unlink')} icon={<Unlink />} onSelect={() => (onUnlink(), onClose())} />
            </>
          )}
        </>
      )}
      {step === 'rename' && (
        <div className="menu-form">
          <MenuInput label={t('launcher.rename.label')} value={text} onChange={setText} onEnter={() => typed && (onRename(typed), onClose())} />
          <div className="menu-note">{t('launcher.rename.hint')}</div>
        </div>
      )}
      {step === 'group' && (
        <>
          <div className="menu-form">
            <MenuInput
              label={t('launcher.group.pick')}
              placeholder={t('launcher.group.pick')}
              value={text}
              onChange={setText}
              onEnter={() => typed && (onMove(exact ?? typed), onClose())}
            />
          </div>
          {matches.map((g) => (
            <MenuItem key={g} label={g} icon={<GroupFolder />} checked={g === p.group} onSelect={() => (onMove(g), onClose())} />
          ))}
          {typed && !exact && <MenuItem label={t('launcher.group.create', { name: typed })} icon={<GroupFolder />} onSelect={() => (onMove(typed), onClose())} />}
          {p.group && <MenuItem label={t('launcher.group.remove')} onSelect={() => (onMove(''), onClose())} />}
        </>
      )}
    </Menu>
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

/** A folder written as a full path (`~/…`, `/…`, `C:\…`) rather than a name in the projects folder. */
export const isFolderPath = (v: string) => /^(~($|[\\/])|\/|[A-Za-z]:[\\/])/.test(v);

/** What the server says is at a typed path, asked once the typing pauses. */
function useFolderInfo(path: string | null): FolderInfo | 'checking' | { error: string } | null {
  const [info, setInfo] = useState<FolderInfo | 'checking' | { error: string } | null>(null);
  useEffect(() => {
    if (!path) return setInfo(null);
    setInfo('checking');
    let live = true;
    const timer = setTimeout(() => {
      api.folder(path).then(
        (r) => live && setInfo(r),
        (e: Error) => live && setInfo({ error: e.message }),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [path]);
  return info;
}

export function NewDialog({ initial, taken, onClose, at }: { initial: ProjectKind; taken: Set<string>; onClose: () => void; at?: string }) {
  const { t } = useTranslation();
  const linksOn = useStore((s) => s.health?.links !== false);
  const projectsInRepo = useStore((s) => !!s.health?.projectsInRepo);
  const [git, setGit] = useState(false);
  const [kind, setKind] = useState<ProjectKind>(initial);
  const [title, setTitle] = useState('');
  const [folder, setFolder] = useState<string | null>(at ?? null);
  const [busy, setBusy] = useState(false);
  // a motion piece starts in the size last used (16:9 the first time)
  const [size, setSize] = useState<Size | null>(() => readSizes().last ?? [1920, 1080]);
  // the rest is optional: a design system (canvas, slides), a board size (canvas), a table (dashboard)
  const [systems, setSystems] = useState<{ name: string; title: string }[]>([]);
  const [designSystem, setDesignSystem] = useState('');
  const [board, setBoard] = useState(DEFAULT_BOARD_SIZE.join('x'));
  const [dataFile, setDataFile] = useState<{ file: File; rows: number } | null>(null);
  const [dataError, setDataError] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  useEffect(() => titleRef.current?.focus(), []);
  useEffect(() => {
    api.projects().then((l) => setSystems(l.filter((p) => p.kind === 'design-system')), () => setSystems([]));
  }, []);
  // the folder is a detail: it follows the title, falls back to the type's name for a title with no
  // letters (Chinese, say), and steps aside for a name that is taken, until the person edits it
  const auto = freeName(slugOf(title) || kind, taken);
  const name = folder ?? auto;
  // a full path puts the project there instead of in the projects folder
  const path = linksOn && isFolderPath(name) ? name : null;
  const info = useFolderInfo(path);
  const sizeBad = kind === 'motion' && !size;
  const problem = !name
    ? ''
    : path
      ? info === null || info === 'checking'
        ? ''
        : 'error' in info
          ? info.error
          : info.state === 'project'
            ? t('launcher.new.pathHasProject', { path: info.path })
            : info.state === 'busy'
              ? t('launcher.new.pathBusy', { path: info.path })
              : info.state === 'file'
                ? t('launcher.new.pathFile', { path: info.path })
                : ''
      : !NAME_RE.test(name)
        ? t(linksOn ? 'launcher.new.folderInvalidOrPath' : 'launcher.new.folderInvalid')
        : taken.has(name)
          ? t('launcher.new.folderTaken', { name })
          : '';
  const waiting = !!path && (info === null || info === 'checking');
  // a repository from the start is offered only where the project would not already be in one
  const inRepo = path ? !!info && info !== 'checking' && !('error' in info) && !!info.repo : projectsInRepo;
  const offerGit = !inRepo && !waiting;
  const submit = async () => {
    if (!name || problem || waiting || busy || sizeBad) return;
    setBusy(true);
    try {
      const boardSize = board.split('x').map(Number) as Size;
      const { name: made, gitError } = await api.createProject(
        path ? { path } : name,
        title.trim() || (path ? path.split(/[\\/]/).filter(Boolean).pop() || kind : name),
        kind,
        kind === 'motion' && size ? size : kind === 'design' && board !== DEFAULT_BOARD_SIZE.join('x') ? boardSize : undefined,
        { git: offerGit && git },
      );
      if (gitError) toast(t('launcher.new.gitFailed', { error: gitError }), 'error');
      if (kind === 'motion' && size) rememberSize(size);
      const opts: NewOptions = {
        designSystem: (kind === 'design' || kind === 'slides') && designSystem ? designSystem : undefined,
        dataFile: kind === 'dashboard' ? dataFile?.file : undefined,
      };
      for (const m of await applyNewOptions(made, opts)) toast(m, 'error');
      open(made);
    } catch (err) {
      setBusy(false);
      toast((err as Error).message, 'error');
    }
  };
  return (
    <Dialog label={t('launcher.new.title')} onClose={onClose} onSubmit={() => void submit()}>
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
      {kind === 'motion' && <SizePicker value={size} onChange={setSize} />}
      {(kind === 'design' || kind === 'slides' || kind === 'dashboard' || offerGit) && (
        <div className="nopts" data-options={kind}>
          <span className="nopt-h">{t('launcher.new.options')}</span>
          {(kind === 'design' || kind === 'slides') && (
            <label className="nopt">
              <span>{t('launcher.new.ds')}</span>
              <select className="input" value={designSystem} onChange={(e) => setDesignSystem(e.target.value)} aria-label={t('launcher.new.ds')}>
                <option value="">{t('launcher.new.dsNone')}</option>
                {systems.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {kind === 'design' && (
            <label className="nopt">
              <span>{t('launcher.new.boardSize')}</span>
              <select className="input" value={board} onChange={(e) => setBoard(e.target.value)} aria-label={t('launcher.new.boardSize')}>
                {BOARD_PRESETS.map((p) => (
                  <option key={p.size.join('x')} value={p.size.join('x')}>
                    {p.key ? t(p.key, { w: p.size[0], h: p.size[1] }) : p.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {kind === 'dashboard' && (
            <div className="nopt">
              <span>{t('launcher.new.dataFile')}</span>
              <span className="nopt-file">
                <label className="btn ghost">
                  {dataFile ? dataFile.file.name : t('launcher.new.dataPick')}
                  <input
                    type="file"
                    hidden
                    accept=".csv,.tsv,.json"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (!f) return;
                      const r = await checkDataFile(f);
                      if ('error' in r) return setDataError(r.error), setDataFile(null);
                      setDataError('');
                      setDataFile({ file: f, rows: r.rows });
                    }}
                  />
                </label>
                {dataFile && (
                  <>
                    <span className="hint">{t('launcher.new.dataRows', { count: dataFile.rows })}</span>
                    <button type="button" className="linkish" onClick={() => setDataFile(null)}>
                      {t('launcher.new.dataClear')}
                    </button>
                  </>
                )}
              </span>
              {dataError && <span className="nopt-err">{dataError}</span>}
            </div>
          )}
          {offerGit && (
            <label className="nopt nopt-check" data-git="">
              <input type="checkbox" checked={git} onChange={(e) => setGit(e.target.checked)} />
              <span>{t('launcher.new.git')}</span>
              <span className="hint">{t('launcher.new.gitHint')}</span>
            </label>
          )}
        </div>
      )}
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
            {!path && <span className="pre">projects/</span>}
            <input ref={folderRef} className="input" aria-label={t('launcher.new.folderLabel')} value={folder} onChange={(e) => setFolder(e.target.value.trim())} />
          </span>
        )}
      </div>
      {folder !== null && linksOn && (
        <div className="where-hint" data-where={path ? 'path' : 'name'}>
          {path && info && info !== 'checking' && !('error' in info) && info.state === 'free' ? t('launcher.new.pathFree', { path: info.path }) : t('launcher.new.folderHint')}
        </div>
      )}
      <div className={`problem${problem ? ' on' : ''}`} role="alert">
        {problem}
      </div>
      <footer>
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button className="btn primary" type="submit" disabled={!name || !!problem || waiting || busy || sizeBad}>
          {t(`launcher.kind.${kind}.create`)}
        </button>
      </footer>
    </Dialog>
  );
}

/**
 * Opens a project folder that lives anywhere on disk. The folder stays where it is; the
 * launcher only remembers it. A folder with no project yet leads to New project, aimed there.
 */
function OpenFolderDialog({ onClose, onCreateHere }: { onClose: () => void; onCreateHere: (path: string) => void }) {
  const { t } = useTranslation();
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const typed = path.trim();
  const usable = isFolderPath(typed);
  const info = useFolderInfo(usable ? typed : null);
  const ready = !!info && info !== 'checking' && !('error' in info);
  const submit = async () => {
    if (!ready || busy) return;
    if (info.state === 'free') return onCreateHere(typed);
    if (info.state !== 'project') return;
    setBusy(true);
    try {
      open((await api.link(typed)).name);
    } catch (e) {
      setBusy(false);
      toast((e as Error).message, 'error');
    }
  };
  const status = !typed
    ? t('launcher.folder.hint')
    : !usable
      ? t('launcher.folder.needPath')
      : !info || info === 'checking'
        ? t('launcher.folder.checking')
        : 'error' in info
          ? info.error
          : info.state === 'project'
            ? info.name
              ? t('launcher.folder.listed', { kind: t(`launcher.kind.${info.kind!}.name`), name: info.name })
              : t('launcher.folder.found', { kind: t(`launcher.kind.${info.kind!}.name`) })
            : info.state === 'free'
              ? t('launcher.folder.empty', { path: info.path })
              : info.state === 'busy'
                ? t('launcher.folder.noProject', { path: info.path })
                : t('launcher.new.pathFile', { path: info.path });
  return (
    <Dialog label={t('launcher.folder.title')} className="lopen" onClose={onClose} onSubmit={() => void submit()}>
      <p className="kblurb">{t('launcher.folder.blurb')}</p>
      <input autoFocus className="input mono" aria-label={t('launcher.folder.label')} placeholder={t('launcher.folder.placeholder')} value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} />
      <div className={`folder-state${ready ? ` s-${info.state}` : ''}`} role="status" data-state={ready ? info.state : undefined}>
        {ready && info.state === 'project' && <KindIcon kind={info.kind!} size={14} />}
        <span>{status}</span>
      </div>
      <footer>
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button className="btn primary" type="submit" disabled={!ready || busy || (info.state !== 'project' && info.state !== 'free')}>
          {ready && info.state === 'free' ? t('launcher.folder.createHere') : t('launcher.folder.open')}
        </button>
      </footer>
    </Dialog>
  );
}

/** Move focus between cards with the arrow keys, by where they sit on screen. */
function arrowNav(e: React.KeyboardEvent<HTMLElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('.lcard, .lrow')];
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
  const [view, setView] = useState<'grid' | 'list'>(() => (readPref(VIEW_KEY) === 'list' ? 'list' : 'grid'));
  const [folded, setFolded] = useState<Set<string>>(() => new Set(readPref(FOLDED_KEY).split('\n').filter(Boolean)));
  const [acting, setActing] = useState<{ name: string; x: number; y: number } | null>(null);
  const [newMenu, setNewMenu] = useState<DOMRect | null>(null);
  const [creating, setCreating] = useState<ProjectKind | null>(null);
  const [createAt, setCreateAt] = useState<string | undefined>(undefined);
  const [opening, setOpening] = useState(false);
  const linksOn = useStore((s) => s.health?.links !== false);
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
      if (e.key === '/' && !(a instanceof HTMLInputElement) && !creating && !importing && !opening) {
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
      .filter((p) => (tab === 'all' || p.kind === tab) && (!needle || p.title.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle) || (p.group ?? '').toLowerCase().includes(needle) || t(`launcher.kind.${p.kind}.name`).toLowerCase().includes(needle)))
      .sort((a, b) =>
        sort === 'name'
          ? (a.title || a.name).localeCompare(b.title || b.name)
          : rank(a) - rank(b) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.name.localeCompare(b.name),
      );
  }, [list, tab, q, sort, recent, t]);
  const taken = useMemo(() => new Set((list ?? []).map((p) => p.name)), [list]);
  const lastOpened = recent.find((n) => taken.has(n));
  const groups = useMemo(() => [...new Set((list ?? []).map((p) => p.group).filter((g): g is string => !!g))].sort((a, b) => a.localeCompare(b)), [list]);
  // with groups, the list falls into one section per group (the most recent first, or by name), the loose ones last; a search flattens it
  const sections = useMemo(() => {
    if (!groups.length || q.trim()) return [{ key: '', name: '', items: shown }];
    const by = new Map<string, ProjectCard[]>();
    for (const p of shown) by.set(p.group ?? '', [...(by.get(p.group ?? '') ?? []), p]);
    const names = [...by.keys()].filter(Boolean);
    return [...names.map((n) => ({ key: n, name: n, items: by.get(n)! })), ...(by.has('') ? [{ key: '', name: t('launcher.group.ungrouped'), items: by.get('')! }] : [])];
  }, [shown, groups, q, t]);
  const flat = sections.length === 1 && !sections[0].name;
  const apply = (name: string, patch: { title?: string; group?: string }) => {
    const before = list?.find((p) => p.name === name);
    if (!before) return;
    const next = (p: ProjectCard, v: { title?: string; group?: string }): ProjectCard => ({ ...p, ...(v.title !== undefined ? { title: v.title } : {}), ...(v.group !== undefined ? { group: v.group || undefined } : {}) });
    setList((l) => l && l.map((p) => (p.name === name ? next(p, patch) : p)));
    api.patchProject(name, patch).then(
      () => {
        if (patch.group === undefined) return;
        const title = before.title || before.name;
        const undo = { label: t('launcher.group.undo'), run: () => apply(name, { group: before.group ?? '' }) };
        if (patch.group) toast(t('launcher.group.moved', { title, group: patch.group }), 'info', undo);
        else toast(t('launcher.group.removed', { title, group: before.group ?? '' }), 'info', undo);
      },
      (e: Error) => {
        setList((l) => l && l.map((p) => (p.name === name ? before : p)));
        toast(e.message, 'error');
      },
    );
  };
  // off the list only: the folder and its files stay, and Undo lists it again
  const unlink = (p: ProjectCard) => {
    const title = p.title || p.name;
    setList((l) => l && l.filter((x) => x.name !== p.name));
    api.unlink(p.name).then(
      () =>
        toast(t('launcher.folder.unlinked', { title }), 'info', {
          label: t('launcher.group.undo'),
          run: () => api.link(p.path!).then(() => api.projects().then(setList), (e: Error) => toast(e.message, 'error')),
        }),
      (e: Error) => {
        setList((l) => l && [...l, p]);
        toast(e.message, 'error');
      },
    );
  };
  const setViewTo = (v: 'grid' | 'list') => {
    setView(v);
    writePref(VIEW_KEY, v);
  };
  const fold = (key: string) =>
    setFolded((f) => {
      const n = new Set(f);
      if (!n.delete(key)) n.add(key);
      writePref(FOLDED_KEY, [...n].join('\n'));
      return n;
    });
  const onMore = (name: string, r: DOMRect) => setActing({ name, x: r.right, y: r.bottom + 4 });
  const acted = acting ? list?.find((p) => p.name === acting.name) : undefined;

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
          <LanguageMenu className="btn lbtn" />
          <button className="btn lbtn" aria-label={t('aiSettings.menu')} title={t('aiSettings.menu')} onClick={() => useStore.setState({ aiSettingsOpen: true })}>
            <Sliders />
          </button>
          <Appearance className="btn lbtn" />
          <button className="btn primary lnewbtn" aria-haspopup="menu" data-new-menu onClick={(e) => setNewMenu(e.currentTarget.getBoundingClientRect())}>
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
        {list !== null && !q.trim() && lastOpened && (tab === 'all' || list.find((p) => p.name === lastOpened)?.kind === tab) && (
          <div className="lcontinue">
            <span>{t('launcher.continue')}</span>
            <button className="linkish" onClick={() => open(lastOpened)}>
              {list.find((p) => p.name === lastOpened)?.title || lastOpened}
            </button>
          </div>
        )}
        {list !== null && (
          <section className={`lall${flat && groups.length ? '' : ' lnogroup'}`} aria-label={t('launcher.projects')}>
            <div className="lbar">
              <h2>{tab === 'all' ? t('launcher.allProjects') : t(`launcher.kind.${tab}.name`)}</h2>
              <div className="ltools">
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
                <div className="lview" role="group" aria-label={t('launcher.view.label')}>
                  {(['grid', 'list'] as const).map((v) => (
                    <button key={v} data-view={v} aria-pressed={view === v} title={t(`launcher.view.${v}`)} aria-label={t(`launcher.view.${v}`)} onClick={() => setViewTo(v)}>
                      {v === 'grid' ? <GridLayout /> : <ListLayout />}
                    </button>
                  ))}
                </div>
                <select className="lsort" aria-label={t('launcher.sort.label')} value={sort} onChange={(e) => setSort(e.target.value as 'recent' | 'name')}>
                  <option value="recent">{t('launcher.sort.recent')}</option>
                  <option value="name">{t('launcher.sort.name')}</option>
                </select>
              </div>
            </div>
            {view === 'list' && shown.length > 0 && (
              <div className="lrowhead" aria-hidden="false">
                <button className="c-title" data-sort="name" aria-pressed={sort === 'name'} onClick={() => setSort('name')}>
                  {t('launcher.list.name')}
                </button>
                <span className="c-path">{t('launcher.list.folder')}</span>
                <span className="c-group">{t('launcher.list.group')}</span>
                <span className="c-size">{t('launcher.list.size')}</span>
                <button className="c-when" data-sort="recent" aria-pressed={sort === 'recent'} onClick={() => setSort('recent')}>
                  {t('launcher.list.modified')}
                </button>
                <span className="c-more" />
              </div>
            )}
            {sections.map((sec, i) => {
              const key = sec.key || (sec.name ? '\u0000' : '');
              const shut = !!sec.name && folded.has(key);
              const last = i === sections.length - 1;
              const tile = tab !== 'all' && <NewTile kind={tab} onClick={() => setCreating(tab)} />;
              return (
                <div key={key} className="lsection" data-group={sec.name || undefined}>
                  {sec.name && (
                    <h3>
                      <button className="lghead" aria-expanded={!shut} aria-label={t(shut ? 'launcher.group.expand' : 'launcher.group.collapse', { name: sec.name })} onClick={() => fold(key)}>
                        <Chevron open={!shut} />
                        <span className="gname">{sec.name}</span>
                        <span className="n">{sec.items.length}</span>
                      </button>
                    </h3>
                  )}
                  {!shut && (
                    <div className={view === 'grid' ? 'lgrid' : 'llist'}>
                      {sec.items.map((p) => (view === 'grid' ? <Card key={p.name} p={p} recent={p.name === lastOpened} flat={flat || !!q.trim()} onMore={onMore} /> : <Row key={p.name} p={p} recent={p.name === lastOpened} onMore={onMore} />))}
                      {view === 'grid' && last && tile}
                    </div>
                  )}
                </div>
              );
            })}
            {view === 'list' && tab !== 'all' && <div className="lgrid ltail"><NewTile kind={tab} onClick={() => setCreating(tab)} /></div>}
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
      {newMenu && (
        <Menu x={newMenu.right} y={newMenu.bottom + 6} align="right" onClose={() => setNewMenu(null)} label={t('launcher.new.title')}>
          {KINDS.map((k) => (
            <div key={k.kind} data-new={k.kind} className="mwrap">
              <MenuItem label={t(`launcher.kind.${k.kind}.new`)} icon={
                  <span className={`kic t-${k.tone}`}>
                    <KindIcon kind={k.kind} size={14} />
                  </span>
                }
                onSelect={() => (setNewMenu(null), setCreating(k.kind))} />
            </div>
          ))}
          <div className="msep" role="separator" />
          <div data-new="import" className="mwrap">
            <MenuItem label={t('launcher.importTile.name')} icon={
                <span className="kic t-blue">
                  <IconFileImport size={14} stroke={1.7} aria-hidden="true" />
                </span>
              }
              onSelect={() => (setNewMenu(null), setImporting({}))} />
          </div>
          <div data-new="archive" className="mwrap">
            <MenuItem label={t('launcher.archive.import')} icon={
                <span className="kic t-blue">
                  <FileZip />
                </span>
              }
              onSelect={() => (setNewMenu(null), void chooseProjectArchive().then((name) => name && open(name)))} />
          </div>
          {linksOn && (
            <div data-new="folder" className="mwrap">
              <MenuItem label={t('launcher.folder.menu')} icon={
                  <span className="kic t-blue">
                    <FolderOpen />
                  </span>
                }
                onSelect={() => (setNewMenu(null), setOpening(true))} />
            </div>
          )}
        </Menu>
      )}
      {acting && acted && <ProjectActions key={acting.name} p={acted} at={acting} groups={groups} onClose={() => setActing(null)} onRename={(title) => apply(acting.name, { title })} onMove={(group) => apply(acting.name, { group })} onUnlink={() => unlink(acted)} />}
      {importing && <ImportDialog initial={importing.picked} taken={taken} onClose={() => setImporting(null)} onDone={open} />}
      {creating && <NewDialog initial={creating} taken={taken} at={createAt} onClose={() => (setCreating(null), setCreateAt(undefined))} />}
      {opening && <OpenFolderDialog onClose={() => setOpening(false)} onCreateHere={(path) => (setOpening(false), setCreateAt(path), setCreating('design'))} />}
    </div>
  );
}
