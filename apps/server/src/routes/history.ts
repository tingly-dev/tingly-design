import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { HttpError, projectDir, readOne, safeRel } from '../store';
import { listSnapshots, readSnapshot, snapshotBefore } from '../history';
import { journal, subscribe } from '../hub';

/** Version history of a file, the change journal and the live event stream every editor listens to. */
export function registerHistory(app: Hono): void {
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
