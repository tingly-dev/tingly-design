import type { Hono } from 'hono';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DASH_RUNS, cleanParams, fillArgs } from '@dc/core';
import { HttpError, kindOf, projectDir } from '../store';
import { CONNECTORS, ConnectorError, callTool } from '../connectors';

/** Dashboards: data sources, runs and their history. */
export function registerDashboards(app: Hono): void {
  app.get('/api/connectors', (c) => c.json(Object.fromEntries(Object.entries(CONNECTORS).map(([k, v]) => [k, { description: v.description, tools: Object.keys(v.tools) }]))));

  /** Run one dataset's call, as the original's page does on each reader's connection. */
  app.post('/api/projects/:p/query', async (c) => {
    const p = c.req.param('p');
    if ((await kindOf(projectDir(p))) !== 'dashboard') throw new HttpError(400, 'notDashboard');
    const body = await c.req.json<{ connector: string; tool: string; args: Record<string, unknown>; params?: unknown }>();
    if (!body.args || typeof body.args !== 'object' || Array.isArray(body.args)) throw new HttpError(400, 'argsMissing');
    const params = cleanParams(body.params) ?? {};
    const t0 = Date.now();
    try {
      const answer = await callTool(p, String(body.connector), String(body.tool), fillArgs(body.args, params), params);
      return c.json({ ok: true, answer, ms: Date.now() - t0 });
    } catch (e) {
      if (e instanceof ConnectorError) return c.json({ ok: false, state: e.state, message: e.message, ms: Date.now() - t0 });
      if (e instanceof HttpError) throw e;
      return c.json({ ok: false, state: 'failed', message: (e as Error).message, ms: Date.now() - t0 });
    }
  });

  /** The latest report of an open page (the original's runs document): for Claude Code to read. Not tracked. */
  app.put('/api/projects/:p/runs', async (c) => {
    const p = c.req.param('p');
    const text = await c.req.text();
    if (text.length > 256 * 1024) throw new HttpError(413, 'runsTooLarge', { size: '256 KB' });
    JSON.parse(text);
    await writeFile(join(projectDir(p), DASH_RUNS), text, 'utf8');
    return c.json({ ok: true });
  });
}
