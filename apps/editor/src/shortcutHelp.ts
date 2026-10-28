import type { ProjectKind } from '@dc/core';

/**
 * The keys each kind answers to, as data, so the one dialog behind "Keyboard shortcuts" (the "more"
 * menu, or `?`) and the line in an inspector's empty state say the same thing. The handlers stay where
 * the keys are caught (`shortcuts.ts`, the motion player, a field); a key added there gets its row here,
 * with the words in `common.shortcut.<id>`.
 */
export const SHORTCUT_IDS = [
  'undo',
  'redo',
  'help',
  'pane',
  'tools',
  'zoomFit',
  'zoomSelection',
  'zoom',
  'duplicate',
  'group',
  'clipboard',
  'delete',
  'order',
  'parent',
  'deselect',
  'slideStep',
  'slideNew',
  'present',
  'presentHere',
  'presentNext',
  'presentBack',
  'presentFull',
  'presentNotes',
  'presentExit',
  'play',
  'frameStep',
  'docBlock',
  'docBlockPick',
  'docComment',
  'docCommentCancel',
  'dashData',
  'dashSave',
  'dsApply',
  'dsRevert',
] as const;
export type ShortcutId = (typeof SHORTCUT_IDS)[number];

export interface Shortcut {
  id: ShortcutId;
  keys: string;
}

/** Keys that work in every kind (the store's undo covers each file a kind writes). */
export const COMMON_SHORTCUTS: Shortcut[] = [
  { id: 'undo', keys: '⌘Z' },
  { id: 'redo', keys: '⇧⌘Z' },
  { id: 'help', keys: '?' },
];

const PANE: Shortcut = { id: 'pane', keys: '⌘\\' };
const SELECTION: Shortcut[] = [
  { id: 'duplicate', keys: '⌘D' },
  { id: 'delete', keys: '⌫' },
  { id: 'parent', keys: '⇧↵ / ↵' },
];

export const KIND_SHORTCUTS: Record<ProjectKind, Shortcut[]> = {
  design: [
    { id: 'tools', keys: 'V H T A N P R O L' },
    { id: 'zoomFit', keys: '⇧1' },
    { id: 'zoomSelection', keys: '⇧2' },
    { id: 'zoom', keys: '⌘+ ⌘− ⌘0' },
    ...SELECTION,
    { id: 'group', keys: '⌘G / ⇧⌘G' },
    { id: 'clipboard', keys: '⌘C ⌘X ⌘V' },
    { id: 'order', keys: '[ ]' },
    { id: 'deselect', keys: 'Esc' },
    PANE,
  ],
  slides: [
    { id: 'slideStep', keys: '↑ ↓ PgUp PgDn' },
    { id: 'slideNew', keys: '⇧⌘N' },
    ...SELECTION,
    { id: 'present', keys: 'F5' },
    { id: 'presentHere', keys: '⇧F5' },
    { id: 'presentNext', keys: '→ ↓ PgDn Space ↵' },
    { id: 'presentBack', keys: '← ↑ PgUp ⌫' },
    { id: 'presentFull', keys: 'F' },
    { id: 'presentNotes', keys: 'N' },
    { id: 'presentExit', keys: 'Esc' },
    PANE,
  ],
  motion: [{ id: 'play', keys: 'Space' }, { id: 'frameStep', keys: '← →' }, ...SELECTION, { id: 'deselect', keys: 'Esc' }, PANE],
  docs: [
    { id: 'docBlock', keys: '/' },
    { id: 'docBlockPick', keys: '↑ ↓ ↵' },
    { id: 'docComment', keys: '⌘↵' },
    { id: 'docCommentCancel', keys: 'Esc' },
  ],
  dashboard: [
    { id: 'dashData', keys: 'Esc' },
    { id: 'dashSave', keys: '⌘S' },
  ],
  'design-system': [
    { id: 'dsApply', keys: '↵' },
    { id: 'dsRevert', keys: 'Esc' },
  ],
};
