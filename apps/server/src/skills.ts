import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isSkillId, type SkillInfo, type SkillScope } from '@dc/core';
import { fromRoot, ROOT } from './layout';
import { projectDir } from './store';
import { logWarn } from './log';

/**
 * The skills a chat may choose (.design/chat-skills.md): every `.claude/skills/<id>/SKILL.md` a
 * person's machine has, in the project's own folder, this repository's (or the bundle's) and the
 * user's `~/.claude/skills`, in that order of precedence when a name is in more than one.
 *
 * Claude Code runs in `ROOT`, so it discovers the built-in and user skills by itself but not a
 * project's own: a chosen skill is named in the request's system prompt with the path of its
 * SKILL.md, whichever scope it comes from, and that is what makes it part of the run.
 */

/** The project's choice, local to this machine like .references.json: neither in a zip nor a commit. */
const CHOSEN_FILE = '.claude-skills.json';

/** Where skills are looked for, weakest first. */
function locations(project: string): { scope: SkillScope; dir: string }[] {
  return [
    { scope: 'user', dir: join(homedir(), '.claude', 'skills') },
    { scope: 'builtin', dir: join(ROOT, '.claude', 'skills') },
    { scope: 'project', dir: join(projectDir(project), '.claude', 'skills') },
  ];
}

/** A SKILL.md's frontmatter: the name it answers to and the one line that says when to read it. */
function front(text: string): { name: string; description: string } {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
  const field = (k: string) => new RegExp(`^${k}:\\s*(.*)$`, 'm').exec(block)?.[1]?.trim().replace(/^(["'])(.*)\1$/, '$2') ?? '';
  return { name: field('name'), description: field('description') };
}

/** Every skill this machine offers, by folder name, a later scope winning a name an earlier one also has. */
export function listSkills(project: string): SkillInfo[] {
  const byId = new Map<string, SkillInfo>();
  for (const { scope, dir } of locations(project)) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const id of names) {
      if (!isSkillId(id)) continue;
      const file = join(dir, id, 'SKILL.md');
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const { name, description } = front(text);
      byId.set(id, { id, name: name || id, description, scope, path: fromRoot(file) });
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** The skills the project's chat has chosen, by folder name; names no skill has anymore are not returned. */
export function readSkillChoice(project: string): string[] {
  try {
    const v = JSON.parse(readFileSync(join(projectDir(project), CHOSEN_FILE), 'utf8')) as { skills?: unknown };
    const ids = Array.isArray(v.skills) ? v.skills : [];
    const known = new Set(listSkills(project).map((s) => s.id));
    return [...new Set(ids.filter((x): x is string => isSkillId(x) && known.has(x)))];
  } catch {
    return [];
  }
}

/** Replaces the project's choice; what comes back is what was kept (dropped: names no skill has). */
export function writeSkillChoice(project: string, input: unknown): string[] {
  const known = new Set(listSkills(project).map((s) => s.id));
  const ids = Array.isArray(input) ? input.filter((x): x is string => isSkillId(x) && known.has(x)) : [];
  const kept = [...new Set(ids)];
  try {
    writeFileSync(join(projectDir(project), CHOSEN_FILE), JSON.stringify({ skills: kept }, null, 2) + '\n', 'utf8');
  } catch (e) {
    logWarn('skills.writeFailed', { project, error: (e as Error).message });
  }
  return kept;
}