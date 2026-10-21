import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BOARD_GROUPS, BOARD_SIZES, type BoardGroup, boardSizeOf, validSize } from '@dc/core';
import { Ratio } from './Ratio';
import { forgetSize, readSizes, sameSize, type Size } from '../motion/motionSizes';
import { Close } from '../icons';

/**
 * The shared size selector for canvases, decks and motion pieces: the categories (BOARD_GROUPS) down the left, the picked
 * category's sizes on the right, each drawn to scale with its width and height, the line under saying
 * where the picked one is used, and Custom for any other width and height. `value` is the size to create with, or null while a custom
 * one is half typed.
 */
export function BoardSizePicker({ value, onChange, kind = 'design' }: { value: Size | null; onChange: (size: Size | null) => void; kind?: 'design' | 'slides' | 'motion' }) {
  const { t } = useTranslation();
  const preset = boardSizeOf(value);
  const [mine, setMine] = useState(() => kind === 'motion' ? readSizes().mine.filter((s) => !boardSizeOf(s)) : []);
  const own = mine.some((s) => sameSize(s, value));
  const [custom, setCustom] = useState<{ w: string; h: string } | null>(null);
  const typed = custom ? validSize([custom.w, custom.h]) : null;
  const num = (v: string) => v.replace(/[^\d]/g, '').slice(0, 4);
  const edit = (c: { w: string; h: string }) => {
    setCustom(c);
    onChange(validSize([c.w, c.h]));
  };
  const [picked, setPicked] = useState<BoardGroup | 'mine' | 'custom'>(preset?.group ?? (own ? 'mine' : value ? 'custom' : 'screen'));
  const tab = picked;
  const pickCustom = () => {
    setPicked('custom');
    const from = value ?? BOARD_SIZES[0].size;
    setCustom({ w: String(from[0]), h: String(from[1]) });
  };
  return (
    <div className="sizes" data-sizes={kind === 'design' ? 'board' : kind}>
      <div className="szsplit">
        <div className="szcats" role="tablist" aria-orientation="vertical" aria-label={t(kind === 'design' ? 'launcher.new.boardSize' : 'launcher.new.size')}>
          {[...BOARD_GROUPS, ...(mine.length ? ['mine' as const] : []), 'custom' as const].map((g) => (
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
              {g === 'custom' ? t('launcher.new.sizeCustom') : g === 'mine' ? t('launcher.new.sizeMineGroup') : t(`canvas.boardGroup.${g}`)}
            </button>
          ))}
        </div>
        {tab === 'custom' ? (
          <div className="szcustom">
            <input className="input" inputMode="numeric" aria-label={t('launcher.new.sizeWidth')} value={custom?.w ?? String(value?.[0] ?? '')} onChange={(e) => edit({ w: num(e.target.value), h: custom?.h ?? String(value?.[1] ?? '') })} />
            <span>×</span>
            <input className="input" inputMode="numeric" aria-label={t('launcher.new.sizeHeight')} value={custom?.h ?? String(value?.[1] ?? '')} onChange={(e) => edit({ w: custom?.w ?? String(value?.[0] ?? ''), h: num(e.target.value) })} />
            <span className={`hint${custom && !typed ? ' bad' : ''}`}>{custom && !typed ? t('launcher.new.sizeInvalid') : t(kind === 'motion' ? 'launcher.new.sizeCustomFor' : 'launcher.new.boardCustomFor')}</span>
          </div>
        ) : tab === 'mine' ? (
          <div className="szrow" role="radiogroup" aria-label={t('launcher.new.sizeMineGroup')}>
            {mine.map((s) => (
              <span key={s.join('x')} className="szmine">
                <button type="button" role="radio" aria-checked={sameSize(s, value)} data-size="mine" className="szopt" onClick={() => onChange(s)}>
                  <Ratio size={s} /><span className="dim">{s[0]}×{s[1]}</span>
                </button>
                <button type="button" className="szx" aria-label={t('launcher.new.sizeForget', { size: s.join('×') })} onClick={() => {
                  forgetSize(s);
                  const next = mine.filter((v) => !sameSize(v, s));
                  setMine(next);
                  if (sameSize(s, value)) onChange([1920, 1080]);
                  if (!next.length) setPicked('slides');
                }}><Close /></button>
              </span>
            ))}
          </div>
        ) : (
          <div className="szrow" role="radiogroup" aria-label={t(`canvas.boardGroup.${tab}`)}>
            {BOARD_SIZES.filter((p) => p.group === tab).map((p) => (
              <button
                type="button"
                key={p.id}
                role="radio"
                aria-checked={!custom && preset?.id === p.id}
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
          {own && value ? t('launcher.new.sizeMine', { size: value.join('×') }) : preset ? `${t(`canvas.boardSize.${preset.id}`)} ${preset.size[0]}×${preset.size[1]} · ${t(`canvas.boardFor.${preset.id}`)}` : ''}
        </p>
      )}
    </div>
  );
}
