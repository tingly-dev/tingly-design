/**
 * The Claude Code conversation a project keeps (.design/agent-panel.md): the session id of its
 * last run, held by the server so a reload, another window, the CLI or an agent over MCP all
 * continue the same context. Pure rules here; the file and the process are the server's.
 */

export interface Conversation {
  /** Claude Code's session id */
  session: string;
  /** the request that last ran in it, for the "Continues: …" mark */
  prompt: string;
  /** when that run ended, ms since the epoch */
  at: number;
}

/** A Claude Code session id is a UUID; anything else is not passed on to the command line. */
export const isSessionId = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s);

/** What the project's conversation file says, or null when it is missing or damaged. */
export function parseConversation(text: string): Conversation | null {
  try {
    const v = JSON.parse(text) as Partial<Conversation>;
    if (!isSessionId(v.session)) return null;
    return { session: v.session, prompt: typeof v.prompt === 'string' ? v.prompt : '', at: typeof v.at === 'number' ? v.at : 0 };
  } catch {
    return null;
  }
}

/**
 * The session a request runs in. An explicit session wins; `fresh` starts a new one; otherwise the
 * project's last conversation is continued (the common case is going back and forth on one thing).
 */
export function sessionFor(req: { resume?: unknown; fresh?: unknown }, kept: Conversation | null): string | undefined {
  if (isSessionId(req.resume)) return req.resume;
  if (req.fresh === true) return undefined;
  return kept?.session;
}

/** Whether a failed run died because Claude Code no longer has the session it was asked to resume. */
export const resumeLost = (text: string): boolean => /no conversation found|session.*(not found|does not exist)/i.test(text);
