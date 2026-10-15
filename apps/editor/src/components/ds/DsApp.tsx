import { useEffect, useMemo, useState } from 'react';
import { DS_README, compileTokensCss, componentNames, dsGlance, sectionFiles } from '@dc/core';
import { AskClaude } from '../AskClaude';
import { display, edit, isSaving, toast, useStore } from '../../store';
import { dsImport, editDsIndex, useDsIndex, useTokens } from '../../ds';
import { ImportHere } from '../ImportHere';
import { ProjectMenu } from '../ProjectMenu';
import { Picture } from '../icons';
import { fileStem, nodeToPng, saveImage } from '../../imageExport';
import { ColorsView, FamiliesView, TypeView } from './TokenViews';
import { AssetsView, ComponentsView, Markdown, Preview } from './ComponentViews';
import { JournalPopover } from '../Overlays';
import { Specimen } from './Specimen';
import { currentTheme } from '../../theme';
import { replaceUrl } from '../../host';
import { useTranslation } from 'react-i18next';

type View = 'overview' | 'colors' | 'type' | 'space' | 'components' | 'assets' | 'issues';

const VIEWS: Exclude<View, 'issues'>[] = ['overview', 'colors', 'type', 'space', 'components', 'assets'];

/** One brand-book section: rendered, or edited as markdown. */
function Section({ path }: { path: string }) {
  const { t: tr } = useTranslation();
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
              {tr('common.cancel')}
            </button>
            <button
              className="btn primary"
              onClick={() => {
                if (draft !== text) edit(path, () => draft, { actor: 'human', summary: `${path} edited` });
                setEditing(false);
              }}
            >
              {tr('common.save')}
            </button>
          </>
        ) : (
          <button className="btn ghost" onClick={() => setEditing(true)}>
            {tr('common.edit')}
          </button>
        )}
      </div>
      {editing ? (
        <textarea className="code mdedit" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-label={tr('ds.section.editLabel', { path })} spellCheck={false} />
      ) : text.trim() ? (
        <Markdown text={text} />
      ) : (
        <p className="hint">{tr('ds.section.empty')}</p>
      )}
    </div>
  );
}

function Overview({ theme }: { theme: string }) {
  const { t: tr } = useTranslation();
  const t = useTokens();
  const index = useDsIndex();
  const files = useStore((s) => s.files);
  const cover = useStore((s) => display(s, 'components/Cover/preview.html'));
  const sections = useMemo(() => {
    const list = sectionFiles(Object.keys(files));
    return list.includes(DS_README) ? list : [DS_README, ...list];
  }, [files]);
  const bundle = useStore((s) => display(s, 'components/bundle.js'));
  const glance = useMemo(() => dsGlance(t), [t]);
  const alt = useMemo(() => (t.themes[1] ? { name: t.themes[1].name, glance: dsGlance(t, t.themes[1].id) } : undefined), [t]);
  const components = useMemo(() => componentNames(Object.keys(files), bundle).length, [files, bundle]);
  const stack = (f?: string) => f?.split(',')[0].replace(/["']/g, '').trim();
  return (
    <section className="dsview" aria-label={tr('ds.nav.overview')}>
      <div className="glance">
        <Specimen glance={glance} alt={alt} themeName={t.themes[0]?.name} title={index.title} />
        <div className="gfacts">
          <p>{tr('ds.glance.what')}</p>
          <dl>
            <dt>{tr('ds.glance.faces')}</dt>
            <dd>
              <span style={{ fontFamily: glance.headingFont }}>{stack(glance.headingFont) ?? '–'}</span> · {tr('ds.glance.heading')}
              {glance.bodyFont && glance.bodyFont !== glance.headingFont && (
                <>
                  <br />
                  <span style={{ fontFamily: glance.bodyFont }}>{stack(glance.bodyFont)}</span> · {tr('ds.glance.body')}
                </>
              )}
            </dd>
            <dt>{tr('ds.glance.shape')}</dt>
            <dd>
              {tr('ds.glance.radius')} {glance.radius ?? tr('ds.glance.none')} · {tr('ds.glance.shadow')} {glance.shadow ? '✓' : tr('ds.glance.none')}
            </dd>
            <dt>{tr('ds.glance.themes')}</dt>
            <dd>{glance.themes.join(' / ') || '–'}</dd>
          </dl>
          <div className="gcount">
            <span>{tr('ds.glance.colorsN', { count: glance.colors })}</span>
            <span>{tr('ds.glance.typeN', { count: glance.typeStyles })}</span>
            <span>{tr('ds.glance.tokensN', { count: glance.tokens })}</span>
            <span>{tr('ds.glance.componentsN', { count: components })}</span>
          </div>
        </div>
      </div>
      {t.colors.length > 0 && (
        <div className="gpalette" aria-label={tr('ds.glance.palette')}>
          {t.colors.map((c) => (
            <span key={c.name} className="gsw" title={c.name}>
              <i style={{ background: c.values[theme] ?? Object.values(c.values)[0] }} />
              <b>{c.name}</b>
            </span>
          ))}
        </div>
      )}
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
  const { t: tr } = useTranslation();
  const t = useTokens();
  return (
    <section className="dsview" aria-label={tr('ds.nav.issues')}>
      <header>
        <h2>{tr('ds.issues.title')}</h2>
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
        <p className="hint">{tr('ds.issues.none')}</p>
      )}
    </section>
  );
}

export function DsApp() {
  const { t: tr } = useTranslation();
  const t = useTokens();
  const index = useDsIndex();
  const connected = useStore((s) => s.connected);
  const saving = useStore(isSaving);
  const journalOpen = useStore((s) => s.journalOpen);
  const [view, setView] = useState<View>(() => (new URLSearchParams(location.search).get('v') as View) || 'overview');
  // previews open in the system's dark theme when the editor itself is dark
  const [theme, setTheme] = useState(() => (currentTheme()?.theme.scheme === 'dark' && t.themes.find((x) => /dark|night|\u6697|\u6df1/i.test(`${x.id} ${x.name}`))?.id) || t.themes[0].id);
  const [renaming, setRenaming] = useState(false);
  useEffect(() => {
    if (!t.themes.some((x) => x.id === theme)) setTheme(t.themes[0].id);
  }, [t, theme]);
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set('v', view);
    replaceUrl(url);
  }, [view]);
  useEffect(() => {
    document.title = tr('ds.app.docTitle', { title: index.title });
  }, [index.title, tr]);
  // the system's own faces and tokens, for samples on this page
  const pageCss = useMemo(() => compileTokensCss({ ...t, colors: [], others: [], groups: [] }), [t]);
  return (
    <div className="app ds" data-theme={theme}>
      <style>{pageCss}</style>
      <nav className="dsnav" aria-label={tr('ds.app.label')}>
        <ProjectMenu />
        {renaming ? (
          <input
            className="dstitle"
            autoFocus
            defaultValue={index.title}
            aria-label={tr('ds.app.nameLabel')}
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
          <h1 className="dstitle" title={tr('ds.app.renameHint')} onDoubleClick={() => setRenaming(true)}>
            {index.title}
          </h1>
        )}
        <div className="hint ns">window.{index.namespace}</div>
        {VIEWS.map((v) => (
          <button key={v} className="navi" aria-current={view === v ? 'page' : undefined} onClick={() => setView(v)}>
            {tr(`ds.nav.${v}`)}
            <span className="cnt">
              {v === 'colors' ? t.colors.length : v === 'type' ? t.groups.reduce((n, g) => n + g.styles.length, 0) : v === 'space' ? t.others.reduce((n, f) => n + f.tokens.length, 0) : ''}
            </span>
          </button>
        ))}
        {t.issues.length > 0 && (
          <button className="navi warn" aria-current={view === 'issues' ? 'page' : undefined} onClick={() => setView('issues')}>
            {tr('ds.nav.issues')} <span className="cnt">{t.issues.length}</span>
          </button>
        )}
        <div className="navfoot">
          {t.themes.length > 1 && (
            <label className="themes">
              {tr('ds.app.theme')}
              <select value={theme} onChange={(e) => setTheme(e.target.value)} aria-label={tr('ds.app.theme')}>
                {t.themes.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <ImportHere target={dsImport} label={tr('ds.app.label')} />
          <button
            className="tb"
            aria-label={tr('common.image.save')}
            title={tr('common.image.saveHint')}
            onClick={() => {
              const node = document.querySelector<HTMLElement>('.dsmain .dsview');
              const bg = getComputedStyle(document.querySelector('.app.ds')!).backgroundColor;
              if (node) void saveImage(`${fileStem(index.title, 'design-system')}-${view}.png`, () => nodeToPng(node, { backgroundColor: bg, width: node.offsetWidth, style: { margin: '0' } }));
            }}
          >
            <Picture />
          </button>
          <button className="tb" aria-pressed={journalOpen} aria-label={tr('ds.app.journal')} onClick={() => useStore.setState({ journalOpen: !journalOpen })}>
            <span className="sync">
              <span className={`dot ${!connected ? 'off' : saving ? 'busy' : ''}`} />
              {!connected ? tr('ds.app.offline') : saving ? tr('ds.app.saving') : tr('ds.app.synced')}
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
