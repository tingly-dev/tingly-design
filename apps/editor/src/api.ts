import type { Actor, AgentStep, JournalEntry, ModelMessage, ProjectCard, ProjectKind } from '@dc/core';
import { at, SERVER } from './base';
import { currentLanguage } from './i18n';

/** fetch, telling the server the language on screen: it answers errors and writes starter copy in it. */
function call(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('x-dc-lang', currentLanguage());
  return fetch(url, { ...init, headers });
}

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
  version?: string;
  /** the host contract's version (docs/en/embedding.md) */
  protocol?: number;
  basePath?: string;
  /** the server's DC_THEME: a mode name, inline JSON or a parsed .json file */
  theme?: unknown;
  /** the server's DC_LANG: the language when neither the URL nor the person chose */
  lang?: string;
}

export type AiSource = 'env' | 'saved' | 'default';

/** GET /api/ai-config: what is in force and where each value came from (the key itself stays on the server). */
export interface AiConfig {
  preset: 'tingly-box' | 'anthropic' | 'custom';
  baseUrl: { value: string; source: AiSource };
  key: { set: boolean; source: AiSource | 'none' };
  fastModel: { value: string; source: AiSource };
  claudeModel: { value: string; source: AiSource };
  claudeRoute: { value: 'shared' | 'login'; source: AiSource };
  claudeCli: boolean;
  box: { reachable: boolean };
}

/** What the dialog saves; a blank field falls back to its default. */
export interface AiDraft {
  baseUrl: string;
  apiKey?: string;
  clearKey?: boolean;
  fastModel: string;
  claudeModel: string;
  /** left out until the person chooses: the default follows whether there is a key */
  claudeRoute?: 'shared' | 'login';
}

export type ServerEvent =
  | { type: 'file'; path: string; content: string; version: string; actor: Actor }
  | { type: 'delete'; path: string; actor: Actor }
  | { type: 'journal'; entry: JournalEntry }
  | { type: 'delegate'; id: string; state: 'start' | 'progress' | 'done' | 'error' | 'stopped'; text?: string; step?: AgentStep; at?: number; session?: string; continued?: boolean }
  | { type: 'assets'; path?: string };

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((body as { error?: string }).error ?? res.statusText), { status: res.status, body });
  return body as T;
}

const enc = encodeURIComponent;

export const api = {
  health: () => call(at('api/health')).then((r) => json<Health>(r)),
  aiConfig: () => call(at('api/ai-config')).then((r) => json<AiConfig>(r)),
  saveAiConfig: (d: AiDraft) =>
    call(at('api/ai-config'), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) }).then((r) => json<{ ok: true }>(r)),
  testAiConfig: (d: AiDraft) =>
    call(at('api/ai-config/test'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) }).then((r) => json<{ ok: boolean; ms: number; error?: string }>(r)),
  projects: () => call(at('api/projects')).then((r) => json<ProjectCard[]>(r)),
  createProject: (name: string, title: string, kind: ProjectKind = 'design', size?: [number, number]) =>
    call(at('api/projects'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, title, kind, ...(size ? { size } : {}) }) }).then((r) =>
      json<{ ok: true }>(r),
    ),
  files: (p: string) => call(at(`api/projects/${enc(p)}/files`)).then((r) => json<{ files: Record<string, FileState> }>(r)),
  journal: (p: string) => call(at(`api/projects/${enc(p)}/journal`)).then((r) => json<JournalEntry[]>(r)),

  /** Resolves with the new version, or with `{ conflict }` carrying the file as it is now. */
  async put(
    p: string,
    path: string,
    body: { content: string; baseVersion: string | null; actor: Actor; summary?: string; prompt?: string },
  ): Promise<{ version: string } | { conflict: FileState | null }> {
    const res = await call(at(`api/projects/${enc(p)}/file?path=${enc(path)}`), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 409) return { conflict: ((await res.json()) as { current: FileState | null }).current };
    return json<{ version: string }>(res);
  },

  async remove(p: string, path: string, baseVersion: string): Promise<{ ok: true } | { conflict: FileState | null }> {
    const res = await call(at(`api/projects/${enc(p)}/file?path=${enc(path)}&baseVersion=${enc(baseVersion)}`), { method: 'DELETE' });
    if (res.status === 409) return { conflict: ((await res.json()) as { current: FileState | null }).current };
    return json<{ ok: true }>(res);
  },

  upload: (p: string, file: File, dir?: string) =>
    call(at(`api/projects/${enc(p)}/assets?name=${enc(file.name)}${dir ? `&dir=${enc(dir)}` : ''}`), { method: 'POST', body: file }).then((r) =>
      json<{ path: string; size: number; type: string }>(r),
    ),

  /** keep a file of an imported folder at its own path under uploads/ (uploads/<folder>-<hash>/…) */
  keepUpload: (p: string, path: string, bytes: Uint8Array) =>
    call(at(`api/projects/${enc(p)}/uploads?path=${enc(path)}`), { method: 'PUT', body: bytes as Uint8Array<ArrayBuffer> }).then((r) => json<{ path: string; size: number }>(r)),

  assets: (p: string) => call(at(`api/projects/${enc(p)}/assets`)).then((r) => json<{ path: string; size: number }[]>(r)),

  removeAsset: (p: string, path: string) =>
    call(at(`api/projects/${enc(p)}/assets?path=${enc(path)}`), { method: 'DELETE' }).then((r) => json<{ ok: true }>(r)),

  installDs: (p: string, from: string) =>
    call(at(`api/projects/${enc(p)}/design-systems`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from }),
    }).then((r) => json<{ record: unknown; fonts: string[] }>(r)),

  uninstallDs: (p: string, namespace: string) =>
    call(at(`api/projects/${enc(p)}/design-systems?namespace=${enc(namespace)}`), { method: 'DELETE' }).then((r) => json<{ ok: true }>(r)),

  /** Where a project's assets are served (for slide frames). */
  /** Can this machine render a motion piece exactly (Chrome or Edge, and ffmpeg)? */
  renderCapabilities: () => call(at('api/render')).then((r) => json<{ chrome: boolean; ffmpeg: boolean }>(r)),
  /** A page as a PDF, printed by the server's Chrome; rejects with status 501 when the machine has none. */
  renderPdf: async (html: string, paper: 'page' | 'a4', signal?: AbortSignal): Promise<Blob> => {
    const res = await call(at('api/pdf'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ html, paper }), signal });
    if (!res.ok) return json<never>(res);
    return res.blob();
  },
  /**
   * Render a motion piece on the server. Progress arrives as lines; resolves to the video's file name
   * (fetch it with `renderedUrl`). Aborting the signal stops the render.
   */
  renderMotion: async (p: string, format: string, onProgress: (done: number, total: number) => void, signal: AbortSignal): Promise<string> => {
    const res = await call(at(`api/projects/${enc(p)}/render`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ format }), signal });
    if (!res.ok || !res.body) return json<never>(res);
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buf += value;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buf.slice(0, i)) as { progress?: [number, number]; done?: string; error?: string; code?: string };
        buf = buf.slice(i + 1);
        if (msg.progress) onProgress(msg.progress[0], msg.progress[1]);
        else if (msg.done) return msg.done;
        else if (msg.code) throw Object.assign(new Error(msg.error ?? ''), { code: msg.code });
      }
      if (done) throw new Error('the render ended without a file');
    }
  },
  renderedUrl: (p: string, file: string) => `${SERVER}/api/projects/${enc(p)}/render/${enc(file)}`,
  rawBase: (p: string) => `${SERVER}/api/projects/${enc(p)}/raw/`,

  fastEdit: (p: string, messages: ModelMessage[], signal: AbortSignal, kind?: string) =>
    call(at(`api/projects/${enc(p)}/fast-edit`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages, kind }),
      signal,
    }),

  delegate: (p: string, body: unknown) =>
    call(at(`api/projects/${enc(p)}/delegate`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<{ id: string }>(r)),

  stopDelegate: (p: string, id: string) => call(at(`api/projects/${enc(p)}/delegate/${enc(id)}`), { method: 'DELETE' }).then((r) => json<{ ok: boolean }>(r)),

  commit: (p: string, message: string) =>
    call(at(`api/projects/${enc(p)}/commit`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    }).then((r) => r.json() as Promise<{ ok: boolean; output: string }>),

  events(p: string, on: (e: ServerEvent) => void, onStatus: (s: 'open' | 'closed') => void): () => void {
    const es = new EventSource(at(`api/projects/${enc(p)}/events`));
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
