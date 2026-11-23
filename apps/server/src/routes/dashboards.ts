import type { Hono } from 'hono';
import { cleanParams, fillArgs } from '@dc/core';
import { HttpError, kindOf, projectDir } from '../store';
import { CONNECTORS, ConnectorError, callTool } from '../connectors';

/** Dashboards: data sources and their calls. */
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
}
