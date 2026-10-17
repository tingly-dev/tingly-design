/**
 * Tingly Design as an MCP server: the command line's commands as tools, and each kind's format
 * reference as a resource, so an agent that speaks MCP (Claude Code, Claude Desktop, an IDE) can
 * list, create, check and export projects and learn the files before it edits them with its own
 * tools. The editor serves it at `/mcp` (Streamable HTTP, JSON replies); `tingly-design mcp` serves
 * the same handler over stdio. Both call `commands.ts`, as the command line does (.design/cli.md §4).
 *
 * The protocol is small enough to answer by hand: initialize, ping, tools/list, tools/call,
 * resources/list, resources/read. What tools say to the model is English, like every prompt;
 * errors follow the caller's language.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { translator, type Language } from '@dc/i18n';
import { check, CommandError, create, exportProject, FORMATS, history, KINDS, outline, projects, prompt, resolveProject, skills, type Ctx } from './commands';
import { VERSION } from './layout';
import { log } from './log';
import { HttpError } from './store';

const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

/** At most this many pictures go back inline from `check` with snapshots, each at most PICTURE_SIDE on its longer side; the rest are named by path. */
const INLINE_PICTURES = 12;
const INLINE_BYTES = 4 * 1024 * 1024;
const PICTURE_SIDE = 1200;

export interface JsonRpc {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

const INSTRUCTIONS = `Tingly Design keeps canvases, slides, design systems, dashboards, docs and motion pieces as plain files in project folders; the editor shows every change live.
Work like this:
1. Find the project with \`list\` (or make one with \`new\`); \`list\` with a project gives its folder and what is in it.
2. Before editing a project's files, read its kind's format reference with \`read_skill\` (or the tingly-design://skills/<kind> resource). Then edit the files in the project's folder with your own file tools.
3. After editing, run \`check\`; with snapshots: true it also draws every board, slide, tab or view and returns pictures to look at.
4. \`export\` saves what the editor's Export menu saves (PNG, PDF, HTML, video, a zip of the project).`;

const project = { type: 'string', description: 'A project name from `list`, or the path to a project folder.' };

const TOOLS = [
  {
    name: 'list',
    description: 'Without a project: every project (name, kind, title, folder if outside the projects folder). With a project: its folder and outline (boards, slides, scenes, tabs, datasets).',
    inputSchema: { type: 'object', properties: { project } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'read_skill',
    description: `The format reference for a kind: which files a project holds and what may go in them. Read it before editing a project's files. Kinds: ${Object.keys(KINDS).filter((k) => k !== 'docs').join(', ')}.`,
    inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: Object.keys(KINDS) } }, required: ['kind'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'new',
    description: 'Create a project with its starter files and return its folder. `name` is a launcher name, or a path to a folder to create it in.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: Object.keys(KINDS) },
        name: { type: 'string' },
        title: { type: 'string', description: 'The title shown in the launcher (default: the name).' },
        size: { type: 'string', description: 'canvas or motion: the first artboard or format, as WxH (e.g. 1280x720).' },
      },
      required: ['kind', 'name'],
    },
  },
  {
    name: 'check',
    description: 'The problems the editor would show in a project (files it cannot read, references to missing files, board markup the canvas cannot pick). With snapshots: true, also draws every board, slide, tab, design-system view or motion cover in the editor (needs Chrome) and returns the pictures (scaled down; full size on disk), with what threw or did not load in the work as problems, and `layout` warnings for text cut off by its box, text past the edge of a board or slide, text too faint on a plain background (`contrast`, or `contrastMany` with a count per file) and a frame with nothing drawn (`blank`); for motion it also checks each format shows the same picture at the same time whatever came before (a `seek` warning when it does not, so the video would not match the preview).',
    inputSchema: { type: 'object', properties: { project, snapshots: { type: 'boolean' } }, required: ['project'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'export',
    description: `Save what the editor's Export menu saves, into the project's renders/ folder, and return the file paths. Formats: any kind zip; ${Object.entries(FORMATS)
      .map(([k, f]) => `${k} ${f.join(', ')}`)
      .join('; ')}. Pictures, PDF and HTML are drawn by the editor in Chrome; motion is rendered frame by frame (needs Chrome and ffmpeg), and motion html is a single-file player made without either.`,
    inputSchema: {
      type: 'object',
      properties: {
        project,
        as: { type: 'string' },
        board: { type: 'string', description: 'canvas: one board (file or title) instead of all.' },
        slide: { type: 'string', description: 'slides png: one slide (id or 1-based number).' },
        tab: { type: 'string', description: 'doc md or png: one tab (id or title).' },
        view: { type: 'string', description: 'design system: overview, colors, type, space, components or assets.' },
        format: { type: 'array', items: { type: 'string' }, description: 'motion: the formats to render (default: all).' },
        scale: { type: 'number', description: 'canvas png: 2 for @2x. motion: draw each frame at this many device pixels per pixel (1–4) and scale down, for sharper type.' },
      },
      required: ['project', 'as'],
    },
  },
  {
    name: 'prompt',
    description:
      "Hand a request to Claude Code, as the editor's request bar does: it edits the project's files (credited to Claude in the change history, live in any open editor) and this returns its last words, the history entries it made and a session id to continue the conversation. Takes minutes. Prefer editing the files yourself when you can; use this to have the editor's own Claude Code do the work.",
    inputSchema: {
      type: 'object',
      properties: {
        project,
        prompt: { type: 'string', description: 'The request, in the words a person would type in the request bar.' },
        file: { type: 'string', description: 'The board, slide, tab or scene file the request is about.' },
        session: { type: 'string', description: 'Continue the Claude Code conversation an earlier prompt returned.' },
        fast: { type: 'boolean', description: "canvas, slides, motion: the editor's fast AI makes a small edit to one file in seconds instead (needs Chrome and a fast model); it hands larger requests to Claude Code itself." },
      },
      required: ['project', 'prompt'],
    },
  },
  {
    name: 'history',
    description: "A project's change log, newest last: who changed which file (person, fast AI, Claude Code, outside edit) and how.",
    inputSchema: {
      type: 'object',
      properties: { project, since: { type: 'string', description: 'After an entry id, a time, or how long ago (30m, 2h, 1d).' }, limit: { type: 'number' } },
      required: ['project'],
    },
    annotations: { readOnlyHint: true },
  },
];

type Args = Record<string, unknown>;
type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
const json = (v: unknown): Content[] => [{ type: 'text', text: JSON.stringify(v, null, 2) }];

async function callTool(ctx: Ctx, name: string, a: Args): Promise<Content[]> {
  const t = translator(ctx.lang);
  switch (name) {
    case 'list':
      return json(str(a.project) ? await outline(await resolveProject(ctx, str(a.project), 'list')) : await projects());
    case 'read_skill': {
      const kind = KINDS[String(a.kind ?? '')];
      const s = (await skills()).find((x) => x.kind === kind);
      if (!s) throw new CommandError(t('cli.badKind', { kind: String(a.kind ?? '') }));
      return [{ type: 'text', text: s.text }];
    }
    case 'new':
      return json(await create(ctx, { kind: str(a.kind), target: str(a.name), title: str(a.title), size: str(a.size) }));
    case 'check': {
      const p = await resolveProject(ctx, str(a.project), 'check');
      const r = await check(ctx, p, { snapshots: a.snapshots === true });
      const out: Content[] = json({ ...r, snapshots: r.snapshots?.files });
      // the pictures themselves, brought down to a size a model reads at a glance, as many as fit: it looks at them without another call
      const pictures = (r.snapshots?.files ?? []).filter((f) => f.endsWith('.png')).slice(0, INLINE_PICTURES);
      const { shrinkPictures } = await import('./render');
      const small = await shrinkPictures(await Promise.all(pictures.map((f) => readFile(f))), PICTURE_SIDE);
      let bytes = 0;
      for (const [i, data] of small.entries()) {
        if ((bytes += data.length) > INLINE_BYTES) break;
        out.push({ type: 'text', text: pictures[i] }, { type: 'image', data: data.toString('base64'), mimeType: 'image/png' });
      }
      return out;
    }
    case 'export': {
      const p = await resolveProject(ctx, str(a.project), 'export');
      const format = Array.isArray(a.format) ? a.format.map(String) : str(a.format)?.split(',').map((f) => f.trim());
      // files go next to the project, never wherever this process happens to run
      const r = await exportProject(ctx, p, { as: str(a.as), out: resolve(p.dir, 'renders'), board: str(a.board), slide: str(a.slide), tab: str(a.tab), view: str(a.view), format, scale: typeof a.scale === 'number' ? a.scale : undefined });
      return json(r);
    }
    case 'prompt': {
      const p = await resolveProject(ctx, str(a.project), 'prompt');
      const r = await prompt(ctx, p, { text: str(a.prompt), file: str(a.file), resume: str(a.session), fast: a.fast === true });
      // a run that failed or was stopped still says so in `outcome`, with what it changed before it ended
      return json(r);
    }
    case 'history': {
      const p = await resolveProject(ctx, str(a.project), 'history');
      return json(await history(ctx, p, { since: str(a.since), limit: typeof a.limit === 'number' ? a.limit : undefined }));
    }
    default:
      throw new RpcError(-32602, `Unknown tool ${name}`);
  }
}

class RpcError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }
}

async function resources() {
  return (await skills()).map((s) => ({ uri: `tingly-design://skills/${s.word}`, name: s.name, title: `${s.word} format reference`, description: s.description, mimeType: 'text/markdown' }));
}

async function answer(ctx: Ctx, m: JsonRpc): Promise<unknown> {
  const p = m.params ?? {};
  switch (m.method) {
    case 'initialize': {
      const asked = String(p.protocolVersion ?? '');
      return {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'tingly-design', title: 'Tingly Design', version: VERSION },
        instructions: INSTRUCTIONS,
      };
    }
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS };
    case 'tools/call': {
      const name = String(p.name ?? '');
      if (!TOOLS.some((x) => x.name === name)) throw new RpcError(-32602, `Unknown tool ${name}`);
      const started = Date.now();
      log('info', 'mcp.tool.start', { tool: name });
      try {
        const content = await callTool(ctx, name, (p.arguments as Args) ?? {});
        log('info', 'mcp.tool.done', { tool: name, ms: Date.now() - started });
        return { content };
      } catch (e) {
        if (e instanceof RpcError) throw e;
        // a tool that ran and failed tells the model why, in the result, so it can correct itself
        const text = e instanceof HttpError ? translator(ctx.lang)(`errors.${e.key}`, e.params) : (e as Error).message;
        log('warn', 'mcp.tool.failed', { tool: name, error: text });
        return { content: [{ type: 'text', text }], isError: true };
      }
    }
    case 'resources/list':
      return { resources: await resources() };
    case 'resources/templates/list':
      return { resourceTemplates: [] };
    case 'resources/read': {
      const uri = String(p.uri ?? '');
      const word = /^tingly-design:\/\/skills\/([\w-]+)$/.exec(uri)?.[1];
      const s = word ? (await skills()).find((x) => x.kind === KINDS[word]) : undefined;
      if (!s) throw new RpcError(-32002, `Resource not found: ${uri}`);
      return { contents: [{ uri, mimeType: 'text/markdown', text: s.text }] };
    }
    default:
      throw new RpcError(-32601, `Method not found: ${m.method}`);
  }
}

/** One message in, its reply out; a notification or a client's reply gets none (null). */
export async function handleMcp(m: JsonRpc, lang: Language, inServer: boolean): Promise<JsonRpc | null> {
  if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0') return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
  if (typeof m.method !== 'string' || m.id === undefined || m.id === null) return null;
  try {
    return { jsonrpc: '2.0', id: m.id, result: await answer({ lang, inServer }, m) };
  } catch (e) {
    const code = e instanceof RpcError ? e.code : -32603;
    return { jsonrpc: '2.0', id: m.id, error: { code, message: (e as Error).message } };
  }
}
