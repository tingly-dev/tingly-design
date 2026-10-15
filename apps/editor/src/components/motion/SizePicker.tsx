import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MOTION_SIZES, validSize } from '@dc/core';
import { forgetSize, readSizes, sameSize, type Size } from '../../motionSizes';
import { Close } from '../icons';

const label = (s: Size) => `${s[0]}×${s[1]}`;

/** The shape of a size, drawn at a fixed height budget, so 9:16 and 16:9 read as different at a glance. */
function Ratio({ size }: { size: Size }) {
  const k = 16 / Math.max(size[0], size[1]);
  return <i className="szratio" style={{ width: Math.max(4, Math.round(size[0] * k)), height: Math.max(4, Math.round(size[1] * k)) }} />;
}

/**
 * Which size a new motion piece starts in: the common ones by shape with the platforms that take
 * them, the person's own custom sizes, and any other width and height. `value` is the size to
 * create with, or null while a custom one is half typed.
 */
export function SizePicker({ value, onChange }: { value: Size | null; onChange: (size: Size | null) => void }) {
  const { t } = useTranslation();
  const [mine, setMine] = useState(() => readSizes().mine);
  const presets = MOTION_SIZES.map((p) => ({ name: p.name, size: p.size as unknown as Size }));
  const preset = presets.find((p) => sameSize(p.size, value));
  const own = mine.find((s) => sameSize(s, value));
  const [custom, setCustom] = useState<{ w: string; h: string } | null>(null);
  const typed = custom ? validSize([custom.w, custom.h]) : null;
  const showCustom = custom !== null || (value !== null && !preset && !own);
  const num = (v: string) => v.replace(/[^\d]/g, '').slice(0, 4);
  const pick = (s: Size) => {
    setCustom(null);
    onChange(s);
  };
  return (
    <div className="sizes">
      <div className="szrow" role="radiogroup" aria-label={t('launcher.new.size')}>
        {presets.map((p) => (
          <button type="button" key={p.name} role="radio" aria-checked={!custom && preset?.name === p.name} data-size={p.name} className="szopt" onClick={() => pick(p.size)}>
            <Ratio size={p.size} />
            <span className="name">{t(`motion.preset.${p.name}`)}</span>
            <span className="dim">{label(p.size)}</span>
          </button>
        ))}
        {mine.map((s) => (
          <span key={label(s)} className="szmine">
            <button type="button" role="radio" aria-checked={!custom && sameSize(s, value)} data-size="mine" className="szopt" title={t('launcher.new.sizeMine', { size: label(s) })} onClick={() => pick(s)}>
              <Ratio size={s} />
              <span className="dim">{label(s)}</span>
            </button>
            <button
              type="button"
              className="szx"
              aria-label={t('launcher.new.sizeForget', { size: label(s) })}
              title={t('launcher.new.sizeForget', { size: label(s) })}
              onClick={() => {
                forgetSize(s);
                setMine(readSizes().mine);
                if (sameSize(s, value)) onChange([1920, 1080]);
              }}
            >
              <Close />
            </button>
          </span>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={showCustom}
          data-size="custom"
          className="szopt"
          onClick={() => {
            const from = value ?? [1920, 1080];
            setCustom({ w: String(from[0]), h: String(from[1]) });
          }}
        >
          <span className="name">{t('launcher.new.sizeCustom')}</span>
        </button>
      </div>
      {showCustom ? (
        <div className="szcustom">
          <input
            className="input"
            inputMode="numeric"
            aria-label={t('launcher.new.sizeWidth')}
            value={custom?.w ?? String(value?.[0] ?? '')}
            onChange={(e) => {
              const c = { w: num(e.target.value), h: custom?.h ?? String(value?.[1] ?? '') };
              setCustom(c);
              onChange(validSize([c.w, c.h]));
            }}
          />
          <span>×</span>
          <input
            className="input"
            inputMode="numeric"
            aria-label={t('launcher.new.sizeHeight')}
            value={custom?.h ?? String(value?.[1] ?? '')}
            onChange={(e) => {
              const c = { w: custom?.w ?? String(value?.[0] ?? ''), h: num(e.target.value) };
              setCustom(c);
              onChange(validSize([c.w, c.h]));
            }}
          />
          <span className={`hint${custom && !typed ? ' bad' : ''}`}>{custom && !typed ? t('launcher.new.sizeInvalid') : t('launcher.new.sizeCustomFor')}</span>
        </div>
      ) : (
        <p className="szfor">{preset ? t('launcher.new.sizeFor', { platforms: t(`motion.presetFor.${preset.name}`) }) : own ? t('launcher.new.sizeMine', { size: label(own) }) : ''}</p>
      )}
    </div>
  );
}
