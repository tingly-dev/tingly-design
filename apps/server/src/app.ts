/**
 * The server's routes, with no side effects beyond registering them: the CLI and
 * the server entry both start it through serve.ts (`startServer`).
 */
import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { DS_TOKENS, fastReady, type Actor, validSize, INDEX_FILE, cleanGroup, retitle, lookOf } from '@dc/core';
import { HttpError, LINKS_ON, createProject, inspectFolder, linkFolder, unlinkProject, isProjectName, kindOf, listProjects, readGroups, resolveKey, setGroup, projectDir, readOne, readProject, removeFile, safeRel, withLock, writeAtomic } from './store';
import { lineDiffSummary, publish, record } from './hub';
import { commitFolder, initRepo, repoOf } from './git';
import { MAX_ARCHIVE_INPUT, PptxImportError, describePptx, packClaudeDesign, packProject, unpackProject } from './archive';
import { logError, logInfo, logWarn } from './log';
import { aiResolved } from './aiconfig';
import { DC_LANG, langOf, trOf } from './i18n';
import { handleMcp } from './mcp';
import { BASE_PATH, BUNDLED, EDITOR_DIST, PROJECTS_DIR, PROTOCOL, SANDBOX_DIST, VERSION, fromRoot } from './layout';
import { registerDesignSystems } from './routes/designSystems';
import { registerImportBoard } from './routes/importBoard';
import { registerAssets } from './routes/assets';
import { registerDashboards } from './routes/dashboards';
import { registerAi } from './routes/ai';
import { registerDelegate } from './routes/delegate';
import { registerExport } from './routes/export';
import { registerHistory } from './routes/history';
import { registerGit } from './routes/git';
import { afterTokens, claudeCliReady } from './routes/shared';

const ACTORS: Actor[] = ['human', 'jquery', 'fast-edit', 'claude', 'external', 'undo'];
/** DC_THEME: the editor's default look, a mode name (light, dark, claude, ds, sunlit, system), inline JSON, or a .json file */
const DC_THEME: unknown = await (async () => {
  const v = process.env.DC_THEME?.trim();
  if (!v) return null;
  if (!v.endsWith('.json')) return v;
  try {
    return JSON.parse(await readFile(v, 'utf8'));
  } catch (e) {
    logWarn('theme.unreadable', { file: v, error: (e as Error).message });
    return null;
  }
})();

/** Every route the editor and a host use; `startServer` (serve.ts) puts it on a port. */
export const app = new Hono();

app.onError((err, c) => {
  if (err instanceof PptxImportError) return c.json({ error: trOf(c)(`errors.${err.key}`, err.params), code: err.key, diagnostics: err.diagnostics.map(d => ({ ...d, message: describePptx(d, trOf(c)) })) }, err.status as 400);
  if (err instanceof HttpError) return c.json({ error: trOf(c)(`errors.${err.key}`, err.params), code: err.key }, err.status as 400);
  logError('request.failed', { method: c.req.method, path: c.req.path, error: err.message });
  return c.json({ error: err.message }, 500);
});

app.get('/api/health', async (c) => {
  return c.json({
    ok: true,
    fastEdit: fastReady(aiResolved()),
    fastModel: aiResolved().fastModel.value,
    imageGen: aiResolved().image.active,
    claudeCli: claudeCliReady(),
    projectsDir: fromRoot(PROJECTS_DIR),
    projectsInRepo: !!(await repoOf(PROJECTS_DIR)),
    links: LINKS_ON,
    theme: DC_THEME,
    lang: DC_LANG,
    version: VERSION,
    protocol: PROTOCOL,
    basePath: BASE_PATH,
  });
});

/** A request that names a project by a name an earlier version gave it goes to the project's current name, so the hub, the journal and the runs only ever see one key. */
app.use('/api/projects/:p/*', async (c, next) => {
  const p = c.req.param('p');
  const key = resolveKey(p);
  if (key === p) return next();
  const url = new URL(c.req.url);
  url.pathname = url.pathname.replace(/(\/api\/projects\/)[^/]+/, `$1${key}`);
  return c.redirect(url.toString(), 308);
});

app.get('/api/projects', async (c) => c.json(await listProjects()));

/** The name a project answers to now, for an address that carries one an older version gave it. */
app.get('/api/resolve/:p', (c) => c.json({ name: resolveKey(c.req.param('p')) }));

/** A new project: `name` is a folder in the projects folder, or `path` is a missing or empty folder anywhere, linked under a name of its own. */
app.post('/api/projects', async (c) => {
  const body = await c.req.json<{ name?: string; path?: string; title?: string; kind?: string; size?: unknown; look?: string; git?: boolean }>();
  const { title, kind, size } = body;
  if (body.path === undefined && !isProjectName(body.name ?? '')) throw new HttpError(400, 'badProjectName');
  if (size !== undefined && !validSize(size)) throw new HttpError(400, 'badSize');
  if (body.look !== undefined && kind !== 'design-system') throw new HttpError(400, 'lookOnlyDs');
  if (body.look !== undefined && !lookOf(String(body.look))) throw new HttpError(400, 'badLook', { look: String(body.look) });
  const name = body.path !== undefined ? await linkFolder(String(body.path), true) : body.name!;
  await createProject(
    name,
    title || name,
    kind === 'slides' || kind === 'design-system' || kind === 'dashboard' || kind === 'docs' || kind === 'motion' ? kind : 'design',
    langOf(c),
    {
      ...((kind === 'motion' || kind === 'slides' || kind === undefined || kind === 'design') && size !== undefined ? { size: validSize(size)! } : {}),
      ...(body.look ? { look: String(body.look) } : {}),
    },
  ).catch(async (e) => {
    if (body.path !== undefined) await unlinkProject(name).catch(() => {});
    throw e;
  });
  // a repository of its own from the start, when asked and the folder is not already in one
  const dir = projectDir(name);
  if (body.git && !(await repoOf(dir))) {
    try {
      await initRepo(dir);
      await commitFolder(dir, `design(${name}): start`);
      logInfo('git.init', { project: name, dir });
    } catch (e) {
      logWarn('git.init.failed', { project: name, error: (e as Error).message });
      return c.json({ ok: true, name, gitError: (e as Error).message });
    }
  }
  return c.json({ ok: true, name });
});

/** What is at a folder anywhere on disk, for the launcher to say before it opens or creates there. */
app.get('/api/folder', async (c) => {
  if (!LINKS_ON) throw new HttpError(403, 'linksOff');
  return c.json(await inspectFolder(c.req.query('path') ?? ''));
});

/** Open a project folder that lives anywhere: it joins the launcher under a name, which comes back. */
app.post('/api/links', async (c) => {
  const { path } = await c.req.json<{ path?: unknown }>();
  const name = await linkFolder(String(path ?? ''));
  logInfo('project.linked', { project: name, dir: projectDir(name) });
  return c.json({ name });
});

/** A whole project as one .zip (.design/project-archive.md): its files, and unless told otherwise its change log and the design systems it installed. */
app.get('/api/projects/:p/archive', async (c) => {
  const p = c.req.param('p');
  const off = (k: string) => c.req.query(k) === '0';
  const { bytes, file, files, systems } = await packProject(p, { journal: !off('journal'), systems: !off('systems') });
  logInfo('archive.export', { project: p, files, systems, bytes: bytes.length });
  return c.body(bytes as Uint8Array<ArrayBuffer>, 200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${file}"`, 'cache-control': 'no-store' });
});

/** The project in Claude's own format (.design/claude-design-format.md): the original type's layout as one .zip. */
app.get('/api/projects/:p/claude-design', async (c) => {
  const p = c.req.param('p');
  const { bytes, file, files, notes } = await packClaudeDesign(p);
  logInfo('claudeDesign.export', { project: p, files, notes: notes.map((n) => n.key), bytes: bytes.length });
  return c.body(bytes as Uint8Array<ArrayBuffer>, 200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${file}"`, 'x-dc-notes': encodeURIComponent(JSON.stringify(notes)), 'access-control-expose-headers': 'x-dc-notes', 'cache-control': 'no-store' });
});

/** A project from a .zip made by the route above (or a project folder zipped by hand), a Claude Design package or a Claude Docs Markdown export; its name comes back. */
app.post('/api/archive', async (c) => {
  // Bound ingress before materializing the body, including chunked uploads. Existing project
  // archives retain their 1 GB allowance; the converter enforces PPTX's tighter own budget.
  const declared = Number(c.req.header('content-length'));
  if (declared > MAX_ARCHIVE_INPUT) throw new HttpError(413, 'archiveInputTooBig');
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = c.req.raw.body?.getReader();
  if (reader) {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > MAX_ARCHIVE_INPUT) { await reader.cancel(); throw new HttpError(413, 'archiveInputTooBig'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (!bytes.length) throw new HttpError(400, 'emptyFile');
  const from = c.req.query('file') ?? 'project';
  const done = await unpackProject(bytes, from);
  logInfo('archive.import', { file: from, project: done.name, systems: done.systems, claudeDesign: done.claudeDesign, notes: done.notes.map((n) => n.key), bytes: bytes.length });
  return c.json(done);
});

/** Take a linked project off the launcher; its folder stays as it is. */
app.delete('/api/links/:p', async (c) => {
  await unlinkProject(c.req.param('p'));
  return c.json({ ok: true });
});

/** Rename a project's title and/or file it under a launcher group ('' takes it out of its group). The folder name stays. */
app.patch('/api/projects/:p', async (c) => {
  const p = c.req.param('p');
  const body = await c.req.json<{ title?: unknown; group?: unknown }>();
  const kind = await kindOf(projectDir(p));
  if (!kind) throw new HttpError(404, 'noProject', { name: p });
  if (body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.replace(/\s+/g, ' ').trim() : '';
    if (!title) throw new HttpError(400, 'emptyTitle');
    await withLock(p, async () => {
      const rel = INDEX_FILE[kind];
      const cur = await readOne(p, rel);
      const content = retitle(cur?.content, title);
      if (content === undefined) throw new HttpError(400, 'badIndex', { file: rel });
      if (cur?.content === content) return;
      const version = await writeAtomic(p, rel, content);
      publish(p, { type: 'file', path: rel, content, version, actor: 'human' });
      await record(p, { actor: 'human', file: rel, summary: lineDiffSummary(cur?.content, content).slice(0, 400), version });
    });
  }
  if (body.group !== undefined) await setGroup(p, cleanGroup(body.group));
  return c.json({ ok: true, groups: await readGroups() });
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
  if (typeof body.content !== 'string') throw new HttpError(400, 'contentMissing');
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
    if (rel === DS_TOKENS) await afterTokens(p, actor);
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

registerDesignSystems(app);
registerImportBoard(app);
registerAssets(app);
registerDashboards(app);
registerHistory(app);
registerAi(app);
registerDelegate(app);
registerExport(app);
registerGit(app);

// ---------------------------------------------------------------- MCP

/**
 * The command line's commands as MCP tools (mcp.ts), over Streamable HTTP with JSON replies. A page
 * on another site must not drive it through the person's browser, so a request carrying an Origin
 * is answered only from this editor's own address or the machine itself.
 */
app.post('/mcp', async (c) => {
  const origin = c.req.header('origin');
  if (origin && !sameMachine(origin, c.req.url)) return c.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Origin not allowed' } }, 403);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }
  const lang = langOf(c);
  const replies = (await Promise.all((Array.isArray(body) ? body : [body]).map((m) => handleMcp(m, lang, true)))).filter((r) => r !== null);
  if (!replies.length) return c.body(null, 202);
  return c.json(Array.isArray(body) ? replies : replies[0]);
});
// no server-sent stream and no sessions to end
app.on(['GET', 'DELETE'], '/mcp', (c) => c.body(null, 405, { allow: 'POST' }));

function sameMachine(origin: string, self: string): boolean {
  try {
    const o = new URL(origin);
    return o.host === new URL(self).host || ['localhost', '127.0.0.1', '[::1]'].includes(o.hostname);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- static

app.use(
  '/sandbox/*',
  async (c, next) => {
    await next();
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Cache-Control', 'no-store');
  },
  serveStatic({ root: relative(process.cwd(), SANDBOX_DIST), rewriteRequestPath: (path) => path.replace(/^\/sandbox/, '') }),
);

if (process.env.NODE_ENV === 'production' || BUNDLED) {
  app.use('/*', serveStatic({ root: relative(process.cwd(), EDITOR_DIST) }));
  app.get('*', async (c) => c.html(await readFile(join(EDITOR_DIST, 'index.html'), 'utf8')));
}

