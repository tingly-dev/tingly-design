/**
 * Putting the routes on a port: the sample projects on first start, the watcher
 * that turns outside edits into journal entries and live updates, and the
 * listening socket. The server entry (index.ts) and the CLI (cli.ts) both start
 * the server through `startServer`; neither does anything else on its own.
 */
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { serve } from '@hono/node-server';
import chokidar from 'chokidar';
import { DS_TOKENS, isDataPath, type Actor } from '@dc/core';
import { afterTokens, app } from './app';
import { activeDelegates, stopDelegates } from './delegate';
import { lineDiffSummary, publish, record } from './hub';
import { BASE_PATH, BUNDLED, PROJECTS_DIR, PROTOCOL, VERSION } from './layout';
import { logError, logInfo } from './log';
import { announce, retire, serving } from './running';
import { isProjectName, isTracked, linkedProjects, onLinksChange, ownWrites, seedSamples, versionOf } from './store';

export interface ServerOptions {
  port: number;
  /** The address to listen on; loopback unless the editor is meant to be shared on the network. */
  host: string;
  /** Write `.server.json` so commands find this editor (running.ts); off for a server a command starts for itself. */
  announce?: boolean;
}

export interface RunningServer {
  port: number;
  /** The editor's address, with the base path and a trailing slash. */
  url: string;
  /** Stops any Claude Code run, the watcher and the socket. */
  close(): Promise<void>;
}

export async function startServer(o: ServerOptions): Promise<RunningServer> {
  if (await seedSamples()) logInfo('samples.copied', { dir: PROJECTS_DIR });

  const fetch: typeof app.fetch = BASE_PATH
    ? (req, ...rest) => {
        const r = underBase(req);
        return r instanceof Response ? r : app.fetch(r, ...rest);
      }
    : app.fetch;

  const { server, port } = await new Promise<{ server: ReturnType<typeof serve>; port: number }>((ok, fail) => {
    const server = serve({ fetch, port: o.port, hostname: o.host }, (info) => ok({ server, port: info.port }));
    server.once('error', fail);
  });
  // only once the port is ours: a caller that retries on another port must not leave a second watcher behind
  const watcher = watchProjects();

  const url = `http://${o.host === '0.0.0.0' ? 'localhost' : o.host}:${port}${BASE_PATH}/`;
  // the command line finds this editor through the projects folder (running.ts); under `pnpm dev`
  // the editor itself is Vite's page, not this port
  const editor = process.env.NODE_ENV === 'production' || BUNDLED ? url : process.env.DC_EDITOR_URL || 'http://localhost:5173/';
  serving(url, editor);
  if (o.announce !== false) {
    announce(url, editor);
    // a process.exit() anywhere (a signal, a host closing stdin) still takes the file back
    process.once('exit', retire);
  }

  let closing: Promise<void> | null = null;
  return {
    port,
    url,
    close() {
      closing ??= (async () => {
        retire();
        stopDelegates();
        await watcher.close();
        await new Promise<void>((ok) => {
          server.close(() => ok());
          // open event streams would otherwise hold close() until they time out
          (server as { closeAllConnections?: () => void }).closeAllConnections?.();
        });
      })();
      return closing;
    },
  };
}

/**
 * The server as a host runs it (`node server.mjs`, `tingly-design serve`, `pnpm dev`): the
 * address line, then one machine-readable ready line for a host that launched it with PORT=0,
 * and a clean stop on SIGTERM, SIGINT or (DC_EXIT_WITH_STDIN=1) stdin closing. See docs/en/embedding.md.
 */
export async function runServer(o: ServerOptions): Promise<RunningServer> {
  const server = await startServer(o);
  console.log(`tingly-design ${VERSION} on ${server.url}  (projects: ${PROJECTS_DIR})`);
  console.log(`TINGLY_DESIGN_READY ${JSON.stringify({ port: server.port, basePath: BASE_PATH, version: VERSION, protocol: PROTOCOL })}`);
  stopOnSignal(server);
  return server;
}

/** Stop the server, and any Claude Code run it started, when the process is told to or its host goes away. */
export function stopOnSignal(server: RunningServer): void {
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void server.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  // a host holds our stdin open and closes it by exiting, however it exits
  if (process.env.DC_EXIT_WITH_STDIN === '1') process.stdin.on('end', stop).on('error', stop).resume();
}

/**
 * Under DC_BASE_PATH every route moves below the prefix: the bare prefix
 * redirects to prefix/ (the editor's assets are relative to it) and anything
 * outside it is not ours.
 */
function underBase(req: Request): Request | Response {
  const url = new URL(req.url);
  if (url.pathname === BASE_PATH) return new Response(null, { status: 308, headers: { location: `${BASE_PATH}/${url.search}` } });
  if (!url.pathname.startsWith(BASE_PATH + '/')) return new Response('not found', { status: 404 });
  url.pathname = url.pathname.slice(BASE_PATH.length);
  return new Request(url, req);
}

/** Outside edits (a terminal, Claude Code, git) become live updates and journal entries. */
function watchProjects() {
  /** Last content seen per file, for diff summaries of outside edits. */
  const seen = new Map<string, string>();

  const isLinkRoot = (path: string) => [...linkedProjects().values()].includes(path);
  const watcher = chokidar.watch(PROJECTS_DIR, {
    ignoreInitial: false,
    ignored: (path: string) => /(^|[/\\])\.[^/\\]+$/.test(path) && path !== PROJECTS_DIR && !isLinkRoot(path),
    awaitWriteFinish: { stabilityThreshold: 60, pollInterval: 20 },
  });

  // a linked folder is watched beside the projects folder, from start-up and from when it is linked
  for (const dir of linkedProjects().values()) watcher.add(dir);
  onLinksChange((_, dir) => dir && watcher.add(dir));

  function split(abs: string): { project: string; rel: string } | null {
    for (const [project, dir] of linkedProjects()) {
      const rel = relative(dir, abs);
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue;
      const r = rel.split(sep).join('/');
      return isTracked(r) || isDataPath(r) ? { project, rel: r } : null;
    }
    const r = relative(PROJECTS_DIR, abs).split(sep);
    if (r.length < 2 || !isProjectName(r[0])) return null;
    const rel = r.slice(1).join('/');
    return isTracked(rel) || isDataPath(rel) ? { project: r[0], rel } : null;
  }

  let ready = false;
  watcher.on('ready', () => {
    ready = true;
  });
  async function onChange(event: string, abs: string): Promise<void> {
    // the first scan's files are what is already there, not changes; known now, since `ready` can turn while this reads
    const initial = !ready;
    const at = split(abs);
    if (!at) return;
    const key = `${at.project}/${at.rel}`;
    // a dashboard's data file changed: pages re-read the datasets on it
    if (isDataPath(at.rel)) {
      if (!initial && (event === 'add' || event === 'change' || event === 'unlink')) publish(at.project, { type: 'assets', path: at.rel });
      return;
    }
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
    if (initial) return;
    const version = versionOf(content);
    if (ownWrites.get(key) === version) return;
    if (before === content) return;
    const actor: Actor = activeDelegates.has(at.project) ? 'claude' : 'external';
    publish(at.project, { type: 'file', path: at.rel, content, version, actor });
    await record(at.project, { actor, file: at.rel, summary: lineDiffSummary(before, content), version });
    if (at.rel === DS_TOKENS) await afterTokens(at.project, actor);
  }
  // one failed event (a file gone mid-read, a race on tokens.css) must not take the server down
  watcher.on('all', (event, abs) => void onChange(event, abs).catch((e) => logError('watcher.failed', { file: abs, error: (e as Error).message })));
  return watcher;
}
