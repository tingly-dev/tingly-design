import { useEffect, useMemo, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { outlineOf, tabFile, tabOrder, wordCount, type DocJson } from '@dc/core';
import { api } from '../../api';
import { display, isSaving, useStore } from '../../store';
import { addTab, deleteTab, editDoc, moveTab, openTab, renameTab, useComments, useCurrentTab, useDocIndex, useDocs } from '../../docs';
import { AskClaude } from '../ds/DsApp';
import { JournalPopover } from '../Overlays';
import { DocEditor, docEditor, pickImage } from './DocEditor';
import { CommentsRail } from './Comments';

function TabRow({ id, title, sub, current }: { id: string; title: string; sub: boolean; current: boolean }) {
  const [renaming, setRenaming] = useState(false);
  const [menu, setMenu] = useState(false);
  return (
    <li className={`tabrow${sub ? ' sub' : ''}${current ? ' on' : ''}`}>
      {renaming ? (
        <input
          autoFocus
          defaultValue={title}
          aria-label="标签页名称"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setRenaming(false);
          }}
          onBlur={(e) => {
            setRenaming(false);
            const v = e.currentTarget.value.trim();
            if (v && v !== title) renameTab(id, v);
          }}
        />
      ) : (
        <button className="tabname" aria-current={current ? 'page' : undefined} onClick={() => openTab(id)} onDoubleClick={() => setRenaming(true)}>
          {title}
        </button>
      )}
      <button className="ib more" aria-label={`${title} 的操作`} onClick={() => setMenu(!menu)}>
        ⋯
      </button>
      {menu && (
        <div className="tabmenu" onMouseLeave={() => setMenu(false)}>
          <button onClick={() => (setMenu(false), setRenaming(true))}>改名</button>
          {!sub && <button onClick={() => (setMenu(false), addTab('新的子页', id))}>添加子页</button>}
          <button onClick={() => (setMenu(false), moveTab(id, -1))}>上移</button>
          <button onClick={() => (setMenu(false), moveTab(id, 1))}>下移</button>
          <button
            className="danger"
            onClick={() => {
              setMenu(false);
              if (confirm(`删除标签页“${title}”${sub ? '' : '和它的子页'}？`)) void deleteTab(id);
            }}
          >
            删除
          </button>
        </div>
      )}
    </li>
  );
}

function Outline({ tab }: { tab: string }) {
  const source = useStore((s) => display(s, tabFile(tab))) ?? '';
  const heads = useMemo(() => outlineOf(source), [source]);
  if (heads.length < 2) return null;
  const go = (i: number) => {
    const e = docEditor.current;
    if (!e) return;
    const top = e.view.dom.children[heads[i].block] as HTMLElement | undefined;
    top?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  return (
    <nav className="outline" aria-label="大纲">
      <h3>大纲</h3>
      {heads.map((h, i) => (
        <button key={i} style={{ paddingLeft: 8 + (h.level - 1) * 12 }} onClick={() => go(i)}>
          {h.text || '（无标题）'}
        </button>
      ))}
    </nav>
  );
}

function Toolbar() {
  const [, force] = useState(0);
  useEffect(() => {
    const e = docEditor.current;
    if (!e) return;
    const f = () => force((n) => n + 1);
    e.on('transaction', f);
    return () => {
      e.off('transaction', f);
    };
  });
  const e = docEditor.current;
  if (!e) return <div className="doctools" />;
  const block = e.isActive('heading', { level: 1 }) ? 'h1' : e.isActive('heading', { level: 2 }) ? 'h2' : e.isActive('heading', { level: 3 }) ? 'h3' : e.isActive('codeBlock') ? 'code' : 'p';
  const b = (label: string, active: boolean, run: () => void, aria = label) => (
    <button className={active ? 'on' : ''} aria-pressed={active} aria-label={aria} onMouseDown={(ev) => ev.preventDefault()} onClick={run}>
      {label}
    </button>
  );
  return (
    <div className="doctools" role="toolbar" aria-label="格式">
      {b('↶', false, () => e.chain().focus().undo().run(), '撤销')}
      {b('↷', false, () => e.chain().focus().redo().run(), '重做')}
      <span className="sep" />
      <select
        aria-label="段落样式"
        value={block}
        onChange={(ev) => {
          const v = ev.target.value;
          const c = e.chain().focus();
          if (v === 'p') c.setParagraph().run();
          else if (v === 'code') c.setCodeBlock().run();
          else c.setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
        }}
      >
        <option value="p">正文</option>
        <option value="h1">标题 1</option>
        <option value="h2">标题 2</option>
        <option value="h3">标题 3</option>
        <option value="code">代码块</option>
      </select>
      <span className="sep" />
      {b('B', e.isActive('bold'), () => e.chain().focus().toggleBold().run(), '粗体')}
      {b('I', e.isActive('italic'), () => e.chain().focus().toggleItalic().run(), '斜体')}
      {b('S', e.isActive('strike'), () => e.chain().focus().toggleStrike().run(), '删除线')}
      <span className="sep" />
      {b('•', e.isActive('bulletList'), () => e.chain().focus().toggleBulletList().run(), '项目列表')}
      {b('1.', e.isActive('orderedList'), () => e.chain().focus().toggleOrderedList().run(), '编号列表')}
      {b('☑', e.isActive('taskList'), () => e.chain().focus().toggleTaskList().run(), '待办清单')}
      {b('❝', e.isActive('blockquote'), () => e.chain().focus().toggleBlockquote().run(), '引用')}
      <span className="sep" />
      {b('表格', false, () => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
      {e.isActive('table') && (
        <>
          {b('+行', false, () => e.chain().focus().addRowAfter().run(), '在下方加一行')}
          {b('+列', false, () => e.chain().focus().addColumnAfter().run(), '在右侧加一列')}
          {b('−行', false, () => e.chain().focus().deleteRow().run(), '删除这一行')}
          {b('−列', false, () => e.chain().focus().deleteColumn().run(), '删除这一列')}
        </>
      )}
      {b('图片', false, () => pickImage(e))}
      {b('—', false, () => e.chain().focus().setHorizontalRule().run(), '分割线')}
    </div>
  );
}

function download(name: string, text: string, type: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** The doc as one page of HTML: every tab in order, images from the project. */
function docHtml(d: DocJson, only?: string): string {
  const s = useStore.getState();
  const project = s.project!;
  const parts = tabOrder(d)
    .filter((t) => !only || t.id === only)
    .map((t) => {
      const md = (display(s, tabFile(t.id)) ?? '').replace(/\]\((\.\.\/)?(assets\/[^)\s]+)\)/g, (_m, _p, path) => `](${api.rawBase(project)}${path})`);
      return `<section class="tab">${DOMPurify.sanitize(marked.parse(md, { gfm: true, async: false }) as string)}</section>`;
    });
  const serif = '"Source Serif 4", Georgia, "Songti SC", "Noto Serif SC", serif';
  const sans = 'system-ui, -apple-system, "PingFang SC", "Noto Sans SC", sans-serif';
  return `<!doctype html><html lang="${d.settings.lang}"><head><meta charset="utf-8"><title>${d.title.replace(/[<&]/g, '')}</title><style>
body{max-width:${d.settings.width === 'wide' ? 1000 : 720}px;margin:40px auto;padding:0 24px;font:16px/1.75 ${d.settings.bodyFont === 'serif' ? serif : sans};color:#1d1d1b}
h1,h2,h3,h4{font-family:${d.settings.headingFont === 'serif' ? serif : sans};line-height:1.3}
table{border-collapse:collapse}td,th{border:1px solid #d6d4ce;padding:6px 10px}pre{background:#f5f5f3;padding:12px;border-radius:8px;overflow:auto}
code{font-family:ui-monospace,Menlo,monospace;font-size:.9em}blockquote{margin:0;padding-left:16px;border-left:3px solid #d6d4ce;color:#555}
img{max-width:100%}.tab+.tab{border-top:1px solid #e4e3df;margin-top:48px;padding-top:24px}@media print{.tab+.tab{break-before:page;border:0}}
</style></head><body>${parts.join('\n')}</body></html>`;
}

function ExportMenu({ onClose }: { onClose: () => void }) {
  const d = useDocIndex();
  const tab = useCurrentTab();
  const s = useStore.getState();
  const name = d.title.replace(/[\\/:*?"<>|]+/g, '-');
  return (
    <div className="popmenu" onMouseLeave={onClose}>
      <button onClick={() => (onClose(), download(`${name}.md`, display(s, tabFile(tab!)) ?? '', 'text/markdown'))}>这个标签页（Markdown）</button>
      <button
        onClick={() => {
          onClose();
          const all = tabOrder(d)
            .map((t) => display(s, tabFile(t.id)) ?? '')
            .join('\n\n---\n\n');
          download(`${name}.md`, all, 'text/markdown');
        }}
      >
        整个文档（Markdown）
      </button>
      <button onClick={() => (onClose(), download(`${name}.html`, docHtml(d), 'text/html'))}>整个文档（HTML）</button>
      <button
        onClick={() => {
          onClose();
          const w = window.open('', '_blank');
          if (!w) return;
          w.document.write(docHtml(d));
          w.document.close();
          w.onload = () => w.print();
          setTimeout(() => w.print(), 600);
        }}
      >
        打印 / 存为 PDF
      </button>
    </div>
  );
}

function Settings({ onClose }: { onClose: () => void }) {
  const d = useDocIndex();
  const set = (k: 'headingFont' | 'bodyFont' | 'width', v: string) => editDoc((x) => ((x.settings as unknown as Record<string, string>)[k] = v), `settings ${k} = ${v}`);
  const seg = (k: 'headingFont' | 'bodyFont' | 'width', opts: [string, string][]) => (
    <div className="seg">
      {opts.map(([v, label]) => (
        <button key={v} aria-pressed={d.settings[k] === v} onClick={() => set(k, v)}>
          {label}
        </button>
      ))}
    </div>
  );
  return (
    <div className="popmenu settings" onMouseLeave={onClose}>
      <label>标题字体</label>
      {seg('headingFont', [
        ['sans', '无衬线'],
        ['serif', '衬线'],
      ])}
      <label>正文字体</label>
      {seg('bodyFont', [
        ['sans', '无衬线'],
        ['serif', '衬线'],
      ])}
      <label>版面宽度</label>
      {seg('width', [
        ['default', '标准'],
        ['wide', '宽'],
      ])}
    </div>
  );
}

function Title() {
  const d = useDocIndex();
  const [renaming, setRenaming] = useState(false);
  if (renaming)
    return (
      <input
        className="dashtitle"
        autoFocus
        defaultValue={d.title}
        aria-label="文档标题"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setRenaming(false);
        }}
        onBlur={(e) => {
          setRenaming(false);
          const v = e.currentTarget.value.trim();
          if (v && v !== d.title) editDoc((x) => (x.title = v), 'doc renamed');
        }}
      />
    );
  return (
    <h1 className="dashtitle" title="双击改名" onDoubleClick={() => setRenaming(true)}>
      {d.title}
    </h1>
  );
}

export function DocsApp() {
  const d = useDocIndex();
  const tab = useCurrentTab();
  const connected = useStore((s) => s.connected);
  const saving = useStore(isSaving);
  const journalOpen = useStore((s) => s.journalOpen);
  const rail = useDocs((s) => s.rail);
  const comments = useComments();
  const [pop, setPop] = useState<'export' | 'settings' | null>(null);
  const source = useStore((s) => (tab ? display(s, tabFile(tab)) : '')) ?? '';
  const words = useMemo(() => wordCount(source), [source]);
  const open = comments.threads.filter((t) => t.tab === tab && !t.resolved).length;

  useEffect(() => {
    const t = new URLSearchParams(location.search).get('t');
    if (t) useDocs.setState({ tab: t });
  }, []);
  useEffect(() => {
    document.title = d.title;
  }, [d.title]);

  const order = tabOrder(d);
  return (
    <div className={`app docs${rail ? ' with-rail' : ''}`} data-width={d.settings.width} data-hfont={d.settings.headingFont} data-bfont={d.settings.bodyFont}>
      <header className="dashbar">
        <a className="btn ghost back" href="/" title="所有项目">
          ←
        </a>
        <Title />
        <span className={`dot ${connected ? 'on' : 'off'}`} title={connected ? (saving ? '保存中…' : '已保存') : '连不上服务端'} />
        <span className="hint">{saving ? '保存中…' : '已保存'}</span>
        <div className="grow" />
        <span className="hint">{words} 字</span>
        <div className="popwrap">
          <button className={`btn ghost${pop === 'settings' ? ' on' : ''}`} onClick={() => setPop(pop === 'settings' ? null : 'settings')}>
            版式
          </button>
          {pop === 'settings' && <Settings onClose={() => setPop(null)} />}
        </div>
        <div className="popwrap">
          <button className={`btn ghost${pop === 'export' ? ' on' : ''}`} onClick={() => setPop(pop === 'export' ? null : 'export')}>
            导出
          </button>
          {pop === 'export' && tab && <ExportMenu onClose={() => setPop(null)} />}
        </div>
        <button className={`btn ghost${rail ? ' on' : ''}`} aria-pressed={rail} onClick={() => useDocs.setState({ rail: !rail })}>
          评论{open ? <span className="badge blue">{open}</span> : null}
        </button>
        <button className="btn ghost" onClick={() => useStore.setState((s) => ({ journalOpen: !s.journalOpen }))}>
          记录
        </button>
      </header>
      <aside className="doctabs" aria-label="标签页">
        <h3>标签页</h3>
        <ul>
          {order.map((t) => (
            <TabRow key={t.id} id={t.id} title={t.title} sub={!!t.parent} current={t.id === tab} />
          ))}
        </ul>
        <button className="btn ghost addtab" onClick={() => addTab('新的标签页')}>
          ＋ 标签页
        </button>
        {tab && <Outline tab={tab} />}
      </aside>
      <main className="docmain">
        <Toolbar />
        <div className="docscroll">
          <div className="docpage">{tab && <DocEditor key={tab} tab={tab} />}</div>
        </div>
        <AskClaude
          file={tab ? tabFile(tab) : undefined}
          placeholder="交给 Claude Code：写一节、按评论改、加一张表、整理全文…"
          context={() => {
            const e = docEditor.current;
            if (!e || e.state.selection.empty) return '';
            const text = e.state.doc.textBetween(e.state.selection.from, e.state.selection.to, '\n').slice(0, 1500);
            return `The person selected these words in the tab:\n"""\n${text}\n"""`;
          }}
        />
      </main>
      {rail && <CommentsRail />}
      {journalOpen && <JournalPopover />}
    </div>
  );
}
