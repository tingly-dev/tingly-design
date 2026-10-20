import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { aiResolved, imageEndpoint } from './aiconfig';
import { logError, logInfo } from './log';
import { HttpError, projectDir, readAsset, writeAsset } from './store';

/**
 * Image generation through an OpenAI-style gateway (.design/ai-settings.md, .design/image-generation.md):
 * `POST {base}/images/generations` to make a picture, `POST {base}/images/edits` to change one the project
 * already holds. The result is kept the way a picture a person brought in is, named by content, so every
 * kind's existing references to it work unchanged.
 */

export interface ImageRequest {
  prompt: string;
  /** `1024x1024`, `1536x1024`, `1024x1536` or `auto`; the gateway's own default when left out */
  size?: string;
  quality?: string;
  /** a picture in the project to change (`uploads/…`), instead of making one from nothing */
  edit?: string;
}

const SIZE = /^(auto|\d{3,4}x\d{3,4})$/;
const QUALITY = new Set(['auto', 'low', 'medium', 'high', 'standard', 'hd']);
const MAX_BYTES = 25 * 1024 * 1024;

/** What the bytes are, by their first bytes; a gateway's content type is not trusted for the file name. */
export function sniffImage(b: Uint8Array): 'png' | 'jpg' | 'webp' | null {
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  return null;
}

const mimeOf = (ext: string) => (ext === 'jpg' ? 'image/jpeg' : `image/${ext}`);

/** The gateway's own message from an error body (`{error:{message}}`), else the status. */
async function problem(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const j = JSON.parse(text) as { error?: { message?: string } | string };
    const m = typeof j.error === 'string' ? j.error : j.error?.message;
    if (m) return `${res.status} ${m}`.slice(0, 400);
  } catch {
    // not JSON
  }
  return `${res.status} ${text.slice(0, 200) || res.statusText}`.trim();
}

async function fromProject(project: string, rel: string): Promise<{ bytes: Buffer; ext: string }> {
  if (!/^uploads\/[^/]+\.(png|jpe?g|webp)$/i.test(rel) || rel.includes('..')) throw new HttpError(400, 'imageEditSource', { path: rel });
  const bytes = await readAsset(project, rel);
  if (!bytes) throw new HttpError(404, 'imageEditSource', { path: rel });
  return { bytes, ext: sniffImage(bytes) ?? 'png' };
}

const SWITCH_FILE = '.image.json';

/**
 * A project's own switch for image generation: on unless this machine turned it off for the project.
 * Local state like `.runs.json` (kept out of the zip and out of a commit), so a shared project does not carry one person's choice.
 */
export async function projectImageOn(project: string): Promise<boolean> {
  try {
    return (JSON.parse(await readFile(join(projectDir(project), SWITCH_FILE), 'utf8')) as { enabled?: unknown }).enabled !== false;
  } catch {
    return true;
  }
}

export async function setProjectImageOn(project: string, on: boolean): Promise<void> {
  // a name that is not a project has no folder to write into
  await writeFile(join(projectDir(project), SWITCH_FILE), on ? '{}\n' : JSON.stringify({ enabled: false }) + '\n').catch(() => {
    throw new HttpError(404, 'noProject', { name: project });
  });
}

/** Where a project stands: the settings configure it, the global switch allows it, the project's own switch picks. `on` is what Claude Code is offered. */
export async function imageState(project: string): Promise<{ configured: boolean; global: boolean; project: boolean; on: boolean }> {
  const r = aiResolved().image;
  const own = await projectImageOn(project);
  return { configured: r.ready, global: r.enabled.value, project: own, on: r.active && own };
}

/** Make or change one picture and keep it; returns where it was kept. */
export async function generateImage(project: string, req: ImageRequest): Promise<{ path: string; size: number; model: string; ms: number }> {
  const ep = imageEndpoint();
  if (!ep) throw new HttpError(aiResolved().image.ready ? 403 : 501, aiResolved().image.ready ? 'imageOff' : 'noImageModel');
  if (!(await projectImageOn(project))) throw new HttpError(403, 'imageOff');
  const prompt = (req.prompt ?? '').trim();
  if (!prompt) throw new HttpError(400, 'promptMissing');
  if (prompt.length > 8000) throw new HttpError(400, 'badRequest', { detail: 'prompt is longer than 8000 characters' });
  if (req.size && !SIZE.test(req.size)) throw new HttpError(400, 'badRequest', { detail: `size ${req.size}` });
  if (req.quality && !QUALITY.has(req.quality)) throw new HttpError(400, 'badRequest', { detail: `quality ${req.quality}` });

  const edit = req.edit ? await fromProject(project, req.edit) : null;

  const started = Date.now();
  const meta = { project, op: edit ? 'edit' : 'generate', model: ep.model, host: new URL(ep.baseUrl).host, promptChars: prompt.length, size: req.size };
  logInfo('image.start', meta);
  let res: Response;
  try {
    const headers = { authorization: `Bearer ${ep.key}` };
    const signal = AbortSignal.timeout(180_000);
    if (edit) {
      const form = new FormData();
      form.set('model', ep.model);
      form.set('prompt', prompt);
      if (req.size) form.set('size', req.size);
      if (req.quality) form.set('quality', req.quality);
      form.set('image', new Blob([new Uint8Array(edit.bytes)], { type: mimeOf(edit.ext) }), `image.${edit.ext}`);
      res = await fetch(`${ep.baseUrl}/images/edits`, { method: 'POST', headers, body: form, signal });
    } else {
      const body = { model: ep.model, prompt, n: 1, ...(req.size ? { size: req.size } : {}), ...(req.quality ? { quality: req.quality } : {}) };
      res = await fetch(`${ep.baseUrl}/images/generations`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
    }
  } catch (e) {
    logError('image.error', { ...meta, ms: Date.now() - started, error: (e as Error).message });
    throw new HttpError(502, 'imageFailed', { detail: (e as Error).message });
  }
  if (!res.ok) {
    const detail = await problem(res);
    logError('image.error', { ...meta, ms: Date.now() - started, status: res.status, error: detail });
    throw new HttpError(502, 'imageFailed', { detail });
  }

  // a gateway answers with base64 (OpenAI's gpt-image) or with a URL to fetch (dall-e, some gateways)
  let bytes: Uint8Array | null = null;
  try {
    const out = (await res.json()) as { data?: { b64_json?: string; url?: string }[] };
    const first = out.data?.[0];
    if (first?.b64_json) bytes = new Uint8Array(Buffer.from(first.b64_json, 'base64'));
    else if (first?.url && /^https?:\/\//.test(first.url)) {
      const img = await fetch(first.url, { signal: AbortSignal.timeout(60_000) });
      if (img.ok) bytes = new Uint8Array(await img.arrayBuffer());
    }
  } catch {
    // handled below
  }
  const ext = bytes ? sniffImage(bytes) : null;
  if (!bytes || !ext || bytes.length > MAX_BYTES) {
    logError('image.error', { ...meta, ms: Date.now() - started, error: 'no picture in the reply' });
    throw new HttpError(502, 'imageFailed', { detail: 'the reply holds no picture' });
  }
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/g, '') || 'image';
  const path = `uploads/${slug}-${hash}.${ext}`;
  await writeAsset(project, path, bytes);
  const ms = Date.now() - started;
  logInfo('image.done', { ...meta, ms, bytes: bytes.length, path });
  return { path, size: bytes.length, model: ep.model, ms };
}
