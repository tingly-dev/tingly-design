import { useEffect, useMemo, useState } from 'react';
import { DS_README, compileTokensCss, sectionFiles } from '@dc/core';
import { delegateToClaude } from '../../fastedit';
import { display, edit, isSaving, useStore } from '../../store';
import { editDsIndex, useDsIndex, useTokens } from '../../ds';
import { ColorsView, FamiliesView, TypeView } from './TokenViews';
import { AssetsView, ComponentsView, Markdown, Preview } from './ComponentViews';
import { JournalPopover } from '../Overlays';
import { Send } from '../icons';

type View = 'overview' | 'colors' | 'type' | 'space' | 'components' | 'assets' | 'issues';

const VIEWS: [View, string][] = [
  ['overview', '概览'],
  ['colors', '颜色'],
  ['type', '文字'],
  ['space', '间距与圆角'],
  ['components', '组件'],
  ['assets', '资源'],
];

/** One brand-book section: rendered, or edited as markdown. */
function Section({ path }: { path: string }) {
  const text = useStore((s) => display(s, path)) ?? '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  useEffect(() => {
    if (!editing) setDraft(text);
  }, [text, editing]);
  return (
    <div className="dssection" data-section={path}>
      <div className="secbar">
        <span className="hint">{path}</span>
        {editing ? (
          <>
            <button className="btn ghost" onClick={() => setEditing(false)}>
              取消
            </button>
            <button
              className="btn primary"
              onClick={() => {
                if (draft !== text) edit(path, () => draft, { actor: 'human', summary: `${path} edited` });
                setEditing(false);
              }}
            >
              保存
            </button>
          </>
        ) : (
          <button className="btn ghost" onClick={() => setEditing(true)}>
            编辑
          </button>
        )}
      </div>
      {editing ? (
        <textarea className="code mdedit" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-label={`编辑 ${path}`} spellCheck={false} />
      ) : text.trim() ? (
        <Markdown text={text} />
      ) : (
        <p className="hint">在这里写品牌手册：内容原则、视觉基础、图标，配上真实的例子；用法规则要点名 token。</p>
      )}
    </div>
  );
}

function Overview({ theme }: { theme: string }) {
  const t = useTokens();
  const index = useDsIndex();
  const files = useStore((s) => s.files);
  const cover = useStore((s) => display(s, 'components/Cover/preview.html'));
  const sections = useMemo(() => {
    const list = sectionFiles(Object.keys(files));
    return list.includes(DS_README) ? list : [DS_README, ...list];
  }, [files]);
  return (
    <section className="dsview" aria-label="概览">
      {cover && (
        <div className="cover">
          <Preview comp="Cover" html={cover} t={t} index={index} theme={theme} minHeight={320} />
        </div>
      )}
      {sections.map((p) => (
        <Section key={p} path={p} />
      ))}
    </section>
  );
}

function Issues() {
  const t = useTokens();
  return (
    <section className="dsview" aria-label="问题">
      <header>
        <h2>tokens.json 里读不懂的部分</h2>
      </header>
      {t.issues.length ? (
        <ul className="issue-list">
          {t.issues.map((i, n) => (
            <li key={n} className="error">
              <code>{i.at}</code> {i.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">没有问题：每个 token 都能读。</p>
      )}
    </section>
  );
}

function AskClaude() {
  const [text, setText] = useState('');
  const fast = useStore((s) => s.fast);
  const delegates = useStore((s) => s.delegates);
  const health = useStore((s) => s.health);
  const active = [...delegates].reverse().find((d) => d.state === 'start' || d.state === 'progress');
  const send = () => {
    const t = text.trim();
    if (!t) return;
    void delegateToClaude(undefined, null, t);
    setText('');
  };
  return (
    <div className="dsask" role="region" aria-label="交给 Claude Code">
      <textarea
        rows={1}
        value={text}
        placeholder={health?.claudeCli === false ? '本机找不到 claude 命令，无法委托。' : '交给 Claude Code：从代码库补全 token 和组件、写品牌手册、做封面…'}
        aria-label="请求"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
      />
      <button className="btn primary" onClick={send} disabled={!text.trim() || health?.claudeCli === false}>
        <Send /> 发送
      </button>
      {(active || fast.note) && (
        <div className="ticker">
          {active ? (
            <>
              <div className="note-line claude">Claude Code 正在处理：{active.prompt}</div>
              {active.lines.slice(-4).map((l, i) => (
                <div key={i} className="claude-line">
                  {l}
                </div>
              ))}
            </>
          ) : (
            <div className="note-line">{fast.note}</div>
          )}
        </div>
      )}
    </div>
  );
}

export function DsApp() {
  const t = useTokens();
  const index = useDsIndex();
  const connected = useStore((s) => s.connected);
  const saving = useStore(isSaving);
  const journalOpen = useStore((s) => s.journalOpen);
  const [view, setView] = useState<View>(() => (new URLSearchParams(location.search).get('v') as View) || 'overview');
  const [theme, setTheme] = useState(t.themes[0].id);
  const [renaming, setRenaming] = useState(false);
  useEffect(() => {
    if (!t.themes.some((x) => x.id === theme)) setTheme(t.themes[0].id);
  }, [t, theme]);
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set('v', view);
    history.replaceState(null, '', url);
  }, [view]);
  useEffect(() => {
    document.title = `${index.title} · 设计系统`;
  }, [index.title]);
  // the system's own faces and tokens, for samples on this page
  const pageCss = useMemo(() => compileTokensCss({ ...t, colors: [], others: [], groups: [] }), [t]);
  return (
    <div className="app ds" data-theme={theme}>
      <style>{pageCss}</style>
      <nav className="dsnav" aria-label="设计系统">
        {renaming ? (
          <input
            className="dstitle"
            autoFocus
            defaultValue={index.title}
            aria-label="设计系统名称"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
            onBlur={(e) => {
              setRenaming(false);
              const v = e.currentTarget.value.trim();
              if (v && v !== index.title) editDsIndex((d) => (d.title = v), `title → ${v}`);
            }}
          />
        ) : (
          <h1 className="dstitle" title="双击改名" onDoubleClick={() => setRenaming(true)}>
            {index.title}
          </h1>
        )}
        <div className="hint ns">window.{index.namespace}</div>
        {VIEWS.map(([v, label]) => (
          <button key={v} className="navi" aria-current={view === v ? 'page' : undefined} onClick={() => setView(v)}>
            {label}
            <span className="cnt">
              {v === 'colors' ? t.colors.length : v === 'type' ? t.groups.reduce((n, g) => n + g.styles.length, 0) : v === 'space' ? t.others.reduce((n, f) => n + f.tokens.length, 0) : ''}
            </span>
          </button>
        ))}
        {t.issues.length > 0 && (
          <button className="navi warn" aria-current={view === 'issues' ? 'page' : undefined} onClick={() => setView('issues')}>
            问题 <span className="cnt">{t.issues.length}</span>
          </button>
        )}
        <div className="navfoot">
          {t.themes.length > 1 && (
            <label className="themes">
              主题
              <select value={theme} onChange={(e) => setTheme(e.target.value)} aria-label="主题">
                {t.themes.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className="tb" aria-pressed={journalOpen} aria-label="同步状态和改动记录" onClick={() => useStore.setState({ journalOpen: !journalOpen })}>
            <span className="sync">
              <span className={`dot ${!connected ? 'off' : saving ? 'busy' : ''}`} />
              {!connected ? '未连接' : saving ? '保存中' : '已同步'}
            </span>
          </button>
        </div>
      </nav>
      <main className="dsmain">
        {view === 'overview' && <Overview theme={theme} />}
        {view === 'colors' && <ColorsView t={t} theme={theme} />}
        {view === 'type' && <TypeView t={t} />}
        {view === 'space' && <FamiliesView t={t} theme={theme} />}
        {view === 'components' && <ComponentsView t={t} index={index} theme={theme} />}
        {view === 'assets' && <AssetsView index={index} />}
        {view === 'issues' && <Issues />}
        <AskClaude />
        <JournalPopover />
      </main>
    </div>
  );
}
