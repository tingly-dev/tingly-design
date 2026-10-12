/**
 * The shape of Tingly Box's palettes, as far as the editor reads them. Tingly
 * Box types them with MUI's PaletteOptions; the copied palette files import
 * this instead, so the editor does not depend on MUI. Not copied: ours.
 */
interface Swatch {
  main?: string;
  light?: string;
  dark?: string;
  contrastText?: string;
}

export interface ThemePalette {
  mode?: 'light' | 'dark';
  primary?: Swatch;
  secondary?: Swatch;
  success?: Swatch;
  error?: Swatch;
  warning?: Swatch;
  info?: Swatch;
  /** `default` may be `transparent` with a `gradient` behind it (ds, sunlit) */
  background?: { default?: string; paper?: string; gradient?: Record<string, string> };
  text?: { primary?: string; secondary?: string; disabled?: string };
  divider?: string;
  action?: { hover?: string; selected?: string; disabled?: string; disabledBackground?: string; focus?: string };
  /** Tingly Box's dashboard colours and flags: carried along, not read */
  [extra: string]: unknown;
}
