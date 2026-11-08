import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { docLookFromSystem, docRoleReport, type DocRoleKind, type DsTokens } from '@dc/core';
import { DocFrame } from './ReadmeDesigned';

const KINDS: DocRoleKind[] = ['color', 'text', 'space'];

/**
 * The design system's Doc page: a built-in sample document with every element a doc draws, worn by this system and
 * theme (what a doc that installs it will look like), and under it each doc role with the value the doc is drawn by and
 * whether the system gave it or it was derived (`docRoleReport`; .design/doc-design-system.md).
 */
export function DocView({ t, theme }: { t: DsTokens; theme: string }) {
  const { t: tr } = useTranslation();
  const sample = tr('ds.doc.sample');
  const lines = useMemo(() => docRoleReport(t, theme, docLookFromSystem(t, theme)), [t, theme]);
  const from = (f: string) => (f === 'doc' ? tr('ds.doc.fromDoc') : f === 'none' ? tr('ds.doc.fromNone') : tr('ds.doc.fromRole', { role: f }));
  return (
    <section className="dsview" aria-label={tr('ds.nav.doc')} data-testid="ds-doc">
      <p className="hint docintro">{tr('ds.doc.intro')}</p>
      <div className="dssection" data-designed="">
        <div className="readme-designed">
          <DocFrame markdown={sample} tokens={t} theme={theme} title={tr('ds.doc.frameTitle')} />
        </div>
      </div>
      <div className="dssection docroles">
        <h3>{tr('ds.doc.rolesTitle')}</h3>
        <p className="hint">{tr('ds.doc.rolesHint')}</p>
        {KINDS.map((kind) => (
          <div key={kind} className="rolegroup">
            <h4>{tr(`ds.doc.kind.${kind}`)}</h4>
            <table className="roletable">
              <tbody>
                {lines
                  .filter((l) => l.role.kind === kind)
                  .map((l) => (
                    <tr key={l.role.name} data-role={l.role.name} data-source={l.source}>
                      <td>
                        <code>{l.role.name}</code>
                      </td>
                      <td>
                        {kind === 'color' && <i className="rolesw" style={{ background: l.value }} />}
                        <code>{l.value}</code>
                      </td>
                      <td className={`rolesrc ${l.source}`}>{l.source === 'system' ? tr('ds.doc.given') : from(l.role.from)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  );
}
