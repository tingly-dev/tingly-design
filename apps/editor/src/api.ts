import type { Actor, AgentStep, ClaudeDesignKind, ClaudeDesignNote, PptxDiagnostic, PptxReport, Turn, BoardImport, Conversation, JournalEntry, ModelMessage, ProjectCard, ProjectKind } from '@dc/core';
import type { ExportReport } from '@dc/export/timing';
import { at, SERVER } from './base';
import { currentLanguage } from './i18n';

/** A PPTX converted for the open deck: the slides as sources, their media as base64 uploads,
 * the presentation's page shape, and the conversion diagnostics. Nothing has been written. */
export interface PptxAppendPlan {
  ok: true;
  id: string;
  size: [number, number];
  slides: { id: string; source: string }[];
  files: Record<string, string>;
  diagnostics: PptxDiagnostic[];
}

/** A project folder, or an immutable built-in template; the two cannot collide. */
export type DesignSystemChoice = string | { look: string };

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

export interface GitState {
  /** the repository holding the project's folder (`~/…`), or null when it is in none */
  repo: string | null;
  /** the branch a commit lands on; empty on a detached head */
  branch: string;
  /** files of this project a commit would take */
  changes: number;
  /** the project's own folder (`~/…`), where a new repository would go */
  folder: string;
}

export interface FolderInfo {
  /** the folder as the server read it, `~/…` under the home folder */
  path: string;
  state: 'project' | 'free' | 'busy' | 'file';
  kind?: ProjectKind;
  /** the name it is already listed under, if any */
  name?: string;
  /** the repository a project here commits to, if the folder is in one */
  repo?: string;
}

export interface Health {
  ok: boolean;
  fastEdit: boolean;
  fastModel: string;
  /** image generation is set up (the server's /images route works) */
  imageGen?: boolean;
  claudeCli: boolean;
  projectsDir: string;
  /** whether the projects folder is inside a git repository */
  projectsInRepo?: boolean;
  /** false when the host keeps every project in its own projects folder (DC_LINKS=0): no opening folders elsewhere */
  links?: boolean;
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
  image: {
    baseUrl: { value: string; source: AiSource };
    model: { value: string; source: AiSource };
    key: { set: boolean; source: AiSource | 'connection' | 'none' };
    ready: boolean;
    enabled: { value: boolean; source: AiSource };
    active: boolean;
  };
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
  /** an OpenAI-compatible image address; blank follows the connection */
  imageBaseUrl?: string;
  imageKey?: string;
  imageModel?: string;
  /** false switches image generation off for every project; left out means on */
  imageEnabled?: boolean;
}

/** GET /api/projects/:p/image-gen: why Claude Code is, or is not, offered the picture tool here. */
export interface ImageState {
  configured: boolean;
  global: boolean;
  project: boolean;
  on: boolean;
}

export type ServerEvent =
  | { type: 'file'; path: string; content: string; version: string; actor: Actor }
  | { type: 'delete'; path: string; actor: Actor }
  | { type: 'journal'; entry: JournalEntry }
  | { type: 'delegate'; id: string; state: 'start' | 'progress' | 'done' | 'error' | 'stopped'; text?: string; step?: AgentStep; at?: number; session?: string; continued?: boolean; source?: 'editor' | 'cli' | 'mcp' }
  | { type: 'assets'; path?: string };

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((body as { error?: string }).error ?? res.statusText), { status: res.status, body });
  return body as T;
}

const enc = encodeURIComponent;

export const api = {
  resolve: (p: string) => call(at(`api/resolve/${enc(p)}`)).then((r) => json<{ name: string }>(r)),
  health: () => call(at('api/health')).then((r) => json<Health>(r)),
  aiConfig: () => call(at('api/ai-config')).then((r) => json<AiConfig>(r)),
  saveAiConfig: (d: AiDraft) =>
    call(at('api/ai-config'), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) }).then((r) => json<{ ok: true }>(r)),
  imageState: (p: string) => call(at(`api/projects/${enc(p)}/image-gen`)).then((r) => json<ImageState>(r)),
  setImageState: (p: string, enabled: boolean) =>
    call(at(`api/projects/${enc(p)}/image-gen`), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }) }).then((r) => json<ImageState>(r)),
  testAiConfig: (d: AiDraft) =>
    call(at('api/ai-config/test'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) }).then((r) => json<{ ok: boolean; ms: number; error?: string }>(r)),
  projects: () => call(at('api/projects')).then((r) => json<ProjectCard[]>(r)),
  /** `where` is a folder name in the projects folder, or `{ path }` for a missing or empty folder anywhere; the project's name comes back */
  createProject: (where: string | { path: string }, title: string, kind: ProjectKind = 'design', size?: [number, number], opts: { git?: boolean; look?: string } = {}) =>
    call(at('api/projects'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...(typeof where === 'string' ? { name: where } : { path: where.path }), title, kind, ...(size ? { size } : {}), ...(opts.git ? { git: true } : {}), ...(opts.look ? { look: opts.look } : {}) }),
    })
      .then((r) => json<{ ok: true; name?: string; gitError?: string }>(r))
      .then((r) => ({ name: r.name ?? (typeof where === 'string' ? where : ''), gitError: r.gitError })),
  /** what is at a folder anywhere on disk: a project, a free (missing or empty) folder, other files, or a file */
  folder: (path: string) => call(at(`api/folder?path=${enc(path)}`)).then((r) => json<FolderInfo>(r)),
  /** open a project folder that lives anywhere; the name it is listed under comes back */
  link: (path: string) =>
    call(at('api/links'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) }).then((r) => json<{ name: string }>(r)),
  /** take a linked project off the launcher; its folder stays as it is */
  unlink: (p: string) => call(at(`api/links/${enc(p)}`), { method: 'DELETE' }).then((r) => json<{ ok: true }>(r)),
  /** the whole project as one .zip; `full: false` leaves out the change log and the design systems it installed */
  archive: async (p: string, full: boolean): Promise<Blob> => {
    const res = await call(at(`api/projects/${enc(p)}/archive${full ? '' : '?journal=0&systems=0'}`));
    if (!res.ok) await json(res);
    return res.blob();
  },
  /** the project in Claude's own format, as one .zip, and what to know before publishing it */
  claudeDesign: async (p: string): Promise<{ blob: Blob; notes: ClaudeDesignNote[] }> => {
    const res = await call(at(`api/projects/${enc(p)}/claude-design`));
    if (!res.ok) await json(res);
    return { blob: await res.blob(), notes: JSON.parse(decodeURIComponent(res.headers.get('x-dc-notes') ?? '[]')) };
  },
  /** a project from a .zip, a Claude Design package or a Claude Docs .md; the name it was given (and the design systems or notes that came with it) come back */
  importArchive: (file: File) =>
    call(at(`api/archive?file=${enc(file.name)}`), { method: 'POST', headers: { 'content-type': 'application/zip' }, body: file }).then((r) => json<{ name: string; systems: string[]; claudeDesign?: ClaudeDesignKind | 'docs'; notes: ClaudeDesignNote[]; pptx?: { report: string; source: string; diagnostics: PptxDiagnostic[]; slides: PptxReport['slides'] } }>(r)),
  /** rename a project's title and/or file it under a launcher group ('' takes it out of its group) */
  patchProject: (p: string, patch: { title?: string; group?: string }) =>
    call(at(`api/projects/${enc(p)}`), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }).then((r) => json<{ ok: true }>(r)),
  files: (p: string) => call(at(`api/projects/${enc(p)}/files`)).then((r) => json<{ files: Record<string, FileState> }>(r)),
  /** the earlier versions kept of a doc tab (newest first), and the text of one */
  history: (p: string, path: string) => call(at(`api/projects/${enc(p)}/history?path=${enc(path)}`)).then((r) => json<{ id: string; at: string }[]>(r)),
  keepVersion: (p: string, path: string) => call(at(`api/projects/${enc(p)}/history?path=${enc(path)}`), { method: 'POST' }).then((r) => json<{ ok: true }>(r)),
  historyItem: (p: string, path: string, id: string) => call(at(`api/projects/${enc(p)}/history/item?path=${enc(path)}&id=${enc(id)}`)).then((r) => json<{ content: string }>(r)),
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

  installDs: (p: string, source: DesignSystemChoice) =>
    call(at(`api/projects/${enc(p)}/design-systems`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(typeof source === 'string' ? { from: source } : source),
    }).then((r) => json<{ record: unknown; fonts: string[] }>(r)),

  /** Copy a canvas's artboard into this deck or motion piece (uploads/<from>-<board>/…); the caller puts the embed on the page. */
  importBoard: (p: string, from: string, board: string) =>
    call(at(`api/projects/${enc(p)}/import-board`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from, board }),
    }).then((r) => json<{ record: BoardImport; size: [number, number] }>(r)),

  /** Convert a PowerPoint into slides for the open deck: a pure conversion (nothing is written);
   * the slides' media rides along as base64 and the editor performs the append transaction. */
  pptxSlides: (p: string, bytes: Uint8Array, name: string) =>
    call(at(`api/projects/${enc(p)}/pptx-slides?name=${enc(name)}`), {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes as Uint8Array<ArrayBuffer>,
    }).then((r) => json<PptxAppendPlan>(r)),

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
   * (fetch it with `renderedUrl`) and where the time went. Aborting the signal stops the render.
   */
  renderMotion: async (p: string, format: string, opts: { container?: 'mp4' | 'gif'; width?: number; height?: number; fps?: number; quality?: string; from?: number; to?: number; cover?: boolean; coverFirst?: boolean }, onProgress: (done: number, total: number) => void, signal: AbortSignal): Promise<{ file: string; report: ExportReport }> => {
    const res = await call(at(`api/projects/${enc(p)}/render`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ format, ...opts }), signal });
    if (!res.ok || !res.body) return json<never>(res);
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buf += value;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buf.slice(0, i)) as { progress?: [number, number]; done?: string; report?: ExportReport; error?: string; code?: string };
        buf = buf.slice(i + 1);
        if (msg.progress) onProgress(msg.progress[0], msg.progress[1]);
        else if (msg.done) return { file: msg.done, report: msg.report! };
        else if (msg.code) throw Object.assign(new Error(msg.error ?? ''), { code: msg.code });
      }
      if (done) throw new Error('the render ended without a file');
    }
  },
  /** An export made in the browser tells the server how it went, so the log has both routes. */
  logExport: (p: string, report: ExportReport, why?: string) =>
    void call(at(`api/projects/${enc(p)}/export-report`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ report, why }) }).catch(() => {}),
  renderedUrl: (p: string, file: string) => `${SERVER}/api/projects/${enc(p)}/render/${enc(file)}`,
  rawBase: (p: string) => `${SERVER}/api/projects/${enc(p)}/raw/`,
  /** rawBase for the frames that draw a project's pictures: `rev` changes when an outside edit replaces one, so the frame asks for it again */
  frameBase: (p: string, rev: number) => `${SERVER}/api/projects/${enc(p)}/raw/${rev ? `?v=${rev}` : ''}`,

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

  /** the project's stored conversation record, oldest first (.design/chat-panel.md) */
  transcript: (p: string) => call(at(`api/projects/${enc(p)}/transcript`)).then((r) => json<Turn[]>(r)),

  /** hand the server a finished fast-model turn to keep; best effort */
  keepTurn: (p: string, turn: Turn) =>
    void call(at(`api/projects/${enc(p)}/transcript`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(turn) }).catch(() => {}),

  conversation: (p: string) => call(at(`api/projects/${enc(p)}/conversation`)).then((r) => json<Conversation | null>(r)),

  stopDelegate: (p: string, id: string) => call(at(`api/projects/${enc(p)}/delegate/${enc(id)}`), { method: 'DELETE' }).then((r) => json<{ ok: boolean }>(r)),

  /** `init`: the project is in no repository, and the person agreed to give it one of its own */
  commit: (p: string, message: string, init = false) =>
    call(at(`api/projects/${enc(p)}/commit`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, init }),
    }).then((r) => r.json() as Promise<{ ok: boolean; output: string }>),
  /** where a commit of this project would land */
  git: (p: string) => call(at(`api/projects/${enc(p)}/git`)).then((r) => json<GitState>(r)),

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
