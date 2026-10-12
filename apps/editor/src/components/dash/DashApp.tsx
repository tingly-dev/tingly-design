import { useEffect, useMemo, useRef, useState } from 'react';
import { DASH_PAGE, sandboxDoc, type FromDash, type QuerySource } from '@dc/core';
import { display, isSaving, useStore } from '../../store';
import {
  changedParams,
  datasetsChanged,
  load,
  pageFiles,
  postFrame,
  refreshAll,
  reloadPage,
  resetDash,
  runQuery,
  scheduleRuns,
  setFrame,
  setMode,
  setParams,
  setTheme,
  editDash,
  useDash,
  useDashIndex,
  useDatasets,
  want,
} from '../../dash';
import { AskClaude } from '../ds/DsApp';
import { JournalPopover } from '../Overlays';
import { SourcesPanel } from './Sources';
import { CodePanel } from './CodePanel';

/** The page, in its own sandboxed frame; loaded afresh whenever its files change. */
function PageFrame() {
  const ref = useRef<HTMLIFrameElement>(null);
  const pageKey = useDash((s) => s.pageKey);
  const srcdoc = useMemo(() => sandboxDoc(location.origin, 'dash'), []);
  const datasets = useDatasets();
  const ids = useRef<string[]>([]);
  ids.current = datasets.map((d) => d.id);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const w = ref.current?.contentWindow;
      if (!w || e.source !== w) return;
      const m = e.data as FromDash;
      if (!m || typeof m !== 'object' || typeof m.dc !== 'string') return;
      const d = useDash.getState();
      switch (m.dc) {
        case 'ready':
          setFrame(w);
          postFrame({
            dc: 'dash-page',
            files: pageFiles(),
            datasets: ids.current,
            params: d.params,
            theme: d.theme,
            link: decodeURIComponent(location.hash.slice(1)),
            mode: d.mode,
          });
          break;
        case 'dash-declared': {
          useDash.setState({ loaders: m.loaders });
          // a dataset loaded as plain rows before its page declared a loader: load it again
          for (const id of m.loaders) if (d.states[id] && !d.raw[id]) void load(id, true);
          break;
        }
        case 'dash-want':
          want(m.ids);
          break;
        case 'dash-set-params':
          setParams(m.params);
          break;
        case 'dash-refresh':
          if (m.id) void load(m.id, true);
          else refreshAll();
          break;
        case 'dash-link': {
          const url = new URL(location.href);
          url.hash = m.name ? encodeURIComponent(m.name) : '';
          history.replaceState(null, '', url);
          break;
        }
        case 'dash-report':
          useDash.setState({ report: m.report, derived: m.derived });
          scheduleRuns();
          break;
        case 'dash-call': {
          const src = datasets.find((x) => x.id === m.id)?.dataset?.source as QuerySource | undefined;
          if (!src || src.kind !== 'query') return postFrame({ dc: 'dash-call-result', call: m.call, error: `${m.id} is not a query` });
          void runQuery({ ...src, tool: m.tool, args: m.args }, d.params).then((r) =>
            postFrame(r.ok ? { dc: 'dash-call-result', call: m.call, answer: r.answer } : { dc: 'dash-call-result', call: m.call, error: r.message }),
          );
          break;
        }
        case 'dash-pick':
          useDash.setState({ pick: m.pick, open: m.pick.sources[0] ?? null, side: 'sources' });
          break;
        case 'key':
          if (m.key === 'Escape' && d.mode === 'data') setMode('page');
          break;
      }
    };
    addEventListener('message', onMsg);
    return () => removeEventListener('message', onMsg);
  }, [datasets]);

  useEffect(() => () => setFrame(null), []);

  return <iframe key={pageKey} ref={ref} className="dashframe" title="看板页面" sandbox="allow-scripts" srcDoc={srcdoc} />;
}

/** Reload the page when its files change; reload datasets whose source changed. */
function Watch() {
  const pageKey = useStore((s) =>
    Object.keys(s.files)
      .filter((p) => p.startsWith('files/'))
      .sort()
      .map((p) => p + '\n' + (display(s, p) ?? ''))
      .join('\0'),
  );
  const datasets = useDatasets();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(reloadPage, 250);
    return () => clearTimeout(t);
  }, [pageKey]);
  const ids = datasets.map((d) => d.id).join(',');
  const lastIds = useRef(ids);
  useEffect(() => {
    datasetsChanged(datasets);
    // the page is told which ids are datasets when it loads: a new or removed one needs a reload
    if (lastIds.current !== ids) {
      lastIds.current = ids;
      reloadPage();
    }
  }, [datasets, ids]);
  return null;
}

function Title() {
  const index = useDashIndex();
  const [renaming, setRenaming] = useState(false);
  if (renaming)
    return (
      <input
        className="dashtitle"
        autoFocus
        defaultValue={index.title}
        aria-label="看板名称"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setRenaming(false);
        }}
        onBlur={(e) => {
          setRenaming(false);
          const v = e.currentTarget.value.trim();
          if (v && v !== index.title) editDash((d) => (d.title = v), 'dashboard renamed');
        }}
      />
    );
  return (
    <h1 className="dashtitle" title="双击改名" onDoubleClick={() => setRenaming(true)}>
      {index.title}
    </h1>
  );
}

function Filters() {
  const params = useDash((s) => s.params);
  const index = useDashIndex();
  const set = changedParams(params, index.params);
  if (!set.length) return null;
  const show = (v: unknown) => (Array.isArray(v) ? v.join('、') : v === null || v === undefined ? '（空）' : String(v));
  return (
    <div className="dashfilters" aria-label="筛选">
      {set.map((k) => (
        <span key={k} className="chip" title={`${k} = ${JSON.stringify(params[k] ?? null)}`}>
          {k}：{show(params[k])}
        </span>
      ))}
      <button className="btn ghost" onClick={() => setParams(null)}>
        重置筛选
      </button>
    </div>
  );
}

export function DashApp() {
  const index = useDashIndex();
  const project = useStore((s) => s.project);
  const connected = useStore((s) => s.connected);
  const saving = useStore(isSaving);
  const journalOpen = useStore((s) => s.journalOpen);
  const mode = useDash((s) => s.mode);
  const theme = useDash((s) => s.theme);
  const side = useDash((s) => s.side);
  const report = useDash((s) => s.report);
  const states = useDash((s) => s.states);
  const problems = (report?.flagged ?? 0) + (report?.errors.length ?? 0) + Object.values(states).filter((s) => s.status === 'error' || s.status === 'connect').length;

  useEffect(() => {
    resetDash();
  }, [project]);
  useEffect(() => {
    document.title = `${index.title} · 看板`;
  }, [index.title]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === 'Escape' && useDash.getState().mode === 'data') setMode('page');
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`app dash${side ? ' with-side' : ''}`} data-mode={mode}>
      <header className="dashbar">
        <a className="btn ghost back" href="/" title="所有项目">
          ←
        </a>
        <Title />
        <span className={`dot ${connected ? 'on' : 'off'}`} title={connected ? (saving ? '保存中…' : '已连接') : '连不上服务端'} />
        <Filters />
        <div className="grow" />
        <button className="btn ghost" onClick={refreshAll} title="重新读取所有数据">
          刷新
        </button>
        <button className={`btn ghost${mode === 'data' ? ' on' : ''}`} aria-pressed={mode === 'data'} onClick={() => setMode(mode === 'data' ? 'page' : 'data')} title="点一个数字或图表，看它的来源">
          数据模式
        </button>
        <button className="btn ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="切换明暗">
          {theme === 'dark' ? '亮色' : '暗色'}
        </button>
        <button className={`btn ghost${side === 'sources' ? ' on' : ''}`} aria-pressed={side === 'sources'} onClick={() => useDash.setState({ side: side === 'sources' ? null : 'sources' })}>
          数据来源{problems ? <span className="badge">{problems}</span> : null}
        </button>
        <button className={`btn ghost${side === 'code' ? ' on' : ''}`} aria-pressed={side === 'code'} onClick={() => useDash.setState({ side: side === 'code' ? null : 'code' })}>
          代码
        </button>
        <button className="btn ghost" onClick={() => useStore.setState((s) => ({ journalOpen: !s.journalOpen }))}>
          记录
        </button>
      </header>
      <main className="dashmain">
        {mode === 'data' && <div className="dashhint">数据模式：点一个数字、图表或表格，看它的来源。Esc 退出。</div>}
        <PageFrame />
        <AskClaude
          file={DASH_PAGE}
          placeholder="交给 Claude Code：连上数据、加一张图、加一个筛选、修好没对上的数字…"
          context={() => {
            const { pick, open } = useDash.getState();
            const lines: string[] = [];
            if (pick) lines.push(`看板上点的是：来源 ${pick.sources.join(' ')}${pick.field ? `，列 ${pick.field}` : ''}${pick.where ? `，行 ${pick.where}` : pick.row !== undefined ? `，第 ${pick.row} 行` : ''}${pick.at ? `（在 #${pick.at} 里）` : ''}。`);
            else if (open) lines.push(`数据来源里打开的是 ${open}。`);
            return lines.join('\n');
          }}
        />
      </main>
      {side === 'sources' && <SourcesPanel />}
      {side === 'code' && <CodePanel />}
      <Watch />
      {journalOpen && <JournalPopover />}
    </div>
  );
}
