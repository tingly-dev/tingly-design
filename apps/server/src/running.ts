/**
 * Which editor is running on a projects folder, so the command line works with it
 * instead of beside it (.design/cli.md §4). A server writes `.server.json` in the
 * projects folder once it listens and removes it when it stops; a command reads it,
 * and trusts it only when that process is alive and answers on its address.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECTS_DIR, PROTOCOL, VERSION } from './layout';

const FILE = '.server.json';

export interface RunningEditor {
  pid: number;
  /** Where the API answers, with the base path and a trailing slash. */
  url: string;
  /** Where a person opens the editor: the same address, except under `pnpm dev` (Vite). */
  editor: string;
  version: string;
  protocol: number;
  startedAt: string;
}

/** Says this process serves the projects folder. A second server on the same folder takes over the file; the last one started is the one commands use. */
export function announce(url: string, editor: string): void {
  const info: RunningEditor = { pid: process.pid, url, editor, version: VERSION, protocol: PROTOCOL, startedAt: new Date().toISOString() };
  try {
    writeFileSync(join(PROJECTS_DIR, FILE), JSON.stringify(info, null, 2) + '\n', 'utf8');
  } catch {
    // a read-only projects folder still serves; commands just will not find it
  }
}

/** Takes the file back when this process is the one it names. */
export function retire(): void {
  if (read()?.pid === process.pid) rmSync(join(PROJECTS_DIR, FILE), { force: true });
}

function read(): RunningEditor | null {
  try {
    const v = JSON.parse(readFileSync(join(PROJECTS_DIR, FILE), 'utf8'));
    return typeof v?.pid === 'number' && typeof v.url === 'string' ? { editor: v.url, ...v } : null;
  } catch {
    return null;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: alive, but someone else's
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The editor running on this projects folder, or null. A file left by a server that died is removed. */
export async function findEditor(): Promise<RunningEditor | null> {
  const info = read();
  if (!info) return null;
  if (!alive(info.pid)) {
    rmSync(join(PROJECTS_DIR, FILE), { force: true });
    return null;
  }
  try {
    const r = await fetch(new URL('api/health', info.url), { signal: AbortSignal.timeout(1500) });
    return r.ok ? info : null;
  } catch {
    return null;
  }
}

/** A JSON call to the running editor, in the command's language; its error message is already in that language. */
export async function call<T>(editor: RunningEditor, path: string, lang: string, body?: unknown): Promise<T> {
  const r = await fetch(new URL(path.replace(/^\//, ''), editor.url), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'x-dc-lang': lang },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const v = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new EditorError(v.error ?? `${r.status} ${r.statusText}`);
  return v;
}

export class EditorError extends Error {}
