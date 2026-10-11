import { useEffect, useState } from 'react';
import { api } from './api';
import { canvasOf, fitAll, focusBoard, openProject, toast, useStore } from './store';
import { installShortcuts } from './shortcuts';
import { Canvas } from './components/Canvas';
import { LeftBar, RightBar } from './components/Bars';
import { RightPanel } from './components/panel/RightPanel';
import { PromptBar } from './components/PromptBar';
import { ContextMenu, FocusView, JournalPopover, NoteFormatBar } from './components/Overlays';

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

function Picker() {
  const [list, setList] = useState<{ name: string; title: string }[] | null>(null);
  const [name, setName] = useState('');
  useEffect(() => {
    api.projects().then(setList, (e) => toast(e.message, 'error'));
  }, []);
  const go = (p: string) => {
    location.search = '?p=' + encodeURIComponent(p);
  };
  return (
    <div className="picker">
      <div className="card">
        <h1>选择画布</h1>
        <div className="list">
          {list === null && <div className="hint">读取中…</div>}
          {list?.length === 0 && <div className="hint">还没有画布，在下面新建一个。</div>}
          {list?.map((p) => (
            <button key={p.name} className="row" onClick={() => go(p.name)}>
              <span className="name">{p.title}</span>
              <span className="meta">projects/{p.name}</span>
            </button>
          ))}
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n) return;
            try {
              await api.createProject(n, n);
              go(n);
            } catch (err) {
              toast((err as Error).message, 'error');
            }
          }}
        >
          <input className="input" placeholder="新画布的文件夹名，如 onboarding" aria-label="新画布名称" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn primary" type="submit">
            新建
          </button>
        </form>
      </div>
      <Toasts />
    </div>
  );
}

export function App() {
  const project = new URLSearchParams(location.search).get('p');
  const loaded = useStore((s) => s.loaded);
  const mode = useStore((s) => s.mode);
  const tool = useStore((s) => s.tool);
  const panelOpen = useStore((s) => s.panelOpen);

  useEffect(() => {
    api.health().then((health) => useStore.setState({ health }), () => toast('连不上服务端，确认 pnpm dev 在运行。', 'error'));
    if (!project) return;
    openProject(project)
      .then(() => {
        requestAnimationFrame(() => {
          const c = canvasOf(useStore.getState());
          if (c.pages.length) useStore.setState({ page: c.launch.page ?? c.pages[0].id });
          if (c.launch.view === 'focused' && c.launch.file) focusBoard(c.launch.file);
          else fitAll();
        });
      })
      .catch((e) => toast(e.message, 'error'));
    return installShortcuts();
  }, [project]);

  if (!project) return <Picker />;
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
