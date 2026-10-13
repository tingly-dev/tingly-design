import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Actor, AgentStep, JournalEntry } from '@dc/core';
import { projectDir } from './store';

/**
 * Live state shared by everyone looking at a project: an event stream and
 * the journal — one line per change, whoever made it.
 */

export type HubEvent =
  | { type: 'file'; path: string; content: string; version: string; actor: Actor }
  | { type: 'delete'; path: string; actor: Actor }
  | { type: 'journal'; entry: JournalEntry }
  | { type: 'delegate'; id: string; state: 'start' | 'progress' | 'done' | 'error' | 'stopped'; text?: string; step?: AgentStep; at?: number }
  /** images or fonts were added or removed (binary files carry no content in events) */
  | { type: 'assets'; path?: string };

type Listener = (e: HubEvent) => void;
const listeners = new Map<string, Set<Listener>>();
const journals = new Map<string, JournalEntry[]>();

/**
 * Claude Code runs still going, event by event, so an editor that opens
 * (or reloads) mid-run sees what it has done so far instead of nothing.
 */
const running = new Map<string, Map<string, HubEvent[]>>();

export function subscribe(project: string, fn: Listener): () => void {
  let set = listeners.get(project);
  if (!set) listeners.set(project, (set = new Set()));
  set.add(fn);
  for (const events of running.get(project)?.values() ?? []) for (const e of events) fn(e);
  return () => set!.delete(fn);
}

export function publish(project: string, e: HubEvent): void {
  if (e.type === 'delegate') {
    let runs = running.get(project);
    if (!runs) running.set(project, (runs = new Map()));
    if (e.state === 'start' || e.state === 'progress') runs.set(e.id, [...(runs.get(e.id) ?? []), e].slice(-200));
    else runs.delete(e.id);
  }
  for (const fn of listeners.get(project) ?? []) {
    try {
      fn(e);
    } catch {
      // a closed stream; it unsubscribes itself
    }
  }
}

async function load(project: string): Promise<JournalEntry[]> {
  let j = journals.get(project);
  if (j) return j;
  j = [];
  try {
    const text = await readFile(join(projectDir(project), '.journal.jsonl'), 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        j.push(JSON.parse(line));
      } catch {
        // skip a torn line
      }
    }
  } catch {
    // no journal yet
  }
  j = j.slice(-500);
  journals.set(project, j);
  return j;
}

export async function journal(project: string): Promise<JournalEntry[]> {
  return [...(await load(project))];
}

export async function record(
  project: string,
  e: Omit<JournalEntry, 'id' | 'at'>,
): Promise<JournalEntry> {
  const entry: JournalEntry = { id: randomUUID().slice(0, 8), at: new Date().toISOString(), ...e };
  const j = await load(project);
  j.push(entry);
  if (j.length > 500) j.splice(0, j.length - 500);
  await appendFile(join(projectDir(project), '.journal.jsonl'), JSON.stringify(entry) + '\n', 'utf8');
  publish(project, { type: 'journal', entry });
  return entry;
}

/** A short "what changed" for an edit made outside the editor. */
export function lineDiffSummary(before: string | undefined, after: string): string {
  if (before === undefined) return 'file created';
  const a = before.split('\n');
  const b = after.split('\n');
  const setA = new Map<string, number>();
  for (const l of a) setA.set(l, (setA.get(l) ?? 0) + 1);
  let added = 0;
  for (const l of b) {
    const n = setA.get(l) ?? 0;
    if (n > 0) setA.set(l, n - 1);
    else added++;
  }
  let removed = 0;
  for (const n of setA.values()) removed += n;
  return `+${added} −${removed} lines`;
}
