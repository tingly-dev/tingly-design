import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { COLOUR_GROUPS, colourGroup, detectTheme, dsGlance, scanSources, strayColours, themeContrast, type ThemeSystem } from '@dc/core';
import { useStore } from '../../store';
import { Segmented } from '../Segmented';
import { DsInstall } from './DsInstall';
import { applyTheme, themeName, useThemeInputs, type ThemeScope } from './themeApply';

/**
 * The Theme tab of a canvas or deck (`.design/project-theme.md`): every theme of every installed design system as a
 * card, one click to show the whole work in it, an Original look card to go back, and below, the theme it now
 * wears with its colours by role and the contrast of the text on what it is drawn on. A deck says whether the
 * switch is for every slide or this one; there is no preview mode, the toast's Undo is the way back.
 */
export function ThemeTab() {
  const { t } = useTranslation();
  const slides = useStore((s) => s.kind === 'slides');
  const [scope, setScope] = useState<ThemeScope>('all');
  const { systems, record, sources } = useThemeInputs(slides ? scope : 'all');
  const stats = useMemo(() => scanSources(sources), [sources]);
  const worn = useMemo(() => detectTheme(stats, systems, record), [stats, systems, record]);
  // the original is there when the work was switched from one (the plan itself is made when the card is clicked)
  const canOriginal = !!record?.base && !!worn;
  const wornSystem = worn ? systems.find((x) => x.namespace === worn.system) : undefined;
  const stay = useMemo(() => strayColours(stats, systems).length, [stats, systems]);

  return (
    <div className="sec themetab">
      <h3>{t('panel.theme.title')}</h3>
      <p className="hint" style={{ margin: 0 }}>
        {t(slides ? 'panel.theme.introSlides' : 'panel.theme.introDesign')}
      </p>
      {!systems.length ? (
        <>
          <p className="hint" style={{ margin: 0 }}>
            {t(slides ? 'panel.theme.emptySlides' : 'panel.theme.emptyDesign')}
          </p>
          <DsInstall />
        </>
      ) : (
        <>
          {slides && (
            <div className="th-scope">
              <span>{t('panel.theme.scope')}</span>
              <Segmented
                value={scope}
                onChange={setScope}
                label={t('panel.theme.scope')}
                data="scope"
                options={[
                  { value: 'all', label: t('panel.theme.scopeAll') },
                  { value: 'one', label: t('panel.theme.scopeOne') },
                ]}
              />
            </div>
          )}
          <div className="th-grid" role="group" aria-label={t('panel.theme.title')}>
            <button
              type="button"
              className="th-card th-orig"
              data-theme-card="original"
              aria-pressed={!worn}
              disabled={!!worn && !canOriginal}
              title={worn && !canOriginal ? t('panel.theme.originalNone') : undefined}
              onClick={() => worn && applyTheme('original', scope)}
            >
              <span className="th-spec">Aa</span>
              <span className="th-name">{t('panel.theme.original')}</span>
            </button>
            {systems.flatMap((sys) =>
              sys.tokens.themes.map((th) => {
                const g = dsGlance(sys.tokens, th.id);
                const name = themeName(sys, th.id);
                const on = worn?.system === sys.namespace && worn.theme === th.id;
                return (
                  <button
                    key={`${sys.namespace}/${th.id}`}
                    type="button"
                    className="th-card"
                    data-theme-card={`${sys.namespace}/${th.id}`}
                    aria-pressed={on}
                    aria-label={t('panel.theme.cardLabel', { name })}
                    onClick={() => applyTheme({ system: sys.namespace, theme: th.id }, scope)}
                  >
                    <span className="th-spec" style={{ background: g.paper ?? g.surface, color: g.ink, fontFamily: g.bodyFont, boxShadow: g.line ? `inset 0 0 0 1px ${g.line}` : undefined }}>
                      Aa
                      {g.accent && <i style={{ background: g.accent }} />}
                    </span>
                    <span className="th-name">{sys.title}</span>
                    {sys.tokens.themes.length > 1 && <span className="th-sub">{th.name}</span>}
                  </button>
                );
              }),
            )}
          </div>
          <div className="th-now" aria-live="polite">
            <b>{worn && wornSystem ? t('panel.theme.wearing', { name: themeName(wornSystem, worn.theme) }) : t('panel.theme.wearingNone')}</b>
            {stay > 0 && <p className="hint">{t('panel.theme.stay', { count: stay })}</p>}
          </div>
          {worn && wornSystem && <Palette sys={wornSystem} theme={worn.theme} deck={slides} />}
        </>
      )}
    </div>
  );
}

/** The worn theme's colours by role, the contrast of its text on what it is drawn on, and its typefaces. */
function Palette({ sys, theme, deck }: { sys: ThemeSystem; theme: string; deck: boolean }) {
  const { t } = useTranslation();
  const groups = COLOUR_GROUPS.map((g) => ({ g, colours: sys.tokens.colors.filter((c) => c.values[theme] && colourGroup(c.name) === g) })).filter((x) => x.colours.length);
  const checks = themeContrast(sys.tokens, theme);
  const families = Object.entries(sys.tokens.families);
  return (
    <>
      <h3>{t('panel.theme.colours')}</h3>
      {groups.map(({ g, colours }) => (
        <div key={g} className="th-group" data-group={g}>
          <div className="th-gt">{t(`panel.theme.groups.${g}`)}</div>
          <div className="th-sws">
            {colours.map((c) => (
              <span key={c.name} className="th-sw" title={`${c.name} ${c.values[theme]}${c.usage ? `\n${c.usage}` : ''}`}>
                <i style={{ background: c.values[theme] }} />
                <span>{c.name}</span>
              </span>
            ))}
          </div>
        </div>
      ))}
      {checks.length > 0 && (
        <>
          <h3>{t('panel.theme.contrast')}</h3>
          <ul className="th-contrast">
            {checks.map((c) => (
              <li key={`${c.text}/${c.on}`} className={c.ok ? 'ok' : 'low'} title={c.ok ? undefined : t('panel.theme.contrastLow', { need: c.need })}>
                <span>{t('panel.theme.contrastRow', { text: c.text, on: c.on })}</span>
                <b>{c.ratio.toFixed(1)}:1</b>
              </li>
            ))}
          </ul>
        </>
      )}
      {families.length > 0 && (
        <>
          <h3>{t('panel.theme.fonts')}</h3>
          {families.map(([k, v]) => (
            <div key={k} className="th-font" style={{ fontFamily: v }}>
              <span>{v.split(',')[0].replace(/["']/g, '')}</span>
              <small>{k}</small>
            </div>
          ))}
          <p className="hint" style={{ margin: 0 }}>
            {t(deck ? 'panel.theme.fontsDeck' : 'panel.theme.fontsCanvas')}
          </p>
        </>
      )}
    </>
  );
}
