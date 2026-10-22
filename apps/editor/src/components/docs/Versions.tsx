import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tabFile } from '@dc/core';
import { api } from '../../api';
import { toast, useStore } from '../../store';
import { saveTab } from './docs';

/** The kept earlier versions of the open tab: pick one to read it, restore it as a normal edit (so undo still works). */
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

  const pick = async (id: string) => {
    if (!project) return;
    setPicked(id);
    try {
      setText((await api.historyItem(project, file, id)).content);
    } catch (err) {
      setText('');
      toast((err as Error).message || t('docs.versions.failed'), 'error');
    }
  };
  const restore = () => {
    saveTab(tab, text, 'human', `${file} restored`);
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
          <pre className="vtext">{text.slice(0, 4000)}</pre>
          <button className="btn primary sm" disabled={!text} onClick={restore}>
            {t('docs.versions.restore')}
          </button>
        </>
      )}
    </div>
  );
}
