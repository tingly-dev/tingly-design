import { useEffect, useState, type ComponentType } from 'react';
import type { ProjectKind } from '@dc/core';
import { api } from './api';
import { canvasOf, openProject, toast, useStore } from './store';
import { fitAll, focusBoard } from './components/canvas/view';
import { installShortcuts } from './shortcuts';
import { Canvas } from './components/canvas/Canvas';
import { CanvasTopBar, LeftBar, RightBar } from './components/canvas/Bars';
import { RightPanel } from './components/panel/RightPanel';
import { PromptBar } from './components/PromptBar';
import { ContextMenu, FocusView, JournalPopover, NoteFormatBar } from './components/Overlays';
import { SlidesApp } from './components/slides/SlidesApp';
import { DsApp } from './components/ds/DsApp';
import { DashApp } from './components/dash/DashApp';
import { DocsApp } from './components/docs/DocsApp';
import { MotionApp } from './components/motion/MotionApp';
import { Launcher } from './components/launcher/Launcher';
import { ChatShell } from './components/ChatPanel';
import { serverDefault } from './theme';
import { ConfirmHost } from './components/ConfirmDialog';
import { ShortcutsHost } from './components/Shortcuts';
import { announceReady } from './host';
import { serverLanguage, t } from './i18n';

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <>
      <ConfirmHost />
      <ShortcutsHost />
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
            {t.action && (
              <button
                className="toast-act"
                onClick={() => {
                  t.action!.run();
                  useStore.setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) }));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/** The launcher, or a project in the shell that holds the conversation column. */
export function App() {
  return (
    <ChatShell>
      <Project />
    </ChatShell>
  );
}

function Project() {
  const project = new URLSearchParams(location.search).get('p');
  const loaded = useStore((s) => s.loaded);
  const kind = useStore((s) => s.kind);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    api.health().then(
      (health) => {
        useStore.setState({ health });
        serverDefault(health.theme);
        serverLanguage(health.lang);
        announceReady(health);
      },
      () => {
        toast(t('errors.serverUnreachable'), 'error');
        announceReady(null);
      },
    );
    if (!project) return;
    setFailed(null);
    openProject(project)
      .then(() => {
        requestAnimationFrame(() => {
          if (useStore.getState().kind !== 'design') return;
          const c = canvasOf(useStore.getState());
          if (c.pages.length) useStore.setState({ page: c.launch.page ?? c.pages[0].id });
          if (c.launch.view === 'focused' && c.launch.file) focusBoard(c.launch.file);
          else fitAll();
        });
      })
      // before the files arrive there is no editor to show a toast over: the page says it instead
      .catch((e) => (useStore.getState().loaded ? toast((e as Error).message, 'error') : setFailed((e as Error).message)));
    return installShortcuts();
  }, [project]);

  if (!project)
    return (
      <>
        <Launcher />
        <Toasts />
      </>
    );
  // until the files say what kind of project this is, draw no editor: the canvas one would flash
  // in front of every other kind, and anything clicked in it is gone once the real one mounts
  if (!loaded)
    return (
      <>
        <div className="project-loading" aria-busy={!failed}>
          {failed ? (
            <div role="alert">
              <p>{t('app.open.failed', { error: failed })}</p>
              <a className="btn outline" href="?">
                {t('app.open.home')}
              </a>
            </div>
          ) : (
            <div className="slow">
              <p>{t('app.open.loading', { name: project })}</p>
              <a className="btn ghost" href="?">
                {t('app.open.home')}
              </a>
            </div>
          )}
        </div>
        <Toasts />
      </>
    );
  const KindApp = KIND_APP[kind ?? 'design'];
  return <KindApp />;
}

/** The canvas editor: boards on a stage with the bars, the panel and the prompt. */
function CanvasApp() {
  const mode = useStore((s) => s.mode);
  const tool = useStore((s) => s.tool);
  const panelOpen = useStore((s) => s.pane === 'inspector');
  return (
    <>
      <CanvasTopBar />
      <div className={`app ${mode}`} data-tool={tool} data-mode={mode}>
        <main className="stage">
          <Canvas />
          <LeftBar />
          <RightBar />
          {mode === 'edit' && <PromptBar />}
          <JournalPopover />
        </main>
        {panelOpen && mode === 'edit' && <RightPanel />}
        <ContextMenu />
        {mode === 'edit' && <NoteFormatBar />}
        <FocusView />
        <Toasts />
      </div>
    </>
  );
}

/** Another kind's editor, with the toasts every kind shows. */
const withToasts = (App: ComponentType) =>
  function KindShell() {
    return (
      <>
        <App />
        <Toasts />
      </>
    );
  };

/** The editor each kind opens in: one entry per kind, so a kind added later fails to compile until it has one. */
const KIND_APP: Record<ProjectKind, ComponentType> = {
  design: CanvasApp,
  slides: withToasts(SlidesApp),
  'design-system': withToasts(DsApp),
  dashboard: withToasts(DashApp),
  docs: withToasts(DocsApp),
  motion: withToasts(MotionApp),
};
