import { keepReplaced } from './history';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
  isPptxImportPath,
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
  consumingGuide,
  withConsumingGuide,
  isDsTextFile,
  namespaceOf,
  newDsIndex,
  parseDsIndex,
  resolveTokens,
  starterTokens,
  lookOf,
  lookKit,
  lookTokens,
  LOOK_KIT_WORDS,
  type LookKitWord,
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
import { logInfo, logWarn } from './log';
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
  const known = links.get(name);
  if (known) return known;
  const inProjects = join(PROJECTS_DIR, name);
  // a project made in an opened folder a moment ago is not in the list yet
  if (folders.size && !existsSync(inProjects)) {
    refreshMembers();
    return links.get(name) ?? inProjects;
  }
  return inProjects;
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

/**
 * A linked project's name is made from its folder, so the same folder always answers to the same
 * name: the folder's own name and a short stamp of its path, `site-3f9a1c`. Two folders called
 * `site` are two projects with two names, and what `?p=` says never depends on what was linked first.
 */
function idFor(abs: string): string {
  const slug = basename(abs).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-_]+|-+$/g, '').slice(0, 48).replace(/[-_]+$/, '') || 'project';
  return `${slug}-${createHash('sha1').update(abs).digest('hex').slice(0, 6)}`;
}

/** Linked folders by their name (`idFor`), and the other names the file still holds for them (earlier versions named them by hand or in order of arrival). */
const links = new Map<string, string>();
const aliases = new Map<string, string>();
if (LINKS_ON) {
  const stored = readLinks().map(([key, dir]): [string, string] => [key, resolve(dir)]);
  for (const [key, dir] of stored) {
    links.set(idFor(dir), dir);
    if (key !== idFor(dir)) aliases.set(key, dir);
  }
  // the file is rewritten once, when it still lacks a folder's name made from its path
  const keys = new Set(stored.map(([key]) => key));
  if ([...links.keys()].some((id) => !keys.has(id))) setTimeout(() => void saveLinks().catch(() => {}), 0);
}

/** The older names a linked project is still known by. */
function aliasesOf(dir: string): string[] {
  return [...aliases].filter(([, d]) => d === dir).map(([k]) => k);
}

/**
 * The name a key answers to now: itself, or the name made from the folder an older key was given
 * to (the names earlier versions wrote into `.links.json`, still found in bookmarks, host
 * messages and the sources a design system or an imported board remembers). A folder of that name
 * in the projects folder, or a link under it, comes first. Only the edges call this (the editor
 * opening an address, a source named in a request, the command line); everything else is keyed
 * by the name made from the path, so a project has one key in the hub, the journal and the runs.
 */
export function resolveKey(key: string): string {
  const old = aliases.get(key);
  if (!old || links.has(key) || !isProjectName(key) || existsSync(join(PROJECTS_DIR, key))) return key;
  return idFor(old);
}

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
export async function inspectFolder(input: string): Promise<{ path: string; state: 'project' | 'group' | 'free' | 'busy' | 'file'; kind?: ProjectKind; name?: string; repo?: string; members?: { name: string; kind: ProjectKind }[]; group?: string }> {
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
  const inside = projectsIn(abs);
  if (inside.length) return { path, state: 'group', members: inside.slice(0, MEMBERS_SHOWN).map((m) => ({ name: m.folder, kind: m.kind })), ...(groupIdOf(abs) ? { group: groupIdOf(abs) } : {}), ...inRepo };
  const entries = (await readdir(abs).catch(() => [])).filter((e) => !e.startsWith('.'));
  return { path, state: entries.length ? 'busy' : 'free', ...inRepo };
}

/** The folders inside a folder, for the launcher's folder picker; a path that does not exist falls back to its nearest existing parent. */
export async function browseFolder(input: string): Promise<{ path: string; abs: string; parent: string | null; sep: string; dirs: { name: string; kind?: ProjectKind }[]; more: boolean }> {
  if (input.trim() && !folderPath(input)) throw new HttpError(400, 'badFolderPath', { path: input });
  let abs = folderPath(input) ?? homedir();
  while (!(await stat(abs).catch(() => null))?.isDirectory()) {
    const up = dirname(abs);
    if (up === abs) break;
    abs = up;
  }
  const LIMIT = 500;
  const found: string[] = [];
  for (const e of await readdir(abs, { withFileTypes: true }).catch(() => [])) {
    if (e.name.startsWith('.')) continue;
    // a link to a folder counts as a folder
    if (e.isDirectory() || (e.isSymbolicLink() && (await stat(join(abs, e.name)).catch(() => null))?.isDirectory())) found.push(e.name);
  }
  found.sort((a, b) => a.localeCompare(b));
  const dirs = await Promise.all(found.slice(0, LIMIT).map(async (name) => ({ name, kind: (await kindOf(join(abs, name))) ?? undefined })));
  const up = dirname(abs);
  return { path: showPath(abs), abs, parent: up === abs ? null : up, sep, dirs, more: found.length > LIMIT };
}

/** The project name a folder already answers to: a folder in the projects folder, or one already linked. */
export function nameOfFolder(abs: string): string | undefined {
  for (const [name, dir] of links) if (dir === abs) return name;
  if (dirname(abs) === PROJECTS_DIR && isProjectName(basename(abs))) return basename(abs);
  return undefined;
}

let linksWrite: Promise<unknown> = Promise.resolve();
function saveLinks(): Promise<void> {
  const next = linksWrite.then(async () => {
    await mkdir(PROJECTS_DIR, { recursive: true });
    const tmp = join(PROJECTS_DIR, `${LINKS_FILE}.tmp-${randomUUID().slice(0, 8)}`);
    await writeFile(tmp, JSON.stringify({ ...Object.fromEntries(aliases), ...Object.fromEntries([...links].filter(([name]) => !memberNames.has(name))) }, null, 2) + '\n', 'utf8');
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
  const name = idFor(abs);
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
  const name = idFor(abs);
  links.set(name, abs);
  await saveLinks();
  for (const fn of linkListeners) fn(name, abs);
  return name;
}

/** Takes a linked project off the list. Its folder and files stay where they are. */
export async function unlinkProject(key: string): Promise<void> {
  const name = resolveKey(key);
  const dir = links.get(name);
  if (!dir) throw new HttpError(404, 'notLinked', { name: key });
  if (memberNames.has(name)) throw new HttpError(409, 'inFolderGroup', { name: key });
  links.delete(name);
  for (const [old, d] of aliases) if (d === dir) aliases.delete(old);
  await saveLinks();
  for (const fn of linkListeners) fn(name, null);
}


// ---------------------------------------------------------------- directory groups

/**
 * A folder that holds projects side by side can be opened as a group (`.folders.json` beside
 * `.links.json`, `{ id: absolute path }`): its project subfolders, one level down, are its members.
 * Members are found by looking, never stored, so a project made in the folder (by hand, by Claude
 * Code) appears without anyone registering it. They join `links` like any project kept elsewhere,
 * under the same path-made name, and are told apart by `memberNames` so the links file never
 * holds them. Closing a group forgets the folder, not a file in it (.design/folder-groups.md).
 */
const FOLDERS_FILE = '.folders.json';
const MEMBERS_SHOWN = 200;
const folders = new Map<string, string>();
/** Projects that are in `links` only because a registered folder holds them, and the folder (its id) that does. */
const memberNames = new Set<string>();
const memberOf = new Map<string, string>();
if (LINKS_ON) {
  try {
    const raw = JSON.parse(readFileSync(join(PROJECTS_DIR, FOLDERS_FILE), 'utf8')) as Record<string, unknown>;
    for (const v of Object.values(raw)) if (typeof v === 'string' && isAbsolute(v)) folders.set(idFor(resolve(v)), resolve(v));
  } catch {
    // none opened yet
  }
  refreshMembers();
}

/** The projects directly inside a folder: their folder name, path and kind. Hidden folders and folders that are not projects are not listed. */
export function projectsIn(abs: string): { folder: string; dir: string; kind: ProjectKind }[] {
  const out: { folder: string; dir: string; kind: ProjectKind }[] = [];
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || !(e.isDirectory() || e.isSymbolicLink())) continue;
    const dir = join(abs, e.name);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const kind = kindOfSync(dir);
    if (kind) out.push({ folder: e.name, dir, kind });
  }
  return out.sort((a, b) => a.folder.localeCompare(b.folder));
}

function groupIdOf(abs: string): string | undefined {
  const id = idFor(abs);
  return folders.has(id) ? id : undefined;
}

/** Looks at every opened folder again: new projects join, projects that left go. Called when the list is made and when a name is not known. */
export function refreshMembers(): void {
  const seen = new Set<string>();
  const added: [string, string][] = [];
  for (const [id, abs] of folders) {
    for (const m of projectsIn(abs)) {
      const name = idFor(m.dir);
      // a project the person opened on its own, or that sits in the projects folder, stays what it was
      if ((links.has(name) && !memberNames.has(name)) || dirname(m.dir) === PROJECTS_DIR) continue;
      seen.add(name);
      memberOf.set(name, id);
      if (!links.has(name)) {
        links.set(name, m.dir);
        added.push([name, m.dir]);
      }
      memberNames.add(name);
    }
  }
  for (const name of [...memberNames]) {
    if (seen.has(name)) continue;
    memberNames.delete(name);
    memberOf.delete(name);
    links.delete(name);
  }
  for (const [name, dir] of added) for (const fn of linkListeners) fn(name, dir);
}

let foldersWrite: Promise<unknown> = Promise.resolve();
function saveFolders(): Promise<void> {
  const next = foldersWrite.then(async () => {
    await mkdir(PROJECTS_DIR, { recursive: true });
    const tmp = join(PROJECTS_DIR, `${FOLDERS_FILE}.tmp-${randomUUID().slice(0, 8)}`);
    await writeFile(tmp, JSON.stringify(Object.fromEntries(folders), null, 2) + '\n', 'utf8');
    await rename(tmp, join(PROJECTS_DIR, FOLDERS_FILE));
  });
  foldersWrite = next.catch(() => {});
  return next;
}

export interface FolderGroup {
  id: string;
  /** the folder, `~/…` under the home folder */
  path: string;
  /** the names of the projects in it now */
  members: string[];
}

/** Every opened folder with the projects it holds now. */
export function folderGroups(): FolderGroup[] {
  refreshMembers();
  return [...folders].map(([id, abs]) => ({ id, path: showPath(abs), members: [...memberOf].filter(([, g]) => g === id).map(([name]) => name) }));
}

/** Opens a folder of projects as a group; the folder stays as it is. */
export async function openFolderGroup(input: string): Promise<FolderGroup> {
  if (!LINKS_ON) throw new HttpError(403, 'linksOff');
  const abs = folderPath(input);
  if (!abs) throw new HttpError(400, 'badFolderPath', { path: input });
  if (abs === PROJECTS_DIR) throw new HttpError(409, 'folderIsProjectsFolder', { path: showPath(abs) });
  const at = await inspectFolder(abs);
  if (at.state === 'project') throw new HttpError(409, 'folderIsProject', { path: at.path });
  if (at.state !== 'group') throw new HttpError(404, 'noProjectsInFolder', { path: at.path });
  const id = idFor(abs);
  if (!folders.has(id)) {
    folders.set(id, abs);
    await saveFolders();
  }
  refreshMembers();
  return folderGroups().find((g) => g.id === id)!;
}

/** Takes an opened folder off the list. Its projects and files stay where they are. */
export async function closeFolderGroup(id: string): Promise<void> {
  if (!folders.delete(id)) throw new HttpError(404, 'notFolderGroup', { name: id });
  await saveFolders();
  refreshMembers();
}

/** The opened folder a project is a member of: its id and path. */
export function folderGroupOf(name: string): { id: string; path: string } | undefined {
  const id = memberOf.get(name);
  const abs = id ? folders.get(id) : undefined;
  return id && abs ? { id, path: showPath(abs) } : undefined;
}

// ---------------------------------------------------------------- archived projects

/**
 * A project the person filed out of the launcher is named in `.archived.json` beside the
 * projects (`{ name: the ISO time it was archived }`), this machine's own state like
 * `.groups.json`: the folder and its files stay exactly where they are, so the zip export,
 * a commit and Claude Code all work as before. It only leaves `GET /api/projects` and joins
 * `GET /api/projects?archived=1`, which hands the same cards back with `archived` set
 * (.design/launcher.md §3).
 */
const ARCHIVED_FILE = '.archived.json';

export async function readArchived(): Promise<Record<string, string>> {
  try {
    const raw = JSON.parse(await readFile(join(PROJECTS_DIR, ARCHIVED_FILE), 'utf8')) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) if (isProjectName(k) && typeof v === 'string' && v) out[resolveKey(k)] = v;
    return out;
  } catch {
    return {};
  }
}

let archivedWrite: Promise<unknown> = Promise.resolve();
/** Archives a project (`on`), or puts it back on the launcher (`off`). */
export function setArchived(name: string, on: boolean): Promise<void> {
  const next = archivedWrite.then(async () => {
    const all = await readArchived();
    const key = resolveKey(name);
    if (on) all[key] ??= new Date().toISOString();
    else delete all[key];
    await mkdir(PROJECTS_DIR, { recursive: true });
    const tmp = join(PROJECTS_DIR, `${ARCHIVED_FILE}.tmp-${randomUUID().slice(0, 8)}`);
    await writeFile(tmp, JSON.stringify(all, null, 2) + '\n', 'utf8');
    await rename(tmp, join(PROJECTS_DIR, ARCHIVED_FILE));
  });
  archivedWrite = next.catch(() => {});
  return next;
}

// ---------------------------------------------------------------- references

/**
 * The other work a project may consult: projects and opened folders, by absolute path, in the
 * project's own `.references.json` (local to this machine like `.image.json`, so it neither goes
 * into a zip nor a commit). A request to Claude Code is given these folders to read, never to
 * change (.design/folder-groups.md).
 */
const REFS_FILE = '.references.json';

export interface Reference {
  /** the folder, `~/…` under the home folder */
  path: string;
  abs: string;
  /** a project, a folder of projects, or a folder that is gone */
  state: 'project' | 'group' | 'missing';
  kind?: ProjectKind;
  /** the name a project is listed under, if it is */
  name?: string;
  /** the projects in a folder of projects, by folder name and kind */
  members?: { name: string; kind: ProjectKind }[];
}

export function readRefs(project: string): Reference[] {
  let paths: unknown[] = [];
  try {
    paths = (JSON.parse(readFileSync(join(projectDir(project), REFS_FILE), 'utf8')) as { paths?: unknown[] }).paths ?? [];
  } catch {
    // none yet
  }
  const own = projectDir(project);
  const out: Reference[] = [];
  for (const v of paths) {
    if (typeof v !== 'string' || !isAbsolute(v)) continue;
    const abs = resolve(v);
    if (abs === own || out.some((r) => r.abs === abs)) continue;
    out.push(describeRef(abs));
  }
  return out;
}

function describeRef(abs: string): Reference {
  const path = showPath(abs);
  if (!existsSync(abs)) return { path, abs, state: 'missing' };
  const kind = kindOfSync(abs);
  if (kind) return { path, abs, state: 'project', kind, ...(nameOfFolder(abs) ? { name: nameOfFolder(abs) } : {}) };
  const inside = projectsIn(abs);
  return inside.length ? { path, abs, state: 'group', members: inside.map((m) => ({ name: m.folder, kind: m.kind })) } : { path, abs, state: 'missing' };
}

/** Replaces a project's references. Each path must be a project or a folder of projects, and not the project itself. */
export async function writeRefs(project: string, input: unknown[]): Promise<Reference[]> {
  const own = projectDir(project);
  if (!(await kindOf(own))) throw new HttpError(404, 'noProject', { name: project });
  const abss: string[] = [];
  for (const v of input) {
    const abs = typeof v === 'string' ? folderPath(v) : null;
    if (!abs) throw new HttpError(400, 'badFolderPath', { path: String(v) });
    if (abs === own) throw new HttpError(400, 'refSelf');
    const r = describeRef(abs);
    if (r.state === 'missing') throw new HttpError(404, 'noProjectInFolder', { path: r.path });
    if (!abss.includes(abs)) abss.push(abs);
  }
  await withLock(project, () => writeFile(join(own, REFS_FILE), JSON.stringify({ paths: abss }, null, 2) + '\n', 'utf8'));
  return readRefs(project);
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
  ttc: 'font/collection',
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
  if (ext === 'pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (ext === 'svg') return 'image/svg+xml';
  return 'text/plain; charset=utf-8';
}

export function assetRel(rel: string): string {
  const r = rel.replace(/\\/g, '/');
  // a dashboard's data files: csv, tsv, json, SQLite
  if (isDataPath(r)) return r;
  // what people brought in: files attached to requests, folders they imported
  if (isUploadPath(r) || isKeptPath(r) || isPptxImportPath(r)) return r;
  const m = /^(assets(?:\/[A-Za-z0-9_][A-Za-z0-9_ -]{0,60})?|fonts|ds\/[a-z0-9][a-z0-9_-]{0,63}\/(?:assets(?:\/[A-Za-z0-9_][A-Za-z0-9_ -]{0,60})?|fonts))\/([A-Za-z0-9_-][A-Za-z0-9_. -]{0,120})\.([a-z0-9]+)$/i.exec(r);
  if (!m || r.includes('..') || !ASSET_TYPES[m[3].toLowerCase()]) throw new HttpError(400, 'notAssetPath', { path: rel });
  return r;
}

/** The file that makes a folder a project, and the kind it makes it. */
const INDEX_KINDS = [[DECK_FILE, 'slides'], [DASH_INDEX, 'dashboard'], [DOC_INDEX, 'docs'], [MOTION_FILE, 'motion'], [CANVAS_FILE, 'design'], [DS_INDEX, 'design-system']] as const;

export async function kindOf(dir: string): Promise<ProjectKind | null> {
  for (const [file, kind] of INDEX_KINDS) {
    try {
      await stat(join(dir, file));
      return kind;
    } catch {
      // try the next
    }
  }
  return null;
}

/** `kindOf` for the places that cannot wait: a request's folder lookup and the files of a reference. */
export function kindOfSync(dir: string): ProjectKind | null {
  for (const [file, kind] of INDEX_KINDS) if (existsSync(join(dir, file))) return kind;
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

/**
 * Samples that were renamed, old folder name to new. A projects folder seeded before the rename keeps the
 * person's copy (with their edits and history) under the new name, and its launcher group follows. Only a
 * folder that still looks like the old sample moves (same kind, and it shares files with the new sample, so a
 * person's own project that happens to use one of these names stays as it is), a folder already holding the
 * new name is left alone, and so is a linked project. The server does it once at start, not every command.
 */
const RENAMED_SAMPLES: Record<string, string> = {
  'box-console': 'tingly-box-console-canvas',
  'box-usage': 'tingly-box-usage-dashboard',
  'design-guide': 'tingly-design-guide-doc',
  'design-motion': 'tingly-design-motion',
  'harness-motion': 'tingly-design-harness-motion',
  'motion-effects': 'tingly-design-shader-effects-motion',
  'tingly-design-ui': 'tingly-design-ui-canvas',
  'tingly-ds': 'tingly-design-system',
  'tingly-intro': 'tingly-design-intro-slides',
};

async function isOldSample(from: string, sample: string): Promise<boolean> {
  const kind = await kindOf(sample);
  if (!kind || kind !== (await kindOf(from))) return false;
  const [mine, theirs] = [[], []] as [string[], string[]];
  await walk(from, from, mine);
  await walk(sample, sample, theirs);
  // the project's own index file is named the same in every project of a kind, so it proves nothing
  return mine.some((f) => theirs.includes(f) && !/^[^/]+\.json$/.test(f));
}

export async function renameSamples(): Promise<void> {
  if (process.env.DC_SAMPLES === '0' || SAMPLES_DIR === PROJECTS_DIR) return;
  const moved: [string, string][] = [];
  for (const [old, next] of Object.entries(RENAMED_SAMPLES)) {
    const from = join(PROJECTS_DIR, old);
    const to = join(PROJECTS_DIR, next);
    if (links.has(old) || !(await stat(from).catch(() => null))?.isDirectory() || (await stat(to).catch(() => null))) continue;
    if (!(await isOldSample(from, join(SAMPLES_DIR, next)))) continue;
    try {
      await rename(from, to);
      moved.push([old, next]);
      logInfo('samples.renamed', { from: old, to: next });
    } catch (err) {
      logWarn('samples.rename_failed', { from: old, to: next, error: String(err) });
    }
  }
  if (!moved.length) return;
  groupsWrite = groupsWrite.then(async () => {
    const all = await readGroupsRaw();
    let changed = false;
    for (const [old, next] of moved) {
      if (!(old in all)) continue;
      if (!(next in all)) all[next] = all[old];
      delete all[old];
      changed = true;
    }
    if (!changed) return;
    const tmp = join(PROJECTS_DIR, `${GROUPS_FILE}.tmp-${randomUUID().slice(0, 8)}`);
    await writeFile(tmp, JSON.stringify(all, null, 2) + '\n', 'utf8');
    await rename(tmp, join(PROJECTS_DIR, GROUPS_FILE));
  }).catch((err) => logWarn('samples.groups_failed', { error: String(err) }));
  await groupsWrite;
}

async function readGroupsRaw(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(join(PROJECTS_DIR, GROUPS_FILE), 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const GROUPS_FILE = '.groups.json';
/** The launcher group the bundled samples are filed under on a fresh install. */
export const SAMPLES_GROUP = 'tingly-design';

/** Which launcher group each project is filed under; kept beside the projects, not inside one. */
export async function readGroups(): Promise<Record<string, string>> {
  try {
    const raw = JSON.parse(await readFile(join(PROJECTS_DIR, GROUPS_FILE), 'utf8')) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) if (isProjectName(k) && cleanGroup(v)) out[resolveKey(k)] = cleanGroup(v);
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
    const key = resolveKey(name);
    if (group) all[key] = group;
    else delete all[key];
    await mkdir(PROJECTS_DIR, { recursive: true });
    const tmp = join(PROJECTS_DIR, `${GROUPS_FILE}.tmp-${randomUUID().slice(0, 8)}`);
    await writeFile(tmp, JSON.stringify(all, null, 2) + '\n', 'utf8');
    await rename(tmp, join(PROJECTS_DIR, GROUPS_FILE));
  });
  groupsWrite = next.catch(() => {});
  return next;
}

/** Every project's card: the launcher's list (`archived` false, the default) or the archived ones with their `archived` time. */
export async function listProjects(opts: { archived?: boolean } = {}): Promise<ProjectCard[]> {
  await mkdir(PROJECTS_DIR, { recursive: true });
  refreshMembers();
  const groups = await readGroups();
  const archived = await readArchived();
  // the launcher group a person gave a project wins; without one a project in an opened folder is grouped by the folder
  const groupOf = (name: string): Pick<ProjectCard, 'group' | 'folderGroup'> => {
    const f = folderGroupOf(name);
    if (groups[name]) return { group: groups[name], ...(f ? { folderGroup: { ...f, derived: false } } : {}) };
    return f ? { group: basename(f.path), folderGroup: { ...f, derived: true } } : {};
  };
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
    const when = archived[e.name];
    if (opts.archived ? !when : when) continue;
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
      out.push({ ...(await projectCard(e.name, kind, files, read, newest ? new Date(newest).toISOString() : null)), ...groupOf(e.name), ...(e.path ? { path: e.path, ...(aliasesOf(e.dir).length ? { aliases: aliasesOf(e.dir) } : {}) } : {}), ...(when ? { archived: when } : {}) });
    } catch {
      // unreadable index
    }
  }
  return out.sort((a, b) => (opts.archived ? (b.archived ?? '').localeCompare(a.archived ?? '') || a.name.localeCompare(b.name) : a.name.localeCompare(b.name)));
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
  await keepReplaced(name, rel, path, content);
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

type Written = { content: string; version: string };

/**
 * tokens.css is generated from tokens.json (never written by hand): rebuilt
 * whenever tokens.json changes, from the editor, Claude Code or a terminal.
 * Returns each generated file's new content when it changed.
 */
export async function regenTokensCss(name: string): Promise<{ css: Written | null; readme: Written | null } | null> {
  const tokens = await readOne(name, DS_TOKENS);
  if (!tokens) return null;
  const index = await readOne(name, DS_INDEX);
  const t = resolveTokens(tokens.content);
  const css = compileTokensCss(t, { title: index ? parseDsIndex(index.content).title : t.name });
  const cur = await readOne(name, DS_TOKENS_CSS);
  const wroteCss = cur?.content === css ? null : { content: css, version: await writeAtomic(name, DS_TOKENS_CSS, css) };
  // the README's "Consuming this system" appendix follows the tokens the same way (a system without a README gets none)
  const wroteReadme = await regenGuide(name, t);
  return { css: wroteCss, readme: wroteReadme };
}

/** The README's appendix for `t`; the file is read again just before it is written so a brand-book edit made meanwhile is kept. */
async function regenGuide(name: string, t: ReturnType<typeof resolveTokens>): Promise<Written | null> {
  const guide = consumingGuide(t);
  for (let tries = 0; tries < 3; tries++) {
    const cur = await readOne(name, DS_README);
    if (!cur) return null;
    const next = withConsumingGuide(cur.content, guide);
    if (next === cur.content) return null;
    if ((await readOne(name, DS_README))?.version !== cur.version) continue;
    return { content: next, version: await writeAtomic(name, DS_README, next) };
  }
  return null;
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

interface Starter {
  name: string;
  title: string;
  lang: Language;
  t: TFunction;
  opts: { size?: [number, number]; look?: string };
  /** A design system's chosen look, checked before anything is written. */
  look?: ReturnType<typeof lookOf>;
}

/** The first files of a new project, per kind: one entry per kind, so a kind added later fails to compile until it can be created. */
const STARTER: Record<ProjectKind, (c: Starter) => Promise<void>> = {
  async 'design-system'({ name, title, t, look }) {
    const ns = namespaceOf(title) === 'DS' ? namespaceOf(name) : namespaceOf(title);
    await writeAtomic(name, DS_TOKENS, look ? lookTokens(look, title) : starterTokens(title));
    await writeAtomic(name, DS_README, look ? t('starter.dsLookReadme', { title, look: t(`ds.look.${look.id}`, { defaultValue: look.id }), id: look.id }) : t('starter.dsReadme', { title }));
    if (look) {
      const words = Object.fromEntries(LOOK_KIT_WORDS.map((k) => [k, t(`starter.lookKit.${k}`, { lib: ns })])) as Record<LookKitWord, string>;
      await Promise.all(Object.entries(lookKit(look, ns, title, words)).map(([path, text]) => writeAtomic(name, path, text)));
    }
    await regenTokensCss(name);
    await writeAtomic(name, DS_INDEX, stringifyDsIndex(newDsIndex(title, ns)));
  },
  async docs({ name, title, t }) {
    await writeAtomic(name, tabFile('main'), newDocTab(title));
    await writeAtomic(name, DOC_INDEX, stringifyDoc(parseDoc(JSON.stringify({ title, tabs: [{ id: 'main', title: t('starter.docTab') }] }))));
  },
  async motion({ name, title, opts }) {
    const { motion, scenes } = newMotion(title, '', opts);
    for (const [id, source] of Object.entries(scenes)) await writeAtomic(name, sceneFile(id), source);
    await writeAtomic(name, MOTION_FILE, JSON.stringify(motion, null, 2) + '\n');
  },
  async dashboard({ name, title, t }) {
    await writeAtomic(name, DASH_PAGE, DASH_STARTER_PAGE.replace('TITLE', title.replace(/[<&>]/g, '')).replace('HINT', t('starter.dashEmpty')));
    await writeAtomic(name, DASH_INDEX, stringifyDash(newDash(title)));
  },
  async slides({ name, title, opts }) {
    const deck = parseDeck(JSON.stringify({
      v: 4,
      ...(opts.size ? { size: opts.size } : {}),
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
      size: opts.size,
      titleSize: 112,
    }));
    await writeAtomic(name, DECK_FILE, stringifyDeck(deck));
  },
  async design({ name, title, lang, t, opts }) {
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
  },
};

/** A new project, its starter copy in `lang`: the language of whoever created it. */
export async function createProject(name: string, title: string, kind: ProjectKind = 'design', lang: Language = 'en', opts: { size?: [number, number]; look?: string } = {}): Promise<void> {
  const t: TFunction = translator(lang);
  const dir = projectDir(name);
  if (await kindOf(dir)) throw new HttpError(409, 'projectExists', { name });
  // a look is checked before anything is written, so a bad one leaves no folder behind
  const look = opts.look ? lookOf(opts.look) : undefined;
  if (opts.look && !look) throw new HttpError(400, 'badLook', { look: opts.look });
  await mkdir(dir, { recursive: true });
  await STARTER[kind]({ name, title, lang, t, opts, look });
}
