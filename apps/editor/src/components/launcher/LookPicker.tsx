import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LOOKS, LOOK_GROUPS, lookOf, type LookGroup } from '@dc/core';

/**
 * Where a new design system starts: Blank, or one of the looks (LOOKS) in groups by feel. The groups run down
 * the left, the picked group's looks on the right, each drawn as a swatch of its own page colour, ink,
 * accent and type. `value` is the look's id, or '' for a blank system. Install pickers hide Blank
 * with `allowBlank`: clearing their field already removes the selection.
 */
export function LookPicker({ value, onChange, allowBlank = true }: { value: string; onChange: (look: string) => void; allowBlank?: boolean }) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<LookGroup | 'blank'>(lookOf(value)?.group ?? (allowBlank ? 'blank' : LOOK_GROUPS[0]));
  return (
    <div className="sizes" data-looks="picker">
      <div className="szsplit">
        <div className="szcats" role="tablist" aria-orientation="vertical" aria-label={t('launcher.new.look')}>
          {(allowBlank ? ['blank', ...LOOK_GROUPS] as const : LOOK_GROUPS).map((g) => (
            <button
              type="button"
              key={g}
              role="tab"
              aria-selected={picked === g}
              data-group={g}
              className="szcat"
              onClick={() => {
                setPicked(g);
                if (g === 'blank') onChange('');
              }}
            >
              {g === 'blank' ? t('launcher.new.lookBlank') : t(`ds.lookGroup.${g}`)}
            </button>
          ))}
        </div>
        {picked === 'blank' ? (
          <p className="szfor">{t('launcher.new.lookBlankNote')}</p>
        ) : (
          <div className="szrow lookrow" role="radiogroup" aria-label={t(`ds.lookGroup.${picked}`)}>
            {LOOKS.filter((l) => l.group === picked).map((l) => (
              <button type="button" key={l.id} role="radio" aria-checked={value === l.id} data-look={l.id} title={t(`ds.look.${l.id}`, { defaultValue: l.id })} className="szopt lookopt" onClick={() => onChange(l.id)}>
                <span
                  className="looksw"
                  aria-hidden
                  style={{ background: l.colors.surface, color: l.colors.ink, borderColor: l.colors.line ?? l.colors['ink-faint'], fontFamily: l.families.display }}
                >
                  Aa
                  <i style={{ background: l.colors.accent }} />
                </span>
                <span className="name">{t(`ds.look.${l.id}`, { defaultValue: l.id })}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {picked !== 'blank' && (allowBlank || !!value) && (
        <p className="szfor" data-picked={value || undefined}>
          {lookOf(value) ? t('launcher.new.lookPicked', { look: t(`ds.look.${value}`, { defaultValue: value }), group: t(`ds.lookGroup.${lookOf(value)!.group}`) }) : allowBlank ? t('launcher.new.lookNone') : null}
        </p>
      )}
    </div>
  );
}
