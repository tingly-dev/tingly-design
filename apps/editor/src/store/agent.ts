// The request bar and the conversation: the fast model's run, Claude Code's runs, the stored turns and where the prompt lives.
// Pure: it holds the types, the initial values and the patches; `store.ts` composes them into the one `useStore`.
import type { AgentStep, Conversation, Turn } from '@dc/core';
import type { ServerEvent } from '../api';
import { readPref } from '../local';

export interface FastLine {
  code: string;
  ok: boolean;
  error?: string;
  /** a marker between attempts, not a statement */
  divider?: boolean;
}

export interface FastState {
  status: 'idle' | 'running' | 'done' | 'error' | 'delegated';
  mode: 'ai' | 'jquery';
  file?: string;
  prompt?: string;
  lines: FastLine[];
  note?: string;
  startedAt?: number;
  endedAt?: number;
  /** the run saved a change, so it can be undone */
  changed?: boolean;
}

/** One line of a Claude Code run: a step it took, or something it said. */
type DelegateEntry = { step: AgentStep; at: number } | { say: string; at: number };

export interface DelegateState {
  id: string;
  prompt: string;
  state: 'start' | 'progress' | 'done' | 'error' | 'stopped';
  log: DelegateEntry[];
  startedAt: number;
  endedAt?: number;
  result?: string;
  /** set when the fast model handed the request over */
  via?: 'fast';
  /** where the request came from (the editor, unless the command line or an agent over MCP sent it) */
  source?: 'editor' | 'cli' | 'mcp';
  /** Claude Code's session id, once it reports one: the next request can continue it */
  session?: string;
  /** this run continued an earlier session instead of starting a fresh one */
  continued?: boolean;
  /** project files the run changed, in the order it first touched them */
  files: string[];
  /** each changed file before the run touched it (null: the run created it) and as the run left it, to undo the run */
  before: Record<string, string | null>;
  after: Record<string, string>;
  undone?: boolean;
}

/** Which run the prompt bar's feed shows: the fast model's, or a Claude Code run by id. */
export type LastRun = { kind: 'fast' } | { kind: 'delegate'; id: string } | null;

export type BarMode = 'left' | 'float';

export interface AgentState {
  fast: FastState;
  delegates: DelegateState[];
  /** the run the feed above the prompt shows, and whether the person closed it */
  lastRun: LastRun;
  runHidden: boolean;
  /** how many run feeds are on screen: when none is, a finished run is announced by a toast instead */
  feeds: number;
  /** the prompt bar folded to a pill (kept across sessions) */
  barCollapsed: boolean;
  /** where the prompt lives: the bar at the bottom of the stage (`float`, the default), or a column of conversation on the left (`left`) */
  barMode: BarMode;
  /** the list of earlier requests open above the bar */
  historyOpen: boolean;
  /** the project's stored conversation, oldest first: runs that ended, from the server and from this session (the live ones are read from `delegates` and `fast`) */
  turns: Turn[];
  /** which tab of the conversation column shows when the kind has a list of its own */
  chatTab: 'list' | 'chat';
  /** the conversation tab's dot while the person is on the other tab: a result arrived, or a run failed */
  chatNote: 'new' | 'failed' | null;
  /** the project's Claude Code conversation, kept by the server: the next request continues it */
  conversation: Conversation | null;
  /** the next Claude Code request starts a fresh session even though one could be continued */
  freshNext: boolean;
}

export const agentInitial = (): AgentState => ({
  fast: { status: 'idle', mode: 'ai', lines: [] },
  delegates: [],
  conversation: null,
  lastRun: null,
  runHidden: false,
  feeds: 0,
  barCollapsed: readPref('dc.barCollapsed') === '1',
  // the right-edge dock this value used to name (`auto`) is the left column now
  barMode: readPref('dc.barMode') === 'left' || readPref('dc.barMode') === 'auto' ? 'left' : 'float',
  historyOpen: false,
  turns: [],
  chatTab: 'chat',
  chatNote: null,
  freshNext: false,
});

/** What a newly opened project starts from: the conversation of the last one is gone (the bar's own look is kept). */
export const agentReset = (): Partial<AgentState> => ({ delegates: [], conversation: null, lastRun: null, runHidden: false, turns: [], chatTab: 'chat', chatNote: null, historyOpen: false, freshNext: false });

/** Add a turn to the stored ones, or replace the one with its id. */
function upsertTurn(list: Turn[], turn: Turn): Turn[] {
  const i = list.findIndex((t) => t.id === turn.id);
  const next = i < 0 ? [...list, turn] : list.map((t, j) => (j === i ? turn : t));
  return next.slice(-200);
}

/** A run ended: it joins the stored turns, and the conversation tab says so when the person is not on it. */
export const endTurnPatch = (s: AgentState, turn: Turn): Partial<AgentState> => ({
  turns: upsertTurn(s.turns, turn),
  ...(s.chatTab !== 'chat' ? { chatNote: turn.state === 'done' ? (s.chatNote === 'failed' ? 'failed' : 'new') : turn.state === 'error' ? 'failed' : s.chatNote } : {}),
});

type DelegateEvent = Extract<ServerEvent, { type: 'delegate' }>;

/** A Claude Code run reported something: the run's entry in `delegates` follows, and a new run takes over the feed. */
export function delegateEventPatch(s: AgentState, e: DelegateEvent, now: number): Partial<AgentState> {
  const list = [...s.delegates];
  const i = list.findIndex((x) => x.id === e.id);
  const d: DelegateState =
    i >= 0
      ? { ...list[i] }
      : { id: e.id, prompt: e.text ?? '', state: 'start', log: [], startedAt: e.at ?? now, files: [], before: {}, after: {}, ...(s.fast.status === 'delegated' && s.lastRun?.kind === 'fast' ? { via: 'fast' as const } : {}) };
  if (i >= 0) list[i] = d;
  else list.push(d);
  if (e.state === 'start') {
    d.prompt = e.text ?? d.prompt;
    if (e.at) d.startedAt = e.at;
    if (e.continued) d.continued = true;
    if (e.source) d.source = e.source;
  }
  if (e.session) d.session = e.session;
  if (e.continued === false) d.continued = false;
  if (e.state === 'progress') {
    if (e.step) {
      d.log = [...d.log, { step: e.step, at: now }].slice(-60);
      if (e.step.changed && !d.files.includes(e.step.changed)) d.files = [...d.files, e.step.changed];
    } else if (e.text) d.log = [...d.log, { say: e.text, at: now }].slice(-60);
  }
  if (e.state === 'done' || e.state === 'error' || e.state === 'stopped') {
    // a stopped run says so in the feed's own words (prompt.run.stoppedNote); the server sends no text for it
    d.result = e.state === 'stopped' ? undefined : e.text;
    d.endedAt = now;
  }
  if (e.state !== 'start') d.state = e.state;
  // a new run takes over the feed; a later event of an older run does not
  const fresh = i < 0;
  // the server keeps the conversation from the moment a run reports its session, whatever the run's end
  const conversation = e.session ? { session: e.session, prompt: d.prompt, at: now } : s.conversation;
  return { delegates: list.slice(-5), conversation, ...(fresh ? { lastRun: { kind: 'delegate', id: e.id } as LastRun, runHidden: false } : {}) };
}
