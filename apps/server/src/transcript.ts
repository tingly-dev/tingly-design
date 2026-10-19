import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compactTranscript, parseTranscript, trimTurn, TRANSCRIPT_LIMITS, type Turn } from '@dc/core';
import { projectDir } from './store';
import { logWarn } from './log';

/**
 * The project's conversation (.design/chat-panel.md): one line per update of a turn in
 * `.transcript.jsonl`, local to this machine like `.runs.json`. A turn is written when it starts,
 * now and then while it runs, and when it ends; reading takes each turn's last line.
 */

const file = (project: string) => join(projectDir(project), '.transcript.jsonl');

/** Lines appended since the file was last rewritten, per project; past the limit it is compacted. */
const appended = new Map<string, number>();

/** The newest `limit` turns of a project, oldest first. */
export function readTranscript(project: string, limit = 100): Turn[] {
  try {
    return parseTranscript(readFileSync(file(project), 'utf8'), limit);
  } catch {
    return [];
  }
}

/** Write a turn's current state. Never throws: a conversation that cannot be kept must not stop the run. */
export function recordTurn(project: string, turn: Turn): void {
  try {
    appendFileSync(file(project), JSON.stringify(trimTurn(turn)) + '\n', 'utf8');
    const n = (appended.get(project) ?? 0) + 1;
    if (n < TRANSCRIPT_LIMITS.turns * 2) return void appended.set(project, n);
    appended.set(project, 0);
    writeFileSync(file(project), compactTranscript(readTranscript(project, TRANSCRIPT_LIMITS.turns)), 'utf8');
  } catch (e) {
    logWarn('transcript.writeFailed', { project, error: (e as Error).message });
  }
}

/**
 * A running turn kept in step with the run: `touch` after each change writes it at most once a
 * second, `end` writes it now. Steps of a long run make a turn large; this keeps the writes few.
 */
export class TurnWriter {
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private project: string,
    readonly turn: Turn,
  ) {
    recordTurn(project, turn);
  }
  touch(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      recordTurn(this.project, this.turn);
    }, 1000);
  }
  end(state: Turn['state'], answer?: string): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.turn.state = state;
    this.turn.endedAt = Date.now();
    if (answer) this.turn.answer = answer;
    recordTurn(this.project, this.turn);
  }
}
