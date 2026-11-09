import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { docOwnLook, type WechatIssue } from '@dc/core';
import { headlessActive } from '../../headless';
import { toast } from '../../store';
import { Dialog } from '../Dialog';
import { useInstalled } from '../ds/ds';
import { CHANNEL_LOOK, applyLook, currentDocLook, docThemeName, useDocLook } from './docLookState';
import { useDocs } from './docs';
import { copyWechat, prepareWechat, renderWechat, saveWechat, wechatPage, type WechatPrepared } from './wechatExport';

/**
 * "WeChat Official Account" in the doc's Import / Export menu: the article as the platform's editor
 * will get it, with what changed on the way above it and the one action that matters, Copy, below
 * (.design/wechat-export.md). The preview is our own picture of the paste, not the platform's.
 * What you see is what you get: the article is the doc as the editor shows it, in the design system and
 * theme the doc wears (.design/doc-design-system.md); there is no look of its own here. The command line
 * asks nothing: it gets the page as a file.
 */
type State = { name: string; scope: string | null; prepared: WechatPrepared | null; error?: string } | null;
let state: State = null;
const listeners = new Set<() => void>();
const set = (next: State) => {
  state = next;
  for (const fn of listeners) fn();
};
const subscribe = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn));

/** Open the preview of the doc (or of the tab `only`, titled `tabTitle`). */
export async function exportWechat(name: string, only?: string, tabTitle?: string): Promise<void> {
  if (headlessActive()) return saveWechat(renderWechat(await prepareWechat(only), currentDocLook().look), name);
  const mine: NonNullable<State> = { name, scope: only ? (tabTitle ?? only) : null, prepared: null };
  set(mine);
  try {
    const prepared = await prepareWechat(only);
    if (state === mine) set({ ...mine, prepared });
  } catch (e) {
    if (state === mine) set({ ...mine, error: (e as Error).message });
  }
}

function IssueLine({ issue }: { issue: WechatIssue }) {
  const { t } = useTranslation();
  switch (issue.kind) {
    case 'links':
      return <>{t('docs.wechat.links', { count: issue.count })}</>;
    case 'picture-missing':
      return <>{t('docs.wechat.pictureMissing', { path: issue.path })}</>;
    case 'picture-remote':
      return <>{t('docs.wechat.pictureRemote', { url: issue.url })}</>;
    case 'figure-missing':
      return <>{t('docs.wechat.figureMissing', { lang: issue.lang })}</>;
    case 'html-dropped':
      return <>{t('docs.wechat.htmlDropped')}</>;
  }
}

export function WechatPreview() {
  const value = useSyncExternalStore(subscribe, () => state);
  const { t } = useTranslation();
  const { look, worn } = useDocLook();
  const installed = useInstalled();
  if (!value) return null;
  const close = () => set(null);
  const doc = value.prepared ? renderWechat(value.prepared, look ?? docOwnLook()) : null;
  const wornName = worn ? docThemeName({ title: worn.title, themes: installed.find((x) => x.record.namespace === worn.system)?.tokens.themes ?? [] }, worn.theme) : '';
  return (
    <Dialog label={t('docs.wechat.title')} className="wechat-preview" onClose={close}>
      <div className="dialog-body" data-testid="wechat-preview">
        <div className="wp-head">
          <span className="wp-scope">{value.scope ? t('docs.wechat.scopeTab', { name: value.scope }) : t('docs.wechat.scopeDoc')}</span>
          <span className="wp-style" data-testid="wechat-style">
            <span>{worn ? t('docs.wechat.styleWorn', { name: wornName }) : t('docs.wechat.styleOwn')}</span>
            {!worn && (
              <button type="button" className="btn ghost sm" data-wechat-look="" onClick={() => void applyLook(CHANNEL_LOOK.wechat)}>
                {t('docs.wechat.useWechat')}
              </button>
            )}
            <button
              type="button"
              className="btn ghost sm"
              data-wechat-change=""
              onClick={() => {
                close();
                useDocs.setState({ themeAsked: true });
              }}
            >
              {t('docs.wechat.change')}
            </button>
          </span>
        </div>
        {value.error ? <p role="alert">{t('docs.wechat.failed', { message: value.error })}</p> : null}
        {!doc && !value.error ? <p role="status">{t('docs.wechat.preparing')}</p> : null}
        {doc ? (
          <>
            <ul className="wp-issues" data-testid="wechat-issues">
              {doc.issues.length ? (
                doc.issues.map((issue, i) => (
                  <li key={i}>
                    <IssueLine issue={issue} />
                  </li>
                ))
              ) : (
                <li className="ok">{t('docs.wechat.noIssues')}</li>
              )}
            </ul>
            <div className="wp-frame">
              <iframe title={t('docs.wechat.previewLabel')} sandbox="" srcDoc={wechatPage(doc.html, value.name)} />
            </div>
            <p className="wp-hint">{t('docs.wechat.hint')}</p>
            <div className="wp-actions">
              <button className="btn primary" onClick={() => void copyWechat(doc, value.name)}>
                {t('docs.wechat.copy')}
              </button>
              <button className="btn outline" onClick={() => (saveWechat(doc, value.name), toast(t('common.image.saved', { name: `${value.name}.html` })))}>
                {t('docs.wechat.save')}
              </button>
              <a className="btn ghost" href="https://mp.weixin.qq.com" target="_blank" rel="noreferrer">
                {t('docs.wechat.openMp')}
              </a>
            </div>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
