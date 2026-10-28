import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MenuItem } from './Menu';

type Verb = (() => void) | null | undefined;

/**
 * What can be done with one item of an ordered list, as menu entries in the same order for every
 * kind (a slide, a scene, a document tab): add, duplicate, move, the kind's own entries, rename, a
 * rule, delete. A verb left out is not offered (the kind cannot do it); a verb given as `null` is
 * shown dimmed (it could, but not for this item: the first one cannot move earlier). Each call
 * closes the menu first. Put it inside `Menu` or `RowMenu`; the kind's own wording for the menu's
 * name stays with the caller.
 */
export function ItemMenuItems({
  close,
  axis = 'vertical',
  onAdd,
  adds,
  onDuplicate,
  onEarlier,
  onLater,
  extra,
  onRename,
  onDelete,
}: {
  close: () => void;
  /** a list drawn down the page moves up / down, a timeline earlier / later */
  axis?: 'vertical' | 'horizontal';
  onAdd?: () => void;
  /** more ways to add, right after "add" (a subtab) */
  adds?: ReactNode;
  onDuplicate?: () => void;
  onEarlier?: Verb;
  onLater?: Verb;
  /** entries only this kind has (skip a slide, start a section) */
  extra?: ReactNode;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const run = (f: () => void) => () => (close(), f());
  const move = (label: string, f: Verb) => f !== undefined && <MenuItem label={label} disabled={f === null} onSelect={f ? run(f) : () => {}} />;
  const v = axis === 'vertical';
  return (
    <>
      {onAdd && <MenuItem label={t('common.item.addAfter')} onSelect={run(onAdd)} />}
      {adds}
      {onDuplicate && <MenuItem label={t('common.item.duplicate')} onSelect={run(onDuplicate)} />}
      {move(t(v ? 'common.item.moveUp' : 'common.item.moveEarlier'), onEarlier)}
      {move(t(v ? 'common.item.moveDown' : 'common.item.moveLater'), onLater)}
      {extra}
      {onRename && <MenuItem label={t('common.rename')} onSelect={run(onRename)} />}
      {onDelete && (
        <>
          <hr />
          <MenuItem label={t('common.delete')} danger onSelect={run(onDelete)} />
        </>
      )}
    </>
  );
}
