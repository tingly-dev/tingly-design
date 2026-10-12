/**
 * The editor's look: a handful of named tokens, written as CSS custom properties on <html>.
 *
 * A theme comes from (later wins at start-up): the server's DC_THEME, the person's own pick
 * (stored), a `?theme=` URL parameter (kept for the tab). After start-up the newest of the
 * picker, `window.tinglyDesign.setTheme()` and a host's postMessage wins. docs/en/theming.md
 * has the formats.
 *
 * The presets are Tingly Box's theme modes (light, dark, claude, ds, sunlit, system), built
 * from its own palettes and font stacks (copied into ./tingly-box), so the editor looks like
 * Tingly Box on its own and inside it, and a host can pass its mode name through unchanged.
 */

import { fontMono, fontSans } from './tingly-box/fonts';
import { claudePalette } from './tingly-box/palettes/claude';
import { darkPalette } from './tingly-box/palettes/dark';
import { dsPalette } from './tingly-box/palettes/ds';
import { lightPalette } from './tingly-box/palettes/light';
import { sunlitBackgroundGradient, sunlitPalette } from './tingly-box/palettes/sunlit';
import type { ThemePalette } from './tingly-box/types';

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

/**
 * Tingly Box's look, per preset: its palette (copied into ./tingly-box by
 * scripts/sync-tingly-box-theme.mjs) plus the few things the palette does not
 * carry, taken from its component overrides (frontend/packages/ui/src/theme/
 * components/*): the menu and dialog shadows, and where a gradient page
 * background needs one solid colour for the canvas.
 */
const TINGLY_BOX: Record<PresetId, { label: string; palette: ThemePalette; menu: string; dialog: string; canvas?: string }> = {
  light: { label: '浅色', palette: lightPalette, menu: '0 10px 24px rgba(15, 23, 42, 0.08)', dialog: '0 20px 48px rgba(15, 23, 42, 0.16)' },
  dark: { label: '深色', palette: darkPalette, menu: '0 10px 32px rgba(0, 0, 0, 0.7), 0 2px 8px rgba(0, 0, 0, 0.5)', dialog: '0 24px 56px rgba(0, 0, 0, 0.75), 0 2px 8px rgba(0, 0, 0, 0.5)' },
  claude: { label: 'Claude', palette: claudePalette, menu: '0 10px 24px rgba(20, 20, 19, 0.08)', dialog: '0 20px 48px rgba(20, 20, 19, 0.16)' },
  // the page is a near-white base under a sky-blue wash: the canvas takes a quarter of the wash
  ds: { label: 'DeepSeek', palette: dsPalette, menu: '0 10px 24px rgba(30, 35, 44, 0.1)', dialog: '0 20px 48px rgba(30, 35, 44, 0.18)', canvas: '#e2eaf4' },
  // the page is a sky gradient: the canvas is its top
  sunlit: { label: 'Sunlit', palette: sunlitPalette, menu: '0 10px 24px rgba(15, 23, 42, 0.08)', dialog: '0 20px 48px rgba(15, 23, 42, 0.16)', canvas: sunlitBackgroundGradient.start },
};

/** A colour that may be translucent, composited over a solid one: tokens are solid, so mixes and fills stay predictable. */
function flatten(c: string | undefined, over: string): string | undefined {
  if (!c) return undefined;
  const a = c.match(/^rgba\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)[\s,/]+([\d.]+)\s*\)$/i);
  const under = hexRgb(over);
  if (!a || !under) return c.toLowerCase();
  const alpha = Number(a[4]);
  const hex = [1, 2, 3].map((i) => Math.round(Number(a[i]) * alpha + under[i - 1] * (1 - alpha)).toString(16).padStart(2, '0'));
  return '#' + hex.join('');
}

/** `color-mix(in srgb, #a p%, #b)` of two hex colours, as the hex colour it comes to; anything else as it is. */
function mixed(v: string): string {
  const m = v.match(/^color-mix\(in srgb, (#[0-9a-f]{6}) ([\d.]+)%, (#[0-9a-f]{6})\)$/i);
  const a = m && hexRgb(m[1]);
  const b = m && hexRgb(m[3]);
  if (!m || !a || !b) return v;
  const w = Number(m[2]) / 100;
  return '#' + a.map((x, i) => Math.round(x * w + b[i] * (1 - w)).toString(16).padStart(2, '0')).join('');
}

/** One preset from Tingly Box's palette: what the palette names is copied, the rest derived the same way a host's palette is. */
function fromTinglyBox(id: PresetId): Preset {
  const { label, palette: p, menu, dialog, canvas: canvasOverride } = TINGLY_BOX[id];
  const scheme: Scheme = p.mode === 'dark' ? 'dark' : 'light';
  const bg = p.background?.default;
  const canvas = canvasOverride ?? (bg && bg !== 'transparent' ? bg.toLowerCase() : scheme === 'dark' ? '#000000' : '#ffffff');
  const panel = flatten(p.background?.paper, canvas) ?? canvas;
  const on = (c: string | undefined) => flatten(c, panel);
  const named: Partial<Tokens> = {
    canvas,
    panel,
    ink: on(p.text?.primary),
    muted: on(p.text?.secondary),
    faint: on(p.text?.disabled),
    line: on(p.divider),
    hover: on(p.action?.hover),
    accent: p.primary?.main?.toLowerCase(),
    // the shade that reads as text on the panel
    'accent-ink': (scheme === 'dark' ? p.primary?.light : p.primary?.dark)?.toLowerCase(),
    'accent-soft': on(p.action?.selected),
    'on-accent': p.primary?.contrastText?.toLowerCase(),
    danger: p.error?.main?.toLowerCase(),
    ok: p.success?.main?.toLowerCase(),
    warn: p.warning?.main?.toLowerCase(),
  };
  const tokens = {
    ...named,
    ui: fontSans,
    mono: fontMono,
    // buttons, inputs and menu items are 6px in Tingly Box, cards and dialogs 12px
    r: '6px',
    'r-float': '12px',
  } as Tokens;
  // the rest derived the way a host's palette is, then worked out to plain colours
  for (const [k, d] of Object.entries(DERIVED) as [Token, NonNullable<(typeof DERIVED)[Token]>][]) if (!tokens[k]) tokens[k] = mixed(d.make(tokens, scheme));
  tokens['float-shadow'] = `0 0 0 1px ${tokens.line}, ${menu}`;
  tokens['lift-shadow'] = `0 0 0 1px ${tokens.line}, ${dialog}`;
  tokens.backdrop = scheme === 'dark' ? 'rgba(0, 0, 0, 0.6)' : `rgba(${hexRgb(tokens.ink)?.join(', ') ?? '0, 0, 0'}, 0.32)`;
  return { id, label, scheme, tokens };
}

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

export const PRESETS: Record<PresetId, Preset> = Object.fromEntries(PRESET_IDS.map((id) => [id, fromTinglyBox(id)])) as Record<PresetId, Preset>;

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
  put('accent-soft', p.action?.selected);
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
