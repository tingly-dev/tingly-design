import i18next, { type i18n, type TFunction } from 'i18next';
import en from './locales/en';
import zh from './locales/zh';

export type { Locale } from './types';

/**
 * The languages the editor ships, and the one place that lists them: the language menu, the
 * browser and host detection, the server and the importer all read this list. Adding a language
 * is a row here plus a `locales/<code>/` folder typed `Locale<typeof en>`.
 *
 * The same library, key style (nested keys, `{{name}}` placeholders, `_one` / `_other` plurals)
 * and default language as Tingly Box's console, so a host passing its language through gets the
 * same answer. See .design/i18n.md.
 */
export const SUPPORTED_LANGUAGES = [
  // `label` is the language's own name: it is what a person looks for in a list of languages
  { code: 'en', label: 'English', model: 'English' },
  { code: 'zh', label: '中文', model: 'Simplified Chinese' },
] as const;

/** A message the server can refuse a request with (`errors.<key>`). */
export type ErrorKey = keyof typeof en.errors;

export type Language = (typeof SUPPORTED_LANGUAGES)[number]['code'];

export const DEFAULT_LANGUAGE: Language = 'en';

const CODES: readonly Language[] = SUPPORTED_LANGUAGES.map((l) => l.code);

export const resources = {
  en: { translation: en },
  zh: { translation: zh },
} as const;

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (CODES as readonly string[]).includes(value);
}

/**
 * Any language tag (`zh-CN`, `zh-Hans-TW`, `en_GB`, `ZH`) as one we ship, or null. Callers that
 * need an answer fall back to DEFAULT_LANGUAGE, so an unknown tag reads English rather than
 * whichever branch happened to be the else-case.
 */
export function matchLanguage(tag: string | null | undefined): Language | null {
  if (!tag) return null;
  const t = tag.trim().toLowerCase().replace('_', '-');
  return CODES.find((code) => t === code || t.startsWith(`${code}-`)) ?? null;
}

/** The first of a list of tags (an Accept-Language header, navigator.languages) that we ship. */
export function pickLanguage(tags: readonly (string | null | undefined)[]): Language | null {
  for (const tag of tags) {
    const hit = matchLanguage(tag?.split(';')[0]);
    if (hit) return hit;
  }
  return null;
}

/** The language's name as a model reads it in a prompt ("reply in Simplified Chinese"). */
export function modelLanguageName(lang: Language): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === lang)?.model ?? 'English';
}

/** The options every instance shares, the editor's React one included. */
export const I18N_OPTIONS = {
  resources,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: CODES as Language[],
  defaultNS: 'translation',
  // React and the HTML writers escape what they print themselves
  interpolation: { escapeValue: false },
  returnNull: false,
  initAsync: false,
} as const;

const instances = new Map<Language, i18n>();

/**
 * A translator for one language, for code outside React: the server answering a request, the
 * importer writing its report into a canvas, a new project's starter copy.
 */
export function translator(lang: Language = DEFAULT_LANGUAGE): TFunction {
  let inst = instances.get(lang);
  if (!inst) {
    inst = i18next.createInstance();
    void inst.init({ ...I18N_OPTIONS, lng: lang });
    instances.set(lang, inst);
  }
  return inst.t;
}

export type { TFunction };
