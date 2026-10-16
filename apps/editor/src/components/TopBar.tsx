import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ISSUES_URL, REPO_URL } from '../links';
import { Bug, Check, External, More, Panel, Star } from './icons';
import { useStore } from '../store';
import { Menu, MenuItem } from './Menu';
import { PRESET_IDS, currentTheme, onTheme, pickTheme, type ThemeMode } from '../theme';
import { SUPPORTED_LANGUAGES, chooseLanguage, currentLanguage } from '../i18n';
import { ProjectMenu } from './ProjectMenu';
import { SyncStatus } from './SyncStatus';

/**
 * The name of the project in the bar, renamed in place with a double click. Every kind hands its own
 * label, hint and what to do with the new name, so a kind keeps its own wording and journal entry.
 */
export function ProjectTitle({ value, label, hint, onRename }: { value: string; label: string; hint: string; onRename: (v: string) => void }) {
  const [renaming, setRenaming] = useState(false);
  if (renaming)
    return (
      <input
        className="dashtitle"
        autoFocus
        defaultValue={value}
        aria-label={label}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setRenaming(false);
        }}
        onBlur={(e) => {
          setRenaming(false);
          const v = e.currentTarget.value.trim();
          if (v && v !== value) onRename(v);
        }}
      />
    );
  return (
    <h1 className="dashtitle" title={hint} onDoubleClick={() => setRenaming(true)}>
      {value}
    </h1>
  );
}

/**
 * The one top bar of every editor, in the same place with the same ends: the way out of the project,
 * its name and whether it is saved on the left; what this kind of project does in the middle and to
 * the right (`children`: view switches, import / export, panels); and at the far end the things that
 * belong to the product and not to the project, behind one "more" button: report an issue,
 * star the repository, the language and the look of the editor. Floating tool bars (canvas, slides)
 * keep only tools; nothing about the project lives anywhere else.
 */
/** An icon button for the bar: grey like every other control in it, lit only while what it opens is open. The name is the tooltip. */
export function BarButton({ icon, label, title, on, badge, onClick, ...rest }: { icon: ReactNode; label: string; title?: string; on?: boolean; badge?: ReactNode; onClick: () => void } & Record<`data-${string}`, string | undefined>) {
  return (
    <button className="tb" aria-pressed={on} aria-label={label} title={title ?? label} onClick={onClick} {...rest}>
      {icon}
      {badge}
    </button>
  );
}

const MODES: ThemeMode[] = ['system', ...PRESET_IDS];

/**
 * What belongs to the product and is rarely used, behind one button: report an issue, star the
 * repository, the language and the look of the editor. A person who wants one knows what it is
 * called; the bar does not need four more icons to say so.
 */
function MoreMenu() {
  const { t } = useTranslation();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const theme = useSyncExternalStore(onTheme, currentTheme);
  const lang = currentLanguage();
  const close = () => setPos(null);
  const link = (href: string, icon: ReactNode, label: string, key: string) => (
    <a className="mi" role="menuitem" href={href} target="_blank" rel="noopener noreferrer" data-link={key} onClick={close}>
      <span className="ic">{icon}</span>
      {label}
      <span className="k">
        <External />
      </span>
    </a>
  );
  return (
    <>
      <button
        ref={btn}
        className="tb"
        aria-haspopup="menu"
        aria-expanded={!!pos}
        aria-label={t('common.topbar.more')}
        title={t('common.topbar.more')}
        data-more=""
        onClick={() => {
          const r = btn.current!.getBoundingClientRect();
          setPos(pos ? null : { x: r.right, y: r.bottom + 8 });
        }}
      >
        <More />
      </button>
      {pos && (
        <Menu x={pos.x} y={pos.y} align="right" label={t('common.topbar.more')} onClose={close}>
          {link(ISSUES_URL, <Bug />, t('launcher.links.report'), 'report')}
          {link(REPO_URL, <Star />, t('launcher.links.star'), 'star')}
          <hr />
          <div className="head">{t('appearance.language')}</div>
          {SUPPORTED_LANGUAGES.map((l) => (
            <button key={l.code} className="mi" role="menuitemradio" aria-checked={lang === l.code} data-lang={l.code} lang={l.code} onClick={() => (chooseLanguage(l.code), close())}>
              <span className="ic">{lang === l.code && <Check />}</span>
              {l.label}
            </button>
          ))}
          {theme && (
            <>
              <hr />
              <div className="head">{t('appearance.theme')}</div>
              {MODES.map((m) => (
                <MenuItem key={m} label={t(`appearance.mode.${m}`)} checked={theme.theme.mode === m} onSelect={() => (pickTheme(m), close())} />
              ))}
            </>
          )}
        </Menu>
      )}
    </>
  );
}

/** The kind's own actions go in `children`; `panel` adds the right-panel toggle at their end, the same button in every kind that has a panel. */
export function TopBar({ title, panel, children }: { title: ReactNode; panel?: { label: string; hint: string }; children?: ReactNode }) {
  const { t } = useTranslation();
  const panelOpen = useStore((s) => s.panelOpen);
  return (
    <header className="topbar dashbar" role="banner" aria-label={t('common.topbar.label')}>
      <ProjectMenu />
      {title}
      <SyncStatus />
      <div className="grow" />
      {children}
      {panel && (
        <button className="tb" aria-pressed={panelOpen} aria-label={panel.label} title={panel.hint} onClick={() => useStore.setState({ panelOpen: !panelOpen })}>
          <Panel />
        </button>
      )}
      <span className="tsep" />
      <MoreMenu />
    </header>
  );
}
