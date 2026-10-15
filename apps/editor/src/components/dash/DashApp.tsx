import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  dashImport,
} from '../../dash';
import { ImportHere } from '../ImportHere';
import { ProjectMenu } from '../ProjectMenu';
import { fileStem, saveImage } from '../../imageExport';
import { AskClaude } from '../AskClaude';
import { JournalPopover } from '../Overlays';
import { SourcesPanel } from './Sources';
import { CodePanel } from './CodePanel';
import { replaceUrl } from '../../host';
import { SERVER } from '../../base';
import { currentLanguage, htmlLang } from '../../i18n';

const imageWaits = new Map<string, { ok: (b: Blob) => void; fail: (e: Error) => void }>();

/** The page as drawn now, as a PNG, made inside its frame. */
function pageImage(scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    const timer = setTimeout(() => (imageWaits.delete(id), reject(new Error('timeout'))), 20000);
    imageWaits.set(id, { ok: (b) => (clearTimeout(timer), resolve(b)), fail: (e) => (clearTimeout(timer), reject(e)) });
    postFrame({ dc: 'dash-export', id, scale });
  });
}

/** The page, in its own sandboxed frame; loaded afresh whenever its files change. */
function PageFrame() {
  const { t } = useTranslation();
  const ref = useRef<HTMLIFrameElement>(null);
  const pageKey = useDash((s) => s.pageKey);
  // the frame's own words (its error banner) follow <html lang>; a language change reloads the page
  const lang = htmlLang(currentLanguage());
  const srcdoc = useMemo(() => sandboxDoc(SERVER, 'dash', lang), [lang]);
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
          replaceUrl(url);
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
        case 'dash-exported': {
          const w = imageWaits.get(m.id);
          imageWaits.delete(m.id);
          if (m.blob) w?.ok(m.blob);
          else w?.fail(new Error(m.error ?? 'failed'));
          break;
        }
        case 'key':
          if (m.key === 'Escape' && d.mode === 'data') setMode('page');
          break;
      }
    };
    addEventListener('message', onMsg);
    return () => removeEventListener('message', onMsg);
  }, [datasets]);

  useEffect(() => () => setFrame(null), []);

  return <iframe key={pageKey} ref={ref} className="dashframe" title={t('dash.frameTitle')} sandbox="allow-scripts" srcDoc={srcdoc} />;
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
  const { t } = useTranslation();
  const index = useDashIndex();
  const [renaming, setRenaming] = useState(false);
  if (renaming)
    return (
      <input
        className="dashtitle"
        autoFocus
        defaultValue={index.title}
        aria-label={t('dash.title.nameLabel')}
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
    <h1 className="dashtitle" title={t('dash.title.renameHint')} onDoubleClick={() => setRenaming(true)}>
      {index.title}
    </h1>
  );
}

function Filters() {
  const { t } = useTranslation();
  const params = useDash((s) => s.params);
  const index = useDashIndex();
  const set = changedParams(params, index.params);
  if (!set.length) return null;
  const show = (v: unknown) => (Array.isArray(v) ? v.join(t('dash.listSep')) : v === null || v === undefined ? t('dash.filters.empty') : String(v));
  return (
    <div className="dashfilters" aria-label={t('dash.filters.label')}>
      {set.map((k) => (
        <span key={k} className="chip" title={`${k} = ${JSON.stringify(params[k] ?? null)}`}>
          {t('dash.filters.chip', { name: k, value: show(params[k]) })}
        </span>
      ))}
      <button className="btn ghost" onClick={() => setParams(null)}>
        {t('dash.filters.reset')}
      </button>
    </div>
  );
}

export function DashApp() {
  const { t } = useTranslation();
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
    document.title = t('dash.bar.docTitle', { title: index.title });
  }, [index.title, t]);
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
        <ProjectMenu />
        <Title />
        <span className={`dot ${connected ? 'on' : 'off'}`} title={connected ? (saving ? t('dash.bar.saving') : t('dash.bar.connected')) : t('dash.bar.offline')} />
        <Filters />
        <div className="grow" />
        <ImportHere target={dashImport} label={t('dash.kind')} button="text" />
        <button className="btn ghost" onClick={() => void saveImage(`${fileStem(index.title, 'dashboard')}.png`, () => pageImage())} title={t('common.image.saveHint')}>
          {t('common.image.save')}
        </button>
        <button className="btn ghost" onClick={refreshAll} title={t('dash.bar.refreshAllTitle')}>
          {t('dash.bar.refresh')}
        </button>
        <button className={`btn ghost${mode === 'data' ? ' on' : ''}`} aria-pressed={mode === 'data'} onClick={() => setMode(mode === 'data' ? 'page' : 'data')} title={t('dash.bar.dataModeTitle')}>
          {t('dash.bar.dataMode')}
        </button>
        <button className="btn ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={t('dash.bar.toggleTheme')}>
          {theme === 'dark' ? t('dash.bar.light') : t('dash.bar.dark')}
        </button>
        <button className={`btn ghost${side === 'sources' ? ' on' : ''}`} aria-pressed={side === 'sources'} onClick={() => useDash.setState({ side: side === 'sources' ? null : 'sources' })}>
          {t('dash.sources.label')}
          {problems ? <span className="badge">{problems}</span> : null}
        </button>
        <button className={`btn ghost${side === 'code' ? ' on' : ''}`} aria-pressed={side === 'code'} onClick={() => useDash.setState({ side: side === 'code' ? null : 'code' })}>
          {t('dash.bar.code')}
        </button>
        <button className="btn ghost" onClick={() => useStore.setState((s) => ({ journalOpen: !s.journalOpen }))}>
          {t('dash.bar.journal')}
        </button>
      </header>
      <main className="dashmain">
        {mode === 'data' && <div className="dashhint">{t('dash.bar.dataModeHint')}</div>}
        <PageFrame />
        <AskClaude
          file={DASH_PAGE}
          onOpen={(f) => {
            const id = /^datasets\/(.+)\.json$/.exec(f)?.[1];
            if (id) useDash.setState({ open: id, side: 'sources' });
            else if (f === DASH_PAGE) useDash.setState({ side: 'code' });
          }}
          placeholder={t('dash.ask.placeholder')}
          context={() => {
            const { pick, open } = useDash.getState();
            const lines: string[] = [];
            if (pick) {
              const detail =
                (pick.field ? t('dash.ask.field', { field: pick.field }) : '') +
                (pick.where ? t('dash.ask.where', { where: pick.where }) : pick.row !== undefined ? t('dash.ask.row', { row: pick.row }) : '') +
                (pick.at ? t('dash.ask.at', { at: pick.at }) : '');
              lines.push(t('dash.ask.picked', { sources: pick.sources.join(' '), detail }));
            } else if (open) lines.push(t('dash.ask.open', { id: open }));
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
