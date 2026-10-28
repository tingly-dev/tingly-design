import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import {
  ARCHIVE_FORMAT,
  ARCHIVE_MANIFEST,
  DASH_INDEX,
  DS_TOKENS,
  INDEX_FILE,
  archiveKeeps,
  archivePath,
  datasetIdOf,
  detectClaudeDesign,
  docFromMarkdown,
  freeName,
  fromClaudeDesign,
  hasClaudeDesign,
  toClaudeDesign,
  installedSystems,
  parseDash,
  planArchive,
  projectNameFrom,
  renameSystems,
  importPptx,
  pptxNote,
  PPTX_LIMITS,
  type PptxDiagnostic,
  type PptxReport,
  type ArchiveManifest,
  type ArchiveOptions,
  type ClaudeDesignNote,
  type ClaudeDesignKind,
  type DatasetJson,
  type QuerySource,
  type Table,
} from '@dc/core';
import { HttpError, PROJECTS_DIR, isProjectName, kindOf, linkedProjects, projectDir, resolveKey } from './store';
import { callTool } from './connectors';
import type { TFunction } from '@dc/i18n';
import { VERSION } from './layout';

/** Wording lives in the same bilingual bundle as the import result dialog. */
export function describePptx(diagnostic: PptxDiagnostic, t: TFunction): string {
  return t(`launcher.pptx.reason.${pptxNote(diagnostic)}`);
}

/**
 * A whole project as one .zip and back (.design/project-archive.md). The rules on what goes in
 * and how an archive is read are in core (`projectArchive.ts`); this file reads and writes the
 * folders.
 */

/** Unpacking stops past these, so a hostile archive cannot fill the disk. */
const MAX_FILES = 20_000;
const MAX_BYTES = 1024 ** 3;

/** Every file under a folder, `/`-separated, dot files included (the archive rules decide). */
async function walkAll(dir: string, base = dir, out: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walkAll(p, base, out);
    else if (e.isFile()) out.push(relative(base, p).split(sep).join('/'));
  }
  return out;
}

async function addFolder(into: Zippable, dir: string, prefix: string, opts: Pick<ArchiveOptions, 'journal'>): Promise<number> {
  let n = 0;
  for (const rel of await walkAll(dir)) {
    if (!archiveKeeps(rel, opts)) continue;
    into[`${prefix}/${rel}`] = [new Uint8Array(await readFile(join(dir, rel))), { level: /\.(png|jpe?g|gif|webp|mp4|webm|mp3|m4a|woff2?|zip)$/i.test(rel) ? 0 : 6 }];
    n++;
  }
  return n;
}

/** The project's .zip: its folder, and beside it the design systems it installed when asked. `dir` is for a folder named by path (the command line). */
export async function packProject(name: string, opts: ArchiveOptions, dir = projectDir(name)): Promise<{ bytes: Uint8Array; file: string; files: number; systems: string[] }> {
  const kind = await kindOf(dir);
  if (!kind) throw new HttpError(404, 'noProject', { name });
  const zip: Zippable = {};
  let files = await addFolder(zip, dir, name, opts);
  const systems: string[] = [];
  if (opts.systems && (kind === 'design' || kind === 'slides')) {
    const index = await readFile(join(dir, INDEX_FILE[kind]), 'utf8').catch(() => undefined);
    for (const sys of installedSystems(index)) {
      if (sys === name || !isProjectName(sys)) continue;
      const sdir = projectDir(resolveKey(sys));
      if ((await kindOf(sdir)) !== 'design-system') continue;
      files += await addFolder(zip, sdir, sys, { journal: false });
      systems.push(sys);
    }
  }
  const manifest: ArchiveManifest = { format: ARCHIVE_FORMAT, project: name, kind, systems, journal: opts.journal, exportedAt: new Date().toISOString(), version: VERSION };
  zip[ARCHIVE_MANIFEST] = strToU8(JSON.stringify(manifest, null, 2) + '\n');
  return { bytes: zipSync(zip), file: `${name}.zip`, files, systems };
}

/** Every name a new project may not take: the folders in the projects folder and the linked names. */
async function takenNames(): Promise<Set<string>> {
  await mkdir(PROJECTS_DIR, { recursive: true });
  const taken = new Set(linkedProjects().keys());
  for (const e of await readdir(PROJECTS_DIR)) taken.add(e);
  return taken;
}

/** Write one folder of the archive as a new project: into a hidden folder first, then moved into place. */
async function writeProject(files: Record<string, Uint8Array>, prefix: string, name: string, edit?: (rel: string, bytes: Uint8Array) => Uint8Array): Promise<void> {
  const tmp = join(PROJECTS_DIR, `.import-${randomUUID()}`);
  try {
    for (const [path, bytes] of Object.entries(files)) {
      if (!path.startsWith(prefix)) continue;
      const rel = path.slice(prefix.length);
      if (!rel || !archiveKeeps(rel, { journal: true })) continue;
      const to = join(tmp, ...rel.split('/'));
      await mkdir(dirname(to), { recursive: true });
      await writeFile(to, edit ? edit(rel, bytes) : bytes);
    }
    await rename(tmp, projectDir(name));
  } catch (e) {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

export interface Unpacked {
  name: string;
  systems: string[];
  /** set when the file was Claude's own format: the kind it was read as */
  claudeDesign?: ClaudeDesignKind | 'docs';
  notes: ClaudeDesignNote[];
  pptx?: { report: string; source: string; diagnostics: PptxDiagnostic[]; slides: PptxReport['slides'] };
}

/** Every file of a folder as an archive path, for importing a folder the way a .zip is (the command line). */
export async function readTree(dir: string): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  let count = 0;
  let total = 0;
  for (const rel of await walkAll(dir)) {
    const p = archivePath(rel);
    if (!p || p.startsWith('__MACOSX/')) continue;
    const data = new Uint8Array(await readFile(join(dir, rel)));
    if (++count > MAX_FILES || (total += data.length) > MAX_BYTES) throw new HttpError(413, 'archiveTooBig');
    out[p] = data;
  }
  return out;
}

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  let count = 0;
  let total = 0;
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(bytes, {
      filter: (f) => {
        if (f.name.endsWith('/')) return false;
        count++;
        total += f.originalSize;
        if (count > MAX_FILES || total > MAX_BYTES) throw new HttpError(413, 'archiveTooBig');
        return true;
      },
    });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'archiveUnreadable');
  }
  const files: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(raw)) {
    const p = archivePath(name);
    // macOS adds a __MACOSX folder of resource forks to zips it makes
    if (p && !p.startsWith('__MACOSX/')) files[p] = data;
  }
  return files;
}

export const MAX_ARCHIVE_INPUT = MAX_BYTES;

/** Metadata-only sniff: never inflate an OOXML candidate with the generic archive reader. */
function isOfficePackage(bytes: Uint8Array): boolean {
  let contentTypes = false, relationships = false, presentation = false;
  try {
    unzipSync(bytes, { filter: f => {
      contentTypes ||= f.name === '[Content_Types].xml';
      relationships ||= f.name === '_rels/.rels';
      presentation ||= f.name.startsWith('ppt/');
      return false;
    } });
  } catch { /* An explicitly named PPTX still goes through the strict converter. */ }
  return presentation || (contentTypes && relationships);
}

export class PptxImportError extends HttpError {
  constructor(public diagnostics: PptxDiagnostic[]) {
    const error = diagnostics.find(d => d.level === 'error');
    const code = error?.code ?? '';
    super(code === 'limit_exceeded' ? 413 : 400,
      code === 'limit_exceeded' ? 'pptxLimit' : code.startsWith('unsupported_') ? 'pptxUnsupported' : /forbidden|unsafe|external|duplicate/.test(code) ? 'pptxUnsafe' : 'pptxInvalid');
  }
}

/** Reserve the destination exclusively, so concurrent imports cannot replace one another. */
async function writePptx(files: Record<string, Uint8Array>, base: string): Promise<string> {
  const taken = await takenNames();
  for (;;) {
    const name = freeName(base, taken);
    const destination = projectDir(name);
    try { await mkdir(destination); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      taken.add(name);
      continue;
    }
    try { await writeProject(files, '', name); return name; }
    catch (e) { await rmdir(destination).catch(() => {}); throw e; }
  }
}

/** A project from an archive, Markdown or PPTX; the original PPTX is checked before generic unzip. */
export async function unpackProject(bytes: Uint8Array, fileName: string): Promise<Unpacked> {
  if (bytes.length > MAX_ARCHIVE_INPUT) throw new HttpError(413, 'archiveInputTooBig');
  const office = /\.pptx$/i.test(fileName) || isOfficePackage(bytes);
  if (office && bytes.length > PPTX_LIMITS.compressedBytes) throw new PptxImportError([{ level: 'error', code: 'limit_exceeded', params: { budget: 'compressedBytes', max: PPTX_LIMITS.compressedBytes } }]);
  if (office) {
    const title = fileName.replace(/\.[^.]+$/, '') || 'presentation';
    const result = importPptx(bytes, { id: `pptx-${randomUUID().replace(/-/g, '')}`, title });
    if (!result.ok) throw new PptxImportError(result.diagnostics);
    const name = await writePptx(result.files, projectNameFrom(title));
    return { name, systems: [], notes: [], pptx: { report: result.report.path, source: result.report.source, diagnostics: result.diagnostics, slides: result.report.slides } };
  }
  if (/\.(md|markdown)$/i.test(fileName)) {
    const taken = await takenNames();
    const base = projectNameFrom(fileName.replace(/\.(md|markdown)$/i, ''));
    const name = freeName(base, taken);
    await writeProject(docFromMarkdown(strFromU8(bytes), base.replace(/[-_]+/g, ' ')), '', name);
    return { name, systems: [], claudeDesign: 'docs', notes: [] };
  }
  return importFiles(unzip(bytes), fileName);
}

/** The project a set of files holds (an archive's, or a folder's), whichever of our archive and Claude's package it is. */
export async function importFiles(files: Record<string, Uint8Array>, fileName: string): Promise<Unpacked> {
  let manifest: ArchiveManifest | null = null;
  if (files[ARCHIVE_MANIFEST]) {
    try {
      manifest = JSON.parse(strFromU8(files[ARCHIVE_MANIFEST]));
    } catch {
      manifest = null;
    }
  }
  const taken = await takenNames();
  if (!manifest) {
    const match = detectClaudeDesign(Object.keys(files));
    if (match) {
      const got = fromClaudeDesign(files, match);
      // named after its title; a title with no letters or digits (Chinese) falls back to the file or folder name
      const fromTitle = got.title ? projectNameFrom(got.title) : 'project';
      const name = freeName(fromTitle !== 'project' ? fromTitle : projectNameFrom(fileName.replace(/\.zip$/i, '').replace(/[-_]claude[-_]design$/i, '')), taken);
      await writeProject(got.files, '', name);
      return { name, systems: [], claudeDesign: got.kind, notes: got.notes };
    }
  }
  const plan = planArchive(Object.keys(files), manifest, projectNameFrom(fileName));
  if (!plan) throw new HttpError(400, 'archiveNoProject');
  const renamed: Record<string, string> = {};
  const systems: string[] = [];
  for (const s of plan.systems) {
    // the same system is already here, unchanged: the project uses that one
    const same = taken.has(s.name) && isProjectName(s.name) && (await kindOf(projectDir(s.name))) === 'design-system' && (await readFile(join(projectDir(s.name), DS_TOKENS), 'utf8').catch(() => null)) === (files[`${s.prefix}${DS_TOKENS}`] ? strFromU8(files[`${s.prefix}${DS_TOKENS}`]) : undefined);
    if (same) continue;
    const name = freeName(s.name, taken);
    await writeProject(files, s.prefix, name);
    taken.add(name);
    systems.push(name);
    if (name !== s.name) renamed[s.name] = name;
  }
  const name = freeName(plan.project.name, taken);
  const index = INDEX_FILE[plan.project.kind];
  await writeProject(files, plan.project.prefix, name, (rel, b) => (rel === index && Object.keys(renamed).length ? strToU8(renameSystems(strFromU8(b), renamed)) : b));
  return { name, systems, notes: [] };
}

/** The rows of a dashboard's SQLite queries, by dataset id: each is run here, best effort — one that fails stays a query. */
async function queryRows(name: string, project: Record<string, Uint8Array>): Promise<Record<string, Table>> {
  const out: Record<string, Table> = {};
  const params = parseDash(project[DASH_INDEX] ? strFromU8(project[DASH_INDEX]) : undefined).params;
  for (const [rel, data] of Object.entries(project)) {
    const id = datasetIdOf(rel);
    if (!id) continue;
    let ds: DatasetJson;
    try {
      ds = JSON.parse(strFromU8(data)) as DatasetJson;
    } catch {
      continue;
    }
    const src = ds.source as QuerySource | undefined;
    if (!src || src.kind !== 'query' || src.connector !== 'sqlite') continue;
    try {
      const r = (await callTool(name, src.connector, src.tool, src.args ?? {}, params)) as { columns?: unknown; rows?: unknown };
      if (Array.isArray(r?.columns) && Array.isArray(r?.rows)) out[id] = { columns: r.columns as string[], rows: r.rows as Record<string, unknown>[] };
    } catch {
      // the query is wrong or its database is gone: the dataset goes out as the query it is
    }
  }
  return out;
}

/** The project as Claude's own format: the original type's layout as one .zip (.design/claude-design-format.md). */
export async function packClaudeDesign(name: string, dir = projectDir(name)): Promise<{ bytes: Uint8Array; file: string; files: number; notes: ClaudeDesignNote[] }> {
  const kind = await kindOf(dir);
  if (!kind) throw new HttpError(404, 'noProject', { name });
  if (!hasClaudeDesign(kind)) throw new HttpError(400, 'noClaudeDesign');
  const project: Record<string, Uint8Array> = {};
  for (const rel of await walkAll(dir)) if (archiveKeeps(rel, { journal: false })) project[rel] = new Uint8Array(await readFile(join(dir, rel)));
  let title: unknown;
  try {
    title = JSON.parse((await readFile(join(dir, INDEX_FILE[kind]), 'utf8').catch(() => '{}')) || '{}').title;
  } catch {}
  const pkg = toClaudeDesign(kind, project, typeof title === 'string' && title ? title : name, kind === 'dashboard' ? await queryRows(name, project) : {});
  const zip: Zippable = {};
  for (const [p, d] of Object.entries(pkg.files)) zip[p] = [d, { level: /\.(png|jpe?g|gif|webp|mp4|webm|mp3|m4a|woff2?|zip)$/i.test(p) ? 0 : 6 }];
  return { bytes: zipSync(zip), file: `${name}-claude-design.zip`, files: Object.keys(pkg.files).length, notes: pkg.notes };
}
