import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DASH_PAGE, sandboxDoc, type FromDash, type QuerySource } from '@dc/core';
import { display, isSaving, openPane, useStore } from '../../store';
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
} from './dash';
import { FileMenu, imageExportItems } from '../FileMenu';
import { TopBar, ProjectTitle, BarButton } from '../TopBar';
import { PreviewAs } from '../PreviewAs';
import { Moon, Refresh, Sun, Target } from '../icons';
import { fileStem } from '../../imageExport';
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

/**
 * The page, in its own sandboxed frame. Two frames take turns: the one on
 * stage stays while the next page boots in a hidden twin (a fresh frame each
 * time, so the page's scripts start clean), and the swap waits until the twin
 * has mounted its page. A change Claude Code lands in several writes then
 * appears in steps, and the page never goes blank while it happens.
 */
function PageFrame() {
  const { t } = useTranslation();
  const pageKey = useDash((s) => s.pageKey);
  // counts boots per slot: a slot's frame mounts fresh for each boot, and the slots alternate
  const [gen, setGen] = useState<[number, number]>([0, 0]);
  const [active, setActive] = useState(0);
  // what the message router goes by: the slot on stage, and the slot a page is booting in (the first page boots where it stands)
  const stage = useRef<{ active: 0 | 1; pending: 0 | 1 | null; swap: number }>({ active: 0, pending: 0, swap: 0 });
  const frames = [useRef<HTMLIFrameElement>(null), useRef<HTMLIFrameElement>(null)];
  // the frame's own words (its error banner) follow <html lang>; a language change reloads the page
  const lang = htmlLang(currentLanguage());
  const srcdoc = useMemo(() => sandboxDoc(SERVER, 'dash', lang), [lang]);
  const datasets = useDatasets();
  const ids = useRef<string[]>([]);
  ids.current = datasets.map((d) => d.id);

  // the page that booted takes the stage; what the old page reported is not what is drawn now
  const adopt = (slot: 0 | 1) => {
    const st = stage.current;
    if (st.pending !== slot) return;
    st.pending = null;
    clearTimeout(st.swap);
    st.active = slot;
    setFrame(frames[slot].current?.contentWindow ?? null);
    useDash.setState({ report: null, derived: {} });
    setActive(slot);
  };

  const boot = (slot: 0 | 1) => {
    const st = stage.current;
    st.pending = slot;
    clearTimeout(st.swap);
    // a page that never finishes mounting (a script stopped early) still takes the stage after a wait
    st.swap = window.setTimeout(() => adopt(slot), 5000);
    setGen((g) => (slot === 0 ? [g[0] + 1, g[1]] : [g[0], g[1] + 1]));
  };

  // its files changed: the next page boots in the other slot; a boot still under way starts over with the newer files
  const lastKey = useRef(pageKey);
  useEffect(() => {
    if (lastKey.current === pageKey) return;
    lastKey.current = pageKey;
    const st = stage.current;
    boot(st.pending ?? (st.active === 0 ? 1 : 0));
  }, [pageKey]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const w = e.source as Window | null;
      const slot = w === frames[0].current?.contentWindow ? 0 : w === frames[1].current?.contentWindow ? 1 : -1;
      if (slot < 0 || !w) return;
      const st = stage.current;
      const m = e.data as FromDash;
      if (!m || typeof m !== 'object' || typeof m.dc !== 'string') return;
      const d = useDash.getState();
      if (m.dc === 'ready') {
        // the page still booting becomes the one we talk to (it is on its way to the stage):
        // it asks for its data while mounting, before it declares, and the answers come back to it here
        if (slot !== st.pending) return;
        setFrame(w);
        w.postMessage({ dc: 'dash-page', files: pageFiles(), datasets: ids.current, params: d.params, theme: d.theme, link: decodeURIComponent(location.hash.slice(1)), mode: d.mode }, '*');
        return;
      }
      if (m.dc === 'dash-declared') {
        // the page has mounted: now it takes the stage
        if (slot !== st.pending) return;
        adopt(slot);
        useDash.setState({ loaders: m.loaders });
        // a dataset loaded as plain rows before its page declared a loader: load it again
        const now = useDash.getState();
        for (const id of m.loaders) if (now.states[id] && !now.raw[id]) void load(id, true);
        return;
      }
      // the page still booting asks for its data while it mounts: hear it too (the replies go to it — the frame we talk to is already the booting one)
      if (m.dc === 'dash-want') {
        want(m.ids);
        return;
      }
      // everything else a page says counts only from the one on stage; the one still booting is not listened to
      if (slot !== st.active) return;
      switch (m.dc) {
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
          useDash.setState({ pick: m.pick, open: m.pick.sources[0] ?? null });
          openPane('sources');
          break;
        case 'dash-exported': {
          const x = imageWaits.get(m.id);
          imageWaits.delete(m.id);
          if (m.blob) x?.ok(m.blob);
          else x?.fail(new Error(m.error ?? 'failed'));
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

  useEffect(
    () => () => {
      clearTimeout(stage.current.swap);
      setFrame(null);
    },
    [],
  );

  return (
    <>
      {/* the keys name the slot too: both slots can be on the same boot number */}
      <iframe ref={frames[0]} key={`a${gen[0]}`} className={active === 0 ? 'dashframe' : 'dashframe-next'} title={t('dash.frameTitle')} sandbox="allow-scripts" srcDoc={srcdoc} />
      {gen[1] > 0 && <iframe ref={frames[1]} key={`b${gen[1]}`} className={active === 1 ? 'dashframe' : 'dashframe-next'} title={t('dash.frameTitle')} sandbox="allow-scripts" srcDoc={srcdoc} />}
    </>
  );
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
  return (
    <ProjectTitle value={index.title} label={t('dash.title.nameLabel')} hint={t('dash.title.renameHint')} onRename={(v) => editDash((d) => (d.title = v), 'dashboard renamed')} />
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
  const side = useStore((s) => s.pane);

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
      <TopBar title={<Title />}>
        <Filters />
        <BarButton icon={<Refresh />} label={t('dash.bar.refresh')} title={t('dash.bar.refreshAllTitle')} onClick={refreshAll} />
        <BarButton icon={<Target />} label={t('dash.bar.dataMode')} title={t('dash.bar.dataModeTitle')} on={mode === 'data'} onClick={() => setMode(mode === 'data' ? 'page' : 'data')} />
        <PreviewAs icon={theme === 'dark' ? <Moon /> : <Sun />} options={[{ id: 'light', label: t('dash.bar.light') }, { id: 'dark', label: t('dash.bar.dark') }]} value={theme} onChange={(v) => setTheme(v as 'light' | 'dark')} />
        <FileMenu
          claudeDesign
          target={dashImport}
          label={t('dash.kind')}
          items={imageExportItems({ hint: t('common.transfer.hint.dashPage'), name: `${fileStem(index.title, 'dashboard')}.png`, make: () => pageImage() })}
        />
      </TopBar>
      <main className="dashmain">
        {mode === 'data' && <div className="dashhint">{t('dash.bar.dataModeHint')}</div>}
        <PageFrame />
        <AskClaude
          file={DASH_PAGE}
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
      <JournalPopover />
    </div>
  );
}
