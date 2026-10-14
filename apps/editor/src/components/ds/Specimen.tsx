import type { CSSProperties } from 'react';
import type { DsGlance } from '@dc/core';
import { useTranslation } from 'react-i18next';

const FALLBACK = { paper: '#f4f3ef', surface: '#ffffff', ink: '#1d1d1b', accent: '#9a9892' };

/**
 * A system's look on one small poster: its page, a card with its radius and shadow, a headline in its
 * display face, a line of body text and a button in its brand colour. Two systems differ here at a glance.
 * Used by the launcher card and the design-system overview, so both say the same thing.
 */
export function Specimen({ glance: g, title, className = '' }: { glance: DsGlance; title: string; className?: string }) {
  const { t: tr } = useTranslation();
  const paper = g.paper ?? FALLBACK.paper;
  const surface = g.surface ?? (g.paper ? g.paper : FALLBACK.surface);
  const ink = g.ink ?? FALLBACK.ink;
  const accent = g.accent ?? FALLBACK.accent;
  const style = { '--sp-paper': paper, '--sp-surface': surface, '--sp-ink': ink, '--sp-accent': accent, '--sp-radius': g.radius ?? '8px' } as CSSProperties;
  return (
    <div className={`specimen ${className}`} style={style} role="img" aria-label={tr('ds.glance.specimen', { title })}>
      <div className={`sp-card ${g.shadow ? 'raised' : ''}`}>
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
    </div>
  );
}
