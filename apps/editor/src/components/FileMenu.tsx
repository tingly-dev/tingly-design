import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '../store';
import { ImportHere, importFilesLabel, type ImportControls, type ImportTarget } from './ImportHere';
import { Menu, MenuItem } from './Menu';
import { offerExports, type Pick } from '../headless';
import { saveClaudeDesign, saveProjectArchive } from '../projectArchive';
import { Caret, FileText, FileZip, Frame, Transfer } from './icons';

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
  pick,
  button = 'icon',
  align = 'right',
  claudeDesign = false,
}: {
  target: ImportTarget;
  /** the kind as a noun in the language showing, for "Import into this {label}" */
  label: string;
  /** a function when the list depends on what is selected: it is read when the menu opens */
  items: ExportItem[] | (() => ExportItem[]);
  /** shows one board, slide, tab or view by id or name, for `tingly-design export --board/--slide/--tab/--view` (headless.ts) */
  pick?: Pick;
  button?: 'icon' | 'text';
  align?: 'left' | 'right';
  /** this kind has an original Claude type with files to exchange (docs go through Markdown, motion has none; .design/claude-design-format.md) */
  claudeDesign?: boolean;
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
  // the command line runs the same items without opening the menu
  useEffect(() => offerExports(items, pick));
  const run = async (item: ExportItem) => {
    close();
    try {
      await item.run();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const name = t('common.transfer.button');
  const project = new URLSearchParams(location.search).get('p');
  const own = pos ? (typeof items === 'function' ? items() : items) : [];
  // the whole project, the same two items in every kind (.design/project-archive.md)
  const list: ExportItem[] =
    pos && project
      ? [
          ...own,
          ...(claudeDesign ? [{ id: 'claude-design', rule: own.length > 0, label: t('common.transfer.label.claudeDesign'), hint: t('common.transfer.hint.claudeDesign'), icon: <FileZip />, run: () => saveClaudeDesign(project) }] : []),
          { id: 'project', label: t('common.transfer.label.project'), hint: t('common.transfer.hint.project'), icon: <FileZip />, rule: !claudeDesign && own.length > 0, run: () => saveProjectArchive(project, true) },
          { id: 'project-files', label: t('common.transfer.label.projectFiles'), hint: t('common.transfer.hint.projectFiles'), icon: <FileZip />, run: () => saveProjectArchive(project, false) },
        ]
      : own;
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
            label={importFilesLabel(t, target.accepts)}
            hint={`${target.what} ${target.accepts.includes('drawing') || target.accepts.includes('image') ? t('importer.here.dragOrPaste') : t('importer.here.drag')}`}
            icon={<FileText />}
            onSelect={() => {
              close();
              controls.current?.chooseFiles();
            }}
          />
          {(target.accepts.includes('page') || target.accepts.includes('markdown')) && (
            <MenuItem
              label={t('importer.here.importFolder')}
              icon={<FileText />}
              onSelect={() => {
                close();
                controls.current?.chooseFolder();
              }}
            />
          )}
          {target.board && (
            <MenuItem
              label={t('importer.here.fromProject')}
              hint={target.board.what}
              icon={<Frame />}
              onSelect={() => {
                close();
                controls.current?.pickProject();
              }}
            />
          )}
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
