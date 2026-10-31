import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconFileImport, IconPlus, IconSearch } from '@tabler/icons-react';
import { type ProjectCard, type ProjectKind } from '@dc/core';
import { api } from '../../api';
import { toast, useStore } from '../../store';
import { Chevron, ArchiveBox, FileZip, FolderOpen, GridLayout, ListLayout, Sliders, Unlink } from '../icons';
import { chooseProjectArchive, importProjectFile, isProjectImportFile } from '../../projectArchive';
import { Menu, MenuItem } from '../Menu';
import { Appearance, LanguageMenu } from '../Appearance';
import { ISSUES_URL, REPO_URL } from '../../links';
import { ImportDialog } from '../ImportDialog';
import { droppedFiles, pickedFromText, readPicked, type Picked } from '../../importer';
import { readPref, writePref } from '../../local';
import { NewDialog, OpenFolderDialog } from './NewDialog';
import { Card, NewTile, ProjectActions, Row, ArchivedActions } from './ProjectCards';
import { KIND, KINDS, KindIcon } from './kinds';
import { open, readRecent } from './recent';

const VIEW_KEY = 'dc:launcher-view';
const FOLDED_KEY = 'dc:launcher-folded-groups';

function Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 88 88" aria-hidden="true">
      <rect width="88" height="88" rx="24" fill="var(--ink)" />
      <rect x="25" y="25" width="38" height="9" rx="2" fill="var(--panel)" />
      <rect x="39.5" y="25" width="9" height="39" rx="2" fill="var(--panel)" />
    </svg>
  );
}

/** Move focus between cards with the arrow keys, by where they sit on screen. */
function arrowNav(e: React.KeyboardEvent<HTMLElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('.lcard, .lrow')];
  const i = cards.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  e.preventDefault();
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    cards[Math.max(0, Math.min(cards.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))]?.focus();
    return;
  }
  const r = cards[i].getBoundingClientRect();
  const down = e.key === 'ArrowDown';
  let best: HTMLElement | null = null;
  let bestD = Infinity;
  for (const c of cards) {
    const q = c.getBoundingClientRect();
    if (down ? q.top <= r.top + 4 : q.top >= r.top - 4) continue;
    const d = Math.abs(q.top - r.top) * 4 + Math.abs(q.left - r.left);
    if (d < bestD) [best, bestD] = [c, d];
  }
  best?.focus();
}

export function Launcher() {
  const { t } = useTranslation();
  const [list, setList] = useState<ProjectCard[] | null>(null);
  const [archived, setArchived] = useState<ProjectCard[] | null>(null);
  const [tab, setTab] = useState<ProjectKind | 'all' | 'archived'>('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const [view, setView] = useState<'grid' | 'list'>(() => (readPref(VIEW_KEY) === 'list' ? 'list' : 'grid'));
  const [folded, setFolded] = useState<Set<string>>(() => new Set(readPref(FOLDED_KEY).split('\n').filter(Boolean)));
  const [acting, setActing] = useState<{ name: string; x: number; y: number } | null>(null);
  const [newMenu, setNewMenu] = useState<DOMRect | null>(null);
  const [creating, setCreating] = useState<ProjectKind | null>(null);
  const [createAt, setCreateAt] = useState<string | undefined>(undefined);
  const [opening, setOpening] = useState(false);
  const linksOn = useStore((s) => s.health?.links !== false);
  const [importing, setImporting] = useState<{ picked?: Picked } | null>(null);
  const [dropping, setDropping] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const recent = useMemo(readRecent, []);

  const reload = useCallback(() => {
    api.projects().then(setList, (e) => {
      setList([]);
      toast(e.message, 'error');
    });
    // the Archive tab's list; a failure here leaves it empty, the main list's toast already said why
    api.projects({ archived: true }).then(setArchived, () => setArchived([]));
  }, []);
  useEffect(reload, [reload]);
  // a folder of projects opened as a group is taken off again from its heading; the toast puts it back
  const closeFolder = (id: string, path: string) => {
    const folder = path.split('/').filter(Boolean).pop() ?? path;
    api.closeFolder(id).then(
      () => {
        reload();
        toast(t('launcher.folder.groupClosed', { folder }), 'info', { label: t('launcher.group.undo'), run: () => api.openFolder(path).then(reload, (e) => toast(e.message, 'error')) });
      },
      (e) => toast(e.message, 'error'),
    );
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const a = document.activeElement;
      if (e.key === '/' && !(a instanceof HTMLInputElement) && !creating && !importing && !opening) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    // SVG on the clipboard (Figma: Copy as SVG) pasted onto the launcher opens the import with it
    const paste = (e: ClipboardEvent) => {
      if (creating || importing || document.activeElement instanceof HTMLInputElement) return;
      const picked = pickedFromText(e.clipboardData?.getData('text/plain') ?? '');
      if (!picked) return;
      e.preventDefault();
      setImporting({ picked });
    };
    window.addEventListener('keydown', key);
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('paste', paste);
    };
  }, [creating, importing]);

  const counts = useMemo(() => {
    const c = { all: list?.length ?? 0, archived: archived?.length ?? 0 } as Record<ProjectKind | 'all' | 'archived', number>;
    for (const k of KINDS) c[k.kind] = list?.filter((p) => p.kind === k.kind).length ?? 0;
    return c;
  }, [list, archived]);
  // the Archive tab looks at the archived projects, every other tab at the launcher's list
  const source = tab === 'archived' ? archived : list;
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rank = (p: ProjectCard) => {
      const i = recent.indexOf(p.name);
      return i < 0 ? Infinity : i;
    };
    return (source ?? [])
      .filter((p) => (tab === 'all' || tab === 'archived' || p.kind === tab) && (!needle || p.title.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle) || (p.group ?? '').toLowerCase().includes(needle) || t(`launcher.kind.${p.kind}.name`).toLowerCase().includes(needle)))
      .sort((a, b) =>
        sort === 'name'
          ? (a.title || a.name).localeCompare(b.title || b.name)
          : rank(a) - rank(b) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.name.localeCompare(b.name),
      );
  }, [source, tab, q, sort, recent, t]);
  const taken = useMemo(() => new Set([...(list ?? []), ...(archived ?? [])].map((p) => p.name)), [list, archived]);
  const lastOpened = recent.find((n) => taken.has(n));
  const groups = useMemo(() => [...new Set((list ?? []).map((p) => p.group).filter((g): g is string => !!g))].sort((a, b) => a.localeCompare(b)), [list]);
  // with groups, the list falls into one section per group (the most recent first, or by name), the loose ones last; a search flattens it, and so does the Archive tab
  const sections = useMemo(() => {
    type Section = { key: string; name: string; items: ProjectCard[]; folder?: { id: string; path: string } };
    if (tab === 'archived' || !groups.length || q.trim()) return [{ key: '', name: '', items: shown } as Section];
    const by = new Map<string, ProjectCard[]>();
    for (const p of shown) by.set(p.group ?? '', [...(by.get(p.group ?? '') ?? []), p]);
    const names = [...by.keys()].filter(Boolean);
    // a group that is an opened folder says so, and can be closed from its heading
    const folderOf = (items: ProjectCard[]) => items.find((p) => p.folderGroup?.derived)?.folderGroup;
    return [...names.map((n): Section => ({ key: n, name: n, items: by.get(n)!, folder: folderOf(by.get(n)!) })), ...(by.has('') ? [{ key: '', name: t('launcher.group.ungrouped'), items: by.get('')! } as Section] : [])];
  }, [shown, groups, q, tab, t]);
  const flat = sections.length === 1 && !sections[0].name;
  const apply = (name: string, patch: { title?: string; group?: string }) => {
    const before = list?.find((p) => p.name === name);
    if (!before) return;
    const next = (p: ProjectCard, v: { title?: string; group?: string }): ProjectCard => ({ ...p, ...(v.title !== undefined ? { title: v.title } : {}), ...(v.group !== undefined ? { group: v.group || undefined } : {}) });
    setList((l) => l && l.map((p) => (p.name === name ? next(p, patch) : p)));
    api.patchProject(name, patch).then(
      () => {
        if (patch.group === undefined) return;
        const title = before.title || before.name;
        const undo = { label: t('launcher.group.undo'), run: () => apply(name, { group: before.group ?? '' }) };
        if (patch.group) toast(t('launcher.group.moved', { title, group: patch.group }), 'info', undo);
        else toast(t('launcher.group.removed', { title, group: before.group ?? '' }), 'info', undo);
      },
      (e: Error) => {
        setList((l) => l && l.map((p) => (p.name === name ? before : p)));
        toast(e.message, 'error');
      },
    );
  };
  // off the list only: the folder and its files stay, and Undo lists it again
  const unlink = (p: ProjectCard) => {
    const title = p.title || p.name;
    setList((l) => l && l.filter((x) => x.name !== p.name));
    api.unlink(p.name).then(
      () =>
        toast(t('launcher.folder.unlinked', { title }), 'info', {
          label: t('launcher.group.undo'),
          run: () => api.link(p.path!).then(() => api.projects().then(setList), (e: Error) => toast(e.message, 'error')),
        }),
      (e: Error) => {
        setList((l) => l && [...l, p]);
        toast(e.message, 'error');
      },
    );
  };
  // filed out of the launcher (`on`), or put back from the Archive tab: only the list changes, the folder and its files stay as they are
  const setArchivedTo = (p: ProjectCard, on: boolean) => {
    const title = p.title || p.name;
    if (on) setList((l) => l && l.filter((x) => x.name !== p.name));
    else setArchived((l) => l && l.filter((x) => x.name !== p.name));
    api.patchProject(p.name, { archived: on }).then(
      () => {
        reload();
        if (on)
          toast(t('launcher.archived.done', { title }), 'info', {
            label: t('launcher.group.undo'),
            run: () => setArchivedTo(p, false),
          });
        else toast(t('launcher.archived.restored', { title }), 'info');
      },
      (e: Error) => {
        toast(e.message, 'error');
        reload();
      },
    );
  };
  const setViewTo = (v: 'grid' | 'list') => {
    setView(v);
    writePref(VIEW_KEY, v);
  };
  const fold = (key: string) =>
    setFolded((f) => {
      const n = new Set(f);
      if (!n.delete(key)) n.add(key);
      writePref(FOLDED_KEY, [...n].join('\n'));
      return n;
    });
  const onMore = (name: string, r: DOMRect) => setActing({ name, x: r.right, y: r.bottom + 4 });
  const acted = acting ? source?.find((p) => p.name === acting.name) : undefined;

  return (
    <div
      className={`launcher${dropping ? ' dropping' : ''}`}
      data-drop-hint={t('launcher.dropHint')}
      onDragOver={(e) => {
        if (creating || importing || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => e.currentTarget.contains(e.relatedTarget as Node) || setDropping(false)}
      onDrop={(e) => {
        if (!dropping) return;
        e.preventDefault();
        setDropping(false);
        const files = Array.from(e.dataTransfer.files);
        // Read DataTransfer now (the browser clears it after the event). Project files go
        // straight through the same shared file import path, not the HTML/SVG dialog.
        const material = droppedFiles(e.dataTransfer);
        void (async () => {
          const dropped = await material;
          if (files.length === 1 && await isProjectImportFile(files[0])) {
            const name = await importProjectFile(files[0]);
            if (name) open(name);
            return;
          }
          const picked = await readPicked(dropped);
          if (picked.entry) setImporting({ picked });
          else toast(t('launcher.dropNoEntry'), 'error');
        })().catch(e => toast((e as Error).message, 'error'));
      }}
    >
      <header className="lhead">
        <div className="brand">
          <a className="mark" href={REPO_URL} target="_blank" rel="noopener noreferrer" title={t('launcher.brand.title')} aria-label={t('launcher.brand.title')}>
            <Mark />
          </a>
          <div>
            <h1>Tingly Design</h1>
            <div className="sub">{list ? t('launcher.subtitle', { count: list.length }) : t('launcher.subtitleLoading')}</div>
          </div>
        </div>
        <div className="tools">
          <LanguageMenu className="btn lbtn" />
          <button className="btn lbtn" aria-label={t('aiSettings.menu')} title={t('aiSettings.menu')} onClick={() => useStore.setState({ aiSettingsOpen: true })}>
            <Sliders />
          </button>
          <Appearance className="btn lbtn" />
          <button className="btn primary lnewbtn" aria-haspopup="menu" data-new-menu onClick={(e) => setNewMenu(e.currentTarget.getBoundingClientRect())}>
            <IconPlus size={15} stroke={2} aria-hidden="true" /> {t('launcher.new.title')}
          </button>
        </div>
      </header>

      <nav className="ltabs" role="tablist" aria-label={t('launcher.tabs.label')}>
        {(['all', ...KINDS.map((k) => k.kind), 'archived'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} data-tab={k} className={k === 'all' || k === 'archived' ? '' : `t-${KIND[k].tone}`} onClick={() => setTab(k)}>
            {k === 'all' ? null : k === 'archived' ? <ArchiveBox /> : <KindIcon kind={k} size={14} />}
            {k === 'all' ? t('launcher.tabs.all') : k === 'archived' ? t('launcher.archived.tab') : t(`launcher.kind.${k}.name`)}
            <span className="n">{counts[k]}</span>
          </button>
        ))}
      </nav>

      <main className="lmain" onKeyDown={arrowNav}>
        {source === null && <div className="lhint">{t('launcher.loading')}</div>}
        {list !== null && !q.trim() && lastOpened && (tab === 'all' || list.find((p) => p.name === lastOpened)?.kind === tab) && (
          <div className="lcontinue">
            <span>{t('launcher.continue')}</span>
            <button className="linkish" onClick={() => open(lastOpened)}>
              {list.find((p) => p.name === lastOpened)?.title || lastOpened}
            </button>
          </div>
        )}
        {source !== null && (
          <section className={`lall${flat && groups.length ? '' : ' lnogroup'}`} aria-label={t('launcher.projects')}>
            <div className="lbar">
              <h2>{tab === 'all' ? t('launcher.allProjects') : tab === 'archived' ? t('launcher.archived.tab') : t(`launcher.kind.${tab}.name`)}</h2>
              <div className="ltools">
                <label className="lsearch">
                  <IconSearch size={15} stroke={1.7} aria-hidden="true" />
                  <input
                    ref={search}
                    placeholder={t('launcher.search.placeholder')}
                    aria-label={t('launcher.search.label')}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && shown[0]) open(shown[0].name);
                      if (e.key === 'Escape') setQ('');
                    }}
                  />
                  <kbd>/</kbd>
                </label>
                <div className="lview" role="group" aria-label={t('launcher.view.label')}>
                  {(['grid', 'list'] as const).map((v) => (
                    <button key={v} data-view={v} aria-pressed={view === v} title={t(`launcher.view.${v}`)} aria-label={t(`launcher.view.${v}`)} onClick={() => setViewTo(v)}>
                      {v === 'grid' ? <GridLayout /> : <ListLayout />}
                    </button>
                  ))}
                </div>
                <select className="lsort" aria-label={t('launcher.sort.label')} value={sort} onChange={(e) => setSort(e.target.value as 'recent' | 'name')}>
                  <option value="recent">{t('launcher.sort.recent')}</option>
                  <option value="name">{t('launcher.sort.name')}</option>
                </select>
              </div>
            </div>
            {view === 'list' && shown.length > 0 && (
              <div className="lrowhead" aria-hidden="false">
                <button className="c-title" data-sort="name" aria-pressed={sort === 'name'} onClick={() => setSort('name')}>
                  {t('launcher.list.name')}
                </button>
                <span className="c-path">{t('launcher.list.folder')}</span>
                <span className="c-group">{t('launcher.list.group')}</span>
                <span className="c-size">{t('launcher.list.size')}</span>
                <button className="c-when" data-sort="recent" aria-pressed={sort === 'recent'} onClick={() => setSort('recent')}>
                  {t('launcher.list.modified')}
                </button>
                <span className="c-more" />
              </div>
            )}
            {sections.map((sec, i) => {
              const key = sec.key || (sec.name ? '\u0000' : '');
              const shut = !!sec.name && folded.has(key);
              const last = i === sections.length - 1;
              const tile = tab !== 'all' && tab !== 'archived' && <NewTile kind={tab} onClick={() => setCreating(tab)} />;
              return (
                <div key={key} className="lsection" data-group={sec.name || undefined}>
                  {sec.name && (
                    <h3>
                      <button className="lghead" aria-expanded={!shut} aria-label={t(shut ? 'launcher.group.expand' : 'launcher.group.collapse', { name: sec.name })} onClick={() => fold(key)}>
                        <Chevron open={!shut} />
                        <span className="gname">{sec.name}</span>
                        <span className="n">{sec.items.length}</span>
                      </button>
                      {sec.folder && (
                        <>
                          <span className="gpath mono" title={sec.folder.path}>{sec.folder.path}</span>
                          <button className="btn ghost sm gclose" onClick={() => closeFolder(sec.folder!.id, sec.folder!.path)}>
                            <Unlink />
                            {t('launcher.folder.groupClose')}
                          </button>
                        </>
                      )}
                    </h3>
                  )}
                  {!shut && (
                    <div className={view === 'grid' ? 'lgrid' : 'llist'}>
                      {sec.items.map((p) => (view === 'grid' ? <Card key={p.name} p={p} recent={p.name === lastOpened} flat={flat || !!q.trim()} onMore={onMore} /> : <Row key={p.name} p={p} recent={p.name === lastOpened} onMore={onMore} />))}
                      {view === 'grid' && last && tile}
                    </div>
                  )}
                </div>
              );
            })}
            {view === 'list' && tab !== 'all' && tab !== 'archived' && <div className="lgrid ltail"><NewTile kind={tab} onClick={() => setCreating(tab)} /></div>}
            {!shown.length && <div className="lhint">{q.trim() ? t('launcher.notFound', { q: q.trim() }) : tab === 'all' ? t('launcher.noProjects') : tab === 'archived' ? t('launcher.archived.empty') : t(`launcher.kind.${tab}.empty`)}</div>}
          </section>
        )}
      </main>
      <footer className="lfoot">
        <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer">
          {t('launcher.links.report')}
        </a>
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          {t('launcher.links.star')}
        </a>
      </footer>
      {newMenu && (
        <Menu x={newMenu.right} y={newMenu.bottom + 6} align="right" onClose={() => setNewMenu(null)} label={t('launcher.new.title')}>
          {KINDS.map((k) => (
            <div key={k.kind} data-new={k.kind} className="mwrap">
              <MenuItem label={t(`launcher.kind.${k.kind}.new`)} icon={
                  <span className={`kic t-${k.tone}`}>
                    <KindIcon kind={k.kind} size={14} />
                  </span>
                }
                onSelect={() => (setNewMenu(null), setCreating(k.kind))} />
            </div>
          ))}
          <div className="msep" role="separator" />
          <div data-new="import" className="mwrap">
            <MenuItem label={t('launcher.importTile.name')} icon={
                <span className="kic t-blue">
                  <IconFileImport size={14} stroke={1.7} aria-hidden="true" />
                </span>
              }
              onSelect={() => (setNewMenu(null), setImporting({}))} />
          </div>
          {(['pptx', 'markdown', 'table', 'zip'] as const).map((format) => (
            <div key={format} data-new={format === 'zip' ? 'archive' : format} className="mwrap">
              <MenuItem label={t(`launcher.archive.${format}`)} hint={t(`launcher.archive.${format}Hint`)} icon={
                  <span className="kic t-blue">
                    {format === 'zip' ? <FileZip /> : <IconFileImport size={14} stroke={1.7} aria-hidden="true" />}
                  </span>
                }
                onSelect={() => (setNewMenu(null), void chooseProjectArchive(format).then((name) => name && open(name)))} />
            </div>
          ))}
          {linksOn && (
            <div data-new="folder" className="mwrap">
              <MenuItem label={t('launcher.folder.menu')} icon={
                  <span className="kic t-blue">
                    <FolderOpen />
                  </span>
                }
                onSelect={() => (setNewMenu(null), setOpening(true))} />
            </div>
          )}
        </Menu>
      )}
      {acting && acted && (
        tab === 'archived' ? (
          <ArchivedActions key={acting.name} p={acted} at={acting} onClose={() => setActing(null)} onRestore={() => setArchivedTo(acted, false)} />
        ) : (
          <ProjectActions key={acting.name} p={acted} at={acting} groups={groups} onClose={() => setActing(null)} onRename={(title) => apply(acting.name, { title })} onMove={(group) => apply(acting.name, { group })} onArchive={() => setArchivedTo(acted, true)} onUnlink={() => unlink(acted)} />
        )
      )}
      {importing && <ImportDialog initial={importing.picked} taken={taken} onClose={() => setImporting(null)} onDone={open} />}
      {creating && <NewDialog initial={creating} taken={taken} at={createAt} onClose={() => (setCreating(null), setCreateAt(undefined))} />}
      {opening && <OpenFolderDialog onClose={() => setOpening(false)} onOpened={() => (setOpening(false), reload())} onCreateHere={(path) => (setOpening(false), setCreateAt(path), setCreating('design'))} />}
    </div>
  );
}
