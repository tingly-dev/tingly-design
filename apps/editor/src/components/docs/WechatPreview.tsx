import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { WechatIssue } from '@dc/core';
import { headlessActive } from '../../headless';
import { t } from '../../i18n';
import { toast } from '../../store';
import { Dialog } from '../Dialog';
import { buildWechat, copyWechat, saveWechat, wechatPage, type WechatDoc } from './wechatExport';

/**
 * "WeChat Official Account" in the doc's Import / Export menu: the article as the platform's editor
 * will get it, drawn at a phone's width, with what changed on the way and the one action that matters,
 * Copy (.design/wechat-export.md). The preview is our own picture of the paste, not the platform's.
 * The command line asks nothing: it gets the page as a file.
 */
type State = { name: string; scope: string | null; doc: WechatDoc | null; error?: string } | null;
let state: State = null;
const listeners = new Set<() => void>();
const set = (next: State) => {
  state = next;
  for (const fn of listeners) fn();
};
const subscribe = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn));

/** Open the preview of the doc (or of the tab `only`, titled `tabTitle`). */
export async function exportWechat(name: string, only?: string, tabTitle?: string): Promise<void> {
  if (headlessActive()) return saveWechat(await buildWechat(only), name);
  const mine = { name, scope: only ? (tabTitle ?? only) : null, doc: null as WechatDoc | null };
  set(mine);
  try {
    const doc = await buildWechat(only);
    if (state === mine) set({ ...mine, doc });
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
  if (!value) return null;
  const close = () => set(null);
  const { doc } = value;
  return (
    <Dialog label={t('docs.wechat.title')} className="wechat-preview" onClose={close}>
      <div className="dialog-body" data-testid="wechat-preview">
        <p className="wp-scope">{value.scope ? t('docs.wechat.scopeTab', { name: value.scope }) : t('docs.wechat.scopeDoc')}</p>
        {value.error ? <p role="alert">{t('docs.wechat.failed', { message: value.error })}</p> : null}
        {!doc && !value.error ? <p role="status">{t('docs.wechat.preparing')}</p> : null}
        {doc ? (
          <div className="wp-body">
            <div className="wp-phone">
              <iframe title={t('docs.wechat.previewLabel')} sandbox="" srcDoc={wechatPage(doc.html, value.name)} />
            </div>
            <div className="wp-side">
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
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
