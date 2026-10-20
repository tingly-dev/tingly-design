import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  CANVAS_FILE,
  MOTION_FILE,
  isMotionFile,
  newMotion,
  sceneFile,
  DASH_DATA_TYPES,
  IMAGE_TYPES,
  isKeptPath,
  isUploadPath,
  DOC_INDEX,
  isDocFile,
  newDocTab,
  parseDoc,
  stringifyDoc,
  tabFile,
  DASH_INDEX,
  DASH_PAGE,
  DASH_STARTER_PAGE,
  isDashFile,
  isDataPath,
  newDash,
  parseDash,
  stringifyDash,
  DECK_FILE,
  DS_INDEX,
  DS_README,
  DS_TOKENS,
  DS_TOKENS_CSS,
  compileTokensCss,
  isDsTextFile,
  namespaceOf,
  newDsIndex,
  parseDsIndex,
  resolveTokens,
  starterTokens,
  lookOf,
  lookTokens,
  stringifyDsIndex,
  isBoardFile,
  isSlideFile,
  newBoardSource,
  newSlideSource,
  parseCanvas,
  parseDeck,
  slideFile,
  stringifyCanvas,
  stringifyDeck,
  cleanGroup,
  projectCard,
  type ProjectCard,
  type ProjectKind,
} from '@dc/core';
import { PROJECTS_DIR, SAMPLES_DIR } from './layout';
import { repoOf } from './git';
import type { ErrorKey, Language, TFunction } from '@dc/i18n';
import { translator } from '@dc/i18n';

export { PROJECTS_DIR, ROOT as REPO_ROOT } from './layout';

export interface FileState {
  content: string;
  version: string;
}

export function versionOf(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

export function isProjectName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name);
}

export function projectDir(name: string): string {
  if (!isProjectName(name)) throw new HttpError(400, 'badProjectName');
  return links.get(name) ?? join(PROJECTS_DIR, name);
}

// ---------------------------------------------------------------- projects kept elsewhere

/**
 * A project folder anywhere on disk, opened or created from the launcher, is
 * listed in `.links.json` beside the projects (`{ name: absolute path }`), so
 * it gets a flat name like every other project and the rest of the server,
 * the editor's `?p=` and Claude Code delegation need no second kind of
 * address. Removing a link never touches the folder. DC_LINKS=0 turns it off
 * for a host that keeps every project in its own data folder.
 */
const LINKS_FILE = '.links.json';
export const LINKS_ON = process.env.DC_LINKS !== '0';
const links = new Map<string, string>(LINKS_ON ? readLinks() : []);

function readLinks(): [string, string][] {
  try {
    const raw = JSON.parse(readFileSync(join(PROJECTS_DIR, LINKS_FILE), 'utf8')) as Record<string, unknown>;
    return Object.entries(raw).filter((e): e is [string, string] => isProjectName(e[0]) && typeof e[1] === 'string' && isAbsolute(e[1]));
  } catch {
    return [];
  }
}

/** Every linked project: name → absolute folder. */
export function linkedProjects(): ReadonlyMap<string, string> {
  return links;
}

/** A path as a person typed it (`~/work/site`, an absolute path) made absolute, or null when it is neither. */
export function folderPath(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  if (v === '~' || v.startsWith('~/') || v.startsWith('~\\')) return resolve(homedir(), v.slice(2));
  return isAbsolute(v) ? resolve(v) : null;
}

/** The path to show for a folder: `~/…` under the home folder. */
export function showPath(abs: string): string {
  const rel = relative(homedir(), abs);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? `~/${rel.split(sep).join('/')}` : abs;
}

/** What is at a folder: a project of some kind, nothing (free to create in), or something else. */
export async function inspectFolder(input: string): Promise<{ path: string; state: 'project' | 'free' | 'busy' | 'file'; kind?: ProjectKind; name?: string; repo?: string }> {
  const abs = folderPath(input);
  if (!abs) throw new HttpError(400, 'badFolderPath', { path: input });
  const path = showPath(abs);
  const st = await stat(abs).catch(() => null);
  // the repository a project here would commit to, if any
  const repo = await repoOf(abs);
  const inRepo = repo ? { repo: showPath(repo) } : {};
  if (!st) return { path, state: 'free', ...inRepo };
  if (!st.isDirectory()) return { path, state: 'file' };
  const kind = await kindOf(abs);
  if (kind) return { path, state: 'project', kind, name: nameOfFolder(abs), ...inRepo };
  const entries = (await readdir(abs).catch(() => [])).filter((e) => !e.startsWith('.'));
  return { path, state: entries.length ? 'busy' : 'free', ...inRepo };
}

/** The project name a folder already answers to: a folder in the projects folder, or one already linked. */
export function nameOfFolder(abs: string): string | undefined {
  for (const [name, dir] of links) if (dir === abs) return name;
  if (dirname(abs) === PROJECTS_DIR && isProjectName(basename(abs))) return basename(abs);
  return undefined;
}

async function takenNames(): Promise<Set<string>> {
  const names = new Set(links.keys());
  for (const e of await readdir(PROJECTS_DIR).catch(() => [] as string[])) names.add(e);
  return names;
}

/** A free project name for a folder, from its own name. */
async function nameFor(abs: string): Promise<string> {
  const base = basename(abs).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-_]+|-+$/g, '').slice(0, 56) || 'project';
  const taken = await takenNames();
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

let linksWrite: Promise<unknown> = Promise.resolve();
function saveLinks(): Promise<void> {
  const next = linksWrite.then(async () => {
    await mkdir(PROJECTS_DIR, { recursive: true });
    const tmp = join(PROJECTS_DIR, `${LINKS_FILE}.tmp-${randomUUID().slice(0, 8)}`);
    await writeFile(tmp, JSON.stringify(Object.fromEntries(links), null, 2) + '\n', 'utf8');
    await rename(tmp, join(PROJECTS_DIR, LINKS_FILE));
  });
  linksWrite = next.catch(() => {});
  return next;
}

/** Listeners told when a folder is linked or unlinked (the file watcher). */
const linkListeners = new Set<(name: string, dir: string | null) => void>();
export function onLinksChange(fn: (name: string, dir: string | null) => void): void {
  linkListeners.add(fn);
}

/**
 * A name for a project folder in this process only, without adding it to the list on disk: the
 * command line exporting a folder given by its path opens it in the editor this way, and the
 * launcher never shows it.
 */
export async function visitFolder(abs: string): Promise<string> {
  const known = nameOfFolder(abs);
  if (known) return known;
  const name = await nameFor(abs);
  links.set(name, abs);
  return name;
}

/**
 * Opens a project folder that lives anywhere: its name when it already has
 * one, else a new link. `create` links a folder that is missing or empty, for
 * a new project to be written into.
 */
export async function linkFolder(input: string, create = false): Promise<string> {
  if (!LINKS_ON) throw new HttpError(403, 'linksOff');
  const abs = folderPath(input);
  if (!abs) throw new HttpError(400, 'badFolderPath', { path: input });
  const at = await inspectFolder(abs);
  if (create ? at.state !== 'free' : at.state !== 'project') {
    throw new HttpError(create ? 409 : 404, create ? (at.state === 'project' ? 'folderHasProject' : 'folderNotEmpty') : at.state === 'free' ? 'noFolder' : 'noProjectInFolder', { path: at.path });
  }
  const known = nameOfFolder(abs);
  if (known) {
    if (create) throw new HttpError(409, 'folderHasProject', { path: at.path });
    return known;
  }
  const name = await nameFor(abs);
  links.set(name, abs);
  await saveLinks();
  for (const fn of linkListeners) fn(name, abs);
  return name;
}

/** Takes a linked project off the list. Its folder and files stay where they are. */
export async function unlinkProject(name: string): Promise<void> {
  if (!links.has(name)) throw new HttpError(404, 'notLinked', { name });
  links.delete(name);
  await saveLinks();
  for (const fn of linkListeners) fn(name, null);
}

/**
 * A refused request. `key` names the message in @dc/i18n's `errors` area; the server's error
 * handler words it in the language of the request, so the person reads it in the editor's language.
 */
export class HttpError extends Error {
  constructor(
    public status: number,
    public key: ErrorKey,
    public params: Record<string, string | number> = {},
  ) {
    super(key);
  }
}

/** A path inside a project that the editor is allowed to read and write. */
export function safeRel(rel: string): string {
  const r = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  if (r === CANVAS_FILE || isBoardFile(r) || r === DECK_FILE || isSlideFile(r)) return r;
  if (isDashFile(r) || isDocFile(r) || isMotionFile(r)) return r;
  // a design system's text files, and a copy of one installed into a canvas or deck
  if (isDsTextFile(r) || /^ds\/[a-z0-9][a-z0-9_-]{0,63}\/tokens\.json$/.test(r)) return r;
  throw new HttpError(400, 'notProjectFile', { path: rel });
}

/** Images and fonts a project keeps beside its files (binary, never edited as text). */
export const ASSET_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
};

/** The media type a project's binary file is served with. */
export function assetType(rel: string): string {
  const ext = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase();
  if (rel.startsWith('uploads/')) return uploadType(ext);
  return (rel.startsWith('data/') ? DASH_DATA_TYPES[ext] : ASSET_TYPES[ext]) ?? 'application/octet-stream';
}

/** A file kept in uploads/ is served as an image, a font, a PDF, an SVG, or else plain text (never as a page or a script). */
function uploadType(ext: string): string {
  if (IMAGE_TYPES[ext]) return IMAGE_TYPES[ext];
  if (ext !== 'svg' && ASSET_TYPES[ext]) return ASSET_TYPES[ext];
  if (ext === 'ico') return 'image/x-icon';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'svg') return 'image/svg+xml';
  return 'text/plain; charset=utf-8';
}

export function assetRel(rel: string): string {
  const r = rel.replace(/\\/g, '/');
  // a dashboard's data files: csv, tsv, json, SQLite
  if (isDataPath(r)) return r;
  // what people brought in: files attached to requests, folders they imported
  if (isUploadPath(r) || isKeptPath(r)) return r;
  const m = /^(assets(?:\/[A-Za-z0-9_][A-Za-z0-9_ -]{0,60})?|fonts|ds\/[a-z0-9][a-z0-9_-]{0,63}\/(?:assets(?:\/[A-Za-z0-9_][A-Za-z0-9_ -]{0,60})?|fonts))\/([A-Za-z0-9_-][A-Za-z0-9_. -]{0,120})\.([a-z0-9]+)$/i.exec(r);
  if (!m || r.includes('..') || !ASSET_TYPES[m[3].toLowerCase()]) throw new HttpError(400, 'notAssetPath', { path: rel });
  return r;
}

export async function kindOf(dir: string): Promise<ProjectKind | null> {
  for (const [file, kind] of [[DECK_FILE, 'slides'], [DASH_INDEX, 'dashboard'], [DOC_INDEX, 'docs'], [MOTION_FILE, 'motion'], [CANVAS_FILE, 'design'], [DS_INDEX, 'design-system']] as const) {
    try {
      await stat(join(dir, file));
      return kind;
    } catch {
      // try the next
    }
  }
  return null;
}

export function isTracked(rel: string): boolean {
  try {
    safeRel(rel);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir: string, base: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, base, out);
    else {
      const rel = relative(base, p).split(sep).join('/');
      if (isTracked(rel)) out.push(rel);
    }
  }
}

/**
 * A projects folder that does not exist yet starts with the samples, so a
 * host's first visit opens on working sample projects instead of an empty
 * launcher. An existing folder, even an empty one, is left alone: someone
 * who deleted every project does not get the samples back. DC_SAMPLES=0
 * turns this off.
 */
export async function seedSamples(): Promise<boolean> {
  if (process.env.DC_SAMPLES === '0' || SAMPLES_DIR === PROJECTS_DIR) return false;
  if (await stat(PROJECTS_DIR).catch(() => null)) return false;
  if (!(await stat(SAMPLES_DIR).catch(() => null))) return false;
  // whatever a person's machine keeps beside a project (journal, run reports, Claude Code's
  // conversation, the transcript: every dotfile) belongs to whoever used the samples before
  await cp(SAMPLES_DIR, PROJECTS_DIR, { recursive: true, filter: (src) => !/[/\\]\.[^/\\]+$/.test(src) });
  // the samples arrive filed together, so a new install's launcher shows them as one group and the person's
  // own projects land beside it, not mixed in; the grouping is this machine's, like any other
  const samples = (await readdir(SAMPLES_DIR, { withFileTypes: true })).filter((e) => e.isDirectory() && isProjectName(e.name));
  await writeFile(join(PROJECTS_DIR, GROUPS_FILE), JSON.stringify(Object.fromEntries(samples.map((e) => [e.name, SAMPLES_GROUP])), null, 2) + '\n', 'utf8');
  return true;
}

const GROUPS_FILE = '.groups.json';
/** The launcher group the bundled samples are filed under on a fresh install. */
export const SAMPLES_GROUP = 'tingly-design';

/** Which launcher group each project is filed under; kept beside the projects, not inside one. */
export async function readGroups(): Promise<Record<string, string>> {
  try {
    const raw = JSON.parse(await readFile(join(PROJECTS_DIR, GROUPS_FILE), 'utf8')) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) if (isProjectName(k) && cleanGroup(v)) out[k] = cleanGroup(v);
    return out;
  } catch {
    return {};
  }
}

let groupsWrite: Promise<unknown> = Promise.resolve();
/** Files a project under a group, or out of every group when `group` is empty. */
export function setGroup(name: string, group: string): Promise<void> {
  const next = groupsWrite.then(async () => {
    const all = await readGroups();
    if (group) all[name] = group;
    else delete all[name];
    await mkdir(PROJECTS_DIR, { recursive: true });
    const tmp = join(PROJECTS_DIR, `${GROUPS_FILE}.tmp-${randomUUID().slice(0, 8)}`);
    await writeFile(tmp, JSON.stringify(all, null, 2) + '\n', 'utf8');
    await rename(tmp, join(PROJECTS_DIR, GROUPS_FILE));
  });
  groupsWrite = next.catch(() => {});
  return next;
}

export async function listProjects(): Promise<ProjectCard[]> {
  await mkdir(PROJECTS_DIR, { recursive: true });
  const groups = await readGroups();
  const out: ProjectCard[] = [];
  const found: { name: string; dir: string; path?: string }[] = [];
  for (const e of await readdir(PROJECTS_DIR, { withFileTypes: true })) {
    if (e.isDirectory() && isProjectName(e.name) && !links.has(e.name)) found.push({ name: e.name, dir: join(PROJECTS_DIR, e.name) });
  }
  for (const [name, dir] of links) found.push({ name, dir, path: showPath(dir) });
  for (const e of found) {
    const dir = e.dir;
    const kind = await kindOf(dir);
    if (!kind) continue;
    try {
      const files: string[] = [];
      await walk(dir, dir, files);
      let newest = 0;
      for (const f of files) {
        try {
          newest = Math.max(newest, (await stat(join(dir, f))).mtimeMs);
        } catch {
          // gone meanwhile
        }
      }
      const read = (rel: string) => readFile(join(dir, rel), 'utf8').catch(() => undefined);
      out.push({ ...(await projectCard(e.name, kind, files, read, newest ? new Date(newest).toISOString() : null)), group: groups[e.name], ...(e.path ? { path: e.path } : {}) });
    } catch {
      // unreadable index
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readProject(name: string): Promise<Record<string, FileState>> {
  const dir = projectDir(name);
  if (!(await kindOf(dir))) throw new HttpError(404, 'noProject', { name });
  return readFolder(dir);
}

/** A project folder's tracked files, wherever it is (the CLI reads a folder it was given without linking it). */
export async function readFolder(dir: string): Promise<Record<string, FileState>> {
  const files: string[] = [];
  await walk(dir, dir, files);
  const out: Record<string, FileState> = {};
  for (const f of files) {
    const content = await readFile(join(dir, f), 'utf8');
    out[f] = { content, version: versionOf(content) };
  }
  return out;
}

export async function readOne(name: string, rel: string): Promise<FileState | null> {
  try {
    const content = await readFile(join(projectDir(name), safeRel(rel)), 'utf8');
    return { content, version: versionOf(content) };
  } catch {
    return null;
  }
}

/** Writes happen one at a time per project so the version check and the write are atomic. */
const locks = new Map<string, Promise<unknown>>();
export function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(name) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(name, next.catch(() => {}));
  return next;
}

/** Versions this server wrote, so the file watcher can tell our writes from outside edits. */
export const ownWrites = new Map<string, string>();

export async function writeAtomic(name: string, rel: string, content: string): Promise<string> {
  const path = join(projectDir(name), safeRel(rel));
  await mkdir(dirname(path), { recursive: true });
  // unique per write: two writes of one file in the same millisecond must not share a temp file
  const tmp = path + `.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
  await writeFile(tmp, content, 'utf8');
  const v = versionOf(content);
  ownWrites.set(`${name}/${rel}`, v);
  await rename(tmp, path);
  return v;
}

export async function writeAsset(name: string, rel: string, bytes: Uint8Array): Promise<void> {
  const path = join(projectDir(name), assetRel(rel));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

export async function readAsset(name: string, rel: string): Promise<Buffer | null> {
  try {
    return await readFile(join(projectDir(name), assetRel(rel)));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return null;
  }
}

/**
 * tokens.css is generated from tokens.json (never written by hand): rebuilt
 * whenever tokens.json changes, from the editor, Claude Code or a terminal.
 * Returns the new content when it changed.
 */
export async function regenTokensCss(name: string): Promise<{ content: string; version: string } | null> {
  const tokens = await readOne(name, DS_TOKENS);
  if (!tokens) return null;
  const index = await readOne(name, DS_INDEX);
  const t = resolveTokens(tokens.content);
  const css = compileTokensCss(t, { title: index ? parseDsIndex(index.content).title : t.name });
  const cur = await readOne(name, DS_TOKENS_CSS);
  if (cur?.content === css) return null;
  return { content: css, version: await writeAtomic(name, DS_TOKENS_CSS, css) };
}

/** Binary files of a project (images, fonts), for the asset views. */
export async function listAssets(name: string): Promise<{ path: string; size: number }[]> {
  const dir = projectDir(name);
  const out: { path: string; size: number }[] = [];
  const visit = async (d: string) => {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) await visit(p);
      else {
        const rel = relative(dir, p).split(sep).join('/');
        try {
          assetRel(rel);
          out.push({ path: rel, size: (await stat(p)).size });
        } catch {
          // a text file or something else
        }
      }
    }
  };
  for (const top of ['assets', 'fonts', 'ds', 'data']) await visit(join(dir, top));
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export async function removeAsset(name: string, rel: string): Promise<void> {
  await rm(join(projectDir(name), assetRel(rel)), { force: true });
}

export async function removeFile(name: string, rel: string): Promise<void> {
  ownWrites.set(`${name}/${rel}`, 'deleted');
  await rm(join(projectDir(name), safeRel(rel)), { force: true });
}

/** A new project, its starter copy in `lang`: the language of whoever created it. */
export async function createProject(name: string, title: string, kind: ProjectKind = 'design', lang: Language = 'en', opts: { size?: [number, number]; look?: string } = {}): Promise<void> {
  const t: TFunction = translator(lang);
  const dir = projectDir(name);
  if (await kindOf(dir)) throw new HttpError(409, 'projectExists', { name });
  await mkdir(dir, { recursive: true });
  if (kind === 'design-system') {
    const ns = namespaceOf(title) === 'DS' ? namespaceOf(name) : namespaceOf(title);
    const look = opts.look ? lookOf(opts.look) : undefined;
    if (opts.look && !look) throw new HttpError(400, 'badLook', { look: opts.look });
    await writeAtomic(name, DS_TOKENS, look ? lookTokens(look, title) : starterTokens(title));
    await writeAtomic(name, DS_README, look ? t('starter.dsLookReadme', { title, look: t(`ds.look.${look.id}`) }) : t('starter.dsReadme', { title }));
    await regenTokensCss(name);
    await writeAtomic(name, DS_INDEX, stringifyDsIndex(newDsIndex(title, ns)));
    return;
  }
  if (kind === 'docs') {
    await writeAtomic(name, tabFile('main'), newDocTab(title));
    await writeAtomic(name, DOC_INDEX, stringifyDoc(parseDoc(JSON.stringify({ title, tabs: [{ id: 'main', title: t('starter.docTab') }] }))));
    return;
  }
  if (kind === 'motion') {
    const { motion, scenes } = newMotion(title, '', opts);
    for (const [id, source] of Object.entries(scenes)) await writeAtomic(name, sceneFile(id), source);
    await writeAtomic(name, MOTION_FILE, JSON.stringify(motion, null, 2) + '\n');
    return;
  }
  if (kind === 'dashboard') {
    await writeAtomic(name, DASH_PAGE, DASH_STARTER_PAGE.replace('TITLE', title.replace(/[<&>]/g, '')).replace('HINT', t('starter.dashEmpty')));
    await writeAtomic(name, DASH_INDEX, stringifyDash(newDash(title)));
    return;
  }
  if (kind === 'slides') {
    const deck = parseDeck(JSON.stringify({
      v: 4,
      createdOnFiles: { v: 1, at: new Date().toISOString() },
      lists: 'css',
      title,
      cover: 'cover',
      order: ['cover'],
      sections: {},
      faces: {},
      designSystems: [],
    }));
    await writeAtomic(name, slideFile('cover'), newSlideSource('cover', {
      title,
      body: '',
    }).replace('font-size:72px', 'font-size:112px'));
    await writeAtomic(name, DECK_FILE, stringifyDeck(deck));
    return;
  }
  const [boardW, boardH] = opts.size ?? [1200, 760];
  const canvas = parseCanvas(JSON.stringify({
    v: 3,
    title,
    createdOnFiles: { v: 1, at: new Date().toISOString() },
    boards: { 'Main.dc.html': { x: 0, y: 0, w: boardW, h: boardH, title } },
    order: ['Main.dc.html'],
  }));
  await writeAtomic(name, CANVAS_FILE, stringifyCanvas(canvas));
  await writeAtomic(name, 'Main.dc.html', newBoardSource({ title, w: boardW, h: boardH, lang, hint: t('starter.canvasHint') }));
}
