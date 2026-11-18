import type { Hono } from 'hono';
import { editIndex } from './shared';
import { CANVAS_FILE, DECK_FILE, boardDeps, importedBoardDir, isBoardFile, parseCanvas, putLinked, MOTION_FILE, type LinkedPage } from '@dc/core';
import { HttpError, isProjectName, kindOf, projectDir, resolveKey, readAsset, readOne, withLock, writeAsset, writeAtomic } from '../store';
import { publish, record } from '../hub';
import { fingerprint, keepStash } from '../linkedPage';

/**
 * Copy an artboard of a canvas, with every sibling it mounts and every file it shows, into `p`: the
 * artboards under `dir` (keeping their paths), what they show at the same paths. Returns the files it
 * replaced, as they were, for an Undo.
 */
export async function copyArtboard(p: string, from: string, board: string, dir: string, actor = `artboard ${board} imported from ${from}`): Promise<{ replaced: { rel: string; bytes: Buffer | null }[]; assets: number }> {
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
  const replaced: { rel: string; bytes: Buffer | null }[] = [];
  for (const [f, content] of boards) {
    const rel = `${dir}/${f}`;
    const cur = await readOne(p, rel);
    if (cur?.content === content) continue;
    replaced.push({ rel, bytes: cur ? Buffer.from(cur.content) : null });
    const version = await writeAtomic(p, rel, content);
    publish(p, { type: 'file', path: rel, content, version, actor: 'human' });
    await record(p, { actor: 'human', file: rel, summary: actor, version });
  }
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

/** Importing a canvas artboard into a deck or motion piece. */
export function registerImportBoard(app: Hono): void {
  /**
   * Import an artboard of a canvas into a slide deck or a motion piece: the
   * artboard, the siblings it mounts and the files it shows are copied in (the
   * artboards under uploads/<from>-<board>/, keeping their paths; its uploads/
   * and assets/ files at the same paths), and the index records where it came
   * from, so importing it again updates the copy every embed points at. The
   * editor then puts the `<x-embed src>` on the slide or scene. The record is
   * a linked page (.design/cross-kind-embedding.md): it also says which page
   * of which kind, and a hash of the original, so a change there is noticed.
   */
  app.post('/api/projects/:p/import-board', async (c) => {
    const p = c.req.param('p');
    const { from: named, board } = await c.req.json<{ from: string; board: string }>();
    if (!isProjectName(named ?? '')) throw new HttpError(400, 'badProjectName');
    const from = resolveKey(named);
    const kind = await kindOf(projectDir(p));
    if (kind !== 'slides' && kind !== 'motion') throw new HttpError(400, 'importBoardInto');
    if ((await kindOf(projectDir(from))) !== 'design') throw new HttpError(404, 'notCanvas', { name: from });
    const canvas = parseCanvas((await readOne(from, CANVAS_FILE))?.content);
    if (!isBoardFile(board ?? '') || !canvas.boards[board] || !(await readOne(from, board))) throw new HttpError(404, 'noBoard', { name: from, board: String(board ?? '') });
    const dir = importedBoardDir(from, board);
    return withLock(p, async () => {
      const { replaced } = await copyArtboard(p, from, board, dir);
      const rec: LinkedPage & { board: string } = {
        path: `${dir}/${board}`,
        from: `projects/${from}`,
        kind: 'design',
        page: board,
        board,
        mode: 'live',
        at: await fingerprint(from, 'design', board),
        copiedAt: new Date().toISOString(),
      };
      const index = kind === 'slides' ? DECK_FILE : MOTION_FILE;
      let before: LinkedPage | undefined;
      await editIndex(
        p,
        index,
        (json) => {
          before = (Array.isArray(json.imports) ? (json.imports as LinkedPage[]) : []).find((r) => r && r.path === rec.path);
          json.imports = putLinked(json.imports, rec);
        },
        `artboard ${board} imported from ${from}`,
      );
      if (before && replaced.length) keepStash(p, { record: before, files: replaced });
      return c.json({ record: rec, size: [canvas.boards[board].w, canvas.boards[board].h] });
    });
  });
}
