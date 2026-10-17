import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBold,
  IconColumnInsertRight,
  IconColumnRemove,
  IconItalic,
  IconList,
  IconListCheck,
  IconListNumbers,
  IconPhoto,
  IconQuote,
  IconRowInsertBottom,
  IconRowRemove,
  IconSeparatorHorizontal,
  IconStrikethrough,
  IconTable,
  type IconProps,
} from '@tabler/icons-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { outlineOf, tabFile, tabOrder, wordCount, type DocJson } from '@dc/core';
import { api } from '../../api';
import { display, isSaving, useStore } from '../../store';
import { addTab, deleteTab, docsImport, editDoc, moveTab, openTab, renameTab, useComments, useCurrentTab, useDocIndex, useDocs } from './docs';
import { htmlToPng, saveImage } from '../../imageExport';
import { AskClaude } from '../AskClaude';
import { JournalPopover } from '../Overlays';
import { DocEditor, docEditor, pickImage } from './DocEditor';
import { CommentsRail } from './Comments';
import { FileMenu, type ExportItem } from '../FileMenu';
import { FilePdf, FileText, Picture } from '../icons';
import { t as tNow } from '../../i18n';
import { pdfHint, printWindow, savePdf, useDirectPdf } from '../../pdfExport';
import { TopBar, ProjectTitle, BarButton } from '../TopBar';
import { LayoutCols, Message } from '../icons';
import { useTranslation } from 'react-i18next';
import { download } from '../../local';

function TabRow({ id, title, sub, current }: { id: string; title: string; sub: boolean; current: boolean }) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [menu, setMenu] = useState(false);
  return (
    <li className={`tabrow${sub ? ' sub' : ''}${current ? ' on' : ''}`}>
      {renaming ? (
        <input
          autoFocus
          defaultValue={title}
          aria-label={t('docs.tab.nameLabel')}
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
      <button className="ib more" aria-label={t('docs.tab.actions', { title })} onClick={() => setMenu(!menu)}>
        ⋯
      </button>
      {menu && (
        <div className="tabmenu" onMouseLeave={() => setMenu(false)}>
          <button onClick={() => (setMenu(false), setRenaming(true))}>{t('docs.tab.rename')}</button>
          {!sub && <button onClick={() => (setMenu(false), addTab(t('docs.tab.newSubTitle'), id))}>{t('docs.tab.addSub')}</button>}
          <button onClick={() => (setMenu(false), moveTab(id, -1))}>{t('docs.tab.moveUp')}</button>
          <button onClick={() => (setMenu(false), moveTab(id, 1))}>{t('docs.tab.moveDown')}</button>
          <button
            className="danger"
            onClick={() => {
              setMenu(false);
              if (confirm(sub ? t('docs.tab.confirmDeleteSub', { title }) : t('docs.tab.confirmDelete', { title }))) void deleteTab(id);
            }}
          >
            {t('common.delete')}
          </button>
        </div>
      )}
    </li>
  );
}

function Outline({ tab }: { tab: string }) {
  const { t } = useTranslation();
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
    <nav className="outline" aria-label={t('docs.outline.label')}>
      <h3>{t('docs.outline.label')}</h3>
      {heads.map((h, i) => (
        <button key={i} style={{ paddingLeft: 8 + (h.level - 1) * 12 }} onClick={() => go(i)}>
          {h.text || t('docs.outline.untitled')}
        </button>
      ))}
    </nav>
  );
}

function Toolbar() {
  const { t } = useTranslation();
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
  const b = (label: ReactNode, active: boolean, run: () => void, aria = String(label)) => (
    <button className={active ? 'on' : ''} aria-pressed={active} aria-label={aria} title={aria} onMouseDown={(ev) => ev.preventDefault()} onClick={run}>
      {label}
    </button>
  );
  const i = (I: ComponentType<IconProps>) => <I size={16} stroke={1.7} aria-hidden="true" />;
  return (
    <div className="doctools" role="toolbar" aria-label={t('docs.toolbar.label')}>
      {b(i(IconArrowBackUp), false, () => e.chain().focus().undo().run(), t('common.undo'))}
      {b(i(IconArrowForwardUp), false, () => e.chain().focus().redo().run(), t('common.redo'))}
      <span className="sep" />
      <select
        aria-label={t('docs.toolbar.blockStyle')}
        value={block}
        onChange={(ev) => {
          const v = ev.target.value;
          const c = e.chain().focus();
          if (v === 'p') c.setParagraph().run();
          else if (v === 'code') c.setCodeBlock().run();
          else c.setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
        }}
      >
        <option value="p">{t('docs.block.p')}</option>
        <option value="h1">{t('docs.block.h1')}</option>
        <option value="h2">{t('docs.block.h2')}</option>
        <option value="h3">{t('docs.block.h3')}</option>
        <option value="code">{t('docs.block.code')}</option>
      </select>
      <span className="sep" />
      {b(i(IconBold), e.isActive('bold'), () => e.chain().focus().toggleBold().run(), t('docs.format.bold'))}
      {b(i(IconItalic), e.isActive('italic'), () => e.chain().focus().toggleItalic().run(), t('docs.format.italic'))}
      {b(i(IconStrikethrough), e.isActive('strike'), () => e.chain().focus().toggleStrike().run(), t('docs.format.strike'))}
      <span className="sep" />
      {b(i(IconList), e.isActive('bulletList'), () => e.chain().focus().toggleBulletList().run(), t('docs.block.ul'))}
      {b(i(IconListNumbers), e.isActive('orderedList'), () => e.chain().focus().toggleOrderedList().run(), t('docs.block.ol'))}
      {b(i(IconListCheck), e.isActive('taskList'), () => e.chain().focus().toggleTaskList().run(), t('docs.block.todo'))}
      {b(i(IconQuote), e.isActive('blockquote'), () => e.chain().focus().toggleBlockquote().run(), t('docs.block.quote'))}
      <span className="sep" />
      {b(i(IconTable), false, () => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), t('docs.block.table'))}
      {e.isActive('table') && (
        <>
          {b(i(IconRowInsertBottom), false, () => e.chain().focus().addRowAfter().run(), t('docs.toolbar.rowBelow'))}
          {b(i(IconColumnInsertRight), false, () => e.chain().focus().addColumnAfter().run(), t('docs.toolbar.colRight'))}
          {b(i(IconRowRemove), false, () => e.chain().focus().deleteRow().run(), t('docs.toolbar.deleteRow'))}
          {b(i(IconColumnRemove), false, () => e.chain().focus().deleteColumn().run(), t('docs.toolbar.deleteCol'))}
        </>
      )}
      {b(i(IconPhoto), false, () => pickImage(e), t('docs.block.image'))}
      {b(i(IconSeparatorHorizontal), false, () => e.chain().focus().setHorizontalRule().run(), t('docs.block.hr'))}
    </div>
  );
}

/** The doc as one page of HTML: every tab in order, images from the project. */
function docHtml(d: DocJson, only?: string): string {
  const s = useStore.getState();
  const project = s.project!;
  const parts = tabOrder(d)
    .filter((t) => !only || t.id === only)
    .map((t) => {
      const md = (display(s, tabFile(t.id)) ?? '').replace(/\]\((\.\.\/)?((?:assets|uploads)\/[^)\s]+)\)/g, (_m, _p, path) => `](${api.rawBase(project)}${path})`);
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

/** What the menu offers for a doc: the PDF first, then the text formats, then the picture. */
function docsExportItems(d: DocJson, tab: string | null, direct: boolean | null): ExportItem[] {
  const s = useStore.getState();
  const name = d.title.replace(/[\\/:*?"<>|]+/g, '-');
  return [
    {
      id: 'pdf',
      label: tNow('common.transfer.label.pdf'),
      hint: pdfHint(tNow('common.transfer.hint.docWhole'), direct),
      icon: <FilePdf />,
      run: () => savePdf(`${name}.pdf`, { html: docHtml(d), paper: 'a4', print: () => void printWindow(docHtml(d), true) }),
    },
    {
      id: 'md',
      label: tNow('common.transfer.label.markdown'),
      hint: tNow('common.transfer.hint.docTab'),
      icon: <FileText />,
      disabled: !tab,
      rule: true,
      run: () => download(`${name}.md`, display(s, tabFile(tab!)) ?? '', 'text/markdown'),
    },
    {
      id: 'mdAll',
      label: tNow('common.transfer.label.markdown'),
      hint: tNow('common.transfer.hint.docWhole'),
      icon: <FileText />,
      run: () =>
        download(
          `${name}.md`,
          tabOrder(d)
            .map((x) => display(s, tabFile(x.id)) ?? '')
            .join('\n\n---\n\n'),
          'text/markdown',
        ),
    },
    { id: 'html', label: tNow('common.transfer.label.html'), hint: tNow('common.transfer.hint.docPage'), icon: <FileText />, run: () => download(`${name}.html`, docHtml(d), 'text/html') },
    {
      id: 'png',
      label: tNow('common.transfer.label.png'),
      hint: tNow('common.transfer.hint.docTab'),
      icon: <Picture />,
      disabled: !tab,
      rule: true,
      run: async () => void (await saveImage(`${name}.png`, () => htmlToPng(docHtml(d, tab!), { width: d.settings.width === 'wide' ? 1048 : 768 }))),
    },
  ];
}

function Settings({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
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
      <label>{t('docs.settings.headingFont')}</label>
      {seg('headingFont', [
        ['sans', t('docs.settings.sans')],
        ['serif', t('docs.settings.serif')],
      ])}
      <label>{t('docs.settings.bodyFont')}</label>
      {seg('bodyFont', [
        ['sans', t('docs.settings.sans')],
        ['serif', t('docs.settings.serif')],
      ])}
      <label>{t('docs.settings.width')}</label>
      {seg('width', [
        ['default', t('docs.settings.standard')],
        ['wide', t('docs.settings.wide')],
      ])}
    </div>
  );
}

function Title() {
  const { t } = useTranslation();
  const d = useDocIndex();
  return <ProjectTitle value={d.title} label={t('docs.title.label')} hint={t('docs.title.renameHint')} onRename={(v) => editDoc((x) => (x.title = v), 'doc renamed')} />;
}

export function DocsApp() {
  const { t } = useTranslation();
  const d = useDocIndex();
  const tab = useCurrentTab();
  const direct = useDirectPdf();
  const connected = useStore((s) => s.connected);
  const saving = useStore(isSaving);
  const journalOpen = useStore((s) => s.journalOpen);
  const rail = useDocs((s) => s.rail);
  const comments = useComments();
  const [pop, setPop] = useState<'settings' | null>(null);
  const source = useStore((s) => (tab ? display(s, tabFile(tab)) : '')) ?? '';
  const words = useMemo(() => wordCount(source), [source]);
  const open = comments.threads.filter((x) => x.tab === tab && !x.resolved).length;

  useEffect(() => {
    const id = new URLSearchParams(location.search).get('t');
    if (id) useDocs.setState({ tab: id });
  }, []);
  useEffect(() => {
    document.title = d.title;
  }, [d.title]);

  const order = tabOrder(d);
  return (
    <div className={`app docs${rail ? ' with-rail' : ''}`} data-width={d.settings.width} data-hfont={d.settings.headingFont} data-bfont={d.settings.bodyFont}>
      <TopBar title={<Title />}>
        <span className="hint">{t('docs.app.words', { count: words })}</span>
        <div className="popwrap">
          <BarButton icon={<LayoutCols />} label={t('docs.app.layout')} on={pop === 'settings'} onClick={() => setPop(pop === 'settings' ? null : 'settings')} />
          {pop === 'settings' && <Settings onClose={() => setPop(null)} />}
        </div>
        <FileMenu target={docsImport} label={t('docs.app.importLabel')} items={docsExportItems(d, tab, direct)} />
        <BarButton icon={<Message />} label={t('docs.app.comments')} on={rail} badge={open ? <span className="badge blue">{open}</span> : null} onClick={() => useDocs.setState({ rail: !rail })} />
      </TopBar>
      <aside className="doctabs" aria-label={t('docs.app.tabs')}>
        <h3>{t('docs.app.tabs')}</h3>
        <ul>
          {order.map((x) => (
            <TabRow key={x.id} id={x.id} title={x.title} sub={!!x.parent} current={x.id === tab} />
          ))}
        </ul>
        <button className="btn ghost addtab" onClick={() => addTab(t('docs.tab.newTitle'))}>
          {t('docs.app.addTab')}
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
          onOpen={(f) => {
            const id = /^tabs\/(.+)\.md$/.exec(f)?.[1];
            if (id && order.some((x) => x.id === id)) openTab(id);
          }}
          placeholder={t('docs.app.askPlaceholder')}
          context={() => {
            const e = docEditor.current;
            if (!e || e.state.selection.empty) return '';
            const text = e.state.doc.textBetween(e.state.selection.from, e.state.selection.to, '\n').slice(0, 1500);
            return `The person selected these words in the tab:\n"""\n${text}\n"""`;
          }}
        />
      </main>
      {rail && <CommentsRail />}
      <JournalPopover />
    </div>
  );
}
