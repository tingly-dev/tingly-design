import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectCard } from '@dc/core';
import { api } from '../api';
import { at } from '../base';
import { useStore } from '../store';
import { ISSUES_URL, REPO_URL } from '../links';
import { Bug, Caret, External, Home, Plus, Sliders, Star } from './icons';
import { Menu, MenuItem } from './Menu';
import { KindIcon, NewDialog, open, readRecent } from './Launcher';

const SHOWN = 8;

/** The projects to offer next, the way the launcher orders them: last opened first, then last changed. */
function nextUp(list: ProjectCard[], current: string | null): ProjectCard[] {
  const recent = readRecent();
  const rank = (p: ProjectCard) => {
    const i = recent.indexOf(p.name);
    return i < 0 ? Infinity : i;
  };
  return list
    .filter((p) => p.name !== current)
    .sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.name.localeCompare(b.name))
    .slice(0, SHOWN);
}

/**
 * The way out of a project, in every kind's editor: a home button that goes straight to the launcher,
 * and next to it a menu to jump to another project, start one, or reach the repository to report
 * an issue or star it. Rendered by each kind's own bar, so no kind needs the launcher to move around.
 */
export function ProjectMenu() {
  const { t } = useTranslation();
  const kind = useStore((st) => st.kind);
  const current = new URLSearchParams(location.search).get('p');
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [list, setList] = useState<ProjectCard[] | null>(null);
  const [all, setAll] = useState<ProjectCard[]>([]);
  const [creating, setCreating] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const others = useMemo(() => nextUp(list ?? [], current), [list, current]);
  const toggle = () => {
    if (pos) return setPos(null);
    const r = btn.current?.getBoundingClientRect();
    setPos({ x: r?.left ?? 0, y: (r?.bottom ?? 0) + 8 });
    api.projects().then(
      (l) => {
        setList(l);
        setAll(l);
      },
      () => setList([]),
    );
  };
  return (
    <span className="pmenu">
      <a className="tb" href={at('')} aria-label={t('launcher.projectMenu.home')} title={t('launcher.projectMenu.home')}>
        <Home />
      </a>
      <button ref={btn} className="tb" aria-haspopup="menu" aria-expanded={!!pos} aria-label={t('launcher.projectMenu.switch')} title={t('launcher.projectMenu.switch')} onClick={toggle}>
        <Caret />
      </button>
      {pos && (
        <Menu {...pos} onClose={() => setPos(null)} label={t('launcher.projectMenu.switch')}>
          <MenuItem label={t('launcher.allProjects')} icon={<Home />} onSelect={() => (location.href = at(''))} />
          {others.length > 0 && <div className="head">{t('launcher.projectMenu.jump')}</div>}
          {others.map((p) => (
            <MenuItem key={p.name} label={p.title || p.name} icon={<KindIcon kind={p.kind} size={14} />} onSelect={() => open(p.name)} />
          ))}
          {list === null && <div className="head">{t('launcher.loading')}</div>}
          <hr />
          <MenuItem
            label={t('launcher.new.title')}
            icon={<Plus />}
            onSelect={() => {
              setPos(null);
              setCreating(true);
            }}
          />
          <hr />
          <MenuItem
            label={t('aiSettings.menu')}
            icon={<Sliders />}
            onSelect={() => {
              setPos(null);
              useStore.setState({ aiSettingsOpen: true });
            }}
          />
          <hr />
          <a className="mi" role="menuitem" href={ISSUES_URL} target="_blank" rel="noopener noreferrer" onClick={() => setPos(null)}>
            <span className="ic">
              <Bug />
            </span>
            {t('launcher.links.report')}
            <span className="k">
              <External />
            </span>
          </a>
          <a className="mi" role="menuitem" href={REPO_URL} target="_blank" rel="noopener noreferrer" onClick={() => setPos(null)}>
            <span className="ic">
              <Star />
            </span>
            {t('launcher.links.star')}
            <span className="k">
              <External />
            </span>
          </a>
        </Menu>
      )}
      {creating && <NewDialog initial={kind ?? 'design'} taken={new Set(all.map((p) => p.name))} onClose={() => setCreating(false)} />}
    </span>
  );
}
