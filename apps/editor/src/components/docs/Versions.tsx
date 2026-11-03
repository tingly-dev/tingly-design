import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { diffBlocks, tabFile } from '@dc/core';
import { api } from '../../api';
import { display, toast, useStore } from '../../store';
import { saveTab } from './docs';
import { Segmented } from '../Segmented';

/** The kept earlier versions of the open tab: pick one to read it or compare it with the tab now, restore it as a normal edit (what it replaces is kept first, so a restore can be restored in turn). */
export function Versions({ tab, onClose }: { tab: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const project = useStore((s) => s.project);
  const file = tabFile(tab);
  const current = useStore((s) => display(s, file)) ?? '';
  const [list, setList] = useState<{ id: string; at: string }[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [view, setView] = useState<'text' | 'changes'>('text');

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

  const diff = useMemo(() => (picked && text && view === 'changes' ? diffBlocks(text, current) : null), [picked, text, view, current]);
  const same = diff !== null && !diff.some((d) => d.kind !== 'same');

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
          <Segmented
            label={t('docs.versions.title')}
            data="versions-view"
            value={view}
            onChange={setView}
            options={[
              { value: 'text', label: t('docs.versions.text') },
              { value: 'changes', label: t('docs.versions.changes') },
            ]}
          />
          {view === 'text' ? (
            <pre className="vtext">{text}</pre>
          ) : same ? (
            <p className="empty">{t('docs.versions.same')}</p>
          ) : (
            <div className="vdiff">
              {diff!.map((d, i) => (
                <div key={i} className={d.kind === 'same' ? 'vblock' : `vblock d-${d.kind}`}>
                  {d.text}
                </div>
              ))}
            </div>
          )}
          <button className="btn primary sm" disabled={!text} onClick={() => void restore()}>
            {t('docs.versions.restore')}
          </button>
        </>
      )}
    </div>
  );
}
