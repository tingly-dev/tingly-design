/**
 * The conversation a project keeps (.design/chat-panel.md): one turn per request, with what the
 * person said, the steps the agent took, its answer and the files it changed. The server appends
 * a line per update to `.transcript.jsonl`, local to this machine; a turn's last line wins. Pure
 * rules here; the file and the processes are the server's.
 */
import type { AgentStep } from './activity';

export type TurnEntry = { step: AgentStep; at: number } | { say: string; at: number } | { omitted: number };

export interface Turn {
  id: string;
  /** who ran it: the fast model, or Claude Code */
  agent: 'fast' | 'claude';
  prompt: string;
  /** where the request came from */
  source: 'editor' | 'cli' | 'mcp';
  state: 'running' | 'done' | 'error' | 'stopped';
  /** Claude Code: continued the project's conversation (true) or began a new one (false) */
  continued?: boolean;
  /** the fast model handed the request to Claude Code */
  via?: 'fast';
  startedAt: number;
  endedAt?: number;
  /** what the agent did, in order (the fast model's statements are `say` entries) */
  steps: TurnEntry[];
  /** the agent's final words */
  answer?: string;
  /** project files the turn changed, in the order it first touched them */
  files: string[];
}

/** What is kept: the most recent turns, each with its steps and words cut to a size. */
export const TRANSCRIPT_LIMITS = { turns: 200, steps: 300, text: 4000 } as const;

const STATES = ['running', 'done', 'error', 'stopped'];
const SOURCES = ['editor', 'cli', 'mcp'];

/** A parsed line is a turn when it has the fields the panel draws; anything else is dropped. */
export function isTurn(v: unknown): v is Turn {
  const t = v as Partial<Turn> | null;
  return (
    !!t &&
    typeof t === 'object' &&
    typeof t.id === 'string' &&
    (t.agent === 'fast' || t.agent === 'claude') &&
    typeof t.prompt === 'string' &&
    typeof t.startedAt === 'number' &&
    STATES.includes(t.state as string) &&
    SOURCES.includes(t.source as string) &&
    Array.isArray(t.steps) &&
    Array.isArray(t.files)
  );
}

const cut = (s: string | undefined, n: number) => (s && s.length > n ? s.slice(0, n) : s);

/** A turn within the limits: long text cut, and more than `steps` entries folded to the first and last with a count between. */
export function trimTurn(t: Turn): Turn {
  const { steps: max, text } = TRANSCRIPT_LIMITS;
  let steps = t.steps;
  if (steps.length > max) {
    const head = Math.floor(max / 2);
    const tail = max - head - 1;
    steps = [...steps.slice(0, head), { omitted: steps.length - head - tail }, ...steps.slice(steps.length - tail)];
  }
  return { ...t, prompt: cut(t.prompt, text)!, ...(t.answer !== undefined ? { answer: cut(t.answer, text) } : {}), steps };
}

/**
 * The turns a transcript file holds, oldest first. A turn is written again at every change, so
 * the last line for an id wins and the turn keeps the place of its first line; a damaged line
 * is skipped. At most `limit` of the newest.
 */
export function parseTranscript(text: string, limit: number = TRANSCRIPT_LIMITS.turns): Turn[] {
  const byId = new Map<string, Turn>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const v: unknown = JSON.parse(line);
      if (isTurn(v)) byId.set(v.id, v);
    } catch {
      // a half-written line
    }
  }
  return [...byId.values()].slice(-limit);
}

/** The text a transcript file is rewritten to once it has grown past the limits (one line per turn). */
export function compactTranscript(turns: Turn[]): string {
  return turns.slice(-TRANSCRIPT_LIMITS.turns).map((t) => JSON.stringify(trimTurn(t))).join('\n') + '\n';
}
