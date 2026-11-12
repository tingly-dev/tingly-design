import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type TrashedProject } from '@dc/core';
import { api } from '../../api';
import { toast } from '../../store';
import { Dialog } from '../Dialog';
import { askConfirm } from '../ConfirmDialog';
import { KIND, KindIcon } from './kinds';
import { ago } from './ProjectCards';

/** Deleted projects: each can come back whole, or be deleted for good (the one step that asks). */
export function TrashDialog({ initial, onClose, onChanged }: { initial: TrashedProject[]; onClose: () => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<TrashedProject[]>(initial);
  useEffect(() => {
    if (!items.length) onClose();
  }, [items.length, onClose]);
  const fail = (e: Error) => toast(e.message, 'error');
  const restore = (p: TrashedProject) =>
    api.restoreTrashed(p.id).then((r) => {
      const title = p.title || p.name;
      setItems((l) => l.filter((x) => x.id !== p.id));
      onChanged();
      toast(r.name === p.name ? t('launcher.trash.restored', { title }) : t('launcher.trash.restoredAs', { title, name: r.name }), 'info');
    }, fail);
  const forever = async (p: TrashedProject) => {
    if (!(await askConfirm(t('launcher.trash.foreverAsk', { title: p.title || p.name }), t('launcher.trash.forever')))) return;
    api.purgeTrashed(p.id).then(() => (setItems((l) => l.filter((x) => x.id !== p.id)), onChanged()), fail);
  };
  const emptyAll = async () => {
    if (!(await askConfirm(t('launcher.trash.emptyAsk'), t('launcher.trash.emptyAll')))) return;
    api.purgeTrashed().then(() => (setItems([]), onChanged()), fail);
  };
  return (
    <Dialog label={t('launcher.trash.title')} className="trashdlg" onClose={onClose}>
      <p className="trashhint">{t('launcher.trash.hint')}</p>
      <ul className="trashlist" data-trash-list>
        {items.map((p) => (
          <li key={p.id} data-trashed={p.name} className={`t-${KIND[p.kind].tone}`}>
            <span className="kic">
              <KindIcon kind={p.kind} size={14} />
            </span>
            <span className="tname">
              <span className="name">{p.title || p.name}</span>
              <span className="when">{t('launcher.trash.deletedAgo', { when: ago(t, p.deletedAt) })}</span>
            </span>
            <button type="button" className="btn sm outline" data-restore={p.name} onClick={() => void restore(p)}>
              {t('launcher.trash.restore')}
            </button>
            <button type="button" className="btn sm ghost danger" data-forever={p.name} onClick={() => void forever(p)}>
              {t('launcher.trash.forever')}
            </button>
          </li>
        ))}
      </ul>
      <footer>
        <button type="button" className="btn ghost danger" onClick={() => void emptyAll()}>
          {t('launcher.trash.emptyAll')}
        </button>
        <button type="button" className="btn outline" onClick={onClose}>
          {t('common.close')}
        </button>
      </footer>
    </Dialog>
  );
}
