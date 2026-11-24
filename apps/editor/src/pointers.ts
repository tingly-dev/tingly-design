// Live edit pointers in the editor: one per participant, moved by the writes it makes and the places it announces,
// faded out once it has been still a while (`.design/live-pointers.md`). Core's `pointer.ts` says where; this keeps them.
import { useMemo } from 'react';
import { create } from 'zustand';
import {
  changedSpan,
  isElementFile,
  pointerColor,
  pointerTid,
  POINTER_FADE_MS,
  POINTER_IDLE_MS,
  tabIdOf,
  type Participant,
  type PointerTarget,
  type RuntimePointer,
} from '@dc/core';
import { t } from './i18n';
import { parsed } from './store';

export interface LivePointer {
  participant: Participant;
  target: PointerTarget;
  color: string;
  /** when it last moved */
  at: number;
  /** still a while: fading out */
  fading: boolean;
  /** a doc tab's change not placed yet: the text it wrote, which the open tab finds the block of as it takes it in */
  landing?: string;
}

export const usePointers = create<{ pointers: Record<string, LivePointer> }>(() => ({ pointers: {} }));

const timers = new Map<string, ReturnType<typeof setTimeout>[]>();

function stopTimers(id: string): void {
  for (const x of timers.get(id) ?? []) clearTimeout(x);
  timers.delete(id);
}

function drop(id: string): void {
  stopTimers(id);
  usePointers.setState((s) => {
    if (!s.pointers[id]) return {};
    const pointers = { ...s.pointers };
    delete pointers[id];
    return { pointers };
  });
}

/** Move a participant's pointer to `target` (null takes it away); it fades after `POINTER_IDLE_MS` without moving. */
export function showPointer(participant: Participant, target: PointerTarget | null, landing?: string): void {
  const id = participant.id;
  if (!target) return drop(id);
  stopTimers(id);
  const at = Date.now();
  usePointers.setState((s) => ({ pointers: { ...s.pointers, [id]: { participant, target, color: pointerColor(participant), at, fading: false, ...(landing !== undefined ? { landing } : {}) } } }));
  const fade = () => usePointers.setState((s) => (s.pointers[id]?.at === at ? { pointers: { ...s.pointers, [id]: { ...s.pointers[id], fading: true } } } : {}));
  timers.set(id, [setTimeout(fade, POINTER_IDLE_MS), setTimeout(() => drop(id), POINTER_IDLE_MS + POINTER_FADE_MS)]);
}

/** A write by `participant` turned `file` from `before` into `after`: its pointer goes to what changed. */
export function pointChange(participant: Participant, file: string, before: string | undefined, after: string): void {
  if (before === after) return;
  if (isElementFile(file)) {
    const span = changedSpan(before ?? '', after);
    const tid = span ? pointerTid(parsed(after), span) : null;
    if (tid !== null) showPointer(participant, { file, tid });
  } else if (tabIdOf(file)) showPointer(participant, { file }, after);
}

/** The open doc tab took in `text`: the pointers that wrote it land on `block`. */
export function placeLanding(file: string, text: string, block: number | null): void {
  usePointers.setState((s) => {
    let pointers: Record<string, LivePointer> | null = null;
    for (const [id, p] of Object.entries(s.pointers)) {
      if (p.target.file !== file || p.landing !== text) continue;
      pointers ??= { ...s.pointers };
      pointers[id] = { ...p, target: block === null ? { file } : { file, block }, landing: undefined };
    }
    return pointers ? { pointers } : {};
  });
}

/** Whether a pointer waits for the open tab to take in `text`. */
export const hasLanding = (file: string, text: string): boolean => Object.values(usePointers.getState().pointers).some((p) => p.target.file === file && p.landing === text);

export function clearPointers(): void {
  for (const id of [...timers.keys()]) stopTimers(id);
  usePointers.setState({ pointers: {} });
}

/** What a pointer is called: its own name, else the word for its actor. */
export const pointerLabel = (p: Participant): string => p.name ?? t(`app.pointer.${p.actor}`);

/** The pointers on one artboard, slide or scene, as its runtime draws them. */
export function useRuntimePointers(file: string): RuntimePointer[] {
  const pointers = usePointers((s) => s.pointers);
  return useMemo(
    () =>
      Object.values(pointers).flatMap((p) =>
        p.target.file === file && p.target.tid !== undefined ? [{ id: p.participant.id, tid: p.target.tid, color: p.color, label: pointerLabel(p.participant), fading: p.fading }] : [],
      ),
    [pointers, file],
  );
}
