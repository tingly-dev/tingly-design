import type { Hono } from 'hono';
import { CANVAS_FILE, DECK_FILE, DS_INDEX, DS_TOKENS, DS_TOKENS_CSS, dsFolderOf, parseDsIndex, resolveTokens, type Actor, type DsRecord, lookOf, lookTokens } from '@dc/core';
import { HttpError, isProjectName, kindOf, regenTokensCss, projectDir, readAsset, readOne, removeFile, withLock, writeAsset, writeAtomic, versionOf } from '../store';
import { publish, record } from '../hub';
import { trOf } from '../i18n';

/** tokens.json changed in a design system: rebuild tokens.css and tell every editor. */
export async function afterTokens(p: string, actor: Actor): Promise<void> {
  if ((await kindOf(projectDir(p))) !== 'design-system') return;
  const css = await regenTokensCss(p);
  if (css) publish(p, { type: 'file', path: DS_TOKENS_CSS, content: css.content, version: css.version, actor });
}

/** Read a JSON index, change it, write it back as one versioned edit everyone sees. */
export async function editIndex(p: string, rel: string, fn: (json: Record<string, unknown>) => void, summary: string): Promise<void> {
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

/** Design systems: install one into a canvas or deck, tokens, components. */
export function registerDesignSystems(app: Hono): void {
  /**
   * Install a project design system or a built-in look into a canvas or deck, the way
   * the original installs one: the deck keeps its own copy of tokens.json (and
   * the font files it names) under ds/<folder>/, and one record in its index's
   * designSystems. A deck also gets the system's font files as typefaces.
   */
  app.post('/api/projects/:p/design-systems', async (c) => {
    const p = c.req.param('p');
    const { from, look: lookId } = await c.req.json<{ from?: string; look?: string }>();
    if (lookId !== undefined && from !== undefined) throw new HttpError(400, 'badDesignSystemName');
    const builtin = lookId !== undefined ? lookOf(String(lookId)) : undefined;
    if (lookId !== undefined && !builtin) throw new HttpError(400, 'badLook', { look: String(lookId) });
    if (!builtin && !isProjectName(from ?? '')) throw new HttpError(400, 'badDesignSystemName');
    const kind = await kindOf(projectDir(p));
    if (kind !== 'design' && kind !== 'slides') throw new HttpError(400, 'installOnlyInto');
    if (!builtin && (await kindOf(projectDir(from!))) !== 'design-system') throw new HttpError(404, 'notDesignSystem', { name: from! });
    const index = builtin
      ? { title: trOf(c)(`ds.look.${builtin.id}`, { defaultValue: builtin.id }), namespace: `look-${builtin.id}` }
      : parseDsIndex((await readOne(from!, DS_INDEX))?.content);
    const content = builtin ? lookTokens(builtin, index.title) : null;
    const tokens = content !== null ? { content, version: versionOf(content) } : await readOne(from!, DS_TOKENS);
    if (!tokens) throw new HttpError(409, 'noTokens', { name: from! });
    const folder = dsFolderOf(index.namespace);
    return withLock(p, async () => {
      const rel = `ds/${folder}/tokens.json`;
      const v = await writeAtomic(p, rel, tokens.content);
      publish(p, { type: 'file', path: rel, content: tokens.content, version: v, actor: 'human' });
      const resolved = resolveTokens(tokens.content);
      const fonts = resolved.fonts;
      const copied: string[] = [];
      for (const f of fonts) {
        const bytes = builtin ? null : await readAsset(from!, f.file).catch(() => null);
        if (!bytes) continue;
        await writeAsset(p, `ds/${folder}/${f.file}`, new Uint8Array(bytes));
        copied.push(f.file);
      }
      const rec: DsRecord = { title: index.title, namespace: folder, artifact: builtin ? `builtin:${builtin.id}` : `projects/${from}`, version: tokens.version, copiedAt: new Date().toISOString() };
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
}
