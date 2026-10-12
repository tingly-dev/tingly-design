import { useState, useSyncExternalStore } from 'react';
import { IconDeviceDesktop, IconMoon, IconSun } from '@tabler/icons-react';
import { Menu } from './Menu';
import { PRESETS, PRESET_IDS, currentTheme, onTheme, pickTheme, type ThemeMode, type Tokens } from '../theme';

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

const OPTIONS: { mode: ThemeMode; label: string; hint?: string }[] = [
  { mode: 'system', label: '跟随系统', hint: '浅色 / 深色' },
  ...PRESET_IDS.map((id) => ({ mode: id as ThemeMode, label: PRESETS[id].label })),
];

/** The appearance menu: pick a look for the editor. A theme a host passed in shows as its own row. */
export function Appearance({ className = 'btn' }: { className?: string }) {
  const theme = useSyncExternalStore(onTheme, currentTheme);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  if (!theme) return null;
  const { mode, scheme, name, tokens } = theme.theme;
  const Icon = mode === 'system' ? IconDeviceDesktop : scheme === 'dark' ? IconMoon : IconSun;
  return (
    <>
      <button
        className={className}
        aria-label="外观"
        title={`外观：${name}`}
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
        <Menu x={at.x} y={at.y} align="right" label="外观" onClose={() => setAt(null)}>
          <div className="head">外观</div>
          {mode === 'custom' && (
            <button className="mi amode" role="menuitemradio" aria-checked="true" data-mode="custom" onClick={() => setAt(null)}>
              <Swatch tokens={tokens} />
              <span className="al">{name}</span>
              <span className="k">{theme.source === 'host' ? '宿主传入' : theme.source === 'url' ? '链接传入' : theme.source === 'server' ? 'DC_THEME' : ''}</span>
            </button>
          )}
          {OPTIONS.map((o) => (
            <button
              key={o.mode}
              className="mi amode"
              role="menuitemradio"
              aria-checked={mode === o.mode}
              data-mode={o.mode}
              onClick={() => {
                pickTheme(o.mode);
                setAt(null);
              }}
            >
              <Swatch tokens={PRESETS[o.mode === 'system' ? 'light' : o.mode].tokens} split={o.mode === 'system' ? PRESETS.dark.tokens : undefined} />
              <span className="al">{o.label}</span>
              {o.hint && <span className="k">{o.hint}</span>}
            </button>
          ))}
        </Menu>
      )}
    </>
  );
}
