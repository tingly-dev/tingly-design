import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_BOARD_SIZE, type ProjectKind } from '@dc/core';
import { api, type FolderInfo } from '../../api';
import { toast, useStore } from '../../store';
import { NAME_RE, freeName, slugOf } from '../../projectName';
import { SizePicker } from '../motion/SizePicker';
import { readSizes, rememberSize, sameSize, type Size } from '../motion/motionSizes';
import { BoardSizePicker } from './BoardSizePicker';
import { applyNewOptions, checkDataFile, type NewOptions } from '../../newProject';
import { Dialog } from '../Dialog';
import { KINDS, KindIcon } from './kinds';
import { open } from './recent';

/** A folder written as a full path (`~/…`, `/…`, `C:\…`) rather than a name in the projects folder. */
export const isFolderPath = (v: string) => /^(~($|[\\/])|\/|[A-Za-z]:[\\/])/.test(v);

/** What the server says is at a typed path, asked once the typing pauses. */
function useFolderInfo(path: string | null): FolderInfo | 'checking' | { error: string } | null {
  const [info, setInfo] = useState<FolderInfo | 'checking' | { error: string } | null>(null);
  useEffect(() => {
    if (!path) return setInfo(null);
    setInfo('checking');
    let live = true;
    const timer = setTimeout(() => {
      api.folder(path).then(
        (r) => live && setInfo(r),
        (e: Error) => live && setInfo({ error: e.message }),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [path]);
  return info;
}

export function NewDialog({ initial, taken, onClose, at }: { initial: ProjectKind; taken: Set<string>; onClose: () => void; at?: string }) {
  const { t } = useTranslation();
  const linksOn = useStore((s) => s.health?.links !== false);
  const projectsInRepo = useStore((s) => !!s.health?.projectsInRepo);
  const [git, setGit] = useState(false);
  const [kind, setKind] = useState<ProjectKind>(initial);
  const [title, setTitle] = useState('');
  const [folder, setFolder] = useState<string | null>(at ?? null);
  const [busy, setBusy] = useState(false);
  // a motion piece starts in the size last used (16:9 the first time)
  const [size, setSize] = useState<Size | null>(() => readSizes().last ?? [1920, 1080]);
  // the rest is optional: a design system (canvas, slides), a board size (canvas), a table (dashboard)
  const [systems, setSystems] = useState<{ name: string; title: string }[]>([]);
  const [designSystem, setDesignSystem] = useState('');
  const [board, setBoard] = useState<Size | null>(DEFAULT_BOARD_SIZE);
  const [dataFile, setDataFile] = useState<{ file: File; rows: number } | null>(null);
  const [dataError, setDataError] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  useEffect(() => titleRef.current?.focus(), []);
  useEffect(() => {
    api.projects().then((l) => setSystems(l.filter((p) => p.kind === 'design-system')), () => setSystems([]));
  }, []);
  // the folder is a detail: it follows the title, falls back to the type's name for a title with no
  // letters (Chinese, say), and steps aside for a name that is taken, until the person edits it
  const auto = freeName(slugOf(title) || kind, taken);
  const name = folder ?? auto;
  // a full path puts the project there instead of in the projects folder
  const path = linksOn && isFolderPath(name) ? name : null;
  const info = useFolderInfo(path);
  const sizeBad = (kind === 'motion' && !size) || (kind === 'design' && !board);
  const problem = !name
    ? ''
    : path
      ? info === null || info === 'checking'
        ? ''
        : 'error' in info
          ? info.error
          : info.state === 'project'
            ? t('launcher.new.pathHasProject', { path: info.path })
            : info.state === 'busy'
              ? t('launcher.new.pathBusy', { path: info.path })
              : info.state === 'file'
                ? t('launcher.new.pathFile', { path: info.path })
                : ''
      : !NAME_RE.test(name)
        ? t(linksOn ? 'launcher.new.folderInvalidOrPath' : 'launcher.new.folderInvalid')
        : taken.has(name)
          ? t('launcher.new.folderTaken', { name })
          : '';
  const waiting = !!path && (info === null || info === 'checking');
  // a repository from the start is offered only where the project would not already be in one
  const inRepo = path ? !!info && info !== 'checking' && !('error' in info) && !!info.repo : projectsInRepo;
  const offerGit = !inRepo && !waiting;
  const submit = async () => {
    if (!name || problem || waiting || busy || sizeBad) return;
    setBusy(true);
    try {
      const { name: made, gitError } = await api.createProject(
        path ? { path } : name,
        title.trim() || (path ? path.split(/[\\/]/).filter(Boolean).pop() || kind : name),
        kind,
        kind === 'motion' && size ? size : kind === 'design' && board && !sameSize(board, DEFAULT_BOARD_SIZE) ? board : undefined,
        { git: offerGit && git },
      );
      if (gitError) toast(t('launcher.new.gitFailed', { error: gitError }), 'error');
      if (kind === 'motion' && size) rememberSize(size);
      const opts: NewOptions = {
        designSystem: (kind === 'design' || kind === 'slides') && designSystem ? designSystem : undefined,
        dataFile: kind === 'dashboard' ? dataFile?.file : undefined,
      };
      for (const m of await applyNewOptions(made, opts)) toast(m, 'error');
      open(made);
    } catch (err) {
      setBusy(false);
      toast((err as Error).message, 'error');
    }
  };
  return (
    <Dialog label={t('launcher.new.title')} onClose={onClose} onSubmit={() => void submit()}>
      <div className="kinds" role="radiogroup" aria-label={t('launcher.new.kind')}>
        {KINDS.map((k) => (
          <button type="button" key={k.kind} role="radio" aria-checked={kind === k.kind} data-kind={k.kind} className={`kopt t-${k.tone}`} onClick={() => setKind(k.kind)}>
            <KindIcon kind={k.kind} size={16} />
            <span className="name">{t(`launcher.kind.${k.kind}.name`)}</span>
          </button>
        ))}
      </div>
      <p className="kblurb">{t(`launcher.kind.${kind}.blurb`)}</p>
      <input ref={titleRef} className="input" placeholder={t(`launcher.kind.${kind}.example`)} aria-label={t('launcher.new.titleField')} value={title} onChange={(e) => setTitle(e.target.value)} />
      {kind === 'motion' && <SizePicker value={size} onChange={setSize} />}
      {kind === 'design' && <BoardSizePicker value={board} onChange={setBoard} />}
      {(kind === 'design' || kind === 'slides' || kind === 'dashboard' || offerGit) && (
        <div className="nopts" data-options={kind}>
          <span className="nopt-h">{t('launcher.new.options')}</span>
          {(kind === 'design' || kind === 'slides') && (
            <label className="nopt">
              <span>{t('launcher.new.ds')}</span>
              <select className="input" value={designSystem} onChange={(e) => setDesignSystem(e.target.value)} aria-label={t('launcher.new.ds')}>
                <option value="">{t('launcher.new.dsNone')}</option>
                {systems.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {kind === 'dashboard' && (
            <div className="nopt">
              <span>{t('launcher.new.dataFile')}</span>
              <span className="nopt-file">
                <label className="btn ghost">
                  {dataFile ? dataFile.file.name : t('launcher.new.dataPick')}
                  <input
                    type="file"
                    hidden
                    accept=".csv,.tsv,.json"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (!f) return;
                      const r = await checkDataFile(f);
                      if ('error' in r) return setDataError(r.error), setDataFile(null);
                      setDataError('');
                      setDataFile({ file: f, rows: r.rows });
                    }}
                  />
                </label>
                {dataFile && (
                  <>
                    <span className="hint">{t('launcher.new.dataRows', { count: dataFile.rows })}</span>
                    <button type="button" className="linkish" onClick={() => setDataFile(null)}>
                      {t('launcher.new.dataClear')}
                    </button>
                  </>
                )}
              </span>
              {dataError && <span className="nopt-err">{dataError}</span>}
            </div>
          )}
          {offerGit && (
            <label className="nopt nopt-check" data-git="">
              <input type="checkbox" checked={git} onChange={(e) => setGit(e.target.checked)} />
              <span>{t('launcher.new.git')}</span>
              <span className="hint">{t('launcher.new.gitHint')}</span>
            </label>
          )}
        </div>
      )}
      <div className="where">
        {folder === null ? (
          <>
            <span className="path" data-folder={name}>
              projects/{name}
            </span>
            <button
              type="button"
              className="linkish"
              onClick={() => {
                setFolder(name);
                setTimeout(() => folderRef.current?.focus());
              }}
            >
              {t('launcher.new.folderEdit')}
            </button>
          </>
        ) : (
          <span className="folder">
            {!path && <span className="pre">projects/</span>}
            <input ref={folderRef} className="input" aria-label={t('launcher.new.folderLabel')} value={folder} onChange={(e) => setFolder(e.target.value.trim())} />
          </span>
        )}
      </div>
      {folder !== null && linksOn && (
        <div className="where-hint" data-where={path ? 'path' : 'name'}>
          {path && info && info !== 'checking' && !('error' in info) && info.state === 'free' ? t('launcher.new.pathFree', { path: info.path }) : t('launcher.new.folderHint')}
        </div>
      )}
      <div className={`problem${problem ? ' on' : ''}`} role="alert">
        {problem}
      </div>
      <footer>
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button className="btn primary" type="submit" disabled={!name || !!problem || waiting || busy || sizeBad}>
          {t(`launcher.kind.${kind}.create`)}
        </button>
      </footer>
    </Dialog>
  );
}

/**
 * Opens a project folder that lives anywhere on disk. The folder stays where it is; the
 * launcher only remembers it. A folder with no project yet leads to New project, aimed there.
 */
export function OpenFolderDialog({ onClose, onCreateHere }: { onClose: () => void; onCreateHere: (path: string) => void }) {
  const { t } = useTranslation();
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const typed = path.trim();
  const usable = isFolderPath(typed);
  const info = useFolderInfo(usable ? typed : null);
  const ready = !!info && info !== 'checking' && !('error' in info);
  const submit = async () => {
    if (!ready || busy) return;
    if (info.state === 'free') return onCreateHere(typed);
    if (info.state !== 'project') return;
    setBusy(true);
    try {
      open((await api.link(typed)).name);
    } catch (e) {
      setBusy(false);
      toast((e as Error).message, 'error');
    }
  };
  const status = !typed
    ? t('launcher.folder.hint')
    : !usable
      ? t('launcher.folder.needPath')
      : !info || info === 'checking'
        ? t('launcher.folder.checking')
        : 'error' in info
          ? info.error
          : info.state === 'project'
            ? info.name
              ? t('launcher.folder.listed', { kind: t(`launcher.kind.${info.kind!}.name`), name: info.name })
              : t('launcher.folder.found', { kind: t(`launcher.kind.${info.kind!}.name`) })
            : info.state === 'free'
              ? t('launcher.folder.empty', { path: info.path })
              : info.state === 'busy'
                ? t('launcher.folder.noProject', { path: info.path })
                : t('launcher.new.pathFile', { path: info.path });
  return (
    <Dialog label={t('launcher.folder.title')} className="lopen" onClose={onClose} onSubmit={() => void submit()}>
      <p className="kblurb">{t('launcher.folder.blurb')}</p>
      <input autoFocus className="input mono" aria-label={t('launcher.folder.label')} placeholder={t('launcher.folder.placeholder')} value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} />
      <div className={`folder-state${ready ? ` s-${info.state}` : ''}`} role="status" data-state={ready ? info.state : undefined}>
        {ready && info.state === 'project' && <KindIcon kind={info.kind!} size={14} />}
        <span>{status}</span>
      </div>
      <footer>
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button className="btn primary" type="submit" disabled={!ready || busy || (info.state !== 'project' && info.state !== 'free')}>
          {ready && info.state === 'free' ? t('launcher.folder.createHere') : t('launcher.folder.open')}
        </button>
      </footer>
    </Dialog>
  );
}
