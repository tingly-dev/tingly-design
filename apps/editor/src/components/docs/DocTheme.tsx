import { useTranslation } from 'react-i18next';
import { dsGlance } from '@dc/core';
import { DsInstall } from '../panel/DsInstall';
import { useInstalled } from '../ds/ds';
import { applyDocTheme, docThemeName, useDocLook } from './docTheme';

/**
 * A doc's Theme (`.design/doc-design-system.md`): the doc's own look or a theme of an installed design system, one click,
 * no preview state; the same word, cards and place of the canvas's and deck's Theme, as a top-bar popover because a doc has no
 * right panel. Installing a system here wears it at once. What is chosen dresses the editor's page and every export, WeChat included.
 */
export function DocTheme() {
  const { t } = useTranslation();
  const installed = useInstalled();
  const { worn } = useDocLook();
  return (
    <div className="popmenu doctheme" data-testid="doc-theme">
      <h3>{t('docs.theme.title')}</h3>
      <p className="hint">{t('docs.theme.intro')}</p>
      <div className="th-grid" role="group" aria-label={t('docs.theme.title')}>
        <button type="button" className="th-card th-orig" data-theme-card="original" aria-pressed={!worn} onClick={() => !worn || applyDocTheme(null)}>
          <span className="th-spec">Aa</span>
          <span className="th-name">{t('docs.theme.own')}</span>
        </button>
        {installed.flatMap((x) =>
          x.tokens.themes.map((th) => {
            const g = dsGlance(x.tokens, th.id);
            const name = docThemeName({ title: x.record.title, themes: x.tokens.themes }, th.id);
            const on = worn?.system === x.record.namespace && worn.theme === th.id;
            return (
              <button
                key={`${x.record.namespace}/${th.id}`}
                type="button"
                className="th-card"
                data-theme-card={`${x.record.namespace}/${th.id}`}
                aria-pressed={on}
                aria-label={t('panel.theme.cardLabel', { name })}
                onClick={() => on || applyDocTheme({ system: x.record.namespace, theme: th.id })}
              >
                <span className="th-spec" style={{ background: g.paper ?? g.surface, color: g.ink, fontFamily: g.bodyFont, boxShadow: g.line ? `inset 0 0 0 1px ${g.line}` : undefined }}>
                  Aa
                  {g.accent && <i style={{ background: g.accent }} />}
                </span>
                <span className="th-name">{x.record.title}</span>
                {x.tokens.themes.length > 1 && <span className="th-sub">{th.name}</span>}
              </button>
            );
          }),
        )}
      </div>
      <p className="hint" aria-live="polite">
        {worn ? t('docs.theme.wearing', { name: docThemeName({ title: worn.title, themes: installed.find((x) => x.record.namespace === worn.system)?.tokens.themes ?? [] }, worn.theme) }) : t('docs.theme.wearingNone')}
      </p>
      <details className="th-systems" open={!installed.length}>
        <summary>{t('docs.theme.systems')}</summary>
        <DsInstall />
      </details>
    </div>
  );
}
