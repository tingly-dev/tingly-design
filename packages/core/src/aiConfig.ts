/**
 * Which model answers what. Two jobs use a model, and both are configured in one place:
 *
 *  - fast AI, the in-page model that rewrites a passage (the Anthropic SDK in the server);
 *  - Claude Code, which the server starts for bigger work (`claude -p`).
 *
 * They share one connection (base URL and key), because that is how people have it: one gateway, often
 * Tingly Box, or one Anthropic account. Each job has its own model name. Claude Code may instead use
 * its own sign-in (`login`), which leaves its environment alone.
 *
 * Every value comes from the environment (a host that embeds the editor sets it, and it wins), then
 * from what the person saved in the settings dialog, then from a default. The resolution is pure, so
 * the server and the tests share it; the server owns the file and the secrets (apps/server/src/aiconfig.ts).
 * Image generation is a third job (OpenAI-style `/images/generations` and `/images/edits`). It follows the
 * connection when it can (Tingly Box serves an image gateway of its own), has its own model name, and may
 * have its own address and key; Anthropic has no image endpoint, so there it stays off until one is given.
 */

/** Where Tingly Box listens by default, and the path of its Anthropic-compatible gateway. */
export const TINGLY_BOX_URL = 'http://localhost:12580';
export const TINGLY_BOX_ANTHROPIC = `${TINGLY_BOX_URL}/tingly/anthropic`;
/** The model name Tingly Box routes by its rules; the person picks the real upstream model there. */
export const TINGLY_BOX_MODEL = 'tingly';
export const ANTHROPIC_FAST_MODEL = 'claude-haiku-5-5';
/** Tingly Box's OpenAI-compatible image gateway (`…/images/generations`, `…/images/edits`). */
export const TINGLY_BOX_IMAGEGEN = `${TINGLY_BOX_URL}/tingly/imagegen/v1`;
/** The image model when nothing else says: OpenAI's, for an address that is not Tingly Box. */
export const OPENAI_IMAGE_MODEL = 'gpt-image-1';

export type AiSource = 'env' | 'saved' | 'default';
export type AiPreset = 'tingly-box' | 'anthropic' | 'custom';
export type ClaudeRoute = 'shared' | 'login';

/** What the person saved. Empty fields fall back to the default. */
export interface AiSaved {
  baseUrl?: string;
  apiKey?: string;
  fastModel?: string;
  claudeModel?: string;
  claudeRoute?: ClaudeRoute;
  /** an OpenAI-compatible image address; empty follows the connection */
  imageBaseUrl?: string;
  /** a key for the image address; empty uses the connection's */
  imageKey?: string;
  imageModel?: string;
  /** the switch for image generation; only `false` is kept, on is the default */
  imageEnabled?: boolean;
}

/** What the process environment gives (a host's gateway, say). */
export interface AiEnv {
  baseUrl?: string;
  key?: string;
  fastModel?: string;
  claudeModel?: string;
  imageBaseUrl?: string;
  imageKey?: string;
  imageModel?: string;
  /** `0` / `false` / `off` switches image generation off for every project */
  imageEnabled?: string;
}

export interface AiField<T> {
  value: T;
  source: AiSource;
}

export interface AiResolved {
  preset: AiPreset;
  baseUrl: AiField<string>;
  /** whether a key is set; the key itself never leaves the server */
  key: { set: boolean; source: AiSource | 'none' };
  fastModel: AiField<string>;
  claudeModel: AiField<string>;
  claudeRoute: AiField<ClaudeRoute>;
  image: AiImage;
}

export interface AiImage {
  /** empty while there is no image endpoint (Anthropic, or an address nobody gave) */
  baseUrl: AiField<string>;
  model: AiField<string>;
  /** `connection` when it borrows the connection's key; the key itself never leaves the server */
  key: { set: boolean; source: AiSource | 'connection' | 'none' };
  /** the address, a key and a model are all there */
  ready: boolean;
  /** the switch; on unless someone turned it off (the environment wins over the saved choice) */
  enabled: AiField<boolean>;
  /** configured and switched on: the tool is offered (a project's own switch may still turn it off) */
  active: boolean;
}

const clean = (s: unknown): string => (typeof s === 'string' ? s.trim() : '');
/** a base URL as the SDKs want it: no trailing slash */
export const cleanUrl = (s: unknown): string => clean(s).replace(/\/+$/, '');

export function presetOf(baseUrl: string): AiPreset {
  if (!baseUrl || baseUrl === 'https://api.anthropic.com') return 'anthropic';
  return baseUrl.replace(/^http:\/\/127\.0\.0\.1:/, 'http://localhost:') === TINGLY_BOX_ANTHROPIC ? 'tingly-box' : 'custom';
}

export function resolveAi(env: AiEnv, saved: AiSaved): AiResolved {
  const pick = (e: string, s: string, d: string): AiField<string> =>
    e ? { value: e, source: 'env' } : s ? { value: s, source: 'saved' } : { value: d, source: 'default' };
  const baseUrl = pick(cleanUrl(env.baseUrl), cleanUrl(saved.baseUrl), '');
  const preset = presetOf(baseUrl.value);
  const box = preset === 'tingly-box';
  const keyEnv = clean(env.key);
  const keySaved = clean(saved.apiKey);
  const key = { set: Boolean(keyEnv || keySaved), source: keyEnv ? ('env' as const) : keySaved ? ('saved' as const) : ('none' as const) };
  const fastModel = pick(clean(env.fastModel), clean(saved.fastModel), box ? TINGLY_BOX_MODEL : ANTHROPIC_FAST_MODEL);
  // empty means Claude Code's own default model
  const claudeModel = pick(clean(env.claudeModel), clean(saved.claudeModel), box ? TINGLY_BOX_MODEL : '');
  const route: AiField<ClaudeRoute> =
    saved.claudeRoute === 'login' || saved.claudeRoute === 'shared'
      ? { value: saved.claudeRoute, source: 'saved' }
      : { value: key.set ? 'shared' : 'login', source: 'default' };
  const imgUrl = pick(cleanUrl(env.imageBaseUrl), cleanUrl(saved.imageBaseUrl), box ? TINGLY_BOX_IMAGEGEN : '');
  const imgModel = pick(clean(env.imageModel), clean(saved.imageModel), box || presetOfImage(imgUrl.value) === 'tingly-box' ? TINGLY_BOX_MODEL : OPENAI_IMAGE_MODEL);
  const imgKeyEnv = clean(env.imageKey);
  const imgKeySaved = clean(saved.imageKey);
  const imgKey: AiImage['key'] = imgKeyEnv
    ? { set: true, source: 'env' }
    : imgKeySaved
      ? { set: true, source: 'saved' }
      : key.set
        ? { set: true, source: 'connection' }
        : { set: false, source: 'none' };
  const ready = Boolean(imgUrl.value && imgKey.set && imgModel.value);
  const envOff = /^(0|false|off|no)$/i.test(clean(env.imageEnabled));
  const enabled: AiField<boolean> = envOff
    ? { value: false, source: 'env' }
    : saved.imageEnabled === false
      ? { value: false, source: 'saved' }
      : { value: true, source: 'default' };
  const image: AiImage = { baseUrl: imgUrl, model: imgModel, key: imgKey, ready, enabled, active: ready && enabled.value };
  return { preset, baseUrl, key, fastModel, claudeModel, claudeRoute: route, image };
}

/** Whether an image address is Tingly Box's gateway (its model alias is the default there). */
function presetOfImage(url: string): AiPreset {
  return url.replace(/^http:\/\/127\.0\.0\.1:/, 'http://localhost:') === TINGLY_BOX_IMAGEGEN ? 'tingly-box' : 'custom';
}

/** Fast AI works once there is a key; Tingly Box and Anthropic both need one. */
export const fastReady = (r: AiResolved): boolean => r.key.set;

/** Keep only the fields the settings dialog may write, trimmed. */
export function sanitizeSaved(input: unknown): AiSaved {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: AiSaved = {};
  const url = cleanUrl(o.baseUrl);
  if (url) out.baseUrl = url;
  if (clean(o.apiKey)) out.apiKey = clean(o.apiKey);
  if (clean(o.fastModel)) out.fastModel = clean(o.fastModel);
  if (clean(o.claudeModel)) out.claudeModel = clean(o.claudeModel);
  const imgUrl = cleanUrl(o.imageBaseUrl);
  if (imgUrl) out.imageBaseUrl = imgUrl;
  if (clean(o.imageKey)) out.imageKey = clean(o.imageKey);
  if (clean(o.imageModel)) out.imageModel = clean(o.imageModel);
  if (o.imageEnabled === false) out.imageEnabled = false;
  if (o.claudeRoute === 'login' || o.claudeRoute === 'shared') out.claudeRoute = o.claudeRoute;
  return out;
}

/** A base URL the SDKs can use: http(s) only. */
export const validBaseUrl = (s: string): boolean => {
  if (!s) return true;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};
