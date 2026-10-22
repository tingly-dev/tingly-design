import { useTranslation } from 'react-i18next';
import { display, parsed, useStore } from '../../store';
import { lockSig, selectionOf, unlock } from '../../layerFlags';
import { roleOf } from '@dc/core';
import { roleName } from './LayerTree';
import { Lock } from '../icons';

/**
 * What the panel says about a locked selection: the fields below it are off
 * (the panel's body is a disabled fieldset), and one button takes the lock off
 * whatever holds it, so the way forward is right where the question is.
 */
export function LockNotice() {
  const { t } = useTranslation();
  const sig = useStore(lockSig);
  const holder = sig ? selectionOf(sig.slice(1)) : null;
  const holderRole = useStore((s) => {
    if (holder?.kind !== 'el') return null;
    const src = display(s, holder.file);
    const el = src ? parsed(src).elements[holder.tid] : undefined;
    return el ? roleOf(el) : null;
  });
  if (!holder) return null;
  const own = sig[0] === '1';
  const outer = holder.kind === 'board' ? t('panel.role.artboard') : holderRole ? roleName(t, holderRole) : '';
  return (
    <div className="locknote" role="status">
      <Lock />
      <span>{own ? t('panel.lock.own') : t('panel.lock.outer', { layer: outer })}</span>
      <button className="btn sm outline" onClick={() => unlock(holder)}>
        {t('panel.layers.unlock')}
      </button>
    </div>
  );
}
