import type { Hono } from 'hono';
import { HttpError, kindOf, projectDir } from '../store';
import { listSkills, readSkillChoice, writeSkillChoice } from '../skills';

/** The skills a chat may choose (.design/chat-skills.md): what this machine has, and the project's own choice. */
export function registerSkills(app: Hono): void {
  app.get('/api/projects/:p/skills', async (c) => {
    const p = c.req.param('p');
    if (!(await kindOf(projectDir(p)))) throw new HttpError(404, 'noProject', { name: p });
    return c.json({ skills: listSkills(p), chosen: readSkillChoice(p) });
  });

  app.put('/api/projects/:p/skills', async (c) => {
    const p = c.req.param('p');
    if (!(await kindOf(projectDir(p)))) throw new HttpError(404, 'noProject', { name: p });
    const body = await c.req.json<{ skills?: unknown }>().catch(() => ({}) as { skills?: unknown });
    return c.json({ chosen: writeSkillChoice(p, body.skills) });
  });
}