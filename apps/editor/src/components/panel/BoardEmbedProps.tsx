import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DECK_FILE, MOTION_FILE, attr, boardImportsOf, isBoardEmbedPath, boardTweaks, embedProps, parseDc, timeSpec, type DcElement } from '@dc/core';
import { api } from '../../api';
import { display, editElement, toast, useStore } from '../../store';
import { TweakControl } from './OtherProps';

/**
 * A selected embed of an imported artboard (see .design/import-from-project.md):
 * where it came from, the artboard's options as this embed sets them
 * (`data-props`, over the artboard's own defaults), and updating the copy from
 * the canvas it came from.
 */
export function BoardEmbedProps({ file, el }: { file: string; el: DcElement }) {
  const { t } = useTranslation();
  const src = attr(el, 'src') ?? '';
  const project = useStore((s) => s.project);
  const source = useStore((s) => display(s, src));
  const index = useStore((s) => display(s, s.kind === 'motion' ? MOTION_FILE : DECK_FILE));
  const [busy, setBusy] = useState(false);
  const record = (() => {
    try {
      return boardImportsOf(JSON.parse(index ?? '{}')).find((r) => r.path === src);
    } catch {
      return undefined;
    }
  })();
  const from = record?.from.replace(/^projects\//, '');
  const doc = source === undefined ? null : parseDc(source);
  const tweaks = doc ? boardTweaks(doc.props) : [];
  const set = embedProps(attr(el, 'data-props'));
  const write = (next: Record<string, unknown>) =>
    editElement(file, [{ kind: 'attr', tid: el.tid, name: 'data-props', value: Object.keys(next).length ? JSON.stringify(next) : null }]);
  const setOne = (name: string, value: unknown, fallback: unknown) => {
    const next = { ...set };
    if (JSON.stringify(value) === JSON.stringify(fallback)) delete next[name];
    else next[name] = value;
    write(next);
  };
  const update = async () => {
    if (!project || !record || !from) return;
    setBusy(true);
    try {
      await api.importBoard(project, from, record.board);
      toast(t('panel.embed.updated', { title: record.board.replace(/\.dc\.html$/, '') }));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sec bembed">
      <h3>{t('panel.embed.title')}</h3>
      <span className="hint">{record && from ? t('panel.embed.from', { board: record.board.replace(/\.dc\.html$/, ''), project: from }) : t('panel.embed.unknown')}</span>
      {doc && timeSpec(doc.props) && <span className="hint">{t('panel.embed.moving')}</span>}
      {source === undefined && <span className="hint">{t('panel.embed.missing', { path: src })}</span>}
      {record && from && (
        <div className="bembed-a">
          <a className="btn ghost" href={`?p=${encodeURIComponent(from)}`} target="_blank" rel="noreferrer">
            {t('panel.embed.open')}
          </a>
          <button className="btn ghost" disabled={busy} onClick={update} title={t('panel.embed.updateHint')}>
            {t('panel.embed.update')}
          </button>
        </div>
      )}
      {doc &&
        (tweaks.length ? (
          <>
            {tweaks.map(([k, spec]) => (
              <TweakControl key={k} name={k} spec={spec} value={k in set ? set[k] : spec.default} onSet={(v) => setOne(k, v, spec.default)} />
            ))}
            {Object.keys(set).length > 0 && (
              <button className="btn ghost" onClick={() => write({})} title={t('panel.embed.resetHint')}>
                {t('panel.embed.reset')}
              </button>
            )}
          </>
        ) : (
          <span className="hint">{t('panel.embed.noTweaks')}</span>
        ))}
    </div>
  );
}

/** Is this element an embed of an imported artboard? */
export function isBoardEmbedEl(el: DcElement | undefined): el is DcElement {
  return !!el && el.tag === 'x-embed' && isBoardEmbedPath(attr(el, 'src') ?? '');
}
