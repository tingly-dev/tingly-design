import type { Hono } from 'hono';
import { editIndex } from './shared';
import { CANVAS_FILE, DECK_FILE, boardDeps, importedBoardDir, isBoardFile, parseCanvas, MOTION_FILE, type BoardImport } from '@dc/core';
import { HttpError, isProjectName, kindOf, projectDir, readAsset, readOne, withLock, writeAsset, writeAtomic } from '../store';
import { publish, record } from '../hub';

/** Importing a canvas artboard into a deck or motion piece. */
export function registerImportBoard(app: Hono): void {
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
}
