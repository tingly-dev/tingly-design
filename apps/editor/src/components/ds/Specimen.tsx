import type { CSSProperties } from 'react';
import type { DsGlance } from '@dc/core';
import { useTranslation } from 'react-i18next';

const FALLBACK = { paper: '#f4f3ef', surface: '#ffffff', ink: '#1d1d1b', accent: '#9a9892' };

function Pane({ glance: g, title, label }: { glance: DsGlance; title: string; label?: string }) {
  const { t: tr } = useTranslation();
  const paper = g.paper ?? FALLBACK.paper;
  const style = {
    '--sp-paper': paper,
    '--sp-surface': g.surface ?? (g.paper ? g.paper : FALLBACK.surface),
    '--sp-ink': g.ink ?? FALLBACK.ink,
    '--sp-accent': g.accent ?? FALLBACK.accent,
    '--sp-radius': g.radius ?? '8px',
  } as CSSProperties;
  // the system's own shadow and hairline colour, so a hard offset or a heavy border shows as it is
  const cardStyle: CSSProperties | undefined =
    g.shadowValue || g.line ? { ...(g.shadowValue ? { boxShadow: g.shadowValue } : {}), ...(g.line ? { border: `1px solid ${g.line}` } : {}) } : undefined;
  return (
    <div className="sp-pane" style={style}>
      <div className={`sp-card ${g.shadow ? 'raised' : ''}`} style={cardStyle}>
        <div className="sp-head" style={{ fontFamily: g.headingFont }}>
          {title}
        </div>
        <div className="sp-body" style={{ fontFamily: g.bodyFont }}>
          {tr('ds.glance.sample')}
        </div>
        <div className="sp-row">
          <span className="sp-btn" style={{ fontFamily: g.bodyFont }}>
            {tr('ds.glance.button')}
          </span>
          <span className="sp-aa" style={{ fontFamily: g.headingFont }}>
            Aa
          </span>
        </div>
      </div>
      {label && <span className="sp-theme">{label}</span>}
    </div>
  );
}

/**
 * A system's look on one small poster: its page, a card with its radius and shadow, a headline in its
 * display face, a line of body text and a button in its brand colour. A second theme sits beside the
 * first, so light and dark are both seen. Two systems differ here at a glance. Used by the launcher card
 * and the design-system overview, so both say the same thing.
 */
export function Specimen({ glance, alt, themeName, title, className = '' }: { glance: DsGlance; alt?: { name: string; glance: DsGlance }; themeName?: string; title: string; className?: string }) {
  const { t: tr } = useTranslation();
  return (
    <div className={`specimen ${alt ? 'two' : ''} ${className}`} role="img" aria-label={tr('ds.glance.specimen', { title })}>
      <Pane glance={glance} title={title} label={alt ? themeName : undefined} />
      {alt && <Pane glance={alt.glance} title={title} label={alt.name} />}
    </div>
  );
}
