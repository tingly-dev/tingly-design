import type { Hono } from 'hono';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { streamSSE } from 'hono/streaming';
import { DASH_RUNS, cleanParams, fillArgs } from '@dc/core';
import { HttpError, kindOf, projectDir, readOne, safeRel } from '../store';
import { listSnapshots, readSnapshot, snapshotBefore } from '../history';
import { journal, subscribe } from '../hub';
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

  app.get('/api/projects/:p/history', async (c) => c.json(await listSnapshots(c.req.param('p'), safeRel(c.req.query('path') ?? ''))));
  /** Keep the tab as it is now (a restore is about to replace it). */
  app.post('/api/projects/:p/history', async (c) => {
    const p = c.req.param('p');
    const rel = safeRel(c.req.query('path') ?? '');
    const cur = await readOne(p, rel);
    if (cur) await snapshotBefore(p, rel, cur.content, true);
    return c.json({ ok: true });
  });
  app.get('/api/projects/:p/history/item', async (c) => {
    const text = await readSnapshot(c.req.param('p'), safeRel(c.req.query('path') ?? ''), c.req.query('id') ?? '');
    if (text === null) throw new HttpError(404, 'versionMissing');
    return c.json({ content: text });
  });

  app.get('/api/projects/:p/journal', async (c) => c.json(await journal(c.req.param('p'))));

  app.get('/api/projects/:p/events', (c) => {
    const p = c.req.param('p');
    projectDir(p);
    return streamSSE(c, async (s) => {
      const queue: string[] = [];
      let wake: (() => void) | null = null;
      const off = subscribe(p, (e) => {
        queue.push(JSON.stringify(e));
        wake?.();
      });
      s.onAbort(() => {
        off();
        wake?.();
      });
      await s.writeSSE({ event: 'hello', data: '{}' });
      while (!s.aborted) {
        if (!queue.length) {
          // the ping timer goes with the wait, so a closed stream leaves nothing keeping the process up
          let ping: NodeJS.Timeout | undefined;
          await new Promise<void>((r) => {
            wake = r;
            ping = setTimeout(r, 20000);
          });
          clearTimeout(ping);
          wake = null;
          if (!queue.length && !s.aborted) await s.writeSSE({ event: 'ping', data: '{}' });
          continue;
        }
        await s.writeSSE({ data: queue.shift()! });
      }
      off();
    });
  });
}
