import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BOARD_SIZES, MAX_FORMAT_PX, type Size } from '@dc/core';
import { recordChange } from '../../store';
import { readPref, writePref } from '../../local';
import { Close } from '../icons';
import { forgetSize, isPreset, readSizes, rememberSize, sameSize, type Size as MineSize } from '../motion/motionSizes';
import { Field, Row, Select } from './fields';

/** Whether a new size also rescales the content inside it (on unless the person turned it off). */
const SCALE_PREF = 'dc.scaleOnResize';

/**
 * The size rows every kind's panel shares: W and H, the preset list, the person's own sizes (a custom size
 * joins them as soon as it is used, and its × removes it — the same list the New dialog and motion keep,
 * `.design/size-adapt.md`), and the switch that makes the content follow the size (`.design/size-adapt.md`).
 * `onResize` does the work and gets the switch; the change is recorded for Claude Code, and when the shape
 * changed a lot and the content was scaled, the request bar offers the re-layout (`.design/config-awareness.md`).
 * `file` is the artboard being resized (none for a whole deck).
 */
export function SizeRows({ size, onResize, file }: { size: Size; onResize: (w: number, h: number, scale: boolean) => void; file?: string }) {
  const { t } = useTranslation();
  const [scale, setScale] = useState(() => readPref(SCALE_PREF) !== 'off');
  const [mine, setMine] = useState(() => readSizes().mine);
  const resize = (w: number, h: number) => {
    if (w === size[0] && h === size[1]) return;
    // a custom size the panel just used joins the person's own, as it does at creation and in motion
    if (!isPreset([w, h])) {
      rememberSize([w, h]);
      setMine(readSizes().mine);
    }
    recordChange({ type: 'size', ...(file ? { file } : {}), from: size, to: [w, h] }, scale);
    onResize(w, h, scale);
  };
  const forget = (s: MineSize) => {
    // the board or deck keeps its size; only the saved chip goes
    forgetSize(s);
    setMine(readSizes().mine);
  };
  const n = (v: string) => (v.trim() !== '' && Number.isFinite(Number(v)) ? Math.min(MAX_FORMAT_PX, Math.max(40, Math.round(Number(v)))) : undefined);
  return (
    <>
      <Row label={t('panel.field.size')}>
        <Field value={String(size[0])} onCommit={(v) => n(v) !== undefined && resize(n(v)!, size[1])} label={t('panel.field.w')} pre="W" />
        <Field value={String(size[1])} onCommit={(v) => n(v) !== undefined && resize(size[0], n(v)!)} label={t('panel.field.h')} pre="H" />
      </Row>
      <Row label={t('panel.size.preset')}>
        <Select
          value=""
          options={[
            { value: '', label: t('panel.size.presetPlaceholder') },
            ...BOARD_SIZES.map((p) => ({ value: `${p.size[0]}x${p.size[1]}`, label: `${t(`canvas.boardSize.${p.id}`)} ${p.size[0]} × ${p.size[1]}`, group: t(`canvas.boardGroup.${p.group}`) })),
          ]}
          onChange={(v) => {
            const [w, h] = v.split('x').map(Number);
            if (w && h) resize(w, h);
          }}
          label={t('panel.size.presetLabel')}
        />
      </Row>
      {mine.length > 0 && (
        <Row label={t('panel.size.mine')}>
          <span className="mine">
            {mine.map((s) => (
              <span key={s.join('x')} className="mine-size">
                <button type="button" className="msz" aria-pressed={sameSize(s, size)} onClick={() => resize(s[0], s[1])}>
                  {s[0]}×{s[1]}
                </button>
                <button type="button" className="ib sm" aria-label={t('panel.size.mineForget', { size: s.join('×') })} title={t('panel.size.mineForget', { size: s.join('×') })} onClick={() => forget(s)}>
                  <Close />
                </button>
              </span>
            ))}
          </span>
        </Row>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={scale}
          onChange={(e) => {
            setScale(e.currentTarget.checked);
            writePref(SCALE_PREF, e.currentTarget.checked ? 'on' : 'off');
          }}
        />
        {t('panel.size.scaleContent')}
      </label>
    </>
  );
}
