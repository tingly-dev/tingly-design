import { DS_README, DS_TOKENS_CSS, type Actor } from '@dc/core';
import { claudeAvailable } from '../delegate';
import { publish, record } from '../hub';
import { HttpError, kindOf, projectDir, readOne, regenTokensCss, writeAtomic } from '../store';

let cliChecked: boolean | null = null;
/** Whether the Claude Code command is on this machine. Asked once. */
export function claudeCliReady(): boolean {
  cliChecked ??= claudeAvailable();
  return cliChecked;
}

/** tokens.json changed in a design system: rebuild tokens.css and tell every editor. */
export async function afterTokens(p: string, actor: Actor): Promise<void> {
  if ((await kindOf(projectDir(p))) !== 'design-system') return;
  const regen = await regenTokensCss(p);
  if (regen?.css) publish(p, { type: 'file', path: DS_TOKENS_CSS, content: regen.css.content, version: regen.css.version, actor });
  if (regen?.readme) publish(p, { type: 'file', path: DS_README, content: regen.readme.content, version: regen.readme.version, actor });
}

/** Read a JSON index, change it, write it back as one versioned edit everyone sees. */
export async function editIndex(p: string, rel: string, fn: (json: Record<string, unknown>) => void, summary: string): Promise<void> {
  const cur = await readOne(p, rel);
  let json: Record<string, unknown> = {};
  try {
    json = cur ? JSON.parse(cur.content) : {};
  } catch {
    throw new HttpError(409, 'invalidJson', { path: rel });
  }
  fn(json);
  const content = JSON.stringify(json, null, 2) + '\n';
  if (cur?.content === content) return;
  const version = await writeAtomic(p, rel, content);
  publish(p, { type: 'file', path: rel, content, version, actor: 'human' });
  await record(p, { actor: 'human', file: rel, summary, version });
}
