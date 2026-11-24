import type { Hono } from 'hono';
import { DASH_VIEW, INDEX_FILE, dropLinked, importedBoardDir, linkModes, linkedDir, linkedPagesOf, linkedStem, newLinkId, pagesOf, pngSize, putLinked, takesPages, type LinkCheck, type LinkMode, type LinkedPage, type ProjectKind } from '@dc/core';
import { editIndex } from './shared';
import { bundleName, copyLive, drawPoster, isLiveText, type Replaced } from '../linkedCopy';
import { publish, record } from '../hub';
import { fingerprint, keepStash, relInside, renderPagePng, resolveSource, sourcesFor, takeStash, textFiles } from '../linkedPage';
import { logInfo } from '../log';
import { HttpError, isProjectName, kindOf, listProjects, projectDir, readAsset, readOne, resolveKey, withLock, writeAsset, writeAtomic } from '../store';

/** The language the person's editor shows: pictures of a page are drawn with it (what the page says in its own empty states follows it). */
const langOf = (c: { req: { header(name: string): string | undefined } }) => (c.req.header('x-dc-lang') === 'zh' ? 'zh' : 'en');

/** The project's own records of linked pages, from its index. */
async function recordsOf(p: string, kind: ProjectKind): Promise<LinkedPage[]> {
  const index = await readOne(p, INDEX_FILE[kind]);
  try {
    return linkedPagesOf(index ? JSON.parse(index.content) : undefined);
  } catch {
    return [];
  }
}

async function targetKind(p: string): Promise<ProjectKind> {
  const kind = await kindOf(projectDir(p));
  if (!kind) throw new HttpError(404, 'noProject', { name: p });
  return kind;
}

/**
 * Pages of other projects in this one (.design/cross-kind-embedding.md): the picker's list, a page copied
 * in (live where it can run, with a picture drawn beside it; or only the picture) with a record of where it
 * came from, whether the original has changed since, and the one-step update, undo and unlink. A live
 * artboard and a frozen dashboard are the same kind of record as a picture, so the same check and update
 * apply to all of them.
 */
export function registerLinkPage(app: Hono): void {
  /** The projects whose pages this one can take, each with its pages, the ones inside this project's folder first. */
  app.get('/api/projects/:p/link-sources', async (c) => {
    const p = c.req.param('p');
    const kind = await targetKind(p);
    if (!takesPages(kind)) return c.json({ sources: [] });
    return c.json({ sources: await sourcesFor(p, kind) });
  });

  /**
   * Put a page of another project in this one. `mode` says what to keep: `live` (an artboard copied with what
   * it mounts and shows, or a dashboard frozen into one file; the picture beside it is drawn in the
   * background) or `image` (a picture drawn the way the original's Export menu draws it, kept under
   * uploads/linked/<id>/). Left out, the source's preferred form for this kind of project.
   */
  app.post('/api/projects/:p/link-page', async (c) => {
    const p = c.req.param('p');
    const { from: named, page, mode: asked } = await c.req.json<{ from: string; page: string; mode?: LinkMode }>();
    if (!isProjectName(named ?? '')) throw new HttpError(400, 'badProjectName');
    const from = resolveKey(named);
    if (from === p) throw new HttpError(400, 'linkSelf');
    const into = await targetKind(p);
    const sourceKind = await kindOf(projectDir(from));
    if (!sourceKind) throw new HttpError(404, 'noProject', { name: from });
    const modes = linkModes(sourceKind, into);
    const mode: LinkMode = asked === 'live' || asked === 'image' ? asked : modes[0];
    if (!modes.includes(mode)) throw new HttpError(400, 'linkNotTaken', { into, from: sourceKind });
    const files = await textFiles(from);
    const found = pagesOf(sourceKind, files).find((x) => x.page === String(page ?? ''));
    if (!found) throw new HttpError(404, 'linkNoPage', { name: from, page: String(page ?? '') });
    const rel = relInside(projectDir(p), projectDir(from));
    const taken = (records: LinkedPage[]) => records.flatMap((r) => [r.path, r.poster ?? '']).map((x) => /^uploads\/linked\/([^/]+)\//.exec(x)?.[1]).filter((x): x is string => !!x);
    if (mode === 'live') {
      const at = await fingerprint(from, sourceKind, found.page, files);
      const out = await withLock(p, async () => {
        const records = await recordsOf(p, into);
        const same = records.find((r) => r.mode === 'live' && r.kind === sourceKind && r.page === found.page && r.from === `projects/${from}`);
        const path = same?.path ?? (sourceKind === 'design' ? `${importedBoardDir(from, found.page)}/${found.page}` : `${linkedDir(newLinkId(taken(records)))}/${bundleName(found.title)}`);
        const replaced = await copyLive(p, { name: from, kind: sourceKind }, found.page, path, files, `${found.title} linked from ${from}`);
        if (same && replaced.length) keepStash(p, { record: same, files: replaced });
        // where the picture will be kept, so the page can name it before it is drawn
        const poster = same?.poster ?? `${linkedDir(newLinkId([...taken(records), ...(path.startsWith('uploads/linked/') ? [path.split('/')[2]] : [])]))}/${linkedStem(found.page === 'index' ? found.title : found.page)}.png`;
        const rec: LinkedPage = { path, from: `projects/${from}`, ...(rel ? { rel } : {}), kind: sourceKind, page: found.page, mode: 'live', poster, at, copiedAt: new Date().toISOString() };
        await editIndex(p, INDEX_FILE[into], (json) => void (json.imports = putLinked(json.imports, rec)), `${found.title} linked from ${from}`);
        logInfo('link.added', { project: p, from, page: found.page, kind: sourceKind, mode });
        return { record: rec, size: sourceKind === 'design' ? (found.size ?? [1280, 720]) : DASH_VIEW, title: found.title };
      });
      // the picture beside it is drawn while the person goes on; the panel and the exports use it once it is there
      void drawPoster(p, into, out.record.path, langOf(c));
      return c.json(out);
    }
    const png = await renderPagePng(from, sourceKind, found.page, files, langOf(c));
    const at = await fingerprint(from, sourceKind, found.page, files);
    return withLock(p, async () => {
      const records = await recordsOf(p, into);
      const same = records.find((r) => r.mode === 'image' && r.kind === sourceKind && r.page === found.page && r.from === `projects/${from}`);
      const path = same?.path ?? `${linkedDir(newLinkId(taken(records)))}/${linkedStem(found.page)}.png`;
      if (same) keepStash(p, { record: same, files: [{ rel: path, bytes: await readAsset(p, path) }] });
      await writeAsset(p, path, new Uint8Array(png));
      publish(p, { type: 'assets' });
      const rec: LinkedPage = { path, from: `projects/${from}`, ...(rel ? { rel } : {}), kind: sourceKind, page: found.page, mode: 'image', at, copiedAt: new Date().toISOString() };
      await editIndex(p, INDEX_FILE[into], (json) => void (json.imports = putLinked(json.imports, rec)), `${found.title} linked from ${from}`);
      logInfo('link.added', { project: p, from, page: found.page, kind: sourceKind, mode, bytes: png.length });
      return c.json({ record: rec, size: pngSize(png), title: found.title });
    });
  });

  /** Where each linked page stands against its original: current, changed, or why that cannot be said. */
  app.post('/api/projects/:p/link-check', async (c) => {
    const p = c.req.param('p');
    const kind = await targetKind(p);
    const cards = new Map((await listProjects()).map((x) => [x.name, x]));
    const texts = new Map<string, Record<string, string>>();
    const out: LinkCheck[] = [];
    for (const rec of await recordsOf(p, kind)) {
      try {
        const src = await resolveSource(p, rec);
        if (typeof src === 'string') {
          out.push({ path: rec.path, state: src });
          continue;
        }
        if (!texts.has(src.name)) texts.set(src.name, await textFiles(src.name));
        const files = texts.get(src.name)!;
        const found = pagesOf(src.kind, files).find((x) => x.page === rec.page);
        const base = { path: rec.path, project: src.name, title: cards.get(src.name)?.title ?? src.name, ...(found ? { page: found.title } : {}) };
        if (!found) {
          out.push({ ...base, state: 'missing' });
          continue;
        }
        let state: LinkCheck['state'];
        if (rec.at) state = rec.at === (await fingerprint(src.name, rec.kind, rec.page, files)) ? 'current' : 'changed';
        else if (rec.mode === 'live') state = (await readOne(p, rec.path))?.content === files[rec.page] ? 'current' : 'changed';
        else state = 'changed';
        out.push({ ...base, state });
      } catch (e) {
        logInfo('link.check.failed', { project: p, path: rec.path, error: (e as Error).message });
        out.push({ path: rec.path, state: 'unreadable' });
      }
    }
    return c.json({ links: out });
  });

  /** Copy the original again: the picture is drawn anew, an artboard copied anew. What it replaced is kept for the Undo that follows. */
  app.post('/api/projects/:p/link-refresh', async (c) => {
    const p = c.req.param('p');
    const { path } = await c.req.json<{ path: string }>();
    const kind = await targetKind(p);
    const rec = (await recordsOf(p, kind)).find((r) => r.path === path);
    if (!rec) throw new HttpError(404, 'linkNoRecord');
    const src = await resolveSource(p, rec);
    if (typeof src === 'string') throw new HttpError(404, 'linkGone', { name: rec.from.replace(/^projects\//, '') });
    const files = await textFiles(src.name);
    if (!pagesOf(src.kind, files).some((x) => x.page === rec.page)) throw new HttpError(404, 'linkNoPage', { name: src.name, page: rec.page });
    const png = rec.mode === 'image' ? await renderPagePng(src.name, rec.kind, rec.page, files, langOf(c)) : null;
    const at = await fingerprint(src.name, rec.kind, rec.page, files);
    const out = await withLock(p, async () => {
      let replaced: Replaced[];
      if (png) {
        replaced = [{ rel: rec.path, bytes: await readAsset(p, rec.path) }];
        await writeAsset(p, rec.path, new Uint8Array(png));
        publish(p, { type: 'assets' });
      } else {
        // copied to where the record says it is, whatever the project is called now
        replaced = await copyLive(p, src, rec.page, rec.path, files, `${rec.page} updated from ${src.name}`);
      }
      const next: LinkedPage = { ...rec, at, copiedAt: new Date().toISOString() };
      const stash = { record: rec, files: replaced };
      keepStash(p, stash);
      await editIndex(p, INDEX_FILE[kind], (json) => void (json.imports = putLinked(json.imports, next)), `${rec.page} updated from ${src.name}`);
      logInfo('link.updated', { project: p, from: src.name, page: rec.page, mode: rec.mode });
      return { next, stash, replaced: replaced.length > 0 };
    });
    let { next } = out;
    let changed = out.replaced || !!png;
    if (rec.mode === 'live') {
      // the picture kept beside the live copy is drawn again with it; what it replaced goes back with an Undo
      const old = rec.poster ? await readAsset(p, rec.poster).catch(() => null) : null;
      const poster = await drawPoster(p, kind, rec.path, langOf(c));
      if (poster) {
        if (old) out.stash.files.push({ rel: poster, bytes: old });
        next = { ...next, poster };
        changed = true;
      }
    }
    return c.json({ record: next, changed, size: png ? pngSize(png) : null });
  });

  /** The picture kept beside a live copy: the path of it, drawn first when it is not there yet. */
  app.post('/api/projects/:p/link-poster', async (c) => {
    const p = c.req.param('p');
    const { path } = await c.req.json<{ path: string }>();
    const kind = await targetKind(p);
    const rec = (await recordsOf(p, kind)).find((r) => r.path === path);
    if (!rec) throw new HttpError(404, 'linkNoRecord');
    const poster = rec.mode === 'image' ? rec.path : (rec.poster ?? (await drawPoster(p, kind, rec.path, langOf(c))));
    if (!poster) throw new HttpError(503, 'linkNoPoster');
    const bytes = await readAsset(p, poster).catch(() => null);
    return c.json({ poster, size: bytes ? pngSize(new Uint8Array(bytes)) : null });
  });

  /** Take back the last update of one linked page. */
  app.post('/api/projects/:p/link-undo', async (c) => {
    const p = c.req.param('p');
    const { path } = await c.req.json<{ path: string }>();
    const kind = await targetKind(p);
    const stash = takeStash(p, path);
    if (!stash) throw new HttpError(409, 'linkNothingToUndo');
    return withLock(p, async () => {
      for (const f of stash.files) {
        if (!f.bytes) continue;
        if (isLiveText(f.rel)) {
          const content = f.bytes.toString('utf8');
          const version = await writeAtomic(p, f.rel, content);
          publish(p, { type: 'file', path: f.rel, content, version, actor: 'human' });
          await record(p, { actor: 'human', file: f.rel, summary: 'update taken back', version });
        } else await writeAsset(p, f.rel, new Uint8Array(f.bytes));
      }
      publish(p, { type: 'assets' });
      await editIndex(p, INDEX_FILE[kind], (json) => void (json.imports = putLinked(json.imports, stash.record)), `${stash.record.page} update taken back`);
      return c.json({ record: stash.record });
    });
  });

  /** Let go of the original: the record goes, the copy stays as an ordinary picture or artboard. */
  app.post('/api/projects/:p/link-unlink', async (c) => {
    const p = c.req.param('p');
    const { path } = await c.req.json<{ path: string }>();
    const kind = await targetKind(p);
    const rec = (await recordsOf(p, kind)).find((r) => r.path === path);
    if (!rec) throw new HttpError(404, 'linkNoRecord');
    keepStash(p, { record: rec, files: [] });
    await withLock(p, () => editIndex(p, INDEX_FILE[kind], (json) => void (json.imports = dropLinked(json.imports, path)), `${rec.page} unlinked from ${rec.from}`));
    return c.json({ record: rec });
  });
}
