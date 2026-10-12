import { useEffect } from 'react';
import { api } from './api';
import { canvasOf, fitAll, focusBoard, openProject, toast, useStore } from './store';
import { installShortcuts } from './shortcuts';
import { Canvas } from './components/Canvas';
import { LeftBar, RightBar } from './components/Bars';
import { RightPanel } from './components/panel/RightPanel';
import { PromptBar } from './components/PromptBar';
import { ContextMenu, FocusView, JournalPopover, NoteFormatBar } from './components/Overlays';
import { SlidesApp } from './components/slides/SlidesApp';
import { DsApp } from './components/ds/DsApp';
import { DashApp } from './components/dash/DashApp';
import { DocsApp } from './components/docs/DocsApp';
import { Launcher } from './components/Launcher';

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function App() {
  const project = new URLSearchParams(location.search).get('p');
  const loaded = useStore((s) => s.loaded);
  const mode = useStore((s) => s.mode);
  const tool = useStore((s) => s.tool);
  const panelOpen = useStore((s) => s.panelOpen);
  const kind = useStore((s) => s.kind);

  useEffect(() => {
    api.health().then((health) => useStore.setState({ health }), () => toast('连不上服务端，确认 pnpm dev 在运行。', 'error'));
    if (!project) return;
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
      .catch((e) => toast(e.message, 'error'));
    return installShortcuts();
  }, [project]);

  if (!project)
    return (
      <>
        <Launcher />
        <Toasts />
      </>
    );
  if (kind === 'docs')
    return (
      <>
        <DocsApp />
        <Toasts />
      </>
    );
  if (kind === 'dashboard')
    return (
      <>
        <DashApp />
        <Toasts />
      </>
    );
  if (kind === 'design-system')
    return (
      <>
        <DsApp />
        <Toasts />
      </>
    );
  if (kind === 'slides')
    return (
      <>
        <SlidesApp />
        <Toasts />
      </>
    );
  return (
    <div className={`app ${mode}`} data-tool={tool} data-mode={mode}>
      <main className="stage">
        <Canvas />
        <LeftBar />
        <RightBar />
        {loaded && mode === 'edit' && <PromptBar />}
        <JournalPopover />
      </main>
      {panelOpen && mode === 'edit' && <RightPanel />}
      <ContextMenu />
      {mode === 'edit' && <NoteFormatBar />}
      <FocusView />
      <Toasts />
    </div>
  );
}
