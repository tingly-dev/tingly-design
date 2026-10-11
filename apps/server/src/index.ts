import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { streamSSE, stream } from 'hono/streaming';
import Anthropic from '@anthropic-ai/sdk';
import chokidar from 'chokidar';
import { FAST_EDIT_SYSTEM, type Actor } from '@dc/core';
import {
  HttpError,
  PROJECTS_DIR,
  REPO_ROOT,
  createProject,
  isProjectName,
  isTracked,
  listProjects,
  ownWrites,
  projectDir,
  readOne,
  readProject,
  removeFile,
  safeRel,
  versionOf,
  withLock,
  writeAtomic,
} from './store';
import { journal, lineDiffSummary, publish, record, subscribe } from './hub';
import { activeDelegates, claudeAvailable, startDelegate, type DelegateRequest } from './delegate';

const PORT = Number(process.env.PORT ?? 8787);
const FAST_MODEL = process.env.DC_FAST_MODEL ?? 'claude-haiku-5-5';
const ACTORS: Actor[] = ['human', 'jquery', 'fast-edit', 'claude', 'external', 'undo'];
const run = promisify(execFile);

const app = new Hono();

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
  console.error(err);
  return c.json({ error: err.message }, 500);
});

let cliChecked: boolean | null = null;
app.get('/api/health', (c) => {
  if (cliChecked === null) cliChecked = claudeAvailable();
  return c.json({
    ok: true,
    fastEdit: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    fastModel: FAST_MODEL,
    claudeCli: cliChecked,
    projectsDir: relative(REPO_ROOT, PROJECTS_DIR) || '.',
  });
});

app.get('/api/projects', async (c) => c.json(await listProjects()));

app.post('/api/projects', async (c) => {
  const { name, title } = await c.req.json<{ name: string; title?: string }>();
  if (!isProjectName(name)) throw new HttpError(400, '项目名只能用字母、数字、- 和 _');
  await createProject(name, title || name);
  return c.json({ ok: true });
});

app.get('/api/projects/:p/files', async (c) => c.json({ files: await readProject(c.req.param('p')) }));

app.put('/api/projects/:p/file', async (c) => {
  const p = c.req.param('p');
  const rel = safeRel(c.req.query('path') ?? '');
  const body = await c.req.json<{
    content: string;
    baseVersion: string | null;
    actor?: Actor;
    summary?: string;
    prompt?: string;
  }>();
  if (typeof body.content !== 'string') throw new HttpError(400, 'content missing');
  const actor = ACTORS.includes(body.actor as Actor) ? (body.actor as Actor) : 'human';
  return withLock(p, async () => {
    const cur = await readOne(p, rel);
    if ((cur?.version ?? null) !== body.baseVersion) {
      return c.json({ error: 'conflict', current: cur }, 409);
    }
    if (cur && cur.content === body.content) return c.json({ version: cur.version, unchanged: true });
    const version = await writeAtomic(p, rel, body.content);
    publish(p, { type: 'file', path: rel, content: body.content, version, actor });
    await record(p, {
      actor,
      file: rel,
      summary: (body.summary || lineDiffSummary(cur?.content, body.content)).slice(0, 400),
      prompt: body.prompt?.slice(0, 400),
      version,
    });
    return c.json({ version });
  });
});

app.delete('/api/projects/:p/file', async (c) => {
  const p = c.req.param('p');
  const rel = safeRel(c.req.query('path') ?? '');
  const base = c.req.query('baseVersion') ?? null;
  return withLock(p, async () => {
    const cur = await readOne(p, rel);
    if (!cur) return c.json({ ok: true });
    if (cur.version !== base) return c.json({ error: 'conflict', current: cur }, 409);
    await removeFile(p, rel);
    publish(p, { type: 'delete', path: rel, actor: 'human' });
    await record(p, { actor: 'human', file: rel, summary: 'artboard file deleted' });
    return c.json({ ok: true });
  });
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
        await new Promise<void>((r) => {
          wake = r;
          setTimeout(r, 20000);
        });
        wake = null;
        if (!queue.length && !s.aborted) await s.writeSSE({ event: 'ping', data: '{}' });
        continue;
      }
      await s.writeSSE({ data: queue.shift()! });
    }
    off();
  });
});

// ---------------------------------------------------------------- fast edit

let anthropic: Anthropic | null = null;
app.post('/api/projects/:p/fast-edit', async (c) => {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return c.json({ error: '服务端没有配置 ANTHROPIC_API_KEY，快速 AI 不可用（可以改用 jQuery 模式直接写语句）。' }, 501);
  }
  anthropic ??= new Anthropic();
  const body = await c.req.json<{ messages: { role: 'user' | 'assistant'; content: string }[] }>();
  return stream(c, async (s) => {
    const ms = anthropic!.messages.stream({
      model: FAST_MODEL,
      max_tokens: 4096,
      system: FAST_EDIT_SYSTEM,
      messages: body.messages,
    });
    s.onAbort(() => ms.abort());
    try {
      for await (const ev of ms) {
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') await s.write(ev.delta.text);
      }
    } catch (e) {
      if (!s.aborted) await s.write(`\n__ERROR__ ${(e as Error).message}\n`);
    }
  });
});

// ---------------------------------------------------------------- delegate

app.post('/api/projects/:p/delegate', async (c) => {
  const p = c.req.param('p');
  projectDir(p);
  if (cliChecked === null) cliChecked = claudeAvailable();
  if (!cliChecked) return c.json({ error: '本机没有可用的 claude CLI，无法委托。' }, 501);
  const req = await c.req.json<DelegateRequest>();
  if (!req.prompt?.trim()) throw new HttpError(400, 'prompt missing');
  return c.json({ id: startDelegate(p, req) });
});

// ---------------------------------------------------------------- git

app.post('/api/projects/:p/commit', async (c) => {
  const p = c.req.param('p');
  const dir = relative(REPO_ROOT, projectDir(p));
  const { message } = await c.req.json<{ message?: string }>().catch(() => ({ message: undefined }));
  try {
    await run('git', ['add', '-A', '--', dir], { cwd: REPO_ROOT });
    const st = await run('git', ['diff', '--cached', '--stat', '--', dir], { cwd: REPO_ROOT });
    if (!st.stdout.trim()) return c.json({ ok: false, output: '没有需要提交的改动。' });
    const out = await run('git', ['commit', '-m', message?.trim() || `canvas(${p}): update`, '--', dir], { cwd: REPO_ROOT });
    return c.json({ ok: true, output: out.stdout.trim().split('\n')[0] });
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    return c.json({ ok: false, output: (err.stderr || err.message).trim() }, 500);
  }
});

// ---------------------------------------------------------------- static

app.use(
  '/sandbox/*',
  async (c, next) => {
    await next();
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Cache-Control', 'no-store');
  },
  serveStatic({ root: relative(process.cwd(), join(REPO_ROOT, 'packages/sandbox/dist')), rewriteRequestPath: (path) => path.replace(/^\/sandbox/, '') }),
);

if (process.env.NODE_ENV === 'production') {
  const dist = relative(process.cwd(), join(REPO_ROOT, 'apps/editor/dist'));
  app.use('/*', serveStatic({ root: dist }));
  app.get('*', async (c) => c.html(await readFile(join(REPO_ROOT, 'apps/editor/dist/index.html'), 'utf8')));
}

// ---------------------------------------------------------------- watcher

/** Last content seen per file, for diff summaries of outside edits. */
const seen = new Map<string, string>();

const watcher = chokidar.watch(PROJECTS_DIR, {
  ignoreInitial: false,
  ignored: (path: string) => /(^|[/\\])\.[^/\\]+$/.test(path) && path !== PROJECTS_DIR,
  awaitWriteFinish: { stabilityThreshold: 60, pollInterval: 20 },
});

function split(abs: string): { project: string; rel: string } | null {
  const r = relative(PROJECTS_DIR, abs).split(sep);
  if (r.length < 2 || !isProjectName(r[0])) return null;
  const rel = r.slice(1).join('/');
  return isTracked(rel) ? { project: r[0], rel } : null;
}

let ready = false;
watcher.on('ready', () => {
  ready = true;
});
watcher.on('all', async (event, abs) => {
  const at = split(abs);
  if (!at) return;
  const key = `${at.project}/${at.rel}`;
  if (event === 'unlink') {
    if (ownWrites.get(key) === 'deleted') return;
    seen.delete(key);
    publish(at.project, { type: 'delete', path: at.rel, actor: 'external' });
    return;
  }
  if (event !== 'add' && event !== 'change') return;
  let content: string;
  try {
    content = await readFile(abs, 'utf8');
  } catch {
    return;
  }
  const before = seen.get(key);
  seen.set(key, content);
  if (!ready) return;
  const version = versionOf(content);
  if (ownWrites.get(key) === version) return;
  if (before === content) return;
  const actor: Actor = activeDelegates.has(at.project) ? 'claude' : 'external';
  publish(at.project, { type: 'file', path: at.rel, content, version, actor });
  await record(at.project, { actor, file: at.rel, summary: lineDiffSummary(before, content), version });
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`dc-canvas server on http://localhost:${info.port}  (projects: ${PROJECTS_DIR})`);
});
