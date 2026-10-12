/**
 * The editor's look: a handful of named tokens, written as CSS custom properties on <html>.
 *
 * A theme comes from (later wins at start-up): the server's DC_THEME, the person's own pick
 * (stored), a `?theme=` URL parameter (kept for the tab). After start-up the newest of the
 * picker, `window.tinglyDesign.setTheme()` and a host's postMessage wins. docs/en/theming.md
 * has the formats.
 *
 * The presets mirror Tingly Box's theme modes (light, dark, claude, ds, sunlit, system) so a
 * host can pass its own mode name through unchanged; light and dark use the Tingly Design
 * System sample's values (projects/tingly-ds), which came from the Tingly Box web UI.
 */

export const TOKENS = [
  'canvas',
  'panel',
  'panel-2',
  'hover',
  'line',
  'line-2',
  'ink',
  'ink-2',
  'muted',
  'faint',
  'accent',
  'accent-ink',
  'accent-soft',
  'on-accent',
  'danger',
  'danger-soft',
  'ok',
  'ok-soft',
  'warn',
  'warn-soft',
  'backdrop',
  'float-shadow',
  'lift-shadow',
  'ui',
  'mono',
  'r',
  'r-float',
] as const;
export type Token = (typeof TOKENS)[number];
export type Tokens = Record<Token, string>;
export type Scheme = 'light' | 'dark';

export const PRESET_IDS = ['light', 'dark', 'claude', 'ds', 'sunlit'] as const;
export type PresetId = (typeof PRESET_IDS)[number];
/** what the picker offers and what a host may name */
export type ThemeMode = PresetId | 'system';

export interface Preset {
  id: PresetId;
  label: string;
  scheme: Scheme;
  tokens: Tokens;
}

/** Tingly Box's own palette shape (MUI): a host can hand over its theme as it is. */
export interface PaletteInput {
  mode?: Scheme;
  primary?: { main?: string; dark?: string; contrastText?: string };
  background?: { default?: string; paper?: string };
  text?: { primary?: string; secondary?: string; disabled?: string };
  divider?: string;
  action?: { hover?: string; selected?: string };
  error?: { main?: string };
  success?: { main?: string };
  warning?: { main?: string };
}

/** Everything `setTheme`, `?theme=`, DC_THEME and postMessage accept. */
export type ThemeInput =
  | ThemeMode
  | {
      /** what to start from; `system` picks light or dark; default: palette.mode, else light */
      base?: ThemeMode;
      /** shown in the appearance menu */
      name?: string;
      /** CSS token overrides, by name without the leading dashes: { accent: '#e11d48' } */
      tokens?: Partial<Record<Token, string>>;
      palette?: PaletteInput;
    };

const FONTS = {
  ui: "'Geist', system-ui, -apple-system, 'PingFang SC', 'Noto Sans SC', sans-serif",
  mono: "'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace",
  r: '6px',
  'r-float': '12px',
};

const lightShadows = (rgb: string) => ({
  'float-shadow': `0 0 0 1px rgba(${rgb}, 0.07), 0 2px 6px rgba(${rgb}, 0.05), 0 10px 28px rgba(${rgb}, 0.07)`,
  'lift-shadow': `0 0 0 1px rgba(${rgb}, 0.09), 0 6px 14px rgba(${rgb}, 0.08), 0 18px 40px rgba(${rgb}, 0.1)`,
  backdrop: `rgba(${rgb}, 0.32)`,
});

export const PRESETS: Record<PresetId, Preset> = {
  light: {
    id: 'light',
    label: '浅色',
    scheme: 'light',
    tokens: {
      canvas: '#eeeeea',
      panel: '#ffffff',
      'panel-2': '#f6f6f3',
      hover: '#f0f0ec',
      line: '#e5e5e0',
      'line-2': '#d6d6cf',
      ink: '#16181d',
      'ink-2': '#363a43',
      muted: '#5f636d',
      faint: '#8b8f98',
      accent: '#2563eb',
      'accent-ink': '#1d4ed8',
      'accent-soft': '#e9effd',
      'on-accent': '#ffffff',
      danger: '#b91c1c',
      'danger-soft': '#fdecec',
      ok: '#15803d',
      'ok-soft': '#e4f4e9',
      warn: '#b45309',
      'warn-soft': '#fcf0df',
      ...lightShadows('22, 24, 29'),
      ...FONTS,
    },
  },
  dark: {
    id: 'dark',
    label: '深色',
    scheme: 'dark',
    tokens: {
      canvas: '#0f1114',
      panel: '#1a1d23',
      'panel-2': '#22262d',
      hover: '#272b33',
      line: '#2b2f37',
      'line-2': '#3a3f49',
      ink: '#eceef2',
      'ink-2': '#c9cdd5',
      muted: '#9ca2ad',
      faint: '#727884',
      accent: '#6d9bff',
      'accent-ink': '#93b5ff',
      'accent-soft': '#1d2741',
      'on-accent': '#0b1020',
      danger: '#f87171',
      'danger-soft': '#3a1e21',
      ok: '#4ade80',
      'ok-soft': '#15301f',
      warn: '#f5a524',
      'warn-soft': '#3a2a12',
      backdrop: 'rgba(0, 0, 0, 0.55)',
      'float-shadow': '0 0 0 1px rgba(255, 255, 255, 0.07), 0 4px 12px rgba(0, 0, 0, 0.35), 0 12px 32px rgba(0, 0, 0, 0.35)',
      'lift-shadow': '0 0 0 1px rgba(255, 255, 255, 0.1), 0 8px 18px rgba(0, 0, 0, 0.4), 0 20px 44px rgba(0, 0, 0, 0.4)',
      ...FONTS,
    },
  },
  // Anthropic's brand colours, as Tingly Box's claude theme uses them
  claude: {
    id: 'claude',
    label: 'Claude',
    scheme: 'light',
    tokens: {
      canvas: '#f1efe7',
      panel: '#fffefb',
      'panel-2': '#f7f5ee',
      hover: '#f2efe3',
      line: '#e8e6dc',
      'line-2': '#d8d5c8',
      ink: '#141413',
      'ink-2': '#3d3b36',
      muted: '#6b6863',
      faint: '#9a978e',
      accent: '#d97757',
      'accent-ink': '#b5543a',
      'accent-soft': '#f8e7df',
      'on-accent': '#ffffff',
      danger: '#bf4434',
      'danger-soft': '#f8e3df',
      ok: '#5e7047',
      'ok-soft': '#e9eedf',
      warn: '#9a6a2a',
      'warn-soft': '#f5ead8',
      ...lightShadows('20, 20, 19'),
      ...FONTS,
    },
  },
  // DeepSeek blue, with Tingly Box's balanced primary (see tingly-box .design/theme.md)
  ds: {
    id: 'ds',
    label: 'DeepSeek',
    scheme: 'light',
    tokens: {
      canvas: '#edf1fb',
      panel: '#ffffff',
      'panel-2': '#f5f7fd',
      hover: '#edf2ff',
      line: '#e0e7f8',
      'line-2': '#cbd6f3',
      ink: '#1e232c',
      'ink-2': '#343b48',
      muted: '#565f70',
      faint: '#8a93a3',
      accent: '#5580fa',
      'accent-ink': '#3f5ee8',
      'accent-soft': '#e6edff',
      'on-accent': '#ffffff',
      danger: '#dc2626',
      'danger-soft': '#fde8e8',
      ok: '#0c7a70',
      'ok-soft': '#ddf3f0',
      warn: '#b45309',
      'warn-soft': '#fcf0df',
      ...lightShadows('30, 50, 110'),
      ...FONTS,
    },
  },
  sunlit: {
    id: 'sunlit',
    label: 'Sunlit',
    scheme: 'light',
    tokens: {
      canvas: '#e8f4fb',
      panel: '#ffffff',
      'panel-2': '#f3f9fd',
      hover: '#e9f5fd',
      line: '#d9ebf6',
      'line-2': '#bfdcee',
      ink: '#0f172a',
      'ink-2': '#283548',
      muted: '#475569',
      faint: '#8392a6',
      accent: '#0ea5e9',
      'accent-ink': '#0369a1',
      'accent-soft': '#e0f2fe',
      'on-accent': '#ffffff',
      danger: '#dc2626',
      'danger-soft': '#fde8e8',
      ok: '#15803d',
      'ok-soft': '#e4f4e9',
      warn: '#b45309',
      'warn-soft': '#fcf0df',
      ...lightShadows('14, 60, 100'),
      ...FONTS,
    },
  },
};

export interface ResolvedTheme {
  /** a preset id, or `custom` for anything with overrides */
  id: PresetId | 'custom';
  /** what was asked for: `system` stays `system` so the picker can show it */
  mode: ThemeMode | 'custom';
  name: string;
  scheme: Scheme;
  tokens: Tokens;
}

export const isMode = (v: unknown): v is ThemeMode => v === 'system' || PRESET_IDS.includes(v as PresetId);

const systemScheme = (): Scheme => {
  try {
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};

/** A value can set a colour, a shadow or a font stack, never load anything or end the declaration. */
const safe = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 400 && !/url\(|image\(|[;{}<>]|\/\*|\\/i.test(v);

const hexRgb = (c: string): [number, number, number] | null => {
  const m = c.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  const r = c.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  return r ? [Number(r[1]), Number(r[2]), Number(r[3])] : null;
};

/** Relative luminance, for picking text that reads on a colour. */
const luminance = ([r, g, b]: [number, number, number]) => {
  const f = (x: number) => ((x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

const mix = (a: string, pct: number, b: string) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;

/** A derived token follows its roots when a theme overrides a root but not the token itself. */
const DERIVED: Partial<Record<Token, { from: Token[]; make: (t: Tokens, s: Scheme) => string }>> = {
  'panel-2': { from: ['panel', 'ink'], make: (t) => mix(t.ink, 4, t.panel) },
  hover: { from: ['panel', 'ink'], make: (t) => mix(t.ink, 6, t.panel) },
  line: { from: ['panel', 'ink'], make: (t) => mix(t.ink, 11, t.panel) },
  'line-2': { from: ['panel', 'ink', 'line'], make: (t) => mix(t.ink, 18, t.panel) },
  'ink-2': { from: ['panel', 'ink'], make: (t) => mix(t.ink, 82, t.panel) },
  muted: { from: ['panel', 'ink'], make: (t) => mix(t.ink, 62, t.panel) },
  faint: { from: ['panel', 'ink'], make: (t) => mix(t.ink, 45, t.panel) },
  'accent-ink': { from: ['accent', 'ink'], make: (t) => mix(t.accent, 82, t.ink) },
  'accent-soft': { from: ['accent', 'panel'], make: (t, s) => mix(t.accent, s === 'dark' ? 20 : 12, t.panel) },
  'on-accent': {
    from: ['accent'],
    make: (t) => {
      const rgb = hexRgb(t.accent);
      return rgb && luminance(rgb) > 0.45 ? '#111111' : '#ffffff';
    },
  },
  'danger-soft': { from: ['danger', 'panel'], make: (t, s) => mix(t.danger, s === 'dark' ? 20 : 10, t.panel) },
  'ok-soft': { from: ['ok', 'panel'], make: (t, s) => mix(t.ok, s === 'dark' ? 20 : 10, t.panel) },
  'warn-soft': { from: ['warn', 'panel'], make: (t, s) => mix(t.warn, s === 'dark' ? 20 : 10, t.panel) },
  canvas: { from: ['panel', 'ink'], make: (t, s) => (s === 'dark' ? mix('#000', 40, t.panel) : mix(t.ink, 6, t.panel)) },
};

/** Tingly Box (MUI) palette → token overrides. */
export function fromPalette(p: PaletteInput): Partial<Tokens> {
  const o: Partial<Tokens> = {};
  const put = (k: Token, v: string | undefined) => {
    if (v && v !== 'transparent') o[k] = v;
  };
  put('accent', p.primary?.main);
  if (p.mode !== 'dark') put('accent-ink', p.primary?.dark);
  put('on-accent', p.primary?.contrastText);
  put('canvas', p.background?.default);
  put('panel', p.background?.paper);
  put('ink', p.text?.primary);
  put('muted', p.text?.secondary);
  put('faint', p.text?.disabled);
  put('line', p.divider);
  put('hover', p.action?.hover);
  put('danger', p.error?.main);
  put('ok', p.success?.main);
  put('warn', p.warning?.main);
  return o;
}

/** Parse what a URL parameter or DC_THEME carries: a mode name or JSON. */
export function parseInput(raw: string | null | undefined): ThemeInput | null {
  if (!raw) return null;
  const s = raw.trim();
  if (isMode(s)) return s;
  return s.startsWith('{') ? fromStore(s) : null;
}

/** What we stored ourselves: JSON of a ThemeInput. */
const fromStore = (raw: string | null): ThemeInput | null => {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return isMode(v) ? v : v && typeof v === 'object' && !Array.isArray(v) ? (v as ThemeInput) : null;
  } catch {
    return null;
  }
};

export function resolve(input: ThemeInput): ResolvedTheme {
  if (typeof input === 'string') {
    const id: PresetId = input === 'system' ? (systemScheme() === 'dark' ? 'dark' : 'light') : isMode(input) ? input : 'light';
    const p = PRESETS[id];
    return { id, mode: isMode(input) ? input : 'light', name: input === 'system' ? '跟随系统' : p.label, scheme: p.scheme, tokens: { ...p.tokens } };
  }
  const baseMode: ThemeMode = isMode(input?.base) ? input.base : input?.palette?.mode === 'dark' ? 'dark' : 'light';
  const base = resolve(baseMode);
  const overrides: Partial<Tokens> = { ...(input?.palette ? fromPalette(input.palette) : {}) };
  for (const [k, v] of Object.entries(input?.tokens ?? {})) if ((TOKENS as readonly string[]).includes(k)) overrides[k as Token] = v as string;
  for (const k of Object.keys(overrides) as Token[]) if (!safe(overrides[k])) delete overrides[k];
  if (!Object.keys(overrides).length) return { ...base, name: input?.name || base.name };

  const scheme: Scheme = input?.palette?.mode ?? base.scheme;
  const tokens: Tokens = { ...base.tokens, ...overrides };
  const changed = new Set(Object.keys(overrides) as Token[]);
  for (const [k, d] of Object.entries(DERIVED) as [Token, NonNullable<(typeof DERIVED)[Token]>][]) {
    if (!changed.has(k) && d.from.some((f) => changed.has(f))) tokens[k] = d.make(tokens, scheme);
  }
  return { id: 'custom', mode: 'custom', name: input?.name || '外部主题', scheme, tokens };
}

// ------------------------------------------------------------------ applying

const PICK_KEY = 'dc.theme';
const SESSION_KEY = 'dc.theme.session';
const BG_KEY = 'dc.theme.bg';

let current: { input: ThemeInput; theme: ResolvedTheme; source: ThemeSource } | null = null;
const listeners = new Set<() => void>();
export type ThemeSource = 'default' | 'server' | 'saved' | 'url' | 'host';

const read = (store: Storage, k: string) => {
  try {
    return store.getItem(k);
  } catch {
    return null;
  }
};
const write = (store: Storage, k: string, v: string | null) => {
  try {
    if (v === null) store.removeItem(k);
    else store.setItem(k, v);
  } catch {
    // private mode: the theme still applies, it just isn't remembered
  }
};

function paint(t: ResolvedTheme): void {
  const root = document.documentElement;
  for (const k of TOKENS) root.style.setProperty(`--${k}`, t.tokens[k]);
  root.style.colorScheme = t.scheme;
  root.dataset.scheme = t.scheme;
  root.dataset.theme = t.id;
  write(localStorage, BG_KEY, t.tokens.canvas);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.tokens.canvas);
}

function set(input: ThemeInput, source: ThemeSource): ResolvedTheme {
  const theme = resolve(input);
  current = { input, theme, source };
  paint(theme);
  listeners.forEach((f) => f());
  if (window.parent !== window) window.parent.postMessage({ type: 'tingly-design:theme-changed', theme: { id: theme.id, mode: theme.mode, scheme: theme.scheme, name: theme.name } }, '*');
  return theme;
}

/** The person picked one in the appearance menu: remember it, and drop a theme the URL brought. */
export function pickTheme(input: ThemeInput): ResolvedTheme {
  write(localStorage, PICK_KEY, JSON.stringify(input));
  write(sessionStorage, SESSION_KEY, null);
  return set(input, 'saved');
}

/** A host or script set it: applies now, not remembered. */
export function setTheme(input: ThemeInput): ResolvedTheme {
  return set(input, 'host');
}

export const currentTheme = () => current;
export function onTheme(f: () => void): () => void {
  listeners.add(f);
  return () => void listeners.delete(f);
}

/** Start-up: the URL wins over what the person picked, which wins over the server's default. */
export function initTheme(): void {
  const fromUrl = parseInput(new URLSearchParams(location.search).get('theme'));
  if (fromUrl) write(sessionStorage, SESSION_KEY, JSON.stringify(fromUrl));
  const session = fromStore(read(sessionStorage, SESSION_KEY));
  const saved = fromStore(read(localStorage, PICK_KEY));
  if (session) set(session, 'url');
  else if (saved) set(saved, 'saved');
  else set('system', 'default');

  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (current && (current.input === 'system' || (typeof current.input === 'object' && current.input.base === 'system'))) set(current.input, current.source);
    });
  } catch {
    // no matchMedia: system stays light
  }

  // an embedding host (Tingly Box, say) hands its theme down
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent && e.source !== window.opener) return;
    const d = e.data as { type?: string; theme?: ThemeInput } | null;
    if (d?.type === 'tingly-design:set-theme' && d.theme) setTheme(d.theme);
  });

  (window as unknown as { tinglyDesign: object }).tinglyDesign = {
    setTheme,
    getTheme: () => current && { ...current.theme, source: current.source },
    presets: () => PRESET_IDS.map((id) => ({ id, label: PRESETS[id].label, scheme: PRESETS[id].scheme })),
  };
}

/** The server's DC_THEME, used only when neither the URL nor the person chose. */
export function serverDefault(raw: unknown): void {
  if (!current || current.source !== 'default') return;
  const input = typeof raw === 'string' ? parseInput(raw) : raw && typeof raw === 'object' ? (raw as ThemeInput) : null;
  if (input) set(input, 'server');
}
