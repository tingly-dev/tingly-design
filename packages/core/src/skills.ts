/**
 * The skills a chat request can choose (.design/chat-skills.md): a folder `.claude/skills/<dir>/SKILL.md`
 * whose frontmatter names it and says when to read it. Pure rules here; scanning the disk and the paths
 * are the server's.
 */
import type { ProjectKind } from './deck';

/** Every kind's format reference under `.claude/skills/`, which every request of that kind reads already. */
export const KIND_SKILL: Record<ProjectKind, string> = { design: 'dc-canvas', slides: 'slides', 'design-system': 'design-system', dashboard: 'dashboard', docs: 'docs', motion: 'motion' };

/** Where a skill was found, in the order the same directory name resolves: this project, the product, the machine. */
export type SkillScope = 'project' | 'builtin' | 'user';

export const SKILL_SCOPES: SkillScope[] = ['project', 'builtin', 'user'];

/** One skill a request may pick. */
export interface SkillInfo {
  /** the folder's name: what a request carries and what a turn records */
  id: string;
  /** the frontmatter's `name`, or the folder's name when it has none */
  name: string;
  /** the frontmatter's `description`, shown in the picker */
  description: string;
  scope: SkillScope;
  /** the SKILL.md path, relative to the repository/bundle root when it is inside it */
  path: string;
}

/** A skill's id is its folder's name (no separators, so it stays a name and never a path). */
export const isSkillId = (s: unknown): s is string => typeof s === 'string' && /^[\w.-]+$/.test(s);

/** The chosen skills a request may actually use, in the order chosen, without duplicates or unknown names. */
export function chosenSkills(all: SkillInfo[], ids: unknown): SkillInfo[] {
  if (!Array.isArray(ids)) return [];
  const byId = new Map(all.map((s) => [s.id, s]));
  const out: SkillInfo[] = [];
  for (const id of ids) if (isSkillId(id) && byId.has(id) && !out.some((s) => s.id === id)) out.push(byId.get(id)!);
  return out;
}