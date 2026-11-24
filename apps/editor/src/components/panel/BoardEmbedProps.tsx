import { useTranslation } from 'react-i18next';
import { attr, isBoardEmbedPath, isDashBundlePath, isLinkedPicture, boardTweaks, embedProps, parseDc, timeSpec, type DcElement } from '@dc/core';
import { display, editElement, useStore } from '../../store';
import { useLinkedRecords } from '../../linkedPages';
import { LinkedPanel } from './LinkedPanel';
import { TweakControl } from './OtherProps';

/**
 * A selected embed of an imported artboard (see .design/import-from-project.md): where it came from and
 * whether the canvas changed since (the shared linked page form, .design/cross-kind-embedding.md), and
 * the artboard's options as this embed sets them (`data-props`, over the artboard's own defaults).
 */
export function BoardEmbedProps({ file, el }: { file: string; el: DcElement }) {
  const { t } = useTranslation();
  const src = attr(el, 'src') ?? '';
  const source = useStore((s) => display(s, src));
  const linked = useLinkedRecords().some((r) => r.path === src);
  // a frozen dashboard has no tweaks: the linked page form says all there is
  if (isDashBundlePath(src)) return <LinkedPanel path={src} show={{ file, el }} />;
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

  return (
    <>
      <LinkedPanel path={src} show={{ file, el }} />
      <div className="sec bembed">
        <h3>{t('panel.embed.title')}</h3>
        {!linked && <span className="hint">{t('panel.embed.unknown')}</span>}
        {doc && timeSpec(doc.props) && <span className="hint">{t('panel.embed.moving')}</span>}
        {source === undefined && <span className="hint">{t('panel.embed.missing', { path: src })}</span>}
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
    </>
  );
}

/** Is this element an embed of an imported artboard or a frozen dashboard? */
export function isBoardEmbedEl(el: DcElement | undefined): el is DcElement {
  const src = el ? (attr(el, 'src') ?? '') : '';
  return !!el && el.tag === 'x-embed' && (isBoardEmbedPath(src) || isDashBundlePath(src));
}

/** Is this element a picture that is the copy of a linked page? */
export function isLinkedImgEl(el: DcElement | undefined): el is DcElement {
  return !!el && el.tag === 'img' && isLinkedPicture(attr(el, 'src') ?? '');
}
