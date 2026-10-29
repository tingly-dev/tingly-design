/**
 * Which model answers what. Three jobs use a model, and each is its own card in one dialog:
 *
 *  - Claude Code, which the server starts for bigger work (`claude -p`): through its own sign-in on this
 *    machine (`local`), through Tingly Box's `claude_code` routing (`box`), or through any address (`custom`);
 *  - ImageGen, an OpenAI-style `/images/generations` and `/images/edits` address that Claude Code may call;
 *  - fast AI, the in-page model that rewrites a passage (the Anthropic SDK in the server).
 *
 * Every card carries its own connection (address, key, model): nothing is shared between them, so a change in
 * one cannot move another. Tingly Box is the suggested choice in each, and one token can be handed from a card
 * to another when it is saved (`KeyFrom`, in the server), not linked.
 *
 * Every value comes from the environment (a host that embeds the editor sets it, and it wins), then
 * from what the person saved in the settings dialog, then from a default. The resolution is pure, so
 * the server and the tests share it; the server owns the file and the secrets (apps/server/src/aiconfig.ts).
 * A file saved by the older dialog (one shared connection) is read through `migrateSaved`.
 */

/** Where Tingly Box listens by default, and the path of its Anthropic-compatible gateway. */
export const TINGLY_BOX_URL = 'http://localhost:12580';
export const TINGLY_BOX_ANTHROPIC = `${TINGLY_BOX_URL}/tingly/anthropic`;
/** Where Box serves Claude Code: `<box>/tingly/claude_code`, or `…/claude_code:<profile>` for one of its profiles. */
const CLAUDE_CODE_PATH = '/tingly/claude_code';
/** The model name Claude Code asks Box for: the default slot of its Claude Code routing. */
export const TINGLY_BOX_CLAUDE_MODEL = 'cc';
/** The model name Tingly Box routes by its rules; the person picks the real upstream model there. */
export const TINGLY_BOX_MODEL = 'tingly';
export const ANTHROPIC_FAST_MODEL = 'claude-haiku-5-5';
/** Tingly Box's OpenAI-compatible image gateway (`…/images/generations`, `…/images/edits`). */
export const TINGLY_BOX_IMAGEGEN = `${TINGLY_BOX_URL}/tingly/imagegen/v1`;
/** The image model when nothing else says: OpenAI's, for an address that is not Tingly Box. */
export const OPENAI_IMAGE_MODEL = 'gpt-image-1';

export type AiSource = 'env' | 'saved' | 'default';
export type AiPreset = 'tingly-box' | 'anthropic' | 'custom';
export type ClaudeMode = 'local' | 'box' | 'custom';
export type AiCard = 'fast' | 'claude' | 'image';

/** What the person saved. Empty fields fall back to the default. */
export interface AiSaved {
  fastBaseUrl?: string;
  fastKey?: string;
  fastModel?: string;
  /** how Claude Code runs; left out until chosen: the host's key makes it `custom`, else `local` */
  claudeMode?: ClaudeMode;
  /** `box`: the Tingly Box token, the model name on Box's Claude Code routing, and an optional profile (its name or id; empty is the main routing) */
  claudeBoxKey?: string;
  claudeBoxModel?: string;
  claudeProfile?: string;
  /** `custom`: an Anthropic-compatible address (empty is Anthropic's own), its key and model */
  claudeBaseUrl?: string;
  claudeKey?: string;
  claudeModel?: string;
  /** an OpenAI-compatible image address, its key and model */
  imageBaseUrl?: string;
  imageKey?: string;
  imageModel?: string;
  /** the switch for image generation; only `false` is kept, on is the default */
  imageEnabled?: boolean;
}

/** The saved fields that hold a secret: the server keeps them when a save does not carry a new one. */
export const KEY_FIELDS = ['fastKey', 'claudeBoxKey', 'claudeKey', 'imageKey'] as const;
/** Where each card keeps a Tingly Box token: the one a card can hand to another. */
export const BOX_KEY_FIELD: Record<AiCard, 'fastKey' | 'claudeBoxKey' | 'imageKey'> = { fast: 'fastKey', claude: 'claudeBoxKey', image: 'imageKey' };
/** `{claude: 'fast'}`: save the fast card's token as Claude Code's Box token too. */
export type KeyFrom = Partial<Record<AiCard, AiCard>>;

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
export type AiKey = { set: boolean; source: AiSource | 'none' };

export interface AiResolved {
  fast: {
    preset: AiPreset;
    baseUrl: AiField<string>;
    /** whether a key is set; the key itself never leaves the server */
    key: AiKey;
    model: AiField<string>;
    ready: boolean;
  };
  claude: {
    mode: AiField<ClaudeMode>;
    box: { key: AiKey; model: AiField<string>; profile: AiField<string> };
    custom: { baseUrl: AiField<string>; key: AiKey; model: AiField<string> };
    /** the model `claude` is given: the active mode's; empty is Claude Code's own default */
    model: AiField<string>;
    /** where `claude` is pointed; empty for the sign-in of this machine, or Anthropic's own address */
    launchUrl: string;
    /** nothing is missing: the sign-in needs nothing, the other two need a key */
    ready: boolean;
  };
  image: AiImage;
}

export interface AiImage {
  /** which address the person picked; null while nothing is saved */
  preset: 'tingly-box' | 'custom' | null;
  /** empty while there is no image endpoint (nobody gave an address) */
  baseUrl: AiField<string>;
  model: AiField<string>;
  key: AiKey;
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

/** A profile is addressed in the URL, so it is a plain token: letters, digits, `-` and `_` (Box's own rule). */
export const validProfile = (s: string): boolean => !s || /^[A-Za-z0-9_-]+$/.test(s);

/** Tingly Box's Claude Code address for a connection on Box: same host, `/tingly/claude_code[:profile]`. */
export function boxClaudeUrl(baseUrl: string, profile: string): string {
  const root = baseUrl.replace(/\/tingly\/anthropic$/, '');
  return `${root}${CLAUDE_CODE_PATH}${profile ? ':' + profile : ''}`;
}

export function resolveAi(env: AiEnv, saved: AiSaved): AiResolved {
  const pick = (e: string, s: string, d: string): AiField<string> =>
    e ? { value: e, source: 'env' } : s ? { value: s, source: 'saved' } : { value: d, source: 'default' };
  const keyOf = (e: string, s: string): AiKey => (e ? { set: true, source: 'env' } : s ? { set: true, source: 'saved' } : { set: false, source: 'none' });
  const envKey = clean(env.key);

  // fast AI
  const fastUrl = pick(cleanUrl(env.baseUrl), cleanUrl(saved.fastBaseUrl), '');
  const fastPreset = presetOf(fastUrl.value);
  const fastKey = keyOf(envKey, clean(saved.fastKey));
  const fast: AiResolved['fast'] = {
    preset: fastPreset,
    baseUrl: fastUrl,
    key: fastKey,
    model: pick(clean(env.fastModel), clean(saved.fastModel), fastPreset === 'tingly-box' ? TINGLY_BOX_MODEL : ANTHROPIC_FAST_MODEL),
    ready: fastKey.set,
  };

  // Claude Code: an address the host fixed is a custom one, left as the host set it
  const envUrl = cleanUrl(env.baseUrl);
  const mode: AiField<ClaudeMode> = envUrl
    ? { value: 'custom', source: 'env' }
    : saved.claudeMode === 'local' || saved.claudeMode === 'box' || saved.claudeMode === 'custom'
      ? { value: saved.claudeMode, source: 'saved' }
      : { value: envKey ? 'custom' : 'local', source: 'default' };
  const envModel = clean(env.claudeModel);
  const profile = pick('', validProfile(clean(saved.claudeProfile)) ? clean(saved.claudeProfile) : '', '');
  const box = { key: keyOf('', clean(saved.claudeBoxKey)), model: pick(envModel, clean(saved.claudeBoxModel), TINGLY_BOX_CLAUDE_MODEL), profile };
  const customUrl = pick(envUrl, cleanUrl(saved.claudeBaseUrl), '');
  const custom = {
    baseUrl: customUrl,
    key: keyOf(envKey, clean(saved.claudeKey)),
    model: pick(envModel, clean(saved.claudeModel), presetOf(customUrl.value) === 'tingly-box' ? TINGLY_BOX_MODEL : ''),
  };
  const active = mode.value === 'box' ? box : mode.value === 'custom' ? custom : null;
  const claude: AiResolved['claude'] = {
    mode,
    box,
    custom,
    model: active ? active.model : envModel ? { value: envModel, source: 'env' } : { value: '', source: 'default' },
    launchUrl: mode.value === 'box' ? boxClaudeUrl(TINGLY_BOX_URL, profile.value) : mode.value === 'custom' ? customUrl.value : '',
    ready: active ? active.key.set : true,
  };

  // image generation. A host that fixed its gateway as Tingly Box (`ANTHROPIC_BASE_URL`, one token) gets Box's image address
  // with that token, as it always did; every other address and key is the card's own.
  const hostBox = presetOf(envUrl) === 'tingly-box' && Boolean(envKey);
  const imgUrl = pick(cleanUrl(env.imageBaseUrl), cleanUrl(saved.imageBaseUrl), hostBox ? TINGLY_BOX_IMAGEGEN : '');
  const imgBox = presetOfImage(imgUrl.value) === 'tingly-box';
  const imgModel = pick(clean(env.imageModel), clean(saved.imageModel), imgBox ? TINGLY_BOX_MODEL : OPENAI_IMAGE_MODEL);
  const imgKey = keyOf(clean(env.imageKey), clean(saved.imageKey));
  if (!imgKey.set && hostBox && imgBox) Object.assign(imgKey, { set: true, source: 'env' });
  const ready = Boolean(imgUrl.value && imgKey.set && imgModel.value);
  const envOff = /^(0|false|off|no)$/i.test(clean(env.imageEnabled));
  const enabled: AiField<boolean> = envOff
    ? { value: false, source: 'env' }
    : saved.imageEnabled === false
      ? { value: false, source: 'saved' }
      : { value: true, source: 'default' };
  const image: AiImage = { preset: imgUrl.value ? (imgBox ? 'tingly-box' : 'custom') : null, baseUrl: imgUrl, model: imgModel, key: imgKey, ready, enabled, active: ready && enabled.value };
  return { fast, claude, image };
}

function presetOfImage(url: string): AiPreset {
  return url.replace(/^http:\/\/127\.0\.0\.1:/, 'http://localhost:') === TINGLY_BOX_IMAGEGEN ? 'tingly-box' : 'custom';
}

/** Whether two addresses are the same host. */
function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** Fast AI works once there is a key; Tingly Box and Anthropic both need one. */
export const fastReady = (r: AiResolved): boolean => r.fast.ready;

/** Keep only the fields the settings dialog may write, trimmed. */
export function sanitizeSaved(input: unknown): AiSaved {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: AiSaved = {};
  const text = (k: 'fastKey' | 'fastModel' | 'claudeBoxKey' | 'claudeBoxModel' | 'claudeKey' | 'claudeModel' | 'imageKey' | 'imageModel') => {
    if (clean(o[k])) out[k] = clean(o[k]);
  };
  const url = (k: 'fastBaseUrl' | 'claudeBaseUrl' | 'imageBaseUrl') => {
    if (cleanUrl(o[k])) out[k] = cleanUrl(o[k]);
  };
  url('fastBaseUrl');
  url('claudeBaseUrl');
  url('imageBaseUrl');
  for (const k of ['fastKey', 'fastModel', 'claudeBoxKey', 'claudeBoxModel', 'claudeKey', 'claudeModel', 'imageKey', 'imageModel'] as const) text(k);
  if (clean(o.claudeProfile) && validProfile(clean(o.claudeProfile))) out.claudeProfile = clean(o.claudeProfile);
  if (o.imageEnabled === false) out.imageEnabled = false;
  if (o.claudeMode === 'local' || o.claudeMode === 'box' || o.claudeMode === 'custom') out.claudeMode = o.claudeMode;
  return out;
}

/**
 * Read a saved file in either shape. The first dialog kept one shared connection (`baseUrl`, `apiKey`) and a
 * choice of Claude Code's route (`claudeRoute`); each card gets its own copy of what it used, so nothing the
 * person had saved is lost and everything keeps working as it did.
 */
export function migrateSaved(input: unknown): AiSaved {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out = sanitizeSaved(o);
  if (!('baseUrl' in o || 'apiKey' in o || 'claudeRoute' in o)) return out;
  const base = cleanUrl(o.baseUrl);
  const key = clean(o.apiKey);
  const onBox = presetOf(base) === 'tingly-box';
  if (base) out.fastBaseUrl = base;
  if (key) out.fastKey = key;
  // `claudeModel` meant the model of whichever route was used; it now belongs to the tab that used it
  const model = clean(o.claudeModel);
  delete out.claudeModel;
  const shared = o.claudeRoute === 'shared' || (o.claudeRoute !== 'login' && Boolean(key));
  if (!shared) out.claudeMode = 'local';
  else if (onBox) {
    out.claudeMode = 'box';
    if (key) out.claudeBoxKey = key;
    if (model) out.claudeBoxModel = model;
  } else {
    out.claudeMode = 'custom';
    if (base) out.claudeBaseUrl = base;
    if (key) out.claudeKey = key;
    if (model) out.claudeModel = model;
  }
  // the image address used to follow the connection, and borrowed its key from it
  let img = out.imageBaseUrl ?? '';
  if (!img && onBox) out.imageBaseUrl = img = TINGLY_BOX_IMAGEGEN;
  if (key && !out.imageKey && img && (presetOfImage(img) === 'tingly-box' || sameOrigin(img, base))) out.imageKey = key;
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
