import { useTranslation } from 'react-i18next';
import { Linked } from '../icons';
import { originalUrl, unlinkLinkedPage, updateLinkedPage, useLinkedRecords, useLinks } from '../../linkedPages';

/**
 * What a selected linked page says about itself (.design/cross-kind-embedding.md): where it came from, whether
 * the original changed since, and what to do about it: update the copy, open the original, let go of it. One
 * form for every kind and every form of the page (a picture in a doc, on a slide, in a scene or on the canvas, an
 * artboard shown live); nothing here edits the page, which is a copy: the way to change it is the original.
 */
export function LinkedPanel({ path, compact = false }: { path: string; compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const rec = useLinkedRecords().find((r) => r.path === path);
  const check = useLinks((l) => l.states[path]);
  const updating = useLinks((l) => l.updating.includes(path));
  const checking = useLinks((l) => l.checking);
  if (!rec) return null;
  const state = check?.state;
  const project = check?.title ?? rec.from.replace(/^projects\//, '');
  const page = check?.page ?? rec.page.replace(/\.dc\.html$/, '');
  const when = rec.copiedAt ? new Date(rec.copiedAt).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  const canUpdate = state === 'changed' || state === 'current';
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
      <div className="linkedp-state">
        <span className={`linkedp-words ${state === 'changed' ? 'changed' : ''}`} role="status">
          {words}
          {state === 'current' && when ? ` · ${t('linked.panel.asOf', { when })}` : ''}
        </span>
        {state === 'changed' && (
          <button className="btn sm primary" disabled={updating} onClick={() => void updateLinkedPage(path)}>
            {updating ? t('linked.panel.updating') : t('linked.panel.update')}
          </button>
        )}
      </div>
      <div className="linkedp-a">
        {state === 'current' && (
          <button className="btn ghost sm" disabled={updating} onClick={() => void updateLinkedPage(path)} title={t('linked.panel.updateAgainHint')}>
            {updating ? t('linked.panel.updating') : t('linked.panel.update')}
          </button>
        )}
        {canUpdate && (
          <a className="btn ghost sm" href={originalUrl(rec)} target="_blank" rel="noreferrer">
            {t('linked.panel.openOriginal')}
          </a>
        )}
        <button className="btn ghost sm" onClick={() => void unlinkLinkedPage(path)} title={t('linked.panel.unlinkHint')}>
          {t('linked.panel.unlink')}
        </button>
      </div>
    </div>
  );
}
