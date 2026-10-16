import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { TINGLY_BOX_URL, fastReady, resolveAi, sanitizeSaved, type AiEnv, type AiResolved, type AiSaved } from '@dc/core';
import { CONFIG_FILE } from './layout';

/**
 * The server's side of the AI settings (.design/ai-settings.md): reads the environment and the saved
 * file, hands out the model client and the environment for `claude`, and keeps the key to itself.
 * The logic of which value wins is in packages/core/src/aiConfig.ts.
 */

const FILE = CONFIG_FILE;

const env = (): AiEnv => ({
  baseUrl: process.env.ANTHROPIC_BASE_URL,
  key: process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY,
  fastModel: process.env.DC_FAST_MODEL,
  claudeModel: process.env.DC_DELEGATE_MODEL,
});

let saved: AiSaved | null = null;

async function loadSaved(): Promise<AiSaved> {
  if (saved) return saved;
  try {
    saved = sanitizeSaved(JSON.parse(await readFile(FILE, 'utf8')));
  } catch {
    saved = {};
  }
  return saved;
}
await loadSaved();

export const aiResolved = (draft?: AiSaved): AiResolved => resolveAi(env(), { ...saved, ...draft });

/** The key in force: the environment's, else the saved one (or a draft's, to test before saving). */
const keyOf = (draft?: AiSaved): string => (env().key ?? '').trim() || (draft?.apiKey ?? saved?.apiKey ?? '').trim();

export async function saveAi(next: AiSaved, keep: { key: boolean }): Promise<void> {
  const clean = sanitizeSaved(next);
  if (keep.key && saved?.apiKey && !clean.apiKey) clean.apiKey = saved.apiKey;
  saved = clean;
  await mkdir(dirname(FILE), { recursive: true });
  // the key is in it: only the owner reads it
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(clean, null, 2) + '\n', { mode: 0o600 });
  await rename(tmp, FILE);
  client = null;
}

let client: { sig: string; sdk: Anthropic } | null = null;

/** The Anthropic client for fast AI, or null while there is no key. Rebuilt when the settings change. */
export function fastClient(draft?: AiSaved): Anthropic | null {
  const r = aiResolved(draft);
  if (!fastReady(r)) return null;
  const key = keyOf(draft);
  const fromEnv = r.key.source === 'env';
  const sig = JSON.stringify([r.baseUrl.value, fromEnv ? '' : key]);
  if (!draft && client?.sig === sig) return client.sdk;
  // a key from the environment is left to the SDK, which knows whether it is a token or an API key
  const sdk = new Anthropic({ ...(r.baseUrl.value ? { baseURL: r.baseUrl.value } : {}), ...(fromEnv ? {} : { apiKey: key }) });
  if (!draft) client = { sig, sdk };
  return sdk;
}

/** What `claude` is started with: the shared connection when the settings say so, else its own sign-in. */
export function claudeLaunch(): { env: Record<string, string>; model: string } {
  const r = aiResolved();
  // a model the person or the host named is passed on; the alias default only makes sense through the shared connection
  const named = r.claudeModel.source !== 'default';
  const shared = r.claudeRoute.value === 'shared';
  const model = named || shared ? r.claudeModel.value : '';
  if (!shared) return { env: {}, model };
  const out: Record<string, string> = {};
  if (r.baseUrl.value) out.ANTHROPIC_BASE_URL = r.baseUrl.value;
  const key = keyOf();
  // the default endpoint takes an API key; a gateway takes the token header. A host's own variables are already in the environment.
  if (key && r.key.source !== 'env') out[r.baseUrl.value ? 'ANTHROPIC_AUTH_TOKEN' : 'ANTHROPIC_API_KEY'] = key;
  return { env: out, model };
}

export async function boxReachable(): Promise<boolean> {
  try {
    await fetch(TINGLY_BOX_URL, { signal: AbortSignal.timeout(800) });
    return true;
  } catch {
    return false;
  }
}

/** One tiny request through the connection, to say whether the key and model work. */
export async function testFast(draft?: AiSaved): Promise<{ ok: boolean; ms: number; error?: string }> {
  const sdk = fastClient(draft);
  const t0 = Date.now();
  if (!sdk) return { ok: false, ms: 0, error: 'noKey' };
  try {
    await sdk.messages.create({ model: aiResolved(draft).fastModel.value, max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] }, { timeout: 15000, maxRetries: 0 });
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: (e as Error).message };
  }
}
