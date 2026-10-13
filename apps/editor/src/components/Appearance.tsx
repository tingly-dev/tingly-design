import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { IconDeviceDesktop, IconMoon, IconSun } from '@tabler/icons-react';
import { Menu } from './Menu';
import { PRESETS, PRESET_IDS, currentTheme, onTheme, pickTheme, type ThemeMode, type Tokens } from '../theme';
import { SUPPORTED_LANGUAGES, chooseLanguage, currentLanguage } from '../i18n';

/** Three stripes of the theme's own colours: what you get, not a name for it. */
function Swatch({ tokens, split }: { tokens: Tokens; split?: Tokens }) {
  return (
    <span className="aswatch" aria-hidden="true">
      <i style={{ background: tokens.canvas }} />
      <i style={{ background: tokens.panel }} />
      <i style={{ background: tokens.accent }} />
      {split && <b style={{ background: split.canvas, borderColor: split.line }} />}
    </span>
  );
}

const MODES: ThemeMode[] = ['system', ...PRESET_IDS];

/**
 * The appearance menu: how the editor looks and which language it speaks, both settings of the
 * editor itself rather than of a project. A theme a host passed in shows as its own row.
 * Languages are listed by their own names, so someone who cannot read the current one still
 * finds theirs.
 */
export function Appearance({ className = 'btn' }: { className?: string }) {
  const { t } = useTranslation();
  const theme = useSyncExternalStore(onTheme, currentTheme);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  if (!theme) return null;
  const { mode, scheme, name: themeName, tokens } = theme.theme;
  const name = mode === 'custom' ? themeName : t(`appearance.mode.${mode}`);
  const lang = currentLanguage();
  const Icon = mode === 'system' ? IconDeviceDesktop : scheme === 'dark' ? IconMoon : IconSun;
  return (
    <>
      <button
        className={className}
        aria-label={t('appearance.title')}
        title={t('appearance.titleWith', { name })}
        aria-haspopup="menu"
        aria-expanded={!!at}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt(at ? null : { x: r.right, y: r.bottom + 6 });
        }}
      >
        <Icon size={16} stroke={1.6} />
      </button>
      {at && (
        <Menu x={at.x} y={at.y} align="right" label={t('appearance.title')} onClose={() => setAt(null)}>
          <div className="head">{t('appearance.theme')}</div>
          {mode === 'custom' && (
            <button className="mi amode" role="menuitemradio" aria-checked="true" data-mode="custom" onClick={() => setAt(null)}>
              <Swatch tokens={tokens} />
              <span className="al">{name}</span>
              <span className="k">{theme.source === 'host' || theme.source === 'url' || theme.source === 'server' ? t(`appearance.source.${theme.source}`) : ''}</span>
            </button>
          )}
          {MODES.map((m) => (
            <button
              key={m}
              className="mi amode"
              role="menuitemradio"
              aria-checked={mode === m}
              data-mode={m}
              onClick={() => {
                pickTheme(m);
                setAt(null);
              }}
            >
              <Swatch tokens={PRESETS[m === 'system' ? 'light' : m].tokens} split={m === 'system' ? PRESETS.dark.tokens : undefined} />
              <span className="al">{t(`appearance.mode.${m}`)}</span>
              {m === 'system' && <span className="k">{t('appearance.mode.systemHint')}</span>}
            </button>
          ))}
          <div className="head">{t('appearance.language')}</div>
          {SUPPORTED_LANGUAGES.map((l) => (
            <button
              key={l.code}
              className="mi alang"
              role="menuitemradio"
              aria-checked={lang === l.code}
              data-lang={l.code}
              lang={l.code}
              onClick={() => {
                chooseLanguage(l.code);
                setAt(null);
              }}
            >
              <span className="al">{l.label}</span>
            </button>
          ))}
        </Menu>
      )}
    </>
  );
}
