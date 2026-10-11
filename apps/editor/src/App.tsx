import { useEffect, useState } from 'react';
import { api } from './api';
import { fitAll, focusBoard, openProject, toast, useStore, canvasOf } from './store';
import { installShortcuts } from './shortcuts';
import { TopBar } from './components/TopBar';
import { Canvas } from './components/Canvas';
import { LeftPanel } from './components/LeftPanel';
import { Inspector } from './components/Inspector';
import { PromptBar } from './components/PromptBar';

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
        <div className="list" style={{ padding: 0 }}>
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

  useEffect(() => {
    api.health().then((health) => useStore.setState({ health }), () => toast('连不上服务端，确认 pnpm dev 在运行。', 'error'));
    if (!project) return;
    openProject(project)
      .then(() => {
        // wait a frame so the canvas has measured itself
        requestAnimationFrame(() => {
          const c = canvasOf(useStore.getState());
          if (c.launch.view === 'focused' && c.launch.file) focusBoard(c.launch.file);
          else fitAll();
        });
      })
      .catch((e) => toast(e.message, 'error'));
    return installShortcuts();
  }, [project]);

  if (!project) return <Picker />;
  return (
    <div className={`app ${mode}`}>
      <TopBar />
      <aside className="left" aria-label="画板与改动记录">
        <LeftPanel />
      </aside>
      <main className="main">
        <Canvas />
        {loaded && mode === 'edit' && <PromptBar />}
      </main>
      <aside className="right" aria-label="属性">
        <Inspector />
      </aside>
      <Toasts />
    </div>
  );
}
