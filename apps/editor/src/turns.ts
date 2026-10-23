import { useMemo } from 'react';
import type { Turn } from '@dc/core';
import { useStore } from './store';
import type { DelegateState, FastState } from './store/agent';

/**
 * The conversation as the panel reads it: the turns the server kept, with the runs of this
 * session on top of them (a live run knows more than the record of it, and the record
 * knows more than a page that was just opened). See .design/chat-panel.md.
 */

/** A Claude Code run as a turn. */
export function turnOfDelegate(d: DelegateState): Turn {
  return {
    id: d.id,
    agent: 'claude',
    prompt: d.prompt,
    source: d.source ?? 'editor',
    state: d.state === 'start' || d.state === 'progress' ? 'running' : d.state,
    continued: !!d.continued,
    ...(d.via ? { via: d.via } : {}),
    startedAt: d.startedAt,
    ...(d.endedAt ? { endedAt: d.endedAt } : {}),
    steps: d.log,
    ...(d.result ? { answer: d.result } : {}),
    files: d.files,
  };
}

/** The fast model's request as a turn: its statements are what it did; null for jQuery typed by hand and for a hand-over (Claude Code's run is the turn). */
export function turnOfFast(f: FastState): Turn | null {
  if (f.mode !== 'ai' || !f.startedAt || !f.prompt || f.status === 'idle' || f.status === 'delegated') return null;
  const at = f.startedAt;
  return {
    id: `fast-${at}`,
    agent: 'fast',
    prompt: f.prompt,
    source: 'editor',
    state: f.status === 'running' ? 'running' : f.status === 'error' ? 'error' : 'done',
    startedAt: at,
    ...(f.endedAt ? { endedAt: f.endedAt } : {}),
    steps: f.lines.filter((l) => !l.divider && l.ok).map((l) => ({ say: l.code, at })),
    ...(f.note ? { answer: f.note } : {}),
    files: f.file && f.changed ? [f.file] : [],
  };
}

/** Stored turns, replaced by the live ones with the same id, oldest first. */
export function mergeTurns(stored: Turn[], delegates: DelegateState[], fast: FastState): Turn[] {
  const byId = new Map(stored.map((t) => [t.id, t]));
  const live = [...delegates.map(turnOfDelegate), turnOfFast(fast)];
  for (const t of live) {
    if (!t) continue;
    const kept = byId.get(t.id);
    // a page opened mid-run hears the rest of the run, not what came before it
    byId.set(t.id, kept && kept.steps.length > t.steps.length ? { ...t, steps: kept.steps, files: kept.files.length > t.files.length ? kept.files : t.files } : t);
  }
  return [...byId.values()].sort((a, b) => a.startedAt - b.startedAt);
}

export function useTurns(): Turn[] {
  const stored = useStore((s) => s.turns);
  const delegates = useStore((s) => s.delegates);
  const fast = useStore((s) => s.fast);
  return useMemo(() => mergeTurns(stored, delegates, fast), [stored, delegates, fast]);
}
