import { ItemMenuItems } from '../ItemMenu';
import { Menu, MenuItem } from '../Menu';
import { RowMenu } from '../RowMenu';
import { InlineRename } from '../InlineRename';
import { Segmented } from '../Segmented';
import { SideResizer } from '../SideResizer';
import { ListColumn } from '../ChatPanel';
import { useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBold,
  IconColumnInsertRight,
  IconColumnRemove,
  IconFileTypeCsv,
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
import { docDecorCss, docLookCss, docLookVars, docsViewContext, lookFontCss, outlineOf, tabFile, tabOrder, wordCount, type DocJson } from '@dc/core';
import { api, type DeletedTabGroup } from '../../api';
import { display, isSaving, useStore } from '../../store';
import { addTab, deleteTab, duplicateTab, docsImport, editDoc, moveTab, openTab, renameTab, restoreDeletedTab, useComments, useCurrentTab, useDocIndex, useDocs } from './docs';
import { htmlToPng } from '../../imageExport';
import { Versions } from './Versions';
import { AskClaude } from '../AskClaude';
import { JournalPopover } from '../Overlays';
import { DocEditor, docEditor, pickImage } from './DocEditor';
import { BlockBar, downloadTableCsv } from './BlockBar';
import { CommentsRail } from './Comments';
import { FileMenu, imageExportItems, type ExportItem } from '../FileMenu';
import { CopyPicture, FilePdf, FileText, FileWord, Palette, Wechat } from '../icons';
import { DocTheme } from './DocTheme';
import { currentDocLook, systemFontBase, useDocLook } from './docLookState';
import { exportWechat, WechatPreview } from './WechatPreview';
import { t as tNow } from '../../i18n';
import { copyDocMarkdown, saveDocMarkdown } from './markdownExport';
import { saveDocWord } from './wordExport';
import { pdfHint, printWindow, savePdf, useDirectPdf } from '../../pdfExport';
import { TopBar, ProjectTitle, BarButton } from '../TopBar';
import { LayoutCols, VersionsIcon } from '../icons';
import { useTranslation } from 'react-i18next';
import { download } from '../../local';

function TabRow({ id, title, sub, current, first, last }: { id: string; title: string; sub: boolean; current: boolean; first: boolean; last: boolean }) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  return (
    <li className={`tabrow${sub ? ' sub' : ''}${current ? ' on' : ''}`}>
      {renaming ? (
        <InlineRename value={title} label={t('docs.tab.nameLabel')} onCommit={(v) => renameTab(id, v)} onDone={() => setRenaming(false)} />
      ) : (
        <button
          className="tabname"
          aria-current={current ? 'page' : undefined}
          onClick={() => openTab(id)}
          onDoubleClick={() => setRenaming(true)}
          onKeyDown={(e) => {
            if (e.key !== 'Delete' && e.key !== 'Backspace') return;
            e.preventDefault();
            void deleteTab(id);
          }}
        >
          {title}
        </button>
      )}
      <RowMenu label={t('docs.tab.actions', { title })}>
        {(close) => (
          <ItemMenuItems
            close={close}
            adds={!sub && <MenuItem label={t('docs.tab.addSub')} onSelect={() => (close(), addTab(t('docs.tab.newSubTitle'), id))} />}
            onDuplicate={() => duplicateTab(id)}
            onEarlier={first ? null : () => moveTab(id, -1)}
            onLater={last ? null : () => moveTab(id, 1)}
            onRename={() => setRenaming(true)}
            onDelete={() => void deleteTab(id)}
          />
        )}
      </RowMenu>
    </li>
  );
}

/** The tabs a delete took out, listed under the tab rows while there are any: one entry puts a tab, its subtabs and its text back where they sat. */
function RestoreDeleted() {
  const { t, i18n } = useTranslation();
  const index = useDocIndex();
  const project = useStore((s) => s.project);
  const [gone, setGone] = useState<DeletedTabGroup[]>([]);
  const btn = useRef<HTMLButtonElement>(null);
  // the menu closes itself on a press outside it, the button included: remember it was open then, so the click that follows does not open it again
  const wasOpen = useRef(false);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const close = () => setAt(null);
  useEffect(() => {
    if (!project) return setGone([]);
    let live = true;
    const load = () => api.historyDeleted(project).then((l) => live && setGone(l), () => live && setGone([]));
    load();
    // a delete writes its marker just after the index changes; one more look makes sure the list catches it
    const again = setTimeout(load, 1200);
    return () => {
      live = false;
      clearTimeout(again);
    };
  }, [project, index]); // the index changes whenever tabs come or go, which is when this list can change
  if (!gone.length) return null;
  return (
    <>
      <button
        ref={btn}
        className="btn ghost sm restoretab"
        aria-haspopup="menu"
        aria-expanded={!!at}
        onPointerDown={() => (wasOpen.current = !!at)}
        onClick={() => {
          if (wasOpen.current) return void (wasOpen.current = false);
          const r = btn.current!.getBoundingClientRect();
          setAt({ x: r.left, y: r.bottom + 4 });
        }}
      >
        {t('docs.deleted.button')}
      </button>
      {at && (
        <Menu x={at.x} y={at.y} label={t('docs.deleted.menu')} onClose={close}>
          {gone.map((r) => (
            <MenuItem
              key={r.id}
              label={r.title || r.id}
              hint={t('docs.deleted.hint', { at: new Date(r.at).toLocaleString(i18n.language) })}
              onSelect={() => {
                close();
                void restoreDeletedTab(r);
              }}
            />
          ))}
        </Menu>
      )}
    </>
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
          {b(i(IconFileTypeCsv), false, () => downloadTableCsv(e), t('docs.toolbar.tableCsv'))}
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
  // what the doc wears is what the page draws: the doc's own look, or the design system and theme it chose (.design/doc-design-system.md)
  const { look, worn, tokens } = currentDocLook();
  // the serif look names a hosted face: without the link the page (and every picture of it) draws a stand-in
  const serif = !worn && (d.settings.headingFont === 'serif' || d.settings.bodyFont === 'serif');
  const fonts = serif ? '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;600;700&display=swap">' : '';
  // a system's faces: its hosted ones by @import (first in the sheet) and its font files from the project
  const faces = worn && tokens ? lookFontCss(tokens, systemFontBase(worn.system)) : '';
  return `<!doctype html><html lang="${d.settings.lang}"><head><meta charset="utf-8"><title>${d.title.replace(/[<&]/g, '')}</title>${fonts}<style>
${faces}
body{max-width:${d.settings.width === 'wide' ? 1000 : (look.column ?? 720)}px;margin:40px auto;padding:0 24px}
${docLookCss(look)}
img{max-width:100%}.tab+.tab{border-top:1px solid ${look.rule};margin-top:48px;padding-top:24px}@media print{.tab+.tab{break-before:page;border:0}}
</style></head><body>${parts.join('\n')}</body></html>`;
}

/** What the menu offers for a doc: the PDF first, then the text formats, then the picture. */
function docsExportItems(d: DocJson, tab: string | null, direct: boolean | null): ExportItem[] {
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
      id: 'docx',
      label: tNow('common.transfer.label.word'),
      hint: tNow('common.transfer.hint.docWord'),
      icon: <FileWord />,
      run: () => saveDocWord(name),
    },
    {
      id: 'mdAll',
      label: tNow('common.transfer.label.markdown'),
      hint: tNow('common.transfer.hint.docMdWhole'),
      icon: <FileText />,
      rule: true,
      run: () => saveDocMarkdown(name),
    },
    {
      id: 'md',
      label: tNow('common.transfer.label.markdownTab'),
      hint: tNow('common.transfer.hint.docMdTab'),
      icon: <FileText />,
      disabled: !tab,
      run: () => saveDocMarkdown(name, tab!),
    },
    {
      id: 'wechat',
      label: tNow('common.transfer.label.wechat'),
      hint: tNow('common.transfer.hint.docWechat'),
      icon: <Wechat />,
      run: () => exportWechat(`${name}-wechat`),
    },
    {
      id: 'wechat-tab',
      label: tNow('common.transfer.label.wechatTab'),
      hint: tNow('common.transfer.hint.docWechatTab'),
      icon: <Wechat />,
      disabled: !tab,
      run: () => exportWechat(`${name}-wechat`, tab!, d.tabs.find((x) => x.id === tab)?.title),
    },
    {
      id: 'copy-md',
      label: tNow('common.transfer.label.copyMarkdownTab'),
      hint: tNow('common.transfer.hint.docCopyMd'),
      icon: <CopyPicture />,
      disabled: !tab,
      run: () => copyDocMarkdown(name, tab!),
    },
    { id: 'html', label: tNow('common.transfer.label.html'), hint: tNow('common.transfer.hint.docPage'), icon: <FileText />, run: () => download(`${name}.html`, docHtml(d), 'text/html') },
    ...imageExportItems({ hint: tNow('common.transfer.hint.docTab'), name: `${name}.png`, disabled: !tab, rule: true, make: () => htmlToPng(docHtml(d, tab!), { width: d.settings.width === 'wide' ? 1048 : 768 }) }),
  ];
}

function Settings({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const d = useDocIndex();
  const set = (k: 'headingFont' | 'bodyFont' | 'width', v: string) => editDoc((x) => ((x.settings as unknown as Record<string, string>)[k] = v), `settings ${k} = ${v}`);
  const seg = (k: 'headingFont' | 'bodyFont' | 'width', label: string, opts: [string, string][]) => (
    <Segmented label={label} value={d.settings[k]} onChange={(v) => set(k, v)} options={opts.map(([value, text]) => ({ value, label: text }))} />
  );
  return (
    <div className="popmenu settings" onMouseLeave={onClose}>
      <label>{t('docs.settings.headingFont')}</label>
      {seg('headingFont', t('docs.settings.headingFont'), [
        ['sans', t('docs.settings.sans')],
        ['serif', t('docs.settings.serif')],
      ])}
      <label>{t('docs.settings.bodyFont')}</label>
      {seg('bodyFont', t('docs.settings.bodyFont'), [
        ['sans', t('docs.settings.sans')],
        ['serif', t('docs.settings.serif')],
      ])}
      <label>{t('docs.settings.width')}</label>
      {seg('width', t('docs.settings.width'), [
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
  const rail = useStore((s) => s.pane === 'comments');
  const comments = useComments();
  const [pop, setPop] = useState<'settings' | 'versions' | 'theme' | null>(null);
  const { look, worn, tokens } = useDocLook();
  // the WeChat preview's "Change…" opens the Theme here
  const themeAsked = useDocs((x) => x.themeAsked);
  useEffect(() => {
    if (!themeAsked) return;
    setPop('theme');
    useDocs.setState({ themeAsked: false });
  }, [themeAsked]);
  // a system's faces for the page: hosted ones by @import, font files from the project
  useEffect(() => {
    const id = 'doc-look-faces';
    document.getElementById(id)?.remove();
    if (!worn || !tokens) return;
    const css = lookFontCss(tokens, systemFontBase(worn.system));
    if (!css) return;
    const el = document.createElement('style');
    el.id = id;
    el.textContent = css;
    document.head.prepend(el);
    return () => el.remove();
  }, [worn?.system, tokens]);
  const source = useStore((s) => (tab ? display(s, tabFile(tab)) : '')) ?? '';
  const words = useMemo(() => wordCount(source), [source]);

  useEffect(() => {
    const id = new URLSearchParams(location.search).get('t');
    if (id) useDocs.setState({ tab: id });
  }, []);

  // The serif look names a hosted face: load it while such a doc is open, so the tab shows what its exports draw.
  useEffect(() => {
    const id = 'doc-look-font';
    const serif = d.settings.headingFont === 'serif' || d.settings.bodyFont === 'serif';
    if (serif && !document.getElementById(id)) {
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;600;700&display=swap';
      document.head.appendChild(link);
    } else if (!serif) document.getElementById(id)?.remove();
  }, [d.settings.headingFont, d.settings.bodyFont]);
  useEffect(() => {
    document.title = d.title;
  }, [d.title]);

  const order = tabOrder(d);
  return (
    <div className={`app docs${rail ? ' with-rail' : ''}`} data-width={d.settings.width} data-hfont={d.settings.headingFont} data-bfont={d.settings.bodyFont} data-wears={worn ? '' : undefined}>
      <TopBar title={<Title />}>
        <span className="hint">{t('docs.app.words', { count: words })}</span>
        <div className="popwrap">
          <BarButton icon={<LayoutCols />} label={t('docs.app.layout')} on={pop === 'settings'} onClick={() => setPop(pop === 'settings' ? null : 'settings')} />
          {pop === 'settings' && <Settings onClose={() => setPop(null)} />}
        </div>
        <div className="popwrap">
          <BarButton icon={<Palette />} label={t('docs.theme.title')} title={t('docs.theme.hint')} on={pop === 'theme' || !!worn} data-theme-button="" onClick={() => setPop(pop === 'theme' ? null : 'theme')} />
          {pop === 'theme' && <DocTheme />}
        </div>
        {tab && (
          <div className="popwrap">
            <BarButton icon={<VersionsIcon />} label={t('docs.versions.button')} on={pop === 'versions'} data-versions="" onClick={() => setPop(pop === 'versions' ? null : 'versions')} />
            {pop === 'versions' && <Versions key={tab} tab={tab} onClose={() => setPop(null)} />}
          </div>
        )}
        <FileMenu target={docsImport} label={t('docs.app.importLabel')} items={docsExportItems(d, tab, direct)} />
      </TopBar>
      <WechatPreview />
      <ListColumn label={t('docs.app.tabs')} className="docs">
        <aside className="doctabs" aria-label={t('docs.app.tabs')}>
          <SideResizer id="doctabs" edge="end" name={t('docs.app.tabs')} />
          <h3>{t('docs.app.tabs')}</h3>
          <ul>
            {order.map((x) => {
              const siblings = order.filter((y) => (y.parent ?? null) === (x.parent ?? null));
              return <TabRow key={x.id} id={x.id} title={x.title} sub={!!x.parent} current={x.id === tab} first={siblings[0] === x} last={siblings.at(-1) === x} />;
            })}
          </ul>
          <button className="btn ghost addtab" onClick={() => addTab(t('docs.tab.newTitle'))}>
            {t('docs.app.addTab')}
          </button>
          <RestoreDeleted />
          {tab && <Outline tab={tab} />}
        </aside>
      </ListColumn>
      <main className="docmain">
        <Toolbar />
        <div className="docscroll">
          <div className="docpage" style={worn ? (docLookVars(look) as CSSProperties) : undefined}>
            {worn && <style>{docDecorCss(look, '.app.docs[data-wears] .docpage .docbody')}</style>}
            {tab && <DocEditor key={tab} tab={tab} />}
          </div>
        </div>
        <BlockBar />
        <AskClaude
          file={tab ? tabFile(tab) : undefined}
          placeholder={t('docs.app.askPlaceholder')}
          context={() => {
            const e = docEditor.current;
            const { from, to, $from } = e?.state.selection ?? { from: 0, to: 0, $from: null };
            let heading = '';
            if (e) {
              e.state.doc.forEach((n, pos) => {
                if (pos < from && n.type.name === 'heading') heading = n.textContent;
              });
            }
            const lit = rail ? comments.threads.find((x) => x.id === useDocs.getState().thread && !x.resolved) : undefined;
            return docsViewContext({
              title: order.find((x) => x.id === tab)?.title,
              file: tab ? tabFile(tab) : undefined,
              heading,
              selection: e && from !== to ? e.state.doc.textBetween(from, to, '\n') : '',
              block: $from?.parent.textContent,
              thread: lit?.quote,
            });
          }}
        />
      </main>
      {rail && <CommentsRail />}
      <JournalPopover />
    </div>
  );
}
