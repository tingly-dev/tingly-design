import type React from 'react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { HIDE_ATTR, LOCK_ATTR, layerTree, pathTo, slideFile, type Layer, type NoteEntry } from '@dc/core';
import { display, editElement, parsed, useCanvas, useStore } from '../../store';
import { focusBoard, onPage } from '../canvas/view';
import { updateBoard, updateNote } from '../../actions';
import { allFlagged, keyOf, selectionOf, setFlags, soloPlan } from '../../layerFlags';
import { Chevron, Close, Eye, EyeOff, Lock, RoleIcon, Unlock } from '../icons';

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
  Artboard: 'artboard',
  Icon: 'icon',
  Connector: 'connector',
  Table: 'table',
  Notes: 'notes',
  Slide: 'slide',
  Scene: 'scene',
} as const;

export function roleName(t: TFunction, role: string): string {
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

/** The icon a layer role wears in the tree. */
const iconOf = (role: string) => (role === 'Slide' ? 'Artboard' : role === 'Notes' ? 'Note' : role === 'Connector' ? 'Arrow' : role);

/**
 * One tree for every kind: the same row (chevron, icon, name, “label”, hide
 * and lock) whether the thing is an artboard, a canvas item, a slide's element
 * or a scene's element. What differs per kind is only where the rows come from:
 * `CanvasLayers` (items, artboards, their elements), `ElementLayers` (one
 * slide's or scene's elements). Hide and lock are written into the files, as
 * `data-hide` / `data-lock` on an element and `hidden` / `locked` on an item or
 * artboard in canvas.json, so Claude Code and a hand edit see them too.
 */

/** One switch: its own state, whether an outer layer already sets it, and how to flip it. */
interface Flag {
  on: boolean;
  inherited: boolean;
  set: (on: boolean) => void;
  /** hide only: Alt-click keeps just this one of its siblings shown */
  solo?: () => void;
}
interface Switches {
  hide: Flag;
  lock: Flag;
}

/** The rows ticked together (Shift or ⌘/Ctrl-click): a switch on one of them flips all of them. */
const Marks = createContext<Set<string>>(new Set());

function Switch({ kind, flag, rowKey }: { kind: 'hide' | 'lock'; flag: Flag; rowKey: string }) {
  const { t } = useTranslation();
  const marked = useContext(Marks);
  const on = flag.on || flag.inherited;
  const label = flag.inherited && !flag.on ? t(`panel.layers.${kind}Inherited`) : on ? t(`panel.layers.${kind === 'hide' ? 'show' : 'unlock'}`) : t(`panel.layers.${kind}`);
  const Icon = kind === 'hide' ? (on ? EyeOff : Eye) : on ? Lock : Unlock;
  const title = kind === 'hide' && flag.solo && !on ? `${label} · ${t('panel.layers.soloHint')}` : label;
  const click = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (marked.size > 1 && marked.has(rowKey)) return setFlags([...marked].map((k) => [k, !flag.on]), kind);
    if (e.altKey && kind === 'hide' && flag.solo) return flag.solo();
    flag.set(!flag.on);
  };
  return (
    <button
      className={`sw${flag.inherited && !flag.on ? ' inh' : ''}`}
      aria-label={label}
      title={title}
      aria-pressed={on}
      disabled={flag.inherited && !flag.on}
      onClick={click}
    >
      <Icon />
    </button>
  );
}

interface RowProps {
  dataKey: string;
  depth: number;
  role: string;
  name: string;
  label?: string;
  selected: boolean;
  /** undefined: nothing inside; otherwise whether the children show */
  open?: boolean;
  /** the row can't be collapsed (a slide's own root) */
  pinned?: boolean;
  onToggle?: () => void;
  onSelect: () => void;
  onOpen?: () => void;
  onHover?: (on: boolean) => void;
  /** a count or when it shows, right-aligned */
  tail?: string;
  tailClass?: 'rc' | 'rt';
  className?: string;
  switches?: Switches;
}

function LayerRow(p: RowProps) {
  const { t } = useTranslation();
  const off = !!(p.switches?.hide.on || p.switches?.hide.inherited);
  const tree = useContext(TreeActions);
  const marked = useContext(Marks).has(p.dataKey);
  return (
    <div
      className={['lr', p.className, off ? 'off' : '', marked ? 'marked' : ''].filter(Boolean).join(' ')}
      role="treeitem"
      aria-selected={p.selected || marked}
      aria-expanded={p.open}
      data-key={p.dataKey}
      style={{ paddingLeft: 6 + p.depth * 14 }}
      onClick={(e) => {
        if (tree.mark(p.dataKey, e)) return;
        p.onSelect();
      }}
      onDoubleClick={p.onOpen}
      onMouseEnter={p.onHover && (() => p.onHover!(true))}
      onMouseLeave={p.onHover && (() => p.onHover!(false))}
    >
      {p.open !== undefined && !p.pinned ? (
        <button className="tw" aria-label={p.open ? t('panel.layers.collapse') : t('panel.layers.expand')} onClick={(e) => (e.stopPropagation(), p.onToggle?.())}>
          <Chevron open={p.open} />
        </button>
      ) : (
        <span className="tw" />
      )}
      <span className="ri">
        <RoleIcon role={iconOf(p.role)} />
      </span>
      <span className="rn" style={p.depth === 0 ? { overflow: 'hidden', textOverflow: 'ellipsis' } : undefined}>
        {p.name}
      </span>
      {p.label && <span className="rl">“{p.label}”</span>}
      {p.tail && <span className={p.tailClass ?? 'rt'}>{p.tail}</span>}
      {p.switches && (
        <span className="sws">
          <Switch kind="hide" flag={p.switches.hide} rowKey={p.dataKey} />
          <Switch kind="lock" flag={p.switches.lock} rowKey={p.dataKey} />
        </span>
      )}
    </div>
  );
}

/** Which rows are open, expanded down to the selection and scrolled into view when it changes. */
function useTreeState() {
  const sel = useStore((s) => s.selection);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [marked, setMarked] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const keep = (m: Set<string>) => setMarked(m.size > 1 ? m : new Set());
  /** Shift-click ticks the rows from the last one clicked to this one; ⌘/Ctrl-click adds or drops one. True when the click was one of those. */
  const mark = (key: string, e: React.MouseEvent): boolean => {
    const cur = keyOf(useStore.getState().selection);
    if (e.shiftKey) {
      const keys = [...(box.current?.querySelectorAll<HTMLElement>('.lr[data-key]') ?? [])].map((r) => r.dataset.key!);
      const a = keys.indexOf(anchor.current ?? cur ?? key);
      const b = keys.indexOf(key);
      if (a < 0 || b < 0) return false;
      keep(new Set(keys.slice(Math.min(a, b), Math.max(a, b) + 1)));
      useStore.setState({ selection: selectionOf(key), editingNote: null });
      return true;
    }
    if (e.metaKey || e.ctrlKey) {
      const m = new Set(marked.size ? marked : cur ? [cur] : []);
      if (m.has(key)) m.delete(key);
      else m.add(key);
      anchor.current = key;
      keep(m);
      const last = m.has(key) ? key : [...m].at(-1);
      if (last) useStore.setState({ selection: selectionOf(last), editingNote: null });
      return true;
    }
    anchor.current = key;
    setMarked(new Set());
    return false;
  };
  const toggle = (k: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  useEffect(() => {
    const here = keyOf(sel);
    setMarked((m) => (m.size && (!here || !m.has(here)) ? new Set() : m));
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
  return { box, open, toggle, marked, setMarked, mark };
}

const TreeActions = createContext<{ mark: (key: string, e: React.MouseEvent) => boolean }>({ mark: () => false });

/** What an outer layer already decided for everything inside it. */
interface Above {
  hidden: boolean;
  locked: boolean;
}

const setAttrSwitch = (file: string, tid: number, name: string, on: boolean) => editElement(file, [{ kind: 'attr', tid, name, value: on ? '' : null }]);

function ElementRows({
  file,
  layers,
  depth,
  open,
  toggle,
  above,
  away,
}: {
  file: string;
  layers: Layer[];
  depth: number;
  open: Set<string>;
  toggle: (k: string) => void;
  above: Above;
  /** motion: elements not on screen at the playhead, with when they are */
  away?: Map<number, string>;
}) {
  const { t } = useTranslation();
  const motion = useStore((s) => s.kind === 'motion');
  const sel = useStore((s) => (s.selection?.kind === 'el' && s.selection.file === file ? s.selection.tid : null));
  const counts = useStore((s) => s.counts[file]) ?? {};
  const siblings = layers.filter((l) => !(l.role === 'Slide' && depth === 0)).map((l) => ({ key: `${file}#${l.tid}`, hidden: l.hidden }));
  return (
    <>
      {layers.map((l) => {
        const key = `${file}#${l.tid}`;
        const top = l.role === 'Slide' && depth === 0; // a slide's or scene's own root: no switches
        const isOpen = top || open.has(key);
        const rep = l.role === 'Repeating group';
        const count = rep ? (l.children[0] ? (counts[l.children[0].tid] ?? 0) : 0) : 0;
        const gone = away?.get(l.tid);
        const hiddenHere = above.hidden || l.hidden;
        const lockedHere = above.locked || l.locked;
        return (
          <div key={l.tid}>
            <LayerRow
              dataKey={key}
              depth={depth}
              role={l.role}
              name={top && motion ? t('panel.role.scene') : roleName(t, l.role)}
              label={l.label}
              selected={sel === l.tid}
              open={l.children.length ? isOpen : undefined}
              pinned={top}
              onToggle={() => toggle(key)}
              onSelect={() => useStore.setState({ selection: { kind: 'el', file, tid: l.tid }, editingNote: null })}
              onHover={(on) => useStore.setState({ layerHover: on ? { file, tid: l.tid } : null })}
              className={[l.repeated || rep ? 'rep' : '', gone ? 'away' : ''].filter(Boolean).join(' ')}
              tail={rep ? t('panel.layers.count', { count }) : gone}
              tailClass={rep ? 'rc' : 'rt'}
              switches={
                top
                  ? undefined
                  : {
                      hide: { on: l.hidden, inherited: above.hidden, set: (on) => setAttrSwitch(file, l.tid, HIDE_ATTR, on), solo: () => setFlags(soloPlan(siblings, key), 'hide') },
                      lock: { on: l.locked, inherited: above.locked, set: (on) => setAttrSwitch(file, l.tid, LOCK_ATTR, on) },
                    }
              }
            />
            {isOpen && l.children.length > 0 && (
              <ElementRows file={file} layers={l.children} depth={depth + 1} open={open} toggle={toggle} above={{ hidden: hiddenHere, locked: lockedHere }} away={away} />
            )}
          </div>
        );
      })}
    </>
  );
}

function BoardRow({ file, title, open, toggle, solo }: { file: string; title: string; open: Set<string>; toggle: (k: string) => void; solo: () => void }) {
  const source = useStore((s) => display(s, file));
  const entry = useCanvas().boards[file];
  const sel = useStore((s) => s.selection?.kind === 'board' && s.selection.file === file);
  const layers = useMemo(() => (source ? layerTree(parsed(source)) : []), [source]);
  const isOpen = open.has(file);
  // the root element is the artboard itself: show its children directly
  const root = layers.find((l) => l.tag !== 'helmet');
  const kids = root ? (root.children.length ? root.children : [root]) : [];
  const hidden = !!entry?.hidden;
  const locked = !!entry?.locked;
  return (
    <div>
      <LayerRow
        dataKey={file}
        depth={0}
        role="Artboard"
        name={title}
        selected={sel}
        open={kids.length ? isOpen : undefined}
        onToggle={() => toggle(file)}
        onSelect={() => useStore.setState({ selection: { kind: 'board', file }, editingNote: null })}
        onOpen={() => focusBoard(file)}
        switches={{
          hide: { on: hidden, inherited: false, set: (on) => updateBoard(file, { hidden: on }, on ? 'hidden' : 'shown'), solo },
          lock: { on: locked, inherited: false, set: (on) => updateBoard(file, { locked: on }, on ? 'locked' : 'unlocked') },
        }}
      />
      {isOpen && <ElementRows file={file} layers={kids} depth={1} open={open} toggle={toggle} above={{ hidden, locked }} />}
    </div>
  );
}

/** The tree's scroll box, with what several ticked rows offer under it. */
function LayersBox({ tree, children }: { tree: ReturnType<typeof useTreeState>; children: React.ReactNode }) {
  const { t } = useTranslation();
  const keys = [...tree.marked];
  const allHidden = useStore((s) => allFlagged(s, keys, 'hide'));
  const allLocked = useStore((s) => allFlagged(s, keys, 'lock'));
  const actions = useMemo(() => ({ mark: tree.mark }), [tree.mark]);
  return (
    <Marks.Provider value={tree.marked}>
      <TreeActions.Provider value={actions}>
        <div className="layers" ref={tree.box} role="tree" aria-multiselectable="true" aria-label={t('panel.layers.label')}>
          {children}
        </div>
        {keys.length > 1 && (
          <div className="marks" title={t('panel.layers.markHint')}>
            <span>{t('panel.layers.marked', { count: keys.length })}</span>
            <button className="btn sm ghost" onClick={() => setFlags(keys.map((k) => [k, !allHidden]), 'hide')}>
              {allHidden ? <Eye /> : <EyeOff />}
              {allHidden ? t('panel.layers.show') : t('panel.layers.hide')}
            </button>
            <button className="btn sm ghost" onClick={() => setFlags(keys.map((k) => [k, !allLocked]), 'lock')}>
              {allLocked ? <Unlock /> : <Lock />}
              {allLocked ? t('panel.layers.unlock') : t('panel.layers.lock')}
            </button>
            <button className="ib sm" aria-label={t('panel.layers.clearMarks')} title={t('panel.layers.clearMarks')} onClick={() => tree.setMarked(new Set())}>
              <Close />
            </button>
          </div>
        )}
      </TreeActions.Provider>
    </Marks.Provider>
  );
}

/** Canvas: items, then artboards and the elements inside them; follows the selection. */
function CanvasLayers() {
  const { t } = useTranslation();
  const canvas = useCanvas();
  const page = useStore((s) => s.page);
  const sel = useStore((s) => s.selection);
  const tree = useTreeState();
  const { open, toggle } = tree;
  const notes = Object.entries(canvas.notes).filter(([, n]) => typeof n.x === 'number' && onPage(canvas, n.page, page));
  const boards = canvas.order.filter((f) => canvas.boards[f] && onPage(canvas, canvas.boards[f].page, page));
  // items and artboards share the tree's top level: Alt on an eye keeps one of them
  const siblings = [...notes.map(([id, n]) => ({ key: `note:${id}`, hidden: !!n.hidden })), ...boards.map((f) => ({ key: f, hidden: !!canvas.boards[f].hidden }))];
  return (
    <LayersBox tree={tree}>
      {notes.map(([id, n]) => (
        <LayerRow
          key={id}
          dataKey={`note:${id}`}
          depth={0}
          role={ITEM_ICON[n.kind ?? ''] ?? 'Note'}
          name={itemName(t, n)}
          label={n.text ? firstLine(n.text) : undefined}
          selected={sel?.kind === 'note' && sel.id === id}
          onSelect={() => useStore.setState({ selection: { kind: 'note', id } })}
          switches={{
            hide: { on: !!n.hidden, inherited: false, set: (on) => updateNote(id, { hidden: on || undefined }, on ? 'hidden' : 'shown'), solo: () => setFlags(soloPlan(siblings, `note:${id}`), 'hide') },
            lock: { on: !!n.locked, inherited: false, set: (on) => updateNote(id, { locked: on || undefined }, on ? 'locked' : 'unlocked') },
          }}
        />
      ))}
      {boards.map((f) => (
        <BoardRow key={f} file={f} title={canvas.boards[f].title || f} open={open} toggle={toggle} solo={() => setFlags(soloPlan(siblings, f), 'hide')} />
      ))}
      {!notes.length && !boards.length && <div className="empty">{t('panel.layers.empty')}</div>}
    </LayersBox>
  );
}

/** One slide's or scene's elements (the deck's other slides live in the strip). `away`: motion's off-screen elements. */
export function ElementLayers({ file, away }: { file: string; away?: Map<number, string> }) {
  const { t } = useTranslation();
  const source = useStore((s) => (file ? display(s, file) : undefined));
  const layers = useMemo(() => (source ? layerTree(parsed(source)) : []), [source]);
  const tree = useTreeState();
  // the root is always open; the rest follows the selection
  return (
    <LayersBox tree={tree}>
      <ElementRows file={file} layers={layers} depth={0} open={tree.open} toggle={tree.toggle} above={{ hidden: false, locked: false }} away={away} />
    </LayersBox>
  );
}

/** The layers tree of whatever is open: a canvas, or the slide on stage (a scene's goes through `ElementLayers` with its off-screen times). */
export function LayerTree() {
  const slides = useStore((s) => s.kind === 'slides');
  const slide = useStore((s) => s.slide);
  if (!slides) return <CanvasLayers />;
  return slide ? <ElementLayers file={slideFile(slide)} /> : <div className="layers" />;
}
