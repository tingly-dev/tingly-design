/**
 * Tingly Design as an MCP server: the command line's commands as tools, one per step of the work
 * (projects, open, check, look, export, history, prompt); each kind's format reference (and its
 * pages) as resources and, with a brief, as prompts, so an agent that speaks MCP (Claude Code,
 * Claude Desktop, an IDE) learns the files before it edits them with its own tools. The editor serves it at `/mcp` (Streamable HTTP, JSON replies); `tingly-design mcp` serves
 * the same handler over stdio. Both call `commands.ts`, as the command line does (.design/cli.md §4).
 *
 * The protocol is small enough to answer by hand: initialize, ping, tools/list, tools/call,
 * resources/list, resources/read, prompts/list, prompts/get. What tools say to the model is English, like every prompt;
 * errors follow the caller's language.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hasClaudeDesign } from '@dc/core';
import { translator, type Language } from '@dc/i18n';
import { check, CommandError, create, looksLikePath, exportProject, FORMATS, history, KINDS, outline, pickFor, projects, prompt, resolveProject, skillPages, skills, type Ctx, type Kind, type Project } from './commands';
import { VERSION } from './layout';
import { log } from './log';
import { HttpError } from './store';

const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

/** At most this many pictures go back inline from `look`, each at most PICTURE_SIDE on its longer side; the rest are named by path. */
const INLINE_PICTURES = 6;
const INLINE_BYTES = 4 * 1024 * 1024;
const PICTURE_SIDE = 1000;

export interface JsonRpc {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

const INSTRUCTIONS = `Tingly Design keeps canvases, slides, design systems, dashboards, docs and motion pieces as plain files in project folders; the editor shows every change live.
Work in this order, one tool per step: \`projects\` (what exists) → \`open\` (enter a project, or make one with kind; returns its folder, outline and the uri of its format reference) → read that reference (a resource) → edit the files in the folder with your own file tools → \`check\` after each edit → \`look\` to see what was drawn → \`export\` for the finished file.
The prompts \`make\` and \`edit\` start this order with the format reference already included.`;

const project = { type: 'string', description: 'A project name from `projects`, or the path to a project folder.' };
const pick = { type: 'string', description: 'One board (file or title), slide (id or 1-based number; slides pptx also takes a range: 2, 2-4, 1,3-4), doc tab (id or title), design-system view (overview, colors, type, space, components, assets) or motion format; leave out for all.' };

const TOOLS = [
  {
    name: 'projects',
    description: 'Every project: name, kind, title, and the folder if it is outside the projects folder.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'open',
    description: `Enter a project: its folder, outline (boards, slides, scenes, tabs, datasets), its current settings (sizes, installed design systems, motion formats, fps and speed, doc look, dataset sources, design-system themes and tokens: look here instead of guessing from the files) and the resource uri of its format reference, which you read before editing its files. With \`kind\`, creates the project first: \`project\` is then a launcher name or a path to a folder to create it in. Kinds: ${Object.keys(KINDS).filter((k) => k !== 'docs').join(', ')}.`,
    inputSchema: {
      type: 'object',
      properties: {
        project,
        kind: { type: 'string', enum: Object.keys(KINDS), description: 'Create a project of this kind.' },
        title: { type: 'string', description: 'With kind: the title shown in the launcher (default: the name).' },
        size: { type: 'string', description: 'With kind canvas, slides or motion: the size of the first artboard, deck or format, as WxH (e.g. 1280x720) or a named size from the New dialog (wechat, tall, story, og, wide, a4, mpu, …; an unknown name lists them all).' },
        look: { type: 'string', description: 'With kind design-system: start from a look instead of a blank system (minimal-white, swiss-grid, editorial-serif, bauhaus, blueprint, nord, dracula, …; an unknown name lists them all).' },
      },
      required: ['project'],
    },
  },
  {
    name: 'check',
    description: 'The problems the editor would show in a project: files it cannot read, references to missing files, markup the editor cannot pick. Fast, text only, no Chrome. `look` reports all of this too, so once you want to see the work you can go straight to `look`.',
    inputSchema: { type: 'object', properties: { project }, required: ['project'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'look',
    description: 'Draw the work in the editor (needs Chrome) and return the pictures, scaled down (full size on disk), with everything `check` reports plus what the drawing found: scripts that threw, files that did not load, layout warnings (text cut off or past the edge, faint text, a board taller than its content), and for motion a `seek` warning when a format would not match its preview. Give `pick` to draw one thing; without it every board, slide, tab or view is drawn and only the first few come back as pictures.',
    inputSchema: { type: 'object', properties: { project, pick }, required: ['project'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'export',
    description: `Save what the editor's Export menu saves, into the project's renders/ folder, and return the file paths. Formats: any kind zip; ${(Object.keys(FORMATS) as Kind[]).filter((k) => hasClaudeDesign(k)).join(', ')} also claude-design (the original Claude Design layout); ${Object.entries(FORMATS)
      .map(([k, f]) => `${k} ${f.join(', ')}`)
      .join('; ')}. Needs Chrome for pictures, PDF and HTML, and Chrome and ffmpeg for mp4 and gif.`,
    inputSchema: {
      type: 'object',
      properties: {
        project,
        as: { type: 'string' },
        pick,
        format: { type: 'array', items: { type: 'string' }, description: 'motion: the formats to render (default: all).' },
        scale: { type: 'number', description: 'canvas png: 2 for @2x. motion: draw each frame at this many device pixels per pixel (1–4) and scale down.' },
      },
      required: ['project', 'as'],
    },
  },
  {
    name: 'prompt',
    description:
      "Hand a request to the editor's own Claude Code, as its request bar does: it edits the project's files (credited to Claude in the change history, live in any open editor) and this returns its last words, the history entries it made and a session id. Takes minutes. Prefer editing the files yourself when you can.",
    inputSchema: {
      type: 'object',
      properties: {
        project,
        prompt: { type: 'string', description: 'The request, in the words a person would type in the request bar.' },
        file: { type: 'string', description: 'The board, slide, tab or scene file the request is about.' },
        session: { type: 'string', description: "Continue a Claude Code conversation an earlier prompt returned (default: the project's last), or `new` to start a fresh one." },
        fast: { type: 'boolean', description: "canvas, slides, motion: the editor's fast AI makes a small edit to one file in seconds instead (needs Chrome and a fast model)." },
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
type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string } | { type: 'resource_link'; uri: string; name: string; mimeType: string };

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
const json = (v: unknown): Content[] => [{ type: 'text', text: JSON.stringify(v) }];

/** The uri of a kind's format reference, and of one of its pages. */
const skillUri = (word: string, page?: string) => `tingly-design://skills/${word}${page ? `/${page}` : ''}`;
const wordOf = (kind: string) => Object.entries(KINDS).find(([w, k]) => k === kind && w !== 'docs')?.[0] ?? kind;

async function callTool(ctx: Ctx, name: string, a: Args): Promise<Content[]> {
  switch (name) {
    case 'projects':
      return json(await projects());
    case 'open': {
      if (str(a.kind)) {
        const made = await create(ctx, { kind: str(a.kind), target: str(a.project), title: str(a.title), size: str(a.size), look: str(a.look), global: !looksLikePath(str(a.project) ?? '') });
        return opened(made);
      }
      return opened(await resolveProject(ctx, str(a.project), 'list', 'name'));
    }
    case 'check': {
      const r = await check(ctx, await resolveProject(ctx, str(a.project), 'check', 'name'));
      return json(r);
    }
    case 'look': {
      const p = await resolveProject(ctx, str(a.project), 'check', 'name');
      const one = str(a.pick);
      const r = await check(ctx, p, { snapshots: true, pick: pickFor(p.kind, one), format: p.kind === 'motion' && one ? [one] : undefined });
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
      const p = await resolveProject(ctx, str(a.project), 'export', 'name');
      const format = Array.isArray(a.format) ? a.format.map(String) : str(a.format)?.split(',').map((f) => f.trim());
      // files go next to the project, never wherever this process happens to run
      const r = await exportProject(ctx, p, { as: str(a.as), out: resolve(p.dir, 'renders'), ...pickFor(p.kind, str(a.pick)), format, scale: typeof a.scale === 'number' ? a.scale : undefined });
      return json(r);
    }
    case 'prompt': {
      const p = await resolveProject(ctx, str(a.project), 'prompt', 'name');
      const session = str(a.session);
      const r = await prompt(ctx, p, { text: str(a.prompt), file: str(a.file), resume: session === 'new' ? undefined : session, fresh: session === 'new', fast: a.fast === true, source: 'mcp' });
      // a run that failed or was stopped still says so in `outcome`, with what it changed before it ended
      return json(r);
    }
    case 'history': {
      const p = await resolveProject(ctx, str(a.project), 'history', 'name');
      return json(await history(ctx, p, { since: str(a.since), limit: typeof a.limit === 'number' ? a.limit : undefined }));
    }
    default:
      throw new RpcError(-32602, `Unknown tool ${name}`);
  }
}

/** A project entered: where it is, what is in it, and which format reference to read before editing it. */
async function opened(p: Project): Promise<Content[]> {
  const uri = skillUri(wordOf(p.kind));
  return [...json({ ...(await outline(p)), kind: p.kind, formatReference: uri }), { type: 'resource_link', uri, name: `${wordOf(p.kind)} format reference`, mimeType: 'text/markdown' }];
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
  const out = [];
  for (const s of await skills()) {
    out.push({ uri: skillUri(s.word), name: s.name, title: `${s.word} format reference`, description: s.description, mimeType: 'text/markdown' });
    // the reference pages the format reference names (such as slides' layout)
    for (const page of await skillPages(s)) out.push({ uri: skillUri(s.word, page.name), name: `${s.name}/${page.name}`, title: `${s.word} reference: ${page.name}`, mimeType: 'text/markdown' });
  }
  return out;
}

/** A resource by uri: a kind's format reference, or one of its pages. */
async function readResource(uri: string): Promise<string | undefined> {
  const m = /^tingly-design:\/\/skills\/([\w-]+)(?:\/([\w-]+))?$/.exec(uri);
  const s = m ? (await skills()).find((x) => x.kind === KINDS[m[1]]) : undefined;
  if (!m || !s) return undefined;
  return m[2] ? (await skillPages(s)).find((p) => p.name === m[2])?.text : s.text;
}

const PROMPTS = [
  {
    name: 'make',
    description: 'Make a new project of a kind and fill it from a brief, with the kind\'s format reference included.',
    arguments: [
      { name: 'kind', description: Object.keys(KINDS).filter((k) => k !== 'docs').join(', '), required: true },
      { name: 'name', description: 'A launcher name, or a path to a folder to create it in.', required: true },
      { name: 'brief', description: 'What to make.', required: true },
    ],
  },
  {
    name: 'edit',
    description: 'Change an existing project as asked, with its kind\'s format reference included.',
    arguments: [
      { name: 'project', description: 'A project name from `projects`, or the path to a project folder.', required: true },
      { name: 'brief', description: 'What to change.', required: true },
    ],
  },
];

const STEPS = 'Edit the files in the project folder with your own file tools, following the format reference. After each edit run `check`; to see the result run `look` (with `pick` for one board, slide, tab or view). Run `export` only if a finished file is asked for.';

async function getPrompt(ctx: Ctx, name: string, a: Record<string, unknown>) {
  const t = translator(ctx.lang);
  const brief = str(a.brief);
  if (!brief) throw new RpcError(-32602, 'Missing argument: brief');
  let kind: Kind;
  let lead: string;
  if (name === 'make') {
    const k = KINDS[str(a.kind) ?? ''];
    if (!k) throw new CommandError(t('cli.badKind', { kind: str(a.kind) ?? '' }));
    if (!str(a.name)) throw new RpcError(-32602, 'Missing argument: name');
    kind = k;
    lead = `Make a new ${wordOf(k)} project: call \`open\` with project "${str(a.name)}" and kind "${wordOf(k)}", then fill it. ${STEPS}`;
  } else if (name === 'edit') {
    const p = await resolveProject(ctx, str(a.project), 'list', 'name');
    kind = p.kind;
    lead = `Change the project "${p.name}" (a ${wordOf(p.kind)}, folder ${p.dir}). Call \`open\` first to see what is in it. ${STEPS}`;
  } else {
    throw new RpcError(-32602, `Unknown prompt ${name}`);
  }
  const uri = skillUri(wordOf(kind));
  const text = (await readResource(uri)) ?? '';
  return {
    description: PROMPTS.find((x) => x.name === name)?.description,
    messages: [
      { role: 'user', content: { type: 'text', text: `${lead}\n\nThe request: ${brief}` } },
      { role: 'user', content: { type: 'resource', resource: { uri, mimeType: 'text/markdown', text } } },
    ],
  };
}

async function answer(ctx: Ctx, m: JsonRpc): Promise<unknown> {
  const p = m.params ?? {};
  switch (m.method) {
    case 'initialize': {
      const asked = String(p.protocolVersion ?? '');
      return {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: {}, resources: {}, prompts: {} },
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
      const text = await readResource(uri);
      if (text === undefined) throw new RpcError(-32002, `Resource not found: ${uri}`);
      return { contents: [{ uri, mimeType: 'text/markdown', text }] };
    }
    case 'prompts/list':
      return { prompts: PROMPTS };
    case 'prompts/get':
      try {
        return await getPrompt(ctx, String(p.name ?? ''), (p.arguments as Record<string, unknown>) ?? {});
      } catch (e) {
        // a missing project or a bad kind is the caller's mistake in the words of its language, not a broken server
        if (e instanceof CommandError) throw new RpcError(-32602, e.message);
        throw e;
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
