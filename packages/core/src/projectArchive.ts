import { CANVAS_FILE } from './canvas';
import { DASH_INDEX } from './dash';
import { DECK_FILE } from './deck';
import { DS_INDEX } from './designSystem';
import { DOC_INDEX } from './docs';
import type { ProjectKind } from './deck';
import { MOTION_FILE } from './motion';

/**
 * A whole project as one .zip, to hand to someone, move to another machine or
 * keep, and to open again from the launcher. The archive holds project
 * folders side by side, each one openable as it is once unzipped: the project
 * itself and, when asked, the design systems it installed. A manifest at the
 * top says which folder is the project. See .design/project-archive.md.
 */

export const ARCHIVE_MANIFEST = 'tingly-design.json';
export const ARCHIVE_FORMAT = 1;

export interface ArchiveManifest {
  format: number;
  /** the folder in the archive that is the project */
  project: string;
  kind: ProjectKind;
  /** design system folders packed beside it */
  systems: string[];
  /** the change log is in the project folder */
  journal: boolean;
  exportedAt: string;
  /** the Tingly Design version that wrote it */
  version?: string;
}

export interface ArchiveOptions {
  /** keep the change log (`.journal.jsonl`), so undo and the history carry over */
  journal: boolean;
  /** pack the design systems the project installed, as projects of their own */
  systems: boolean;
}

/** Which kind a folder is, from the files at its top, in the order the server checks them. */
const KIND_FILES: [string, ProjectKind][] = [
  [DECK_FILE, 'slides'],
  [DASH_INDEX, 'dashboard'],
  [DOC_INDEX, 'docs'],
  [MOTION_FILE, 'motion'],
  [CANVAS_FILE, 'design'],
  [DS_INDEX, 'design-system'],
];

export function kindOfFiles(files: Iterable<string>): ProjectKind | null {
  const top = new Set(files);
  for (const [file, kind] of KIND_FILES) if (top.has(file)) return kind;
  return null;
}

/**
 * Whether a file of a project folder goes into the archive. What stays out is
 * what belongs to this machine (the git repository, rendered videos, dashboard
 * runs, editor and OS litter); the change log goes in only when asked.
 */
export function archiveKeeps(rel: string, opts: Pick<ArchiveOptions, 'journal'>): boolean {
  const parts = rel.split('/');
  if (parts.some((p) => p === '' || p === '..' || p === 'node_modules')) return false;
  if (parts[0] === 'renders') return false;
  if (rel === '.journal.jsonl') return opts.journal;
  return !parts.some((p) => p.startsWith('.'));
}

/** The design system projects a canvas or deck installed, by name (`artifact: "projects/<name>"` in its index). */
export function installedSystems(indexSource: string | undefined): string[] {
  let raw: unknown;
  try {
    raw = JSON.parse(indexSource ?? '');
  } catch {
    return [];
  }
  const list = raw && typeof raw === 'object' ? (raw as { designSystems?: unknown }).designSystems : undefined;
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const r of list) {
    const m = /^projects\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})$/.exec(String((r as { artifact?: unknown } | null)?.artifact ?? ''));
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** The index text with each installed system's `artifact` pointed at the name it was imported under. */
export function renameSystems(indexSource: string, renamed: Record<string, string>): string {
  if (!Object.keys(renamed).length) return indexSource;
  let raw: { designSystems?: unknown };
  try {
    raw = JSON.parse(indexSource);
  } catch {
    return indexSource;
  }
  if (!Array.isArray(raw.designSystems)) return indexSource;
  let changed = false;
  for (const r of raw.designSystems as { artifact?: unknown }[]) {
    const m = r && /^projects\/(.+)$/.exec(String(r.artifact ?? ''));
    if (m && renamed[m[1]]) {
      r.artifact = `projects/${renamed[m[1]]}`;
      changed = true;
    }
  }
  return changed ? JSON.stringify(raw, null, 2) + '\n' : indexSource;
}

/** A path inside an archive, cleaned, or null when it could step outside the folder it is unpacked into. */
export function archivePath(name: string): string | null {
  const p = name.replace(/\\/g, '/');
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return null;
  const parts = p.split('/').filter((s) => s !== '' && s !== '.');
  if (!parts.length || parts.some((s) => s === '..')) return null;
  return parts.join('/');
}

/** A project name from any folder or file name: the characters a name may hold, starting with a letter or digit. */
export function projectNameFrom(raw: string): string {
  const n = raw
    .replace(/\.zip$/i, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^[-_]+/, '')
    .slice(0, 56)
    .replace(/[-_]+$/, '');
  return n || 'project';
}

/** `base`, or `base-2`, `base-3`… whichever is not taken. */
export function freeName(base: string, taken: ReadonlySet<string>): string {
  const b = projectNameFrom(base);
  if (!taken.has(b)) return b;
  for (let i = 2; ; i++) if (!taken.has(`${b}-${i}`)) return `${b}-${i}`;
}

export interface ArchivePlan {
  /** the folder prefix (`''` for the archive's top) holding the project */
  project: { prefix: string; kind: ProjectKind; name: string };
  systems: { prefix: string; name: string }[];
}

/**
 * Where the projects are in an archive's file list. A manifest names them; without one (a
 * zip made by hand) the archive is one project at its top, or one project folder per
 * top-level folder, and the first that is not a design system is the project.
 */
export function planArchive(paths: string[], manifest: ArchiveManifest | null, fileName = 'project'): ArchivePlan | null {
  const topFiles = (prefix: string) => paths.filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/')).map((p) => p.slice(prefix.length));
  if (manifest && typeof manifest.project === 'string') {
    const prefix = manifest.project ? `${manifest.project}/` : '';
    const kind = kindOfFiles(topFiles(prefix));
    if (!kind) return null;
    const systems = (Array.isArray(manifest.systems) ? manifest.systems : [])
      .filter((s): s is string => typeof s === 'string' && !!s && s !== manifest.project && kindOfFiles(topFiles(`${s}/`)) === 'design-system')
      .map((s) => ({ prefix: `${s}/`, name: s }));
    return { project: { prefix, kind, name: manifest.project || fileName }, systems };
  }
  const rootKind = kindOfFiles(topFiles(''));
  if (rootKind) return { project: { prefix: '', kind: rootKind, name: fileName }, systems: [] };
  const folders = [...new Set(paths.filter((p) => p.includes('/')).map((p) => p.slice(0, p.indexOf('/'))))];
  const found = folders.map((f) => ({ f, kind: kindOfFiles(topFiles(`${f}/`)) })).filter((x): x is { f: string; kind: ProjectKind } => !!x.kind);
  const main = found.find((x) => x.kind !== 'design-system') ?? found[0];
  if (!main) return null;
  return {
    project: { prefix: `${main.f}/`, kind: main.kind, name: main.f },
    systems: found.filter((x) => x !== main && x.kind === 'design-system').map((x) => ({ prefix: `${x.f}/`, name: x.f })),
  };
}
