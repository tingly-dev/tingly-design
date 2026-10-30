import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectCard } from '@dc/core';
import { api, type FolderGroup, type Reference } from '../api';
import { toast, useStore } from '../store';
import { Dialog } from './Dialog';
import { FolderOpen } from './icons';
import { KindIcon } from './launcher/kinds';

/** One thing that can be consulted: where it is, what to call it, and what it is. */
interface Choice {
  path: string;
  title: string;
  kind?: ProjectCard['kind'];
  members?: number;
}

/**
 * The other work Claude may read while it works on this project: a list of the opened folders and the
 * other projects with a checkbox each. A change is saved at once (there is no Save to forget), and
 * Claude Code is given these folders to read, never to change, with every request (.design/folder-groups.md).
 */
export function ReferencesDialog({ project, onClose, onCount }: { project: string; onClose: () => void; onCount: (n: number) => void }) {
  const { t } = useTranslation();
  const projectsPath = useStore((s) => s.health?.projectsPath);
  const [refs, setRefs] = useState<Reference[] | null>(null);
  const [folders, setFolders] = useState<FolderGroup[]>([]);
  const [projects, setProjects] = useState<ProjectCard[]>([]);
  useEffect(() => {
    api.references(project).then(setRefs, (e) => (setRefs([]), toast(e.message, 'error')));
    api.folders().then(setFolders, () => {});
    api.projects().then(setProjects, () => {});
  }, [project]);
  const chosen = useMemo(() => new Set((refs ?? []).map((r) => r.path)), [refs]);
  const folderChoices: Choice[] = folders.map((f) => ({ path: f.path, title: f.path.split('/').filter(Boolean).pop() ?? f.path, members: f.members.length }));
  const projectChoices: Choice[] = projects
    .filter((p) => p.name !== project)
    .map((p) => ({ path: p.path ?? `${projectsPath ?? ''}/${p.name}`, title: p.title || p.name, kind: p.kind }));
  const gone = (refs ?? []).filter((r) => r.state === 'missing');
  const save = (paths: string[]) =>
    api.setReferences(project, paths).then(
      (next) => (setRefs(next), onCount(next.length)),
      (e) => toast(e.message, 'error'),
    );
  const toggle = (path: string) => void save(chosen.has(path) ? [...chosen].filter((p) => p !== path) : [...chosen, path]);
  const row = (c: Choice, icon: React.ReactNode) => (
    <li key={c.path}>
      <label className="refrow">
        <input type="checkbox" checked={chosen.has(c.path)} onChange={() => toggle(c.path)} aria-label={t(chosen.has(c.path) ? 'launcher.refs.remove' : 'launcher.refs.add', { title: c.title })} />
        {icon}
        <span className="rname">{c.title}</span>
        <span className="rpath mono">{c.members !== undefined ? t('launcher.refs.members', { count: c.members }) : c.path}</span>
      </label>
    </li>
  );
  return (
    <Dialog label={t('launcher.refs.title')} className="refsdlg" onClose={onClose}>
      <p className="kblurb">{t('launcher.refs.blurb')}</p>
      {refs === null ? (
        <p className="refnote">{t('launcher.refs.loading')}</p>
      ) : (
        <>
          {!folderChoices.length && !projectChoices.length && <p className="refnote">{t('launcher.refs.noneToAdd')}</p>}
          {folderChoices.length > 0 && (
            <section aria-label={t('launcher.refs.folders')}>
              <h3>{t('launcher.refs.folders')}</h3>
              <ul>{folderChoices.map((c) => row(c, <FolderOpen />))}</ul>
            </section>
          )}
          {projectChoices.length > 0 && (
            <section aria-label={t('launcher.refs.projects')}>
              <h3>{t('launcher.refs.projects')}</h3>
              <ul>{projectChoices.map((c) => row(c, <KindIcon kind={c.kind!} size={14} />))}</ul>
            </section>
          )}
          {gone.length > 0 && (
            <ul>
              {gone.map((r) => (
                <li key={r.path}>
                  <label className="refrow gone">
                    <input type="checkbox" checked onChange={() => toggle(r.path)} aria-label={t('launcher.refs.remove', { title: r.path })} />
                    <span className="rname mono">{r.path}</span>
                    <span className="rpath">{t('launcher.refs.missing')}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <footer>
        <button type="button" className="btn primary" onClick={onClose}>
          {t('common.done')}
        </button>
      </footer>
    </Dialog>
  );
}
