import { useEffect, useState } from 'react';
import { api } from '../../api';
import { useInstalled } from '../../ds';
import { toast, useStore } from '../../store';

/**
 * Design systems in a canvas or deck: install one of this repository's
 * systems (its tokens are copied into ds/<folder>/, and recorded in the
 * index), or remove one. Once installed, colour fields and the text style
 * menu offer its tokens.
 */
export function DsInstall() {
  const project = useStore((s) => s.project);
  const installed = useInstalled();
  const [systems, setSystems] = useState<{ name: string; title: string }[]>([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.projects().then((l) => setSystems(l.filter((p) => p.kind === 'design-system')), () => setSystems([]));
  }, []);
  const install = async (from: string) => {
    if (!project || !from) return;
    setBusy(true);
    try {
      const r = await api.installDs(project, from);
      toast(`已装入设计系统${r.fonts.length ? `，带上 ${r.fonts.length} 个字体文件` : ''}。颜色和文字样式菜单里可以选它的 token 了。`);
      setPick('');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h3>设计系统</h3>
      {installed.map((x) => {
        const from = x.record.artifact.replace(/^projects\//, '');
        return (
          <div key={x.record.namespace} className="dsinst" data-ds={x.record.namespace}>
            <div className="dsi-t">
              <b>{x.record.title}</b>
              <span className="hint">
                {x.tokens.colors.length} 色 · {x.tokens.groups.reduce((n, g) => n + g.styles.length, 0)} 个文字样式
              </span>
            </div>
            <div className="dsi-sw">
              {x.tokens.colors.slice(0, 12).map((c) => (
                <span key={c.name} title={c.name} style={{ background: c.values[x.tokens.themes[0].id] }} />
              ))}
            </div>
            <div className="dsi-a">
              {systems.some((s) => s.name === from) && (
                <>
                  <a className="btn ghost" href={`?p=${encodeURIComponent(from)}`} target="_blank" rel="noreferrer">
                    打开
                  </a>
                  <button className="btn ghost" disabled={busy} onClick={() => install(from)} title="重新复制它当前的 tokens">
                    更新
                  </button>
                </>
              )}
              <button
                className="btn ghost danger"
                disabled={busy}
                onClick={async () => {
                  if (!project) return;
                  await api.uninstallDs(project, x.record.namespace).catch((e) => toast(e.message, 'error'));
                }}
              >
                移除
              </button>
            </div>
          </div>
        );
      })}
      {systems.length ? (
        <div className="faceadd">
          <select className="input" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="选择设计系统">
            <option value="">选择要装入的设计系统…</option>
            {systems.map((s) => (
              <option key={s.name} value={s.name}>
                {s.title}
              </option>
            ))}
          </select>
          <button className="btn outline" disabled={!pick || busy} onClick={() => install(pick)}>
            装入
          </button>
        </div>
      ) : (
        <p className="hint" style={{ margin: 0 }}>
          这个仓库里还没有设计系统。新建项目时选“设计系统”。
        </p>
      )}
    </>
  );
}
