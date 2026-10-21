import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type DesignSystemChoice } from '../../api';
import { DesignSystemPicker } from '../DesignSystemPicker';
import { useInstalled } from '../ds/ds';
import { toast, useStore } from '../../store';

/**
 * Design systems in a canvas or deck: install a project system or built-in look
 * (its tokens are copied into ds/<folder>/, and recorded in the
 * index), or remove one. Once installed, colour fields and the text style
 * menu offer its tokens.
 */
export function DsInstall() {
  const { t } = useTranslation();
  const project = useStore((s) => s.project);
  const installed = useInstalled();
  const [systems, setSystems] = useState<{ name: string; title: string }[]>([]);
  const [pick, setPick] = useState<DesignSystemChoice>('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.projects().then((l) => setSystems(l.filter((p) => p.kind === 'design-system')), () => setSystems([]));
  }, []);
  const install = async (from: DesignSystemChoice) => {
    if (!project || !from) return;
    setBusy(true);
    try {
      const r = await api.installDs(project, from);
      toast(r.fonts.length ? t('panel.ds.installedWithFonts', { count: r.fonts.length }) : t('panel.ds.installed'));
      setPick('');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h3>{t('panel.ds.title')}</h3>
      {installed.map((x) => {
        const from = x.record.artifact.replace(/^projects\//, '');
        return (
          <div key={x.record.namespace} className="dsinst" data-ds={x.record.namespace}>
            <div className="dsi-t">
              <b>{x.record.title}</b>
              <span className="hint">
                {t('panel.ds.summary', { colors: x.tokens.colors.length, styles: x.tokens.groups.reduce((n, g) => n + g.styles.length, 0) })}
              </span>
            </div>
            <div className="dsi-sw">
              {x.tokens.colors.slice(0, 12).map((c) => (
                <span key={c.name} title={c.name} style={{ background: c.values[x.tokens.themes[0].id] }} />
              ))}
            </div>
            <div className="dsi-a">
              {systems.some((s) => s.name === from) && (
                <>
                  <a className="btn ghost" href={`?p=${encodeURIComponent(from)}`} target="_blank" rel="noreferrer">
                    {t('common.open')}
                  </a>
                  <button className="btn ghost" disabled={busy} onClick={() => install(from)} title={t('panel.ds.updateHint')}>
                    {t('panel.ds.update')}
                  </button>
                </>
              )}
              <button
                className="btn ghost danger"
                disabled={busy}
                onClick={async () => {
                  if (!project) return;
                  await api.uninstallDs(project, x.record.namespace).catch((e) => toast(e.message, 'error'));
                }}
              >
                {t('common.remove')}
              </button>
            </div>
          </div>
        );
      })}
      <div className="faceadd">
        <DesignSystemPicker value={pick} onChange={setPick} systems={systems} label={t('panel.ds.pickLabel')} placeholder={t('panel.ds.pickPlaceholder')} disabled={busy} />
        <button className="btn outline" disabled={!pick || busy} onClick={() => install(pick)}>
          {t('panel.ds.install')}
        </button>
      </div>
    </>
  );
}
