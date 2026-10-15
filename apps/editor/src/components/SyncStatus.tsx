import { useTranslation } from 'react-i18next';
import { isSaving, useStore } from '../store';
import { History } from './icons';

/**
 * The status line of a floating bar: whether this editor is connected and has saved, and the way
 * to the change history. The history icon says what a click does; the dot on it says how things
 * are (green saved, blue saving, red offline); a word shows only when something is not as usual,
 * so the common case adds no text to the bar. The same chip in every editor that has a bar of
 * this kind (canvas, slides, design system).
 */
export function SyncStatus() {
  const { t } = useTranslation();
  const connected = useStore((s) => s.connected);
  const saving = useStore(isSaving);
  const open = useStore((s) => s.journalOpen);
  const state = !connected ? 'off' : saving ? 'busy' : 'ok';
  const word = t(`common.sync.${state}`);
  return (
    <button
      className="tb syncchip"
      aria-pressed={open}
      aria-label={t('common.sync.label', { state: word })}
      title={t(`common.sync.${state}Hint`)}
      data-state={state}
      onClick={() => useStore.setState({ journalOpen: !open })}
    >
      <span className="hist">
        <History />
        <span className={`dot ${state === 'ok' ? '' : state}`} />
      </span>
      {state !== 'ok' && <span className="word">{word}</span>}
    </button>
  );
}
