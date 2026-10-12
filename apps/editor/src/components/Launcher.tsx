import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { IconChartBar, IconComponents, IconFileImport, IconFileText, IconLayoutDashboard, IconPlus, IconPresentation, IconSearch, type IconProps } from '@tabler/icons-react';
import { SLIDE_H, SLIDE_W, sandboxDoc, type FromRuntime, type ProjectCard, type ProjectKind, type ProjectPreview } from '@dc/core';
import { api } from '../api';
import { toast } from '../store';
import { Appearance } from './Appearance';
import { goTo } from '../host';
import { SERVER } from '../base';
import { NAME_RE, slugOf } from '../projectName';
import { ImportDialog } from './ImportDialog';
import { droppedFiles, readPicked, type Picked } from '../importHtml';

/** The five project kinds, in the order the launcher lists them. */
export const KINDS: { kind: ProjectKind; zh: string; unit: string; blurb: string; tone: string }[] = [
  { kind: 'design', zh: '画布', unit: '个画板', blurb: '无限画布上的画板、便签和图形，适合界面与流程。', tone: 'blue' },
  { kind: 'slides', zh: '幻灯片', unit: '页', blurb: '1920×1080 的一页页幻灯片，可以直接放映。', tone: 'purple' },
  { kind: 'design-system', zh: '设计系统', unit: '个组件', blurb: '颜色、字体、组件和品牌素材，可装进画布和幻灯片。', tone: 'teal' },
  { kind: 'dashboard', zh: '看板', unit: '个数据集', blurb: '接数据源的图表页面，每个数字都标明出处。', tone: 'orange' },
  { kind: 'docs', zh: '文档', unit: '个标签页', blurb: '富文本文档，带标签页和评论，按块写回 Markdown。', tone: 'green' },
];
const KIND = Object.fromEntries(KINDS.map((k) => [k.kind, k])) as Record<ProjectKind, (typeof KINDS)[number]>;

const RECENT_KEY = 'dc:recent-projects';

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function open(name: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([name, ...readRecent().filter((n) => n !== name)].slice(0, 20)));
  } catch {
    // private mode: nothing to remember
  }
  goTo(name);
}

function ago(iso: string | null): string {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`;
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const KIND_ICONS: Record<ProjectKind, ComponentType<IconProps>> = {
  design: IconLayoutDashboard,
  slides: IconPresentation,
  'design-system': IconComponents,
  dashboard: IconChartBar,
  docs: IconFileText,
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
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [shown, setShown] = useState(false);
  const srcdoc = useMemo(() => sandboxDoc(SERVER, 'runtime'), []);
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
        <iframe ref={frame} title={`预览：${file}`} sandbox="allow-scripts" srcDoc={srcdoc} tabIndex={-1} aria-hidden="true" />
      </div>
    </div>
  );
}

function Minimap({ boards }: { boards: { x: number; y: number; w: number; h: number; title: string }[] }) {
  if (!boards.length) return <div className="lp-empty">空画布</div>;
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
        <div className="lp-empty">{p.cover ? '' : '还没有幻灯片'}</div>
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
          {!p.components.length && <span className="faint">还没有组件</span>}
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
          {!p.datasets.length && <li className="faint">还没有数据集</li>}
        </ul>
      </div>
    );
  } else {
    body = (
      <div className="lp-doc">
        <div className="page">
          <ul>
            {p.tabs.map((t, i) => (
              <li key={i} style={{ paddingLeft: t.depth * 10 }}>
                {t.title}
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
  const [ref, width] = useWidth<HTMLButtonElement>();
  const k = KIND[p.kind];
  return (
    <button ref={ref} className={`lcard t-${k.tone}`} data-project={p.name} data-kind={p.kind} onClick={() => open(p.name)} aria-label={`打开 ${p.title}（${k.zh}）`}>
      <Preview p={p.preview} project={p.name} width={width} />
      <div className="lbody">
        <div className="ltitle">
          <span className="name">{p.title || p.name}</span>
          {recent && <span className="recent">最近打开</span>}
        </div>
        <div className="lmeta">
          <span className="kbadge">
            <KindIcon kind={p.kind} size={12} />
            {k.zh}
          </span>
          <span>
            {p.count} {k.unit}
          </span>
          {p.updatedAt && <span>{ago(p.updatedAt)}</span>}
        </div>
        <div className="lpath">projects/{p.name}</div>
      </div>
    </button>
  );
}

function NewTile({ kind, onClick }: { kind: ProjectKind; onClick: () => void }) {
  const k = KIND[kind];
  return (
    <button className={`lcard lnew t-${k.tone}`} onClick={onClick} data-new={kind}>
      <span className="ic">
        <KindIcon kind={kind} size={22} />
      </span>
      <span className="txt">
        <span className="name">新建{k.zh}</span>
        <span className="blurb">{k.blurb}</span>
      </span>
    </button>
  );
}

function ImportTile({ onClick }: { onClick: () => void }) {
  return (
    <button className="lcard lnew t-blue" onClick={onClick} data-new="import">
      <span className="ic">
        <IconFileImport size={22} stroke={1.7} />
      </span>
      <span className="txt">
        <span className="name">导入 HTML</span>
        <span className="blurb">把现成的网页变成可以编辑的画布。</span>
      </span>
    </button>
  );
}

function NewDialog({ initial, taken, onClose }: { initial: ProjectKind; taken: Set<string>; onClose: () => void }) {
  const [kind, setKind] = useState<ProjectKind>(initial);
  const [title, setTitle] = useState('');
  const [folder, setFolder] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => titleRef.current?.focus(), []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  const name = touched ? folder : slugOf(title);
  const problem = !name
    ? title.trim()
      ? '标题里没有可用作文件夹名的字母或数字，请填写文件夹名。'
      : ''
    : !NAME_RE.test(name)
      ? '文件夹名只能用字母、数字、- 和 _，并以字母或数字开头。'
      : taken.has(name)
        ? `projects/${name} 已经存在。`
        : '';
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
        aria-label="新建项目"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <header>
          <h2>新建项目</h2>
          <button type="button" className="tb" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="kinds" role="radiogroup" aria-label="类型">
          {KINDS.map((k) => (
            <button
              type="button"
              key={k.kind}
              role="radio"
              aria-checked={kind === k.kind}
              data-kind={k.kind}
              className={`kopt t-${k.tone}`}
              onClick={() => setKind(k.kind)}
            >
              <span className="ic">
                <KindIcon kind={k.kind} size={20} />
              </span>
              <span className="name">{k.zh}</span>
              <span className="blurb">{k.blurb}</span>
            </button>
          ))}
        </div>
        <label className="field">
          <span>标题</span>
          <input ref={titleRef} className="input" placeholder={`如：新人上手${KIND[kind].zh}`} aria-label="标题" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span>文件夹</span>
          <span className="folder">
            <span className="pre">projects/</span>
            <input
              className="input"
              placeholder="onboarding"
              aria-label="新项目名称"
              value={name}
              onChange={(e) => {
                setTouched(true);
                setFolder(e.target.value.trim());
              }}
            />
          </span>
        </label>
        <div className={`problem${problem ? ' on' : ''}`} role="alert">
          {problem}
        </div>
        <footer>
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" type="submit" disabled={!name || !!problem || busy}>
            创建{KIND[kind].zh}
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
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
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
      .filter((p) => (tab === 'all' || p.kind === tab) && (!needle || p.title.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle) || KIND[p.kind].zh.includes(needle)))
      .sort((a, b) =>
        sort === 'name'
          ? (a.title || a.name).localeCompare(b.title || b.name)
          : rank(a) - rank(b) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.name.localeCompare(b.name),
      );
  }, [list, tab, q, sort, recent]);
  const taken = useMemo(() => new Set((list ?? []).map((p) => p.name)), [list]);
  const lastOpened = recent.find((n) => taken.has(n));

  return (
    <div
      className={`launcher${dropping ? ' dropping' : ''}`}
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
          .then((picked) => (picked.entry ? setImporting({ picked }) : toast('拖进来的文件里没有 .html 页面。', 'error')));
      }}
    >
      <header className="lhead">
        <div className="brand">
          <Mark />
          <div>
            <h1>Tingly Design</h1>
            <div className="sub">本地设计工作区 · {list ? `${list.length} 个项目` : '读取中…'}</div>
          </div>
        </div>
        <div className="tools">
          <label className="lsearch">
            <IconSearch size={15} stroke={1.7} aria-hidden="true" />
            <input
              ref={search}
              placeholder="搜索标题或文件夹"
              aria-label="搜索项目"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && shown[0]) open(shown[0].name);
                if (e.key === 'Escape') setQ('');
              }}
            />
            <kbd>/</kbd>
          </label>
          <select className="lsort" aria-label="排序" value={sort} onChange={(e) => setSort(e.target.value as 'recent' | 'name')}>
            <option value="recent">最近</option>
            <option value="name">名称</option>
          </select>
          <Appearance className="btn lbtn" />
          <button className="btn primary lnewbtn" onClick={() => setCreating(tab === 'all' ? 'design' : tab)}>
            <IconPlus size={15} stroke={2} aria-hidden="true" /> 新建项目
          </button>
        </div>
      </header>

      <nav className="ltabs" role="tablist" aria-label="按类型筛选">
        {(['all', ...KINDS.map((k) => k.kind)] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} data-tab={k} className={k === 'all' ? '' : `t-${KIND[k].tone}`} onClick={() => setTab(k)}>
            {k !== 'all' && <KindIcon kind={k} size={14} />}
            {k === 'all' ? '全部' : KIND[k].zh}
            <span className="n">{counts[k]}</span>
          </button>
        ))}
      </nav>

      <main className="lmain" onKeyDown={arrowNav}>
        {list === null && <div className="lhint">读取中…</div>}
        {tab === 'all' && !q.trim() && (
          <section className="lstart" aria-label="新建">
            <h2>新建</h2>
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
            <span>继续上次的：</span>
            <button className="linkish" onClick={() => open(lastOpened)}>
              {list.find((p) => p.name === lastOpened)?.title || lastOpened}
            </button>
          </div>
        )}
        {list !== null && (
          <section className="lall" aria-label="项目">
            <h2>{tab === 'all' ? '全部项目' : KIND[tab].zh}</h2>
            <div className="lgrid">
              {shown.map((p) => (
                <Card key={p.name} p={p} recent={p.name === lastOpened} />
              ))}
              {tab !== 'all' && <NewTile kind={tab} onClick={() => setCreating(tab)} />}
            </div>
            {!shown.length && <div className="lhint">{q.trim() ? `没有找到“${q.trim()}”。` : `还没有${tab === 'all' ? '项目，从上面选一种类型新建' : KIND[tab].zh}。`}</div>}
          </section>
        )}
      </main>
      {importing && <ImportDialog initial={importing.picked} taken={taken} onClose={() => setImporting(null)} onDone={open} />}
      {creating && <NewDialog initial={creating} taken={taken} onClose={() => setCreating(null)} />}
    </div>
  );
}
