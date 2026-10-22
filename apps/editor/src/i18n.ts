/**
 * The editor's language. Strings live in @dc/i18n (shared with the server and the importer);
 * this file decides which language is showing and keeps the host told.
 *
 * At start-up, the first of these that names a language we ship wins: a `?lang=` URL parameter
 * (kept for the tab, the way `?theme=` is), the person's own pick in the appearance menu, the
 * server's DC_LANG, the browser's languages, then English. After start-up the newest of the
 * menu, `window.tinglyDesign.setLanguage()` and a host's `tingly-design:set-language` wins.
 * See .design/i18n.md and docs/en/embedding.md.
 */

import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LANGUAGE, I18N_OPTIONS, SUPPORTED_LANGUAGES, isLanguage, matchLanguage, pickLanguage, type Language } from '@dc/i18n';

export { SUPPORTED_LANGUAGES, type Language };

export type LanguageSource = 'default' | 'browser' | 'server' | 'saved' | 'url' | 'host';

const PICK_KEY = 'dc.lang';
const SESSION_KEY = 'dc.lang.session';

const read = (store: () => Storage, k: string) => {
  try {
    return store().getItem(k);
  } catch {
    return null;
  }
};
const write = (store: () => Storage, k: string, v: string | null) => {
  try {
    if (v === null) store().removeItem(k);
    else store().setItem(k, v);
  } catch {
    // private mode: the language still applies, it just isn't remembered
  }
};

function startLanguage(): { lang: Language; source: LanguageSource } {
  const fromUrl = matchLanguage(new URLSearchParams(location.search).get('lang'));
  if (fromUrl) write(() => sessionStorage, SESSION_KEY, fromUrl);
  const session = read(() => sessionStorage, SESSION_KEY);
  if (isLanguage(session)) return { lang: session, source: 'url' };
  const saved = read(() => localStorage, PICK_KEY);
  if (isLanguage(saved)) return { lang: saved, source: 'saved' };
  const browser = pickLanguage(navigator.languages?.length ? navigator.languages : [navigator.language]);
  return browser ? { lang: browser, source: 'browser' } : { lang: DEFAULT_LANGUAGE, source: 'default' };
}

const start = startLanguage();
let source: LanguageSource = start.source;

void i18next.use(initReactI18next).init({ ...I18N_OPTIONS, lng: start.lang });

/** For code outside components (store actions, toasts, files the editor writes). Components use `useTranslation()`. */
export const t = i18next.t.bind(i18next);

export const currentLanguage = (): Language => (isLanguage(i18next.language) ? i18next.language : DEFAULT_LANGUAGE);
/** The language as an HTML lang tag, for <html lang> and the sandboxed frames. */
export const htmlLang = (lang: Language = currentLanguage()): string => (lang === 'zh' ? 'zh-CN' : lang);

function apply(lang: Language, from: LanguageSource): void {
  source = from;
  document.documentElement.lang = htmlLang(lang);
  if (lang !== i18next.language) void i18next.changeLanguage(lang);
  if (window.parent !== window) window.parent.postMessage({ type: 'tingly-design:language-changed', language: lang }, '*');
}

/** The person picked one in the appearance menu: remember it, and drop a language the URL brought. */
export function chooseLanguage(lang: Language): void {
  write(() => localStorage, PICK_KEY, lang);
  write(() => sessionStorage, SESSION_KEY, null);
  apply(lang, 'saved');
}

/** A host or script set it: applies now, not remembered. Accepts any tag (`zh-CN`); unknown ones are ignored. */
export function setLanguage(tag: string): Language | null {
  const lang = matchLanguage(tag);
  if (lang) apply(lang, 'host');
  return lang;
}

/** The server's DC_LANG, used only when neither the URL nor the person chose. */
export function serverLanguage(tag: unknown): void {
  if (source !== 'default' && source !== 'browser') return;
  const lang = typeof tag === 'string' ? matchLanguage(tag) : null;
  if (lang) apply(lang, 'server');
}

export function initLanguage(): void {
  document.documentElement.lang = htmlLang(start.lang);
  // an embedding host (Tingly Box, say) hands its language down
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent && e.source !== window.opener) return;
    const d = e.data as { type?: string; language?: unknown } | null;
    if (d?.type === 'tingly-design:set-language' && typeof d.language === 'string') setLanguage(d.language);
  });
  const api = ((window as unknown as { tinglyDesign?: object }).tinglyDesign ??= {}) as Record<string, unknown>;
  api.setLanguage = setLanguage;
  api.getLanguage = () => ({ language: currentLanguage(), source });
  api.languages = () => SUPPORTED_LANGUAGES.map(({ code, label }) => ({ code, label }));
}
