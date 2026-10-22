import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tabFile } from '@dc/core';
import { api } from '../../api';
import { toast, useStore } from '../../store';
import { saveTab } from './docs';

/** The kept earlier versions of the open tab: pick one to read it, restore it as a normal edit (what it replaces is kept first, so a restore can be restored in turn). */
export function Versions({ tab, onClose }: { tab: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const project = useStore((s) => s.project);
  const [list, setList] = useState<{ id: string; at: string }[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [text, setText] = useState('');
  const file = tabFile(tab);

  useEffect(() => {
    if (!project) return;
    let live = true;
    api.history(project, file).then((l) => live && setList(l), () => live && setList([]));
    return () => {
      live = false;
    };
  }, [project, file]);

  const latest = useRef('');
  const pick = async (id: string) => {
    if (!project) return;
    latest.current = id;
    setPicked(id);
    setText('');
    try {
      const { content } = await api.historyItem(project, file, id);
      if (latest.current === id) setText(content);
    } catch (err) {
      if (latest.current === id) toast((err as Error).message || t('docs.versions.failed'), 'error');
    }
  };
  const restore = async () => {
    if (!project) return;
    await api.keepVersion(project, file).catch(() => undefined);
    saveTab(tab, text, 'human', t('docs.versions.journal'));
    toast(t('docs.versions.restored'));
    onClose();
  };

  return (
    <div className="popmenu versions" role="dialog" aria-label={t('docs.versions.title')}>
      <label>{t('docs.versions.title')}</label>
      {list && !list.length && <p className="empty">{t('docs.versions.empty')}</p>}
      <div className="vlist">
        {(list ?? []).map((v) => (
          <button key={v.id} aria-pressed={picked === v.id} onClick={() => void pick(v.id)}>
            {new Date(v.at).toLocaleString(i18n.language)}
          </button>
        ))}
      </div>
      {picked && (
        <>
          <pre className="vtext">{text}</pre>
          <button className="btn primary sm" disabled={!text} onClick={() => void restore()}>
            {t('docs.versions.restore')}
          </button>
        </>
      )}
    </div>
  );
}
