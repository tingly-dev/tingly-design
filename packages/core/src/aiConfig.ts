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
 * Image generation (.design/ai-settings.md) will be a third job on the same connection.
 */

/** Where Tingly Box listens by default, and the path of its Anthropic-compatible gateway. */
export const TINGLY_BOX_URL = 'http://localhost:12580';
export const TINGLY_BOX_ANTHROPIC = `${TINGLY_BOX_URL}/tingly/anthropic`;
/** The model name Tingly Box routes by its rules; the person picks the real upstream model there. */
export const TINGLY_BOX_MODEL = 'tingly';
export const ANTHROPIC_FAST_MODEL = 'claude-haiku-5-5';

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
}

/** What the process environment gives (a host's gateway, say). */
export interface AiEnv {
  baseUrl?: string;
  key?: string;
  fastModel?: string;
  claudeModel?: string;
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
  return { preset, baseUrl, key, fastModel, claudeModel, claudeRoute: route };
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
