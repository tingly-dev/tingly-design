import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '../store';
import { ImportHere, type ImportControls, type ImportTarget } from './ImportHere';
import { Menu, MenuItem } from './Menu';
import { Caret, FileText, Transfer } from './icons';

/**
 * Everything that moves files across the project's edge, in one place: one button in every
 * kind's bar, one menu with what can come in (what the project takes, and that a drop or a
 * paste works too) and what can go out (the formats this kind can save). A kind describes its
 * exports as a list of items; the menu, the wording and the way a failure shows are the same
 * everywhere, so nothing about moving files has to be hunted for in a different corner of each
 * editor. See .design/export-menu.md.
 */

export interface ExportItem {
  id: string;
  /** the format, in words: "PNG image", "PDF" */
  label: string;
  /** one line: what it contains, or how it is made when that is not obvious */
  hint?: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** does the export; a thrown error becomes a toast. Saving and its own toasts are the item's business */
  run: () => void | Promise<void>;
  /** put a rule above this item (a new family of formats) */
  rule?: boolean;
}

export function FileMenu({
  target,
  label,
  items,
  button = 'icon',
  align = 'right',
}: {
  target: ImportTarget;
  /** the kind as a noun in the language showing, for "Import into this {label}" */
  label: string;
  /** a function when the list depends on what is selected: it is read when the menu opens */
  items: ExportItem[] | (() => ExportItem[]);
  button?: 'icon' | 'text';
  align?: 'left' | 'right';
}) {
  const { t } = useTranslation();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const controls = useRef<ImportControls | null>(null);
  const open = () => {
    const r = btn.current!.getBoundingClientRect();
    setPos({ x: align === 'right' ? r.right : r.left, y: r.bottom + 8 });
  };
  const close = () => setPos(null);
  const run = async (item: ExportItem) => {
    close();
    try {
      await item.run();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const name = t('common.transfer.button');
  const list = pos ? (typeof items === 'function' ? items() : items) : [];
  return (
    <>
      <button
        ref={btn}
        className={button === 'text' ? 'btn ghost' : 'tb'}
        aria-haspopup="menu"
        aria-expanded={!!pos}
        aria-label={name}
        title={t('common.transfer.buttonHint', { label })}
        onClick={() => (pos ? close() : open())}
      >
        {button === 'text' ? (
          name
        ) : (
          <>
            <Transfer />
            <span className="caret">
              <Caret />
            </span>
          </>
        )}
      </button>
      <ImportHere target={target} label={label} button={false} controls={controls} />
      {pos && (
        <Menu x={pos.x} y={pos.y} align={align} label={name} onClose={close}>
          <div className="head">{t('common.transfer.import')}</div>
          <MenuItem
            label={t('importer.here.chooseFiles')}
            hint={target.what}
            icon={<FileText />}
            onSelect={() => {
              close();
              controls.current?.chooseFiles();
            }}
          />
          {(target.accepts.includes('page') || target.accepts.includes('markdown')) && (
            <MenuItem
              label={t('importer.here.chooseFolder')}
              icon={<FileText />}
              onSelect={() => {
                close();
                controls.current?.chooseFolder();
              }}
            />
          )}
          <div className="mhint faint">{target.accepts.includes('drawing') || target.accepts.includes('image') ? t('importer.here.dragOrPaste') : t('importer.here.drag')}</div>
          <hr />
          <div className="head">{t('common.transfer.export')}</div>
          {list.length === 0 && <div className="mhint faint">{t('common.transfer.exportNone')}</div>}
          {list.map((item) => (
            <div key={item.id}>
              {item.rule && <hr />}
              <MenuItem label={item.label} hint={item.hint} icon={item.icon} disabled={item.disabled} onSelect={() => void run(item)} />
            </div>
          ))}
        </Menu>
      )}
    </>
  );
}
