import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { streamSSE, stream } from 'hono/streaming';
import type Anthropic from '@anthropic-ai/sdk';
import chokidar from 'chokidar';
import { createHash } from 'node:crypto';
import {
  CANVAS_FILE,
  DECK_FILE,
  DS_INDEX,
  DS_TOKENS,
  DS_TOKENS_CSS,
  FAST_EDIT_SYSTEM,
  FAST_EDIT_SLIDES,
  FAST_EDIT_MOTION,
  FAST_EDIT_DOCS,
  DASH_RUNS,
  checkUploads,
  fastReady,
  sanitizeSaved,
  validBaseUrl,
  isKeptPath,
  isUploadPath,
  checkMessages,
  cleanParams,
  fillArgs,
  type ModelMessage,
  isDataPath,
  dsFolderOf,
  boardDeps,
  importedBoardDir,
  isBoardFile,
  parseCanvas,
  MOTION_FILE,
  type BoardImport,
  parseDsIndex,
  resolveTokens,
  type Actor,
  type DsRecord,
  validSize,
  INDEX_FILE,
  cleanGroup,
  retitle,
} from '@dc/core';
import {
  ASSET_TYPES,
  HttpError,
  assetType,
  createProject,
  isProjectName,
  isTracked,
  kindOf,
  listAssets,
  listProjects,
  readGroups,
  setGroup,
  regenTokensCss,
  removeAsset,
  ownWrites,
  projectDir,
  assetRel,
  readAsset,
  readOne,
  readProject,
  removeFile,
  safeRel,
  seedSamples,
  versionOf,
  withLock,
  writeAsset,
  writeAtomic,
} from './store';
import { journal, lineDiffSummary, publish, record, subscribe } from './hub';
import { CONNECTORS, ConnectorError, callTool } from './connectors';
import { activeDelegates, claudeAvailable, startDelegate, stopDelegate, stopDelegates, type DelegateRequest } from './delegate';
import { logError, logInfo, logWarn } from './log';
import { PdfError, printPdf } from './pdf';
import type { ExportReport } from '@dc/export/timing';
import { RenderError, renderCapabilities, renderMotion } from './render';
import { aiResolved, boxReachable, fastClient, saveAi, testFast } from './aiconfig';
import { DC_LANG, langOf, replyLanguage, trOf } from './i18n';
import { BASE_PATH, BUNDLED, EDITOR_DIST, PROJECTS_DIR, PROTOCOL, SANDBOX_DIST, VERSION, fromRoot } from './layout';

const PORT = Number(process.env.PORT ?? 8787);
/** DC_HOST: the address to listen on; loopback unless you mean to share the editor on your network */
const HOST = process.env.DC_HOST?.trim() || '127.0.0.1';
const ACTORS: Actor[] = ['human', 'jquery', 'fast-edit', 'claude', 'external', 'undo'];
const run = promisify(execFile);
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

const app = new Hono();

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: trOf(c)(`errors.${err.key}`, err.params), code: err.key }, err.status as 400);
  logError('request.failed', { method: c.req.method, path: c.req.path, error: err.message });
  return c.json({ error: err.message }, 500);
});

let cliChecked: boolean | null = null;
app.get('/api/health', (c) => {
  if (cliChecked === null) cliChecked = claudeAvailable();
  return c.json({
    ok: true,
    fastEdit: fastReady(aiResolved()),
    fastModel: aiResolved().fastModel.value,
    claudeCli: cliChecked,
    projectsDir: fromRoot(PROJECTS_DIR),
    theme: DC_THEME,
    lang: DC_LANG,
    version: VERSION,
    protocol: PROTOCOL,
    basePath: BASE_PATH,
  });
});

app.get('/api/projects', async (c) => c.json(await listProjects()));

app.post('/api/projects', async (c) => {
  const { name, title, kind, size } = await c.req.json<{ name: string; title?: string; kind?: string; size?: unknown }>();
  if (!isProjectName(name)) throw new HttpError(400, 'badProjectName');
  if (size !== undefined && !validSize(size)) throw new HttpError(400, 'badSize');
  await createProject(
    name,
    title || name,
    kind === 'slides' || kind === 'design-system' || kind === 'dashboard' || kind === 'docs' || kind === 'motion' ? kind : 'design',
    langOf(c),
    kind === 'motion' && size !== undefined ? { size: validSize(size)! } : {},
  );
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

// ---------------------------------------------------------- design systems

/** tokens.json changed in a design system: rebuild tokens.css and tell every editor. */
async function afterTokens(p: string, actor: Actor): Promise<void> {
  if ((await kindOf(projectDir(p))) !== 'design-system') return;
  const css = await regenTokensCss(p);
  if (css) publish(p, { type: 'file', path: DS_TOKENS_CSS, content: css.content, version: css.version, actor });
}

/** Read a JSON index, change it, write it back as one versioned edit everyone sees. */
async function editIndex(p: string, rel: string, fn: (json: Record<string, unknown>) => void, summary: string): Promise<void> {
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

/**
 * Install a design system of this repository into a canvas or deck, the way
 * the original installs one: the deck keeps its own copy of tokens.json (and
 * the font files it names) under ds/<folder>/, and one record in its index's
 * designSystems. A deck also gets the system's font files as typefaces.
 */
app.post('/api/projects/:p/design-systems', async (c) => {
  const p = c.req.param('p');
  const { from } = await c.req.json<{ from: string }>();
  if (!isProjectName(from ?? '')) throw new HttpError(400, 'badDesignSystemName');
  const kind = await kindOf(projectDir(p));
  if (kind !== 'design' && kind !== 'slides') throw new HttpError(400, 'installOnlyInto');
  if ((await kindOf(projectDir(from))) !== 'design-system') throw new HttpError(404, 'notDesignSystem', { name: from });
  const index = parseDsIndex((await readOne(from, DS_INDEX))?.content);
  const tokens = await readOne(from, DS_TOKENS);
  if (!tokens) throw new HttpError(409, 'noTokens', { name: from });
  const folder = dsFolderOf(index.namespace);
  return withLock(p, async () => {
    const rel = `ds/${folder}/tokens.json`;
    const v = await writeAtomic(p, rel, tokens.content);
    publish(p, { type: 'file', path: rel, content: tokens.content, version: v, actor: 'human' });
    const resolved = resolveTokens(tokens.content);
    const fonts = resolved.fonts;
    const copied: string[] = [];
    for (const f of fonts) {
      const bytes = await readAsset(from, f.file).catch(() => null);
      if (!bytes) continue;
      await writeAsset(p, `ds/${folder}/${f.file}`, new Uint8Array(bytes));
      copied.push(f.file);
    }
    const rec: DsRecord = { title: index.title, namespace: folder, artifact: `projects/${from}`, version: tokens.version, copiedAt: new Date().toISOString() };
    await editIndex(
      p,
      kind === 'slides' ? DECK_FILE : CANVAS_FILE,
      (json) => {
        const list = (Array.isArray(json.designSystems) ? json.designSystems : []) as DsRecord[];
        const at = list.findIndex((r) => r && r.namespace === folder);
        if (at >= 0) list[at] = rec;
        else list.push(rec);
        json.designSystems = list;
        if (kind === 'slides') {
          const faces = (json.faces && typeof json.faces === 'object' ? json.faces : {}) as Record<string, { family: string; src?: string; href?: string }>;
          for (const f of fonts) {
            if (!copied.includes(f.file)) continue;
            const key = f.family.toLowerCase().replace(/\s+/g, '-');
            if (!faces[key] && Object.keys(faces).length < 4) faces[key] = { family: f.family, src: `ds/${folder}/${f.file}` };
          }
          for (const h of resolved.hosted) {
            const key = h.family.toLowerCase().replace(/\s+/g, '-');
            if (!faces[key] && Object.keys(faces).length < 4) faces[key] = { family: h.family, href: h.href };
          }
          json.faces = faces;
        }
      },
      `design system ${index.title} installed`,
    );
    return c.json({ record: rec, fonts: copied });
  });
});

app.delete('/api/projects/:p/design-systems', async (c) => {
  const p = c.req.param('p');
  const folder = c.req.query('namespace') ?? '';
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(folder)) throw new HttpError(400, 'badNamespace');
  const kind = await kindOf(projectDir(p));
  if (kind !== 'design' && kind !== 'slides') throw new HttpError(400, 'notCanvasOrDeck');
  return withLock(p, async () => {
    await editIndex(
      p,
      kind === 'slides' ? DECK_FILE : CANVAS_FILE,
      (json) => {
        json.designSystems = ((Array.isArray(json.designSystems) ? json.designSystems : []) as DsRecord[]).filter((r) => r?.namespace !== folder);
      },
      `design system ${folder} removed`,
    );
    const rel = `ds/${folder}/tokens.json`;
    if (await readOne(p, rel)) {
      await removeFile(p, rel);
      publish(p, { type: 'delete', path: rel, actor: 'human' });
    }
    return c.json({ ok: true });
  });
});

// ------------------------------------------------------- import from a project

/**
 * Import an artboard of a canvas into a slide deck or a motion piece: the
 * artboard, the siblings it mounts and the files it shows are copied in (the
 * artboards under uploads/<from>-<board>/, keeping their paths; its uploads/
 * and assets/ files at the same paths), and the index records where it came
 * from, so importing it again updates the copy every embed points at. The
 * editor then puts the `<x-embed src>` on the slide or scene.
 */
app.post('/api/projects/:p/import-board', async (c) => {
  const p = c.req.param('p');
  const { from, board } = await c.req.json<{ from: string; board: string }>();
  if (!isProjectName(from ?? '')) throw new HttpError(400, 'badProjectName');
  const kind = await kindOf(projectDir(p));
  if (kind !== 'slides' && kind !== 'motion') throw new HttpError(400, 'importBoardInto');
  if ((await kindOf(projectDir(from))) !== 'design') throw new HttpError(404, 'notCanvas', { name: from });
  const canvas = parseCanvas((await readOne(from, CANVAS_FILE))?.content);
  if (!isBoardFile(board ?? '') || !canvas.boards[board] || !(await readOne(from, board))) throw new HttpError(404, 'noBoard', { name: from, board: String(board ?? '') });
  const dir = importedBoardDir(from, board);
  return withLock(p, async () => {
    // the artboard and every sibling it mounts, as found in the source project
    const boards = new Map<string, string>();
    const files = new Set<string>();
    const todo = [board];
    while (todo.length) {
      const f = todo.pop()!;
      if (boards.has(f)) continue;
      const src = await readOne(from, f);
      if (!src) continue;
      boards.set(f, src.content);
      const deps = boardDeps(src.content, f);
      todo.push(...deps.boards);
      for (const x of deps.files) files.add(x);
    }
    for (const [f, content] of boards) {
      const rel = `${dir}/${f}`;
      const cur = await readOne(p, rel);
      if (cur?.content === content) continue;
      const version = await writeAtomic(p, rel, content);
      publish(p, { type: 'file', path: rel, content, version, actor: 'human' });
      await record(p, { actor: 'human', file: rel, summary: `artboard ${board} imported from ${from}`, version });
    }
    // what it shows keeps its path, so the artboard's own references still hold
    for (const f of files) {
      const bytes = await readAsset(from, f).catch(() => null);
      if (bytes && !(await readAsset(p, f).catch(() => null))) await writeAsset(p, f, new Uint8Array(bytes));
    }
    if (files.size) publish(p, { type: 'assets' });
    const rec: BoardImport = { path: `${dir}/${board}`, from: `projects/${from}`, board, copiedAt: new Date().toISOString() };
    await editIndex(
      p,
      kind === 'slides' ? DECK_FILE : MOTION_FILE,
      (json) => {
        const list = (Array.isArray(json.imports) ? json.imports : []) as BoardImport[];
        const at = list.findIndex((r) => r && r.path === rec.path);
        if (at >= 0) list[at] = rec;
        else list.push(rec);
        json.imports = list;
      },
      `artboard ${board} imported from ${from}`,
    );
    return c.json({ record: rec, size: [canvas.boards[board].w, canvas.boards[board].h] });
  });
});

// ---------------------------------------------------------------- assets

const MAX_ASSET = 20 * 1024 * 1024;

app.get('/api/projects/:p/assets', async (c) => c.json(await listAssets(c.req.param('p'))));

app.delete('/api/projects/:p/assets', async (c) => {
  const p = c.req.param('p');
  await removeAsset(p, c.req.query('path') ?? '');
  publish(p, { type: 'assets' });
  return c.json({ ok: true });
});

/** Upload an image or font (stored under assets/ by content hash, so the same file is kept once), or a request's attachment (the same, under uploads/). */
app.post('/api/projects/:p/assets', async (c) => {
  const p = c.req.param('p');
  projectDir(p);
  const name = c.req.query('name') ?? 'file';
  const ext = (/\.([A-Za-z0-9]+)$/.exec(name)?.[1] ?? '').toLowerCase();
  const dir = c.req.query('dir');
  if (dir === 'data' ? !isDataPath(`data/x.${ext}`) : dir === 'uploads' ? !isUploadPath(`uploads/x.${ext}`) : !ASSET_TYPES[ext]) throw new HttpError(400, 'unsupportedFileType', { type: ext || name });
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (!bytes.length) throw new HttpError(400, 'emptyFile');
  if (bytes.length > MAX_ASSET) throw new HttpError(413, 'fileTooLarge', { size: '20 MB' });
  const stem = name.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'file';
  // into a named folder (a design system's asset group, fonts/, a dashboard's data/): the file keeps its name
  let rel: string;
  if (dir && dir !== 'uploads') {
    rel = assetRel(`${dir.replace(/\/+$/, '')}/${stem}.${ext}`);
  } else {
    // images, and files attached to a request: named by content, so the same file is kept once
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
    rel = `${dir ?? 'assets'}/${stem}-${hash}.${ext}`;
  }
  await writeAsset(p, rel, bytes);
  publish(p, { type: 'assets', path: rel });
  return c.json({ path: rel, size: bytes.length, type: assetType(rel) });
});

/**
 * Keep one file of a folder a person imported, at its own path under uploads/
 * (uploads/<folder>-<hash>/…), so the page's relative links still hold.
 * Single files go through POST /assets?dir=uploads instead, named by content.
 */
app.put('/api/projects/:p/uploads', async (c) => {
  const p = c.req.param('p');
  projectDir(p);
  const rel = c.req.query('path') ?? '';
  if (!isKeptPath(rel)) throw new HttpError(400, 'cannotKeep', { path: rel });
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length > MAX_ASSET) throw new HttpError(413, 'fileTooLarge', { size: '20 MB' });
  await writeAsset(p, rel, bytes);
  publish(p, { type: 'assets', path: rel });
  return c.json({ path: rel, size: bytes.length });
});

/** Serve a project's assets (to the sandboxed frames too: images, and fonts which need CORS). */
app.get('/api/projects/:p/raw/*', async (c) => {
  const p = c.req.param('p');
  const rel = decodeURIComponent(c.req.path.replace(/^\/api\/projects\/[^/]+\/raw\//, ''));
  const bytes = await readAsset(p, rel);
  if (!bytes) return c.json({ error: 'not found' }, 404);
  return c.body(new Uint8Array(bytes), 200, {
    'content-type': assetType(rel),
    'access-control-allow-origin': '*',
    'cache-control': 'private, max-age=3600',
    'x-content-type-options': 'nosniff',
    // an SVG opened directly must not run scripts on this origin
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
  });
});

// -------------------------------------------------------------- dashboards

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

app.post('/api/projects/:p/fast-edit', async (c) => {
  const anthropic = fastClient();
  if (!anthropic) {
    logWarn('fast.unavailable', { project: c.req.param('p'), reason: 'no fast model configured' });
    return c.json({ error: trOf(c)('errors.noFastModel') }, 501);
  }
  const model = aiResolved().fastModel.value;
  const body = await c.req.json<{ messages: ModelMessage[]; kind?: string }>();
  const bad = checkMessages(body.messages);
  if (bad) throw new HttpError(400, 'badRequest', { detail: bad });
  if (body.kind === 'dashboard') throw new HttpError(400, 'dashboardIsClaudeCode');
  const system =
    body.kind === 'docs'
      ? FAST_EDIT_DOCS
      : body.kind === 'slides'
        ? FAST_EDIT_SYSTEM + '\n\n' + FAST_EDIT_SLIDES
        : body.kind === 'motion'
          ? FAST_EDIT_SYSTEM + '\n\n' + FAST_EDIT_SLIDES + '\n\n' + FAST_EDIT_MOTION
          : FAST_EDIT_SYSTEM;
  const lang = replyLanguage(langOf(c));
  const project = c.req.param('p');
  const started = Date.now();
  const meta = { project, kind: body.kind ?? 'design', model, messages: body.messages.length };
  logInfo('fast.start', meta);
  return stream(c, async (s) => {
    const ms = anthropic.messages.stream({
      model,
      max_tokens: 4096,
      system: system + '\n\n' + lang,
      messages: body.messages as Anthropic.MessageParam[],
    });
    let chars = 0;
    s.onAbort(() => {
      logInfo('fast.aborted', { ...meta, ms: Date.now() - started, chars });
      ms.abort();
    });
    try {
      for await (const ev of ms) {
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          chars += ev.delta.text.length;
          await s.write(ev.delta.text);
        }
      }
      const usage = await ms.finalMessage().then((m) => m.usage).catch(() => null);
      logInfo('fast.done', { ...meta, ms: Date.now() - started, chars, inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens });
    } catch (e) {
      if (!s.aborted) {
        logError('fast.error', { ...meta, ms: Date.now() - started, chars, error: (e as Error).message });
        await s.write(`\n__ERROR__ ${(e as Error).message}\n`);
      }
    }
  });
});

// ---------------------------------------------------------------- AI settings

/** What the settings dialog shows. The key never leaves the server: only whether one is set, and where it came from. */
app.get('/api/ai-config', async (c) => {
  if (cliChecked === null) cliChecked = claudeAvailable();
  const [boxUp] = await Promise.all([boxReachable()]);
  return c.json({ ...aiResolved(), claudeCli: cliChecked, box: { reachable: boxUp } });
});

const aiDraft = (b: Record<string, unknown>) => {
  const d = sanitizeSaved(b);
  if (b.baseUrl && !validBaseUrl(d.baseUrl ?? '')) throw new HttpError(400, 'badBaseUrl');
  return d;
};

app.put('/api/ai-config', async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  await saveAi(aiDraft(b), { key: b.clearKey !== true && !b.apiKey });
  return c.json({ ok: true });
});

/** Tries the fast model with what is in the dialog, saved or not. */
app.post('/api/ai-config/test', async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const res = await testFast(aiDraft(b));
  return c.json(res.error === 'noKey' ? { ...res, error: trOf(c)('errors.noFastModel') } : res);
});

// ---------------------------------------------------------------- delegate

app.post('/api/projects/:p/delegate', async (c) => {
  const p = c.req.param('p');
  projectDir(p);
  if (cliChecked === null) cliChecked = claudeAvailable();
  if (!cliChecked) {
    logWarn('delegate.unavailable', { project: p, reason: 'claude CLI not found' });
    return c.json({ error: trOf(c)('errors.noClaudeCli') }, 501);
  }
  const req = await c.req.json<DelegateRequest>();
  if (!req.prompt?.trim()) throw new HttpError(400, 'promptMissing');
  const bad = checkUploads(req.attachments);
  if (bad) throw new HttpError(400, 'badRequest', { detail: bad });
  return c.json({ id: startDelegate(p, req, (await kindOf(projectDir(p))) ?? 'design', langOf(c)) });
});

app.delete('/api/projects/:p/delegate/:id', (c) => {
  const p = c.req.param('p');
  projectDir(p);
  if (!stopDelegate(p, c.req.param('id'))) throw new HttpError(404, 'taskFinished');
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- render

/** Whether this machine can render a motion piece exactly (Chrome and ffmpeg), so the editor knows where to send one that holds an embed. */
app.get('/api/render', async (c) => c.json(await renderCapabilities()));

/**
 * Render a motion piece with the machine's own Chrome and ffmpeg. The answer is a
 * stream of JSON lines: {"progress":[done,total]} while it works, then {"done":"renders/x.mp4"}
 * (served from the project's raw files) or {"error":"…","code":"…"}. Closing the request stops it.
 */
app.post('/api/projects/:p/render', async (c) => {
  const p = c.req.param('p');
  const dir = projectDir(p);
  if ((await kindOf(dir)) !== 'motion') throw new HttpError(400, 'badRequest', { detail: 'not a motion piece' });
  const caps = await renderCapabilities();
  if (!caps.chrome || !caps.ffmpeg) throw new HttpError(501, 'noRenderer');
  type Body = { format?: string; speed?: number; container?: string; width?: number; height?: number; fps?: number; quality?: string; from?: number; to?: number };
  const body = await c.req.json<Body>().catch(() => ({}) as Body);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
  const t = trOf(c);
  const ctl = new AbortController();
  logInfo('render.start', { project: basename(dir), format: body.format, container: body.container, why: 'embed-or-video' });
  return stream(c, async (s) => {
    s.onAbort(() => ctl.abort());
    c.header('content-type', 'application/x-ndjson');
    const line = (v: unknown) => s.write(JSON.stringify(v) + '\n');
    try {
      const { file, report } = await renderMotion({ dir, runtime: join(SANDBOX_DIST, 'motion.js'), format: body.format, speed: body.speed, container: body.container === 'gif' ? 'gif' : 'mp4', width: num(body.width), height: num(body.height), fps: num(body.fps), quality: body.quality === 'low' || body.quality === 'medium' ? body.quality : 'high', from: num(body.from), to: num(body.to), signal: ctl.signal, onProgress: (done, total) => void line({ progress: [done, total] }) });
      await line({ done: basename(file), report });
    } catch (e) {
      const code = e instanceof RenderError ? e.code : 'failed';
      if (code !== 'aborted') logError('render.failed', { project: basename(dir), error: (e as Error).message });
      await line({ code, error: code === 'aborted' ? '' : t('errors.renderFailed', { detail: (e as Error).message }) });
    }
  });
});

/**
 * A page to PDF with the machine's own Chrome: the editor builds the page (a deck one slide per page,
 * a doc), the answer is the PDF. 501 when there is no Chrome, so the editor can fall back to the print dialog.
 */
app.post('/api/pdf', async (c) => {
  const body = await c.req.json<{ html?: string; paper?: string }>().catch(() => ({}) as { html?: string; paper?: string });
  if (typeof body.html !== 'string' || !body.html) throw new HttpError(400, 'badRequest', { detail: 'html' });
  if (!(await renderCapabilities()).chrome) throw new HttpError(501, 'noPdf');
  const t = trOf(c);
  const started = Date.now();
  try {
    const pdf = await printPdf({ html: body.html, origin: new URL(c.req.url).origin, paper: body.paper === 'a4' ? 'a4' : 'page', signal: c.req.raw.signal });
    logInfo('pdf.done', { ms: Date.now() - started, bytes: pdf.length, paper: body.paper === 'a4' ? 'a4' : 'page' });
    return c.body(new Uint8Array(pdf), 200, { 'content-type': 'application/pdf', 'cache-control': 'no-store' });
  } catch (e) {
    logError('pdf.failed', { ms: Date.now() - started, error: (e as Error).message });
    throw new HttpError(500, 'pdfFailed', { detail: (e as Error).message });
  }
});

/** An export made in the browser reports how it went, so the server log shows both routes next to each other (render.done is the other one). */
app.post('/api/projects/:p/export-report', async (c) => {
  const dir = projectDir(c.req.param('p'));
  const body = await c.req.json<{ report?: ExportReport; why?: string }>().catch(() => ({}) as { report?: ExportReport; why?: string });
  const r = body.report;
  if (!r || typeof r.wallMs !== 'number' || typeof r.frames !== 'number') throw new HttpError(400, 'badRequest', { detail: 'no report' });
  logInfo('export.done', {
    project: basename(dir),
    route: 'browser',
    why: typeof body.why === 'string' ? body.why.slice(0, 40) : undefined,
    size: `${Number(r.width)}x${Number(r.height)}`,
    frames: r.frames,
    wall_ms: r.wallMs,
    fps: r.fps,
    ...Object.fromEntries(Object.entries(r.stages ?? {}).map(([k, v]) => [`${k}_ms`, Number((v as { ms: number }).ms)])),
  });
  return c.json({ ok: true });
});

/** A video rendered above, by the name the stream gave. Only files in the project's renders/ folder, only MP4 or GIF. */
app.get('/api/projects/:p/render/:file', async (c) => {
  const dir = projectDir(c.req.param('p'));
  const file = c.req.param('file');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}\.(mp4|gif)$/.test(file) || file.includes('..')) throw new HttpError(400, 'notAssetPath', { path: file });
  const bytes = await readFile(join(dir, 'renders', file)).catch(() => null);
  if (!bytes) return c.json({ error: 'not found' }, 404);
  return c.body(new Uint8Array(bytes), 200, { 'content-type': file.endsWith('.gif') ? 'image/gif' : 'video/mp4', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
});

// ---------------------------------------------------------------- git

app.post('/api/projects/:p/commit', async (c) => {
  const p = c.req.param('p');
  // git finds the repository the projects folder is in: this one, or a host's
  const dir = projectDir(p);
  const { message } = await c.req.json<{ message?: string }>().catch(() => ({ message: undefined }));
  try {
    await run('git', ['add', '-A', '--', dir], { cwd: PROJECTS_DIR });
    const st = await run('git', ['diff', '--cached', '--stat', '--', dir], { cwd: PROJECTS_DIR });
    if (!st.stdout.trim()) return c.json({ ok: false, output: trOf(c)('errors.nothingToCommit') });
    const out = await run('git', ['commit', '-m', message?.trim() || `canvas(${p}): update`, '--', dir], { cwd: PROJECTS_DIR });
    return c.json({ ok: true, output: out.stdout.trim().split('\n')[0] });
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    if (/not a git repository/i.test(err.stderr ?? '')) return c.json({ ok: false, output: trOf(c)('errors.notGitRepo', { dir: fromRoot(PROJECTS_DIR) }) });
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
  serveStatic({ root: relative(process.cwd(), SANDBOX_DIST), rewriteRequestPath: (path) => path.replace(/^\/sandbox/, '') }),
);

if (process.env.NODE_ENV === 'production' || BUNDLED) {
  app.use('/*', serveStatic({ root: relative(process.cwd(), EDITOR_DIST) }));
  app.get('*', async (c) => c.html(await readFile(join(EDITOR_DIST, 'index.html'), 'utf8')));
}

// ---------------------------------------------------------------- watcher

if (await seedSamples()) logInfo('samples.copied', { dir: PROJECTS_DIR });

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
  return isTracked(rel) || isDataPath(rel) ? { project: r[0], rel } : null;
}

let ready = false;
watcher.on('ready', () => {
  ready = true;
});
async function onChange(event: string, abs: string): Promise<void> {
  const at = split(abs);
  if (!at) return;
  const key = `${at.project}/${at.rel}`;
  // a dashboard's data file changed: pages re-read the datasets on it
  if (isDataPath(at.rel)) {
    if (ready && (event === 'add' || event === 'change' || event === 'unlink')) publish(at.project, { type: 'assets', path: at.rel });
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
  if (!ready) return;
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

// ---------------------------------------------------------------- serve

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
const fetch: typeof app.fetch = BASE_PATH
  ? (req, ...rest) => {
      const r = underBase(req);
      return r instanceof Response ? r : app.fetch(r, ...rest);
    }
  : app.fetch;

const server = serve({ fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`tingly-design ${VERSION} on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${info.port}${BASE_PATH}/  (projects: ${PROJECTS_DIR})`);
  // one machine-readable line for a host that launched us with PORT=0 (docs/en/embedding.md)
  console.log(`TINGLY_DESIGN_READY ${JSON.stringify({ port: info.port, basePath: BASE_PATH, version: VERSION, protocol: PROTOCOL })}`);
});

let stopping = false;
function shutdown(): void {
  if (stopping) return;
  stopping = true;
  stopDelegates();
  void watcher.close();
  server.close(() => process.exit(0));
  // open event streams would otherwise hold close() until they time out
  (server as { closeAllConnections?: () => void }).closeAllConnections?.();
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
// a host holds our stdin open and closes it by exiting, however it exits
if (process.env.DC_EXIT_WITH_STDIN === '1') process.stdin.on('end', shutdown).on('error', shutdown).resume();
