import { basename, dirname } from 'node:path';
import {
  DASH_BUNDLE_VERSION,
  DASH_INDEX,
  datasetIdOf,
  failedDataset,
  fillArgs,
  fitBundle,
  formatOf,
  linkedDir,
  linkedPagesOf,
  linkedStem,
  loaderIds,
  newLinkId,
  parseDash,
  parseDataFile,
  parseDataset,
  putLinked,
  queryDataset,
  readyState,
  stringifyBundle,
  boardDeps,
  INDEX_FILE,
  type DashBundle,
  type FileSource,
  type FrozenDataset,
  type LinkedPage,
  type ProjectKind,
  type QuerySource,
} from '@dc/core';
import { editIndex } from './routes/shared';
import { CONNECTORS, ConnectorError, callTool } from './connectors';
import { publish, record } from './hub';
import { logInfo } from './log';
import { readEntry, readOne, readAsset, withLock, writeAsset, writeAtomic } from './store';
import { fingerprint, renderPagePng, resolveSource, textFiles } from './linkedPage';

/** A file a refresh replaced, as it was, for the Undo that follows. */
export interface Replaced {
  rel: string;
  bytes: Buffer | null;
}

/** Text a live copy keeps (artboards, frozen dashboards): written as tracked files, so the editor's store holds them; the rest is bytes. */
export const isLiveText = (rel: string): boolean => rel.endsWith('.dc.html') || rel.endsWith('.dash.json');

async function writeText(p: string, rel: string, content: string, actor: string, replaced: Replaced[]): Promise<void> {
  const cur = await readOne(p, rel);
  if (cur?.content === content) return;
  replaced.push({ rel, bytes: cur ? Buffer.from(cur.content) : null });
  const version = await writeAtomic(p, rel, content);
  publish(p, { type: 'file', path: rel, content, version, actor: 'human' });
  await record(p, { actor: 'human', file: rel, summary: actor, version });
}

/**
 * Copy an artboard of a canvas, with every sibling it mounts and every file it shows, into `p`: the
 * artboards under `dir` (keeping their paths), what they show at the same paths. Returns the files it
 * replaced, as they were, for an Undo.
 */
export async function copyArtboard(p: string, from: string, board: string, dir: string, actor = `artboard ${board} imported from ${from}`): Promise<{ replaced: Replaced[]; assets: number }> {
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
  const replaced: Replaced[] = [];
  for (const [f, content] of boards) await writeText(p, `${dir}/${f}`, content, actor, replaced);
  // what it shows keeps its path, so the artboard's own references still hold
  let assets = 0;
  for (const f of files) {
    const bytes = await readAsset(from, f).catch(() => null);
    if (bytes && !(await readAsset(p, f).catch(() => null))) {
      await writeAsset(p, f, new Uint8Array(bytes));
      assets++;
    }
  }
  if (assets) publish(p, { type: 'assets' });
  return { replaced, assets };
}

/** Where a frozen dashboard goes when it is first linked: a folder of its own, named for the page. */
export const bundleName = (title: string): string => `${linkedStem(title || 'dashboard')}.dash.json`;

/**
 * A dashboard as it is now, in one piece: its page files, and each dataset read once (an attached file
 * from `data/`, a query run through the source project's connectors). What cannot be read is frozen as
 * the failure the page draws for a source that did not answer. Nothing is queried again when it is shown.
 */
export async function freezeDashboard(name: string, files?: Record<string, string>): Promise<{ bundle: DashBundle; cut: string[] }> {
  const text = files ?? (await textFiles(name));
  const dash = parseDash(text[DASH_INDEX]);
  const page: Record<string, string> = {};
  for (const [f, content] of Object.entries(text)) if (f.startsWith('files/')) page[f.slice(6)] = content;
  const loaders = loaderIds(page);
  const now = Date.now();
  const datasets: Record<string, FrozenDataset> = {};
  const failed: Record<string, string> = {};
  const fail = (id: string, message: string, status: 'error' | 'connect' | 'missing' = 'error') => {
    datasets[id] = failedDataset(message, status);
    failed[id] = message;
  };
  for (const f of Object.keys(text)) {
    const id = datasetIdOf(f);
    if (!id) continue;
    const { dataset, error } = parseDataset(text[f]);
    if (!dataset || error) {
      fail(id, error ?? 'unreadable');
      continue;
    }
    try {
      if (dataset.source.kind === 'file') {
        const src = dataset.source as FileSource;
        const bytes = await readEntry(name, src.url.replace(/^\.?\//, ''));
        if (!bytes) {
          fail(id, `${src.url} is not in the project`, 'missing');
          continue;
        }
        const { table, value } = parseDataFile(bytes.toString('utf8'), formatOf(src));
        datasets[id] = { state: readyState(table, value, now) };
      } else {
        const q = dataset.source as QuerySource;
        if (!CONNECTORS[q.connector]) throw new ConnectorError('absent', `${q.connector} is not a connector of this server`);
        const answer = await callTool(name, q.connector, q.tool, fillArgs(q.args, dash.params), dash.params);
        datasets[id] = queryDataset(answer, q.args, now, loaders.dynamic || loaders.ids.includes(id));
      }
    } catch (e) {
      fail(id, (e as Error).message, e instanceof ConnectorError && e.state === 'absent' ? 'connect' : 'error');
    }
  }
  const bundle: DashBundle = { v: DASH_BUNDLE_VERSION, title: dash.title, files: page, datasets, params: dash.params, theme: 'light', frozenAt: new Date(now).toISOString(), ...(Object.keys(failed).length ? { failed } : {}) };
  return { bundle, cut: fitBundle(bundle) };
}

/**
 * Write the live copy of a page at the record's `path`: an artboard with what it mounts and shows, or a
 * frozen dashboard. Returns what it replaced.
 */
export async function copyLive(p: string, src: { name: string; kind: ProjectKind }, page: string, path: string, files: Record<string, string>, actor: string): Promise<Replaced[]> {
  if (src.kind === 'design') return (await copyArtboard(p, src.name, page, path.slice(0, path.lastIndexOf('/')), actor)).replaced;
  const replaced: Replaced[] = [];
  const { bundle, cut } = await freezeDashboard(src.name, files);
  await writeText(p, path, stringifyBundle(bundle), actor, replaced);
  if (cut.length) logInfo('link.frozen.cut', { project: p, from: src.name, datasets: cut });
  return replaced;
}

const posters = new Map<string, Promise<string | null>>();

/**
 * Draw the picture kept beside a live copy and put it in the record. Nothing to say when there is no
 * Chrome or the page cannot be drawn: the live copy works without it, the panel says there is no picture.
 * One draw per copy at a time, so a request that wants the picture waits for the one under way.
 */
export function drawPoster(p: string, into: ProjectKind, path: string, lang = 'en'): Promise<string | null> {
  const key = `${p}\0${path}`;
  const running = posters.get(key);
  if (running) return running;
  const job = (async (): Promise<string | null> => {
    try {
      const index = await readOne(p, INDEX_FILE[into]);
      const rec = linkedPagesOf(index ? JSON.parse(index.content) : undefined).find((r) => r.path === path);
      if (!rec || rec.mode !== 'live') return rec?.poster ?? null;
      const src = await resolveSource(p, rec);
      if (typeof src === 'string') return rec.poster ?? null;
      const files = await textFiles(src.name);
      const png = await renderPagePng(src.name, rec.kind, rec.page, files, lang);
      return await withLock(p, async () => {
        const again = linkedPagesOf(JSON.parse((await readOne(p, INDEX_FILE[into]))?.content ?? '{}')).find((r) => r.path === path);
        if (!again) return null;
        const taken = linkedPagesOf(JSON.parse((await readOne(p, INDEX_FILE[into]))?.content ?? '{}')).map((r) => /^uploads\/linked\/([^/]+)\//.exec(r.poster ?? r.path)?.[1]).filter((x): x is string => !!x);
        const poster = again.poster ?? `${linkedDir(newLinkId(taken))}/${linkedStem(again.page === 'index' ? basename(dirname(again.path)) : again.page)}.png`;
        await writeAsset(p, poster, new Uint8Array(png));
        publish(p, { type: 'assets' });
        const next: LinkedPage = { ...again, poster, at: again.at ?? (await fingerprint(src.name, again.kind, again.page, files)) };
        await editIndex(p, INDEX_FILE[into], (json) => void (json.imports = putLinked(json.imports, next)), `${again.page} picture drawn`);
        logInfo('link.poster', { project: p, from: src.name, page: again.page, bytes: png.length });
        return poster;
      });
    } catch (e) {
      logInfo('link.poster.failed', { project: p, path, error: (e as Error).message });
      return null;
    } finally {
      posters.delete(key);
    }
  })();
  posters.set(key, job);
  return job;
}
