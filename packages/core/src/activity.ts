/**
 * What an agent is doing, in the person's words. Claude Code reports tool
 * calls (`Read /abs/path`, `Grep title`); the editor shows them as steps a
 * person can follow: what was read, searched or changed, with paths
 * relative to the project, so a changed file is a name they recognise.
 * See .design/agent-feedback.md.
 */

export type StepKind = 'read' | 'search' | 'edit' | 'run' | 'plan' | 'other';

export interface AgentStep {
  kind: StepKind;
  /** what happened, short, in the editor's language */
  text: string;
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
      if (/\.claude\/skills\/[^/]+\/SKILL\.md$/.test(file)) return { kind: 'read', text: '读格式说明' };
      return { kind: 'read', text: `读 ${where}` };
    }
    case 'Glob':
      return { kind: 'search', text: `找文件 ${str(input.pattern)}`.trim() };
    case 'Grep':
    {
      const rel = inside(file, project);
      return { kind: 'search', text: `搜索“${str(input.pattern)}”${rel ? `（${rel}）` : ''}` };
    }
    case 'Edit':
    case 'MultiEdit':
    case 'Write': {
      const rel = inside(file, project);
      const text = `${tool === 'Write' ? '写' : '改'} ${where}`;
      return rel ? { kind: 'edit', text, changed: rel } : { kind: 'edit', text };
    }
    case 'Bash': {
      const cmd = str(input.command);
      if (cmd.includes('dash-query')) return { kind: 'run', text: '查询数据' };
      return { kind: 'run', text: `运行 ${cmd.length > 60 ? cmd.slice(0, 60) + '…' : cmd}`.trim() };
    }
    case 'TodoWrite':
      return { kind: 'plan', text: '列出步骤' };
    default:
      return { kind: 'other', text: tool };
  }
}

/** "12 秒", "1 分 05 秒": how long a run has taken. */
export function elapsedLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} 秒`;
  return `${Math.floor(s / 60)} 分 ${String(s % 60).padStart(2, '0')} 秒`;
}
