import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ISSUES_URL, REPO_URL } from '../links';
import { Bug, Star } from './icons';
import { LanguageMenu, Appearance } from './Appearance';
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
 * belong to the product and not to the project, so they are always one click away: report an issue,
 * star the repository, the language and the look of the editor. Floating tool bars (canvas, slides)
 * keep only tools; nothing about the project lives anywhere else.
 */
export function TopBar({ title, children }: { title: ReactNode; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <header className="topbar dashbar" role="banner" aria-label={t('common.topbar.label')}>
      <ProjectMenu />
      {title}
      <SyncStatus />
      <div className="grow" />
      {children}
      <span className="tsep" />
      <span className="tend">
        <a className="tb" href={ISSUES_URL} target="_blank" rel="noopener noreferrer" aria-label={t('launcher.links.report')} title={t('launcher.links.report')} data-link="report">
          <Bug />
        </a>
        <a className="tb" href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label={t('launcher.links.star')} title={t('launcher.links.star')} data-link="star">
          <Star />
        </a>
        <LanguageMenu className="tb" />
        <Appearance className="tb" />
      </span>
    </header>
  );
}
