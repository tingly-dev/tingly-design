import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { type Remark, resolveRemark } from '@dc/core';
import { display, parsed, togglePane, useStore } from '../../store';
import { clearRemarks, focusRemark, placeOf, removeRemark, sendable, sendRemarks, setRemarkText } from '../../review';
import { LOCATE } from '../../locate';
import { Close } from '../icons';
import { SideResizer } from '../SideResizer';

/** One remark: its number (the pin's), what it points at, the person's words. */
function Card({ remark, n }: { remark: Remark; n: number }) {
  const { t } = useTranslation();
  const focus = useStore((s) => (s.remarkFocus?.id === remark.id ? s.remarkFocus.tick : null));
  const kind = useStore((s) => s.kind);
  const lost = useStore((s) => {
    const src = display(s, remark.file);
    return resolveRemark(src === undefined ? null : parsed(src), remark).state === 'lost';
  });
  const box = useRef<HTMLTextAreaElement>(null);
  const card = useRef<HTMLDivElement>(null);
  // a click on its pin (or its card) asks for the keyboard; the card comes into view
  useEffect(() => {
    if (focus === null) return;
    card.current?.scrollIntoView({ block: 'nearest' });
    if (document.activeElement !== box.current) box.current?.focus();
  }, [focus]);
  const a = remark.anchor;
  return (
    <div ref={card} className={`rvcard${focus !== null ? ' on' : ''}${lost ? ' lost' : ''}`} data-remark={remark.id}>
      <div
        className="rvwhere"
        title={t('review.show')}
        onClick={() => {
          if (kind) LOCATE[kind]?.(remark.file);
          focusRemark(remark.id);
        }}
      >
        <span className="rvnum">{n}</span>
        <span className="rvanchor">
          <span className="rvline">
            {a ? (
              <>
                <code>{a.handle}</code> &lt;{a.tag}&gt; {a.label && <span className="rvlabel">{a.label}</span>}
              </>
            ) : (
              t('review.whole')
            )}
          </span>
          <span className="rvplace">{placeOf(remark.file)}</span>
        </span>
        <button className="ib sm" aria-label={t('review.remove', { n })} title={t('review.remove', { n })} onClick={(e) => (e.stopPropagation(), removeRemark(remark.id))}>
          <Close />
        </button>
      </div>
      {lost && <div className="rvlostnote">{t('review.lost')}</div>}
      <textarea
        ref={box}
        className="rvtext"
        rows={2}
        value={remark.text}
        placeholder={t('review.placeholder')}
        aria-label={t('review.textLabel', { n })}
        onChange={(e) => setRemarkText(remark.id, e.target.value)}
        onFocus={() => useStore.getState().remarkFocus?.id !== remark.id && focusRemark(remark.id)}
        onBlur={() => useStore.setState((s) => (s.remarkFocus?.id === remark.id ? { remarkFocus: null } : {}))}
        // the page's keys (delete, arrows) are not for the words typed here
        onKeyDown={(e) => (e.stopPropagation(), e.key === 'Escape' && e.currentTarget.blur())}
      />
    </div>
  );
}

/**
 * The right column while reviewing: the remarks in the order they were made, and one button that hands
 * those with words to Claude Code together. Opening it is the mode (a click on the page leaves a remark),
 * closing it leaves the mode and brings the inspector back.
 */
export function ReviewPane() {
  const { t } = useTranslation();
  const remarks = useStore((s) => s.remarks);
  const noCli = useStore((s) => s.health?.claudeCli === false);
  const busy = useStore((s) => s.delegates.some((d) => d.state === 'start' || d.state === 'progress'));
  const count = sendable(remarks).length;
  const bare = remarks.length - count;
  const why = noCli ? t('prompt.bar.noClaudeCli') : busy ? t('review.busy') : undefined;
  return (
    <aside className="panel review" aria-label={t('review.title')}>
      <SideResizer id="inspector" edge="start" name={t('review.title')} />
      <div className="rvhead">
        <h3>{t('review.title')}</h3>
        <span className="hint">{remarks.length ? t('review.count', { count: remarks.length }) : t('review.countNone')}</span>
        {remarks.length > 0 && (
          <button className="btn ghost sm" onClick={clearRemarks}>
            {t('review.clear')}
          </button>
        )}
        <button className="ib x" aria-label={t('review.close')} title={t('review.close')} onClick={() => togglePane('review')}>
          <Close />
        </button>
      </div>
      <div className="rvlist">
        {remarks.length === 0 ? (
          <div className="rvempty">
            <span className="rvnum">1</span>
            <p>
              <b>{t('review.empty.title')}</b> {t('review.empty.body')}
            </p>
            <p className="hint">{t('review.empty.more')}</p>
          </div>
        ) : (
          remarks.map((r, i) => <Card key={r.id} remark={r} n={i + 1} />)
        )}
      </div>
      <div className="rvfoot">
        {bare > 0 && count > 0 && <span className="hint">{t('review.unsent', { count: bare })}</span>}
        <button className="btn primary" disabled={!count || !!why} title={why} onClick={() => void sendRemarks()}>
          {count ? t('review.send', { count }) : t('review.sendNone')}
        </button>
      </div>
    </aside>
  );
}
