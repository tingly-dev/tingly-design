import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { BOX_KEY_FIELD, KEY_FIELDS, TINGLY_BOX_URL, cleanUrl, migrateSaved, resolveAi, sanitizeSaved, type AiEnv, type AiResolved, type AiSaved, type KeyFrom } from '@dc/core';
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
  imageBaseUrl: process.env.DC_IMAGE_BASE_URL,
  imageKey: process.env.DC_IMAGE_API_KEY,
  imageModel: process.env.DC_IMAGE_MODEL,
  imageEnabled: process.env.DC_IMAGE_ENABLED,
});

let saved: AiSaved | null = null;

async function loadSaved(): Promise<AiSaved> {
  if (saved) return saved;
  try {
    // a file the first dialog wrote (one shared connection) is read as three cards; it is rewritten on the next save
    saved = migrateSaved(JSON.parse(await readFile(FILE, 'utf8')));
  } catch {
    saved = {};
  }
  return saved;
}
await loadSaved();

type KeyField = (typeof KEY_FIELDS)[number];
/** The address each saved key was given for (the Tingly Box token has Box's own, fixed). */
const KEY_ADDRESS: Record<KeyField, 'fastBaseUrl' | 'claudeBaseUrl' | 'imageBaseUrl' | null> = { fastKey: 'fastBaseUrl', claudeBoxKey: null, claudeKey: 'claudeBaseUrl', imageKey: 'imageBaseUrl' };
/** A saved key stays only while its card still points at the address it was saved for: another address gets no key it was not given for. */
const keptKey = (f: KeyField, next: AiSaved): string => {
  const a = KEY_ADDRESS[f];
  return saved?.[f] && (!a || cleanUrl(saved[a]) === cleanUrl(next[a])) ? saved[f]! : '';
};

/** A draft is the dialog's whole state (a blank field is a default), so only the keys it does not carry come from the saved file. */
export const aiResolved = (draft?: AiSaved): AiResolved =>
  resolveAi(env(), draft ? { ...Object.fromEntries(KEY_FIELDS.filter((f) => keptKey(f, draft)).map((f) => [f, keptKey(f, draft)])), ...draft } : { ...saved });

/** A draft with the tokens its `keyFrom` hands over: a card takes another card's token (typed in the dialog, or already saved). */
export function withKeyFrom(draft: AiSaved, keyFrom: KeyFrom = {}): AiSaved {
  const out = { ...draft };
  const held = (f: KeyField) => draft[f] || saved?.[f] || '';
  for (const [to, from] of Object.entries(keyFrom) as [keyof KeyFrom, NonNullable<KeyFrom[keyof KeyFrom]>][]) {
    if (to === from || !BOX_KEY_FIELD[to] || !BOX_KEY_FIELD[from]) continue;
    const key = held(BOX_KEY_FIELD[from]);
    if (key) out[BOX_KEY_FIELD[to]] = key;
  }
  return out;
}

/** The host's key stands in for the fast card's and a custom Claude Code address's, as `ANTHROPIC_*` always did. */
const hostKey = (): string => (env().key ?? '').trim();
const secret = (field: KeyField, draft?: AiSaved): string => (draft ? draft[field] || keptKey(field, draft) : saved?.[field]) || '';
const fastKeyOf = (draft?: AiSaved): string => hostKey() || secret('fastKey', draft);

/** `reset` forgets every saved value, tokens too; otherwise a token the save does not carry is kept (the dialog never reads one back). */
export async function saveAi(next: AiSaved, opts: { reset?: boolean; keyFrom?: KeyFrom } = {}): Promise<void> {
  const clean = sanitizeSaved(withKeyFrom(next, opts.keyFrom));
  if (!opts.reset) for (const f of KEY_FIELDS) if (!clean[f] && keptKey(f, clean)) clean[f] = keptKey(f, clean);
  saved = clean;
  await mkdir(dirname(FILE), { recursive: true });
  // the keys are in it: only the owner reads it
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(clean, null, 2) + '\n', { mode: 0o600 });
  await rename(tmp, FILE);
  client = null;
}

/** Where image requests go (an OpenAI-compatible base URL), with which key and model; null while image generation is off. */
export function imageEndpoint(draft?: AiSaved): { baseUrl: string; key: string; model: string } | null {
  const r = aiResolved(draft).image;
  if (!r.active) return null;
  // a host that fixed Tingly Box as its gateway lends that one token to Box's image address
  const key = (env().imageKey ?? '').trim() || secret('imageKey', draft) || (r.key.source === 'env' ? hostKey() : '');
  return { baseUrl: r.baseUrl.value, key, model: r.model.value };
}

let client: { sig: string; sdk: Anthropic } | null = null;

/** The Anthropic client for fast AI, or null while there is no key. Rebuilt when the settings change. */
export function fastClient(draft?: AiSaved): Anthropic | null {
  const r = aiResolved(draft).fast;
  if (!r.ready) return null;
  const key = fastKeyOf(draft);
  const fromEnv = r.key.source === 'env';
  const sig = JSON.stringify([r.baseUrl.value, fromEnv ? '' : key]);
  if (!draft && client?.sig === sig) return client.sdk;
  // a key from the environment is left to the SDK, which knows whether it is a token or an API key
  const sdk = new Anthropic({ ...(r.baseUrl.value ? { baseURL: r.baseUrl.value } : {}), ...(fromEnv ? {} : { apiKey: key }) });
  if (!draft) client = { sig, sdk };
  return sdk;
}

/** What `claude` is started with, by the tab chosen: its own sign-in leaves the environment alone, the others point it at an address with a key. */
export function claudeLaunch(): { env: Record<string, string>; unset: string[]; model: string } {
  const c = aiResolved().claude;
  // a model the host named is passed on even to the sign-in; the tabs' own defaults only make sense through their connection
  const model = c.mode.value === 'local' ? (c.model.source === 'env' ? c.model.value : '') : c.model.value;
  // the sign-in is the claude command's own: a key or address in this server's environment must not take its place
  if (c.mode.value === 'local') return { env: {}, unset: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'], model };
  const out: Record<string, string> = {};
  if (c.launchUrl) out.ANTHROPIC_BASE_URL = c.launchUrl;
  const key = c.mode.value === 'box' ? secret('claudeBoxKey') : c.custom.key.source === 'env' ? '' : secret('claudeKey');
  // the default endpoint takes an API key; a gateway takes the token header. A host's own variables are already in the environment.
  if (key) out[c.launchUrl ? 'ANTHROPIC_AUTH_TOKEN' : 'ANTHROPIC_API_KEY'] = key;
  // what the tab does not set is not left to the environment either: its own token, not a host's key meant for another address
  const own = c.mode.value === 'box' || (c.mode.source !== 'env' && c.custom.key.source !== 'env');
  const unset = own ? ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'].filter((k) => !(k in out)) : [];
  return { env: out, unset, model };
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
    await sdk.messages.create({ model: aiResolved(draft).fast.model.value, max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] }, { timeout: 15000, maxRetries: 0 });
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: (e as Error).message };
  }
}
