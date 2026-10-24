import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BOARD_SIZES, needsRelayout, type Size } from '@dc/core';
import { delegateToClaude } from '../../fastedit';
import { readPref, writePref } from '../../local';
import { Field, Row, Select } from './fields';

/** Whether a new size also rescales the content inside it (on unless the person turned it off). */
const SCALE_PREF = 'dc.scaleOnResize';

/**
 * The size rows every kind's panel shares: W and H, the preset list, the switch that makes the content follow the size
 * (`.design/size-adapt.md`) and, when the shape changed a lot, the offer to hand the re-layout to Claude Code.
 * `onResize` does the work and gets the switch; `relayout` is the model-facing request for the new size.
 */
export function SizeRows({ size, scopeKey, onResize, relayout, file }: { size: Size; scopeKey: string; onResize: (w: number, h: number, scale: boolean) => void; relayout: (w: number, h: number) => string; file?: string }) {
  const { t } = useTranslation();
  const [scale, setScale] = useState(() => readPref(SCALE_PREF) !== 'off');
  const [shifted, setShifted] = useState<Size | null>(null);
  useEffect(() => setShifted(null), [scopeKey]);
  const resize = (w: number, h: number) => {
    if (w === size[0] && h === size[1]) return;
    setShifted(scale && needsRelayout(size, [w, h]) ? [w, h] : null);
    onResize(w, h, scale);
  };
  const n = (v: string) => (Number.isFinite(Number(v)) ? Math.max(40, Math.round(Number(v))) : undefined);
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
      {shifted && (
        <div className="hint">
          {t('panel.size.relayoutHint')}
          <br />
          <button className="btn sm" onClick={() => void delegateToClaude(file, null, relayout(shifted[0], shifted[1])).finally(() => setShifted(null))}>
            {t('panel.size.relayoutAsk')}
          </button>
        </div>
      )}
    </>
  );
}
