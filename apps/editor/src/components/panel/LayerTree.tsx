import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { layerTree, pathTo, type Layer, type NoteEntry } from '@dc/core';
import { display, focusBoard, onPage, parsed, useCanvas, useStore } from '../../store';
import { Chevron, RoleIcon } from '../icons';

/** A layer's role (core's names) → its key under `panel.role`. */
const ROLE_KEY = {
  Column: 'column',
  Row: 'row',
  Grid: 'grid',
  Text: 'text',
  Image: 'image',
  Vector: 'vector',
  Button: 'button',
  Input: 'input',
  Link: 'link',
  'Repeating group': 'repeatingGroup',
  Condition: 'condition',
  Component: 'component',
  Group: 'group',
  Shape: 'shape',
  Embed: 'embed',
  Icon: 'icon',
  Connector: 'connector',
  Table: 'table',
  Notes: 'notes',
  Slide: 'slide',
} as const;

function roleName(t: TFunction, role: string): string {
  const key = ROLE_KEY[role as keyof typeof ROLE_KEY];
  return key ? t(`panel.role.${key}`) : role;
}

export function itemName(t: TFunction, n: NoteEntry): string {
  switch (n.kind) {
    case 'title1':
      return t('panel.item.title');
    case 'rect':
      return t('panel.item.rect');
    case 'oval':
      return t('panel.item.oval');
    case 'line':
      return t('panel.item.line');
    case 'arrow':
      return t('panel.item.arrow');
    case 'pen':
      return t('panel.item.pen');
    case 'image':
      return t('panel.item.image');
    default:
      return t('panel.item.note');
  }
}
const ITEM_ICON: Record<string, string> = {
  title1: 'Title',
  rect: 'Rectangle',
  oval: 'Oval',
  line: 'Line',
  arrow: 'Arrow',
  pen: 'Drawing',
  image: 'Image',
};

function firstLine(t?: string): string {
  const s = (t ?? '').trim().split('\n')[0] ?? '';
  return s.length > 28 ? s.slice(0, 27) + '…' : s;
}

function ElementRows({ file, layers, depth, open, toggle, counts }: { file: string; layers: Layer[]; depth: number; open: Set<string>; toggle: (k: string) => void; counts: Record<number, number> }) {
  const { t } = useTranslation();
  const sel = useStore((s) => (s.selection?.kind === 'el' && s.selection.file === file ? s.selection.tid : null));
  return (
    <>
      {layers.map((l) => {
        const key = `${file}#${l.tid}`;
        const isOpen = open.has(key);
        const count = l.role === 'Repeating group' ? (l.children[0] ? (counts[l.children[0].tid] ?? 0) : 0) : 0;
        return (
          <div key={l.tid}>
            <div
              className={`lr ${l.repeated || l.role === 'Repeating group' ? 'rep' : ''}`}
              role="treeitem"
              aria-selected={sel === l.tid}
              aria-expanded={l.children.length ? isOpen : undefined}
              data-key={key}
              style={{ paddingLeft: 6 + depth * 14 }}
              onClick={() => useStore.setState({ selection: { kind: 'el', file, tid: l.tid }, editingNote: null })}
              onMouseEnter={() => useStore.setState({ layerHover: { file, tid: l.tid } })}
              onMouseLeave={() => useStore.setState({ layerHover: null })}
            >
              {l.children.length ? (
                <button className="tw" aria-label={isOpen ? t('panel.layers.collapse') : t('panel.layers.expand')} onClick={(e) => (e.stopPropagation(), toggle(key))}>
                  <Chevron open={isOpen} />
                </button>
              ) : (
                <span className="tw" />
              )}
              <span className="ri">
                <RoleIcon role={l.role} />
              </span>
              <span className="rn">{roleName(t, l.role)}</span>
              {l.label && <span className="rl">“{l.label}”</span>}
              {l.role === 'Repeating group' && <span className="rc">{t('panel.layers.count', { count })}</span>}
            </div>
            {isOpen && l.children.length > 0 && <ElementRows file={file} layers={l.children} depth={depth + 1} open={open} toggle={toggle} counts={counts} />}
          </div>
        );
      })}
    </>
  );
}

function BoardRow({ file, title, open, toggle }: { file: string; title: string; open: Set<string>; toggle: (k: string) => void }) {
  const { t } = useTranslation();
  const source = useStore((s) => display(s, file));
  const counts = useStore((s) => s.counts[file]) ?? {};
  const sel = useStore((s) => s.selection?.kind === 'board' && s.selection.file === file);
  const layers = useMemo(() => (source ? layerTree(parsed(source)) : []), [source]);
  const isOpen = open.has(file);
  // the root element is the artboard itself: show its children directly
  const root = layers.find((l) => l.tag !== 'helmet');
  const kids = root ? (root.children.length ? root.children : [root]) : [];
  return (
    <div>
      <div
        className="lr"
        role="treeitem"
        aria-selected={sel}
        aria-expanded={kids.length ? isOpen : undefined}
        data-key={file}
        style={{ paddingLeft: 6 }}
        onClick={() => useStore.setState({ selection: { kind: 'board', file }, editingNote: null })}
        onDoubleClick={() => focusBoard(file)}
      >
        <button className="tw" aria-label={isOpen ? t('panel.layers.collapse') : t('panel.layers.expand')} onClick={(e) => (e.stopPropagation(), toggle(file))}>
          <Chevron open={isOpen} />
        </button>
        <span className="ri">
          <RoleIcon role="Artboard" />
        </span>
        <span className="rn" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {title}
        </span>
      </div>
      {isOpen && <ElementRows file={file} layers={kids} depth={1} open={open} toggle={toggle} counts={counts} />}
    </div>
  );
}

/** Canvas items, then artboards and the elements inside them; follows the selection. */
export function LayerTree() {
  const { t } = useTranslation();
  const canvas = useCanvas();
  const page = useStore((s) => s.page);
  const sel = useStore((s) => s.selection);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const box = useRef<HTMLDivElement>(null);
  const toggle = (k: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  // expand down to the selection and scroll it into view
  useEffect(() => {
    if (!sel) return;
    const keys: string[] = [];
    if (sel.kind === 'el') {
      const src = display(useStore.getState(), sel.file);
      if (src) {
        keys.push(sel.file);
        const path = pathTo(parsed(src), sel.tid);
        for (const tid of path.slice(0, -1)) keys.push(`${sel.file}#${tid}`);
      }
    }
    if (keys.length) setOpen((o) => new Set([...o, ...keys]));
    requestAnimationFrame(() => {
      const key = sel.kind === 'el' ? `${sel.file}#${sel.tid}` : sel.kind === 'board' ? sel.file : `note:${sel.id}`;
      box.current?.querySelector(`[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest' });
    });
  }, [sel]);

  const notes = Object.entries(canvas.notes).filter(([, n]) => typeof n.x === 'number' && onPage(canvas, n.page, page));
  const boards = canvas.order.filter((f) => canvas.boards[f] && onPage(canvas, canvas.boards[f].page, page));
  return (
    <div className="layers" ref={box} role="tree" aria-label={t('panel.layers.label')}>
      {notes.map(([id, n]) => (
        <div
          key={id}
          className="lr"
          role="treeitem"
          aria-selected={sel?.kind === 'note' && sel.id === id}
          data-key={`note:${id}`}
          style={{ paddingLeft: 6 }}
          onClick={() => useStore.setState({ selection: { kind: 'note', id } })}
        >
          <span className="tw" />
          <span className="ri">
            <RoleIcon role={ITEM_ICON[n.kind ?? ''] ?? 'Note'} />
          </span>
          <span className="rn">{itemName(t, n)}</span>
          {n.text && <span className="rl">“{firstLine(n.text)}”</span>}
        </div>
      ))}
      {boards.map((f) => (
        <BoardRow key={f} file={f} title={canvas.boards[f].title || f} open={open} toggle={toggle} />
      ))}
      {!notes.length && !boards.length && <div className="empty">{t('panel.layers.empty')}</div>}
    </div>
  );
}
