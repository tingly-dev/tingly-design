import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BOARD_GROUPS, BOARD_SIZES, type BoardGroup, boardSizeOf, validSize } from '@dc/core';
import { Ratio } from '../motion/SizePicker';
import { sameSize, type Size } from '../motion/motionSizes';

/**
 * Which size a new canvas's first artboard starts in: the categories (BOARD_GROUPS) down the left, the picked
 * category's sizes on the right, each drawn to scale with its width and height, the line under saying
 * where the picked one is used, and Custom for any other width and height. `value` is the size to create with, or null while a custom
 * one is half typed.
 */
export function BoardSizePicker({ value, onChange }: { value: Size | null; onChange: (size: Size | null) => void }) {
  const { t } = useTranslation();
  const preset = boardSizeOf(value);
  const [custom, setCustom] = useState<{ w: string; h: string } | null>(null);
  const typed = custom ? validSize([custom.w, custom.h]) : null;
  const showCustom = custom !== null || (value !== null && !preset);
  const num = (v: string) => v.replace(/[^\d]/g, '').slice(0, 4);
  const edit = (c: { w: string; h: string }) => {
    setCustom(c);
    onChange(validSize([c.w, c.h]));
  };
  const [picked, setPicked] = useState<BoardGroup | 'custom'>(preset?.group ?? (value ? 'custom' : 'screen'));
  const tab = showCustom ? 'custom' : picked;
  const pickCustom = () => {
    const from = value ?? BOARD_SIZES[0].size;
    setCustom({ w: String(from[0]), h: String(from[1]) });
  };
  return (
    <div className="sizes" data-sizes="board">
      <div className="szsplit">
        <div className="szcats" role="tablist" aria-orientation="vertical" aria-label={t('launcher.new.boardSize')}>
          {[...BOARD_GROUPS, 'custom' as const].map((g) => (
            <button
              type="button"
              key={g}
              role="tab"
              aria-selected={tab === g}
              data-group={g}
              className="szcat"
              onClick={() => {
                if (g === 'custom') pickCustom();
                else {
                  setCustom(null);
                  setPicked(g);
                }
              }}
            >
              {g === 'custom' ? t('launcher.new.sizeCustom') : t(`canvas.boardGroup.${g}`)}
            </button>
          ))}
        </div>
        {tab === 'custom' ? (
          <div className="szcustom">
            <input className="input" inputMode="numeric" aria-label={t('launcher.new.sizeWidth')} value={custom?.w ?? String(value?.[0] ?? '')} onChange={(e) => edit({ w: num(e.target.value), h: custom?.h ?? String(value?.[1] ?? '') })} />
            <span>×</span>
            <input className="input" inputMode="numeric" aria-label={t('launcher.new.sizeHeight')} value={custom?.h ?? String(value?.[1] ?? '')} onChange={(e) => edit({ w: custom?.w ?? String(value?.[0] ?? ''), h: num(e.target.value) })} />
            <span className={`hint${custom && !typed ? ' bad' : ''}`}>{custom && !typed ? t('launcher.new.sizeInvalid') : t('launcher.new.boardCustomFor')}</span>
          </div>
        ) : (
          <div className="szrow" role="radiogroup" aria-label={t(`canvas.boardGroup.${tab}`)}>
            {BOARD_SIZES.filter((p) => p.group === tab).map((p) => (
              <button
                type="button"
                key={p.id}
                role="radio"
                aria-checked={preset?.id === p.id}
                data-size={p.id}
                className="szopt"
                title={t(`canvas.boardFor.${p.id}`)}
                onClick={() => onChange([p.size[0], p.size[1]])}
              >
                <Ratio size={[p.size[0], p.size[1]]} />
                <span className="name">{t(`canvas.boardSize.${p.id}`)}</span>
                <span className="dim">
                  {p.size[0]}×{p.size[1]}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {tab !== 'custom' && (
        <p className="szfor" data-for={preset?.id}>
          {preset ? `${t(`canvas.boardSize.${preset.id}`)} ${preset.size[0]}×${preset.size[1]} · ${t(`canvas.boardFor.${preset.id}`)}` : ''}
        </p>
      )}
    </div>
  );
}
