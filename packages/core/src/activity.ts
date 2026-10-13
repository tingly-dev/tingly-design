/**
 * What an agent is doing, in the person's words. Claude Code reports tool
 * calls (`Read /abs/path`, `Grep title`); the editor shows them as steps a
 * person can follow: what was read, searched or changed, with paths
 * relative to the project, so a changed file is a name they recognise.
 * A step carries what happened and to what, not a sentence: the editor
 * words it in the language it is showing (`prompt.step.<op>` in @dc/i18n),
 * so two people watching the same run each read it in their own.
 * See .design/agent-feedback.md and .design/i18n.md.
 */

export type StepKind = 'read' | 'search' | 'edit' | 'run' | 'plan' | 'other';

/** what the step did; each has a `prompt.step.<op>` string */
export type StepOp = 'readSkill' | 'read' | 'glob' | 'grep' | 'grepIn' | 'write' | 'edit' | 'query' | 'run' | 'plan' | 'tool';

export interface AgentStep {
  kind: StepKind;
  op: StepOp;
  /** what it was done to: a path, a pattern, a command or a tool name */
  target?: string;
  /** where a search looked, relative to the project */
  within?: string;
  /** a project file this step changed (edit and write only), relative to the project folder */
  changed?: string;
}

export interface ToolInput {
  file_path?: unknown;
  path?: unknown;
  pattern?: unknown;
  command?: unknown;
  [k: string]: unknown;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** A path relative to `base` when it is inside it, else null. */
function inside(p: string, base: string): string | null {
  const b = base.replace(/\/+$/, '') + '/';
  return p.startsWith(b) ? p.slice(b.length) : null;
}

function shown(p: string, root: string, project: string): string {
  if (!p) return '';
  const rel = inside(p, project);
  if (rel !== null) return rel;
  const fromRoot = inside(p, root);
  return fromRoot ?? p.split('/').pop() ?? p;
}

/**
 * One tool call as a step. `root` is where Claude Code runs (skills live
 * under it); `project` is the absolute project folder. Paths may come
 * absolute or relative to `root`.
 */
export function describeTool(tool: string, input: ToolInput, root: string, project: string): AgentStep {
  const abs = (p: string) => (p && !p.startsWith('/') ? `${root.replace(/\/+$/, '')}/${p}` : p);
  const file = abs(str(input.file_path) || str(input.path));
  const where = shown(file, root, project);
  switch (tool) {
    case 'Read': {
      if (/\.claude\/skills\/[^/]+\/SKILL\.md$/.test(file)) return { kind: 'read', op: 'readSkill' };
      return { kind: 'read', op: 'read', target: where };
    }
    case 'Glob':
      return { kind: 'search', op: 'glob', target: str(input.pattern) };
    case 'Grep': {
      const rel = inside(file, project);
      return rel ? { kind: 'search', op: 'grepIn', target: str(input.pattern), within: rel } : { kind: 'search', op: 'grep', target: str(input.pattern) };
    }
    case 'Edit':
    case 'MultiEdit':
    case 'Write': {
      const rel = inside(file, project);
      const step: AgentStep = { kind: 'edit', op: tool === 'Write' ? 'write' : 'edit', target: where };
      return rel ? { ...step, changed: rel } : step;
    }
    case 'Bash': {
      const cmd = str(input.command);
      if (cmd.includes('dash-query')) return { kind: 'run', op: 'query' };
      return { kind: 'run', op: 'run', target: cmd.length > 60 ? cmd.slice(0, 60) + '…' : cmd };
    }
    case 'TodoWrite':
      return { kind: 'plan', op: 'plan' };
    default:
      return { kind: 'other', op: 'tool', target: tool };
  }
}

/** How long a run has taken, as minutes and seconds; the editor words it. */
export function elapsed(ms: number): { m: number; s: number } {
  const total = Math.max(0, Math.floor(ms / 1000));
  return { m: Math.floor(total / 60), s: total % 60 };
}
