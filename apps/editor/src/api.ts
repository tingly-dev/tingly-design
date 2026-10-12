import type { Actor, JournalEntry } from '@dc/core';

export interface FileState {
  content: string;
  version: string;
}

export interface Health {
  ok: boolean;
  fastEdit: boolean;
  fastModel: string;
  claudeCli: boolean;
  projectsDir: string;
}

export type ServerEvent =
  | { type: 'file'; path: string; content: string; version: string; actor: Actor }
  | { type: 'delete'; path: string; actor: Actor }
  | { type: 'journal'; entry: JournalEntry }
  | { type: 'delegate'; id: string; state: 'start' | 'progress' | 'done' | 'error'; text?: string }
  | { type: 'assets'; path?: string };

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((body as { error?: string }).error ?? res.statusText), { status: res.status, body });
  return body as T;
}

const enc = encodeURIComponent;

export const api = {
  health: () => fetch('/api/health').then((r) => json<Health>(r)),
  projects: () => fetch('/api/projects').then((r) => json<{ name: string; title: string; kind: 'design' | 'slides' | 'design-system' | 'dashboard' }[]>(r)),
  createProject: (name: string, title: string, kind: 'design' | 'slides' | 'design-system' | 'dashboard' = 'design') =>
    fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, title, kind }) }).then((r) =>
      json<{ ok: true }>(r),
    ),
  files: (p: string) => fetch(`/api/projects/${enc(p)}/files`).then((r) => json<{ files: Record<string, FileState> }>(r)),
  journal: (p: string) => fetch(`/api/projects/${enc(p)}/journal`).then((r) => json<JournalEntry[]>(r)),

  /** Resolves with the new version, or with `{ conflict }` carrying the file as it is now. */
  async put(
    p: string,
    path: string,
    body: { content: string; baseVersion: string | null; actor: Actor; summary?: string; prompt?: string },
  ): Promise<{ version: string } | { conflict: FileState | null }> {
    const res = await fetch(`/api/projects/${enc(p)}/file?path=${enc(path)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 409) return { conflict: ((await res.json()) as { current: FileState | null }).current };
    return json<{ version: string }>(res);
  },

  async remove(p: string, path: string, baseVersion: string): Promise<{ ok: true } | { conflict: FileState | null }> {
    const res = await fetch(`/api/projects/${enc(p)}/file?path=${enc(path)}&baseVersion=${enc(baseVersion)}`, { method: 'DELETE' });
    if (res.status === 409) return { conflict: ((await res.json()) as { current: FileState | null }).current };
    return json<{ ok: true }>(res);
  },

  upload: (p: string, file: File, dir?: string) =>
    fetch(`/api/projects/${enc(p)}/assets?name=${enc(file.name)}${dir ? `&dir=${enc(dir)}` : ''}`, { method: 'POST', body: file }).then((r) =>
      json<{ path: string; size: number; type: string }>(r),
    ),

  assets: (p: string) => fetch(`/api/projects/${enc(p)}/assets`).then((r) => json<{ path: string; size: number }[]>(r)),

  removeAsset: (p: string, path: string) =>
    fetch(`/api/projects/${enc(p)}/assets?path=${enc(path)}`, { method: 'DELETE' }).then((r) => json<{ ok: true }>(r)),

  installDs: (p: string, from: string) =>
    fetch(`/api/projects/${enc(p)}/design-systems`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from }),
    }).then((r) => json<{ record: unknown; fonts: string[] }>(r)),

  uninstallDs: (p: string, namespace: string) =>
    fetch(`/api/projects/${enc(p)}/design-systems?namespace=${enc(namespace)}`, { method: 'DELETE' }).then((r) => json<{ ok: true }>(r)),

  /** Where a project's assets are served (for slide frames). */
  rawBase: (p: string) => `${location.origin}/api/projects/${enc(p)}/raw/`,

  fastEdit: (p: string, messages: { role: 'user' | 'assistant'; content: string }[], signal: AbortSignal, kind?: string) =>
    fetch(`/api/projects/${enc(p)}/fast-edit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages, kind }),
      signal,
    }),

  delegate: (p: string, body: unknown) =>
    fetch(`/api/projects/${enc(p)}/delegate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<{ id: string }>(r)),

  commit: (p: string, message: string) =>
    fetch(`/api/projects/${enc(p)}/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    }).then((r) => r.json() as Promise<{ ok: boolean; output: string }>),

  events(p: string, on: (e: ServerEvent) => void, onStatus: (s: 'open' | 'closed') => void): () => void {
    const es = new EventSource(`/api/projects/${enc(p)}/events`);
    es.onopen = () => onStatus('open');
    es.onerror = () => onStatus('closed');
    es.onmessage = (m) => {
      try {
        on(JSON.parse(m.data));
      } catch {
        // ignore
      }
    };
    return () => es.close();
  },
};
