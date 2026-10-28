import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconArrowUp, IconHome } from '@tabler/icons-react';
import { api, type BrowseResult } from '../../api';
import { Dialog } from '../Dialog';
import { GroupFolder } from '../icons';
import { KindIcon } from './kinds';

/** A path is read from its end, where the folder's own name is: a box that is not being typed in shows that end. */
export const showEnd = (e: { currentTarget: HTMLInputElement }) => {
  e.currentTarget.scrollLeft = e.currentTarget.scrollWidth;
};
export function useShowEnd(value: string) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el) el.scrollLeft = el.scrollWidth;
  }, [value]);
  return ref;
}

/**
 * Browses the computer's folders (the server lists them; a browser cannot) and hands back the
 * one chosen, as a full path. Starts at `start` (a typed path, or the home folder when empty).
 */
export function FolderPicker({ start, onPick, onClose }: { start: string; onPick: (path: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [at, setAt] = useState<BrowseResult | null>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const seq = useRef(0);
  // what the person has typed is theirs: an answer that was already on its way does not write over it
  const typing = useRef(false);
  const bar = useShowEnd(typed);
  const go = (path: string, own = false) => {
    if (own) typing.current = false;
    const mine = ++seq.current;
    api.browse(path).then(
      (r) => {
        if (mine !== seq.current) return;
        setAt(r);
        if (!typing.current) setTyped(r.path);
        setError('');
      },
      (e: Error) => mine === seq.current && setError(e.message),
    );
  };
  useEffect(() => go(start), []); // eslint-disable-line react-hooks/exhaustive-deps
  const child = (name: string) => (at ? `${at.abs}${at.abs.endsWith(at.sep) ? '' : at.sep}${name}` : name);
  return (
    <Dialog label={t('launcher.folder.pickerTitle')} className="lpicker" onClose={onClose} onSubmit={() => at && onPick(at.path)}>
      <div className="picker-bar">
        <button type="button" className="ib" title={t('launcher.folder.pickerUp')} aria-label={t('launcher.folder.pickerUp')} disabled={!at?.parent} onClick={() => at?.parent && go(at.parent, true)}>
          <IconArrowUp size={16} />
        </button>
        <button type="button" className="ib" title={t('launcher.folder.pickerHome')} aria-label={t('launcher.folder.pickerHome')} onClick={() => go('', true)}>
          <IconHome size={16} />
        </button>
        <input
          ref={bar}
          className="input mono"
          aria-label={t('launcher.folder.pickerPath')}
          value={typed}
          onBlur={showEnd}
          onChange={(e) => {
            typing.current = true;
            setTyped(e.target.value);
          }}
          onKeyDown={(e) => {
            // Enter in the path box goes there; it is not the dialog's submit
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              go(typed.trim(), true);
            }
          }}
          spellCheck={false}
        />
      </div>
      <ul className="picker-list" role="listbox" aria-label={t('launcher.folder.pickerPath')} data-picker-list="">
        {at?.dirs.map((d) => (
          <li key={d.name}>
            <button type="button" className="picker-row" title={t('launcher.folder.pickerOpen', { name: d.name })} onClick={() => go(child(d.name), true)}>
              {d.kind ? <KindIcon kind={d.kind} size={14} /> : <GroupFolder />}
              <span className="name">{d.name}</span>
              {d.kind && <span className="tag">{t('launcher.folder.pickerHasProject', { kind: t(`launcher.kind.${d.kind}.name`) })}</span>}
            </button>
          </li>
        ))}
        {at && !at.dirs.length && <li className="picker-note">{t('launcher.folder.pickerEmpty')}</li>}
        {!at && !error && <li className="picker-note">{t('launcher.folder.pickerLoading')}</li>}
      </ul>
      {at?.more && <p className="picker-note">{t('launcher.folder.pickerMore')}</p>}
      <div className={`problem${error ? ' on' : ''}`} role="alert">
        {error}
      </div>
      <footer>
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button className="btn primary" type="submit" disabled={!at}>
          {t('launcher.folder.pickerChoose')}
        </button>
      </footer>
    </Dialog>
  );
}
