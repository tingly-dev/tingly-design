import { useTranslation } from 'react-i18next';
import { parseDashBundle, type DcElement, type LinkMode } from '@dc/core';
import { Linked } from '../icons';
import { Segmented } from '../Segmented';
import { display, useStore } from '../../store';
import { originalUrl, showLinkedAs, unlinkLinkedPage, updateLinkedPage, useLinkedRecords, useLinks } from '../../linkedPages';

/**
 * What a selected linked page says about itself (.design/cross-kind-embedding.md): where it came from, whether
 * the original changed since, and what to do about it: update the copy, open the original, let go of it. One
 * form for every kind and every form of the page (a picture in a doc, on a slide, in a scene or on the canvas, a
 * page shown live); nothing here edits the page, which is a copy: the way to change it is the original. `path` is
 * the element's `src`: the copy, or the picture kept beside it. A page that is kept live can be shown as the live
 * element or as its picture (`show`: the element and its file, where that can be switched in place).
 */
export function LinkedPanel({ path, compact = false, show }: { path: string; compact?: boolean; show?: { file: string; el: DcElement } }) {
  const { t, i18n } = useTranslation();
  const rec = useLinkedRecords().find((r) => r.path === path || r.poster === path);
  const frozen = useStore((s) => (rec?.kind === 'dashboard' && rec.mode === 'live' ? display(s, rec.path) : undefined));
  const bundle = parseDashBundle(frozen);
  const check = useLinks((l) => (rec ? l.states[rec.path] : undefined));
  const updating = useLinks((l) => (rec ? l.updating.includes(rec.path) : false));
  const checking = useLinks((l) => l.checking);
  if (!rec) return null;
  const state = check?.state;
  const project = check?.title ?? rec.from.replace(/^projects\//, '');
  const page = check?.page ?? rec.page.replace(/\.dc\.html$/, '');
  const when = rec.copiedAt ? new Date(rec.copiedAt).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  const canUpdate = state === 'changed' || state === 'current';
  const shown: LinkMode = show?.el.tag === 'x-embed' ? 'live' : 'image';
  const canSwitch = !!show && rec.mode === 'live' && !!rec.poster;
  const frozenAt = bundle?.frozenAt ? new Date(bundle.frozenAt).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  const failed = bundle?.failed ? Object.keys(bundle.failed).length : 0;
  const words = state ? t(`linked.panel.state.${state === 'missing' && check?.page === undefined && check?.project ? 'pageGone' : state}`) : checking ? t('linked.panel.checking') : '';
  return (
    <div className={compact ? 'linkedp compact' : 'sec linkedp'} data-state={state ?? 'unknown'}>
      {!compact && (
        <h3>
          <Linked size={13} /> {t('linked.panel.title')}
        </h3>
      )}
      <div className="linkedp-src">
        <span className="linkedp-k">{t('linked.panel.from')}</span>
        <span className="linkedp-v" title={rec.from}>
          {t('linked.panel.source', { page, project })}
        </span>
      </div>
      {canSwitch && (
        <div className="linkedp-src linkedp-show">
          <span className="linkedp-k">{t('linked.panel.showAs')}</span>
          <Segmented<LinkMode>
            label={t('linked.panel.showAs')}
            value={shown}
            onChange={(to) => to !== shown && void showLinkedAs(show!.file, show!.el, rec, to)}
            options={[
              { value: 'live', label: t('linked.panel.live'), title: t('linked.panel.liveHint') },
              { value: 'image', label: t('linked.panel.picture'), title: t('linked.panel.pictureHint') },
            ]}
          />
        </div>
      )}
      {bundle && shown === 'live' && (
        <div className="linkedp-src linkedp-data">
          <span className="linkedp-k">{t('linked.panel.data')}</span>
          <span className="linkedp-v">
            {t('linked.panel.frozen', { when: frozenAt, count: Object.keys(bundle.datasets).length })}
            {failed ? ` · ${t('linked.panel.failed', { count: failed })}` : ''}
          </span>
        </div>
      )}
      <div className="linkedp-state">
        <span className={`linkedp-words ${state === 'changed' ? 'changed' : ''}`} role="status">
          {words}
          {state === 'current' && when ? ` · ${t('linked.panel.asOf', { when })}` : ''}
        </span>
        {state === 'changed' && (
          <button className="btn sm primary" disabled={updating} onClick={() => void updateLinkedPage(rec.path)}>
            {updating ? t('linked.panel.updating') : t('linked.panel.update')}
          </button>
        )}
      </div>
      <div className="linkedp-a">
        {state === 'current' && (
          <button className="btn ghost sm" disabled={updating} onClick={() => void updateLinkedPage(rec.path)} title={t('linked.panel.updateAgainHint')}>
            {updating ? t('linked.panel.updating') : t('linked.panel.update')}
          </button>
        )}
        {canUpdate && (
          <a className="btn ghost sm" href={originalUrl(rec)} target="_blank" rel="noreferrer">
            {t('linked.panel.openOriginal')}
          </a>
        )}
        <button className="btn ghost sm" onClick={() => void unlinkLinkedPage(rec.path)} title={t('linked.panel.unlinkHint')}>
          {t('linked.panel.unlink')}
        </button>
      </div>
    </div>
  );
}
