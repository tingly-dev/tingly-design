import { useTranslation } from 'react-i18next';
import type { ProjectKind } from '@dc/core';
import { COMMON_SHORTCUTS, KIND_SHORTCUTS, type Shortcut } from '../shortcutHelp';
import { useStore } from '../store';
import { Dialog } from './Dialog';

function Rows({ rows }: { rows: Shortcut[] }) {
  const { t } = useTranslation();
  return (
    <dl className="keyrows">
      {rows.map((r) => (
        <div key={r.id}>
          <dt>
            <kbd>{r.keys}</kbd>
          </dt>
          <dd>{t(`common.shortcut.${r.id}`)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "Keyboard shortcuts": the keys that work everywhere, then the ones of the open kind. Mounted once, opened from the "more" menu or with `?`. */
export function ShortcutsHost() {
  const { t } = useTranslation();
  const open = useStore((s) => s.shortcutsOpen);
  const kind = useStore((s) => s.kind);
  if (!open || !kind) return null;
  return (
    <Dialog label={t('common.shortcut.title')} className="shortcutsdlg" onClose={() => useStore.setState({ shortcutsOpen: false })}>
      <h3>{t('common.shortcut.everywhere')}</h3>
      <Rows rows={COMMON_SHORTCUTS} />
      <h3>{t('common.shortcut.inThisKind')}</h3>
      <Rows rows={KIND_SHORTCUTS[kind]} />
    </Dialog>
  );
}

/** The first few keys of a kind in a line, for an inspector's empty state, with the way to the full list. */
export function ShortcutLine({ kind }: { kind: ProjectKind }) {
  const { t } = useTranslation();
  return (
    <p className="hint" style={{ margin: 0 }}>
      {KIND_SHORTCUTS[kind]
        .slice(0, 6)
        .map((r) => `${r.keys} ${t(`common.shortcut.${r.id}`)}`)
        .join(' · ')}{' '}
      · {t('common.shortcut.hint')}
    </p>
  );
}
