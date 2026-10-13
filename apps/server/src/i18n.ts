import type { Context } from 'hono';
import { DEFAULT_LANGUAGE, matchLanguage, modelLanguageName, pickLanguage, translator, type Language, type TFunction } from '@dc/i18n';

/** DC_LANG: the editor's language when neither the link nor the person chose one (a host passes its own). */
export const DC_LANG: Language | null = matchLanguage(process.env.DC_LANG);

/**
 * The language a request is answered in: the editor sends the one it is showing (`x-dc-lang`),
 * anything else (curl, a host) falls back to Accept-Language, DC_LANG, then English.
 */
export function langOf(c: Context): Language {
  return (
    matchLanguage(c.req.header('x-dc-lang')) ??
    pickLanguage((c.req.header('accept-language') ?? '').split(',')) ??
    DC_LANG ??
    DEFAULT_LANGUAGE
  );
}

export const trOf = (c: Context): TFunction => translator(langOf(c));

/**
 * Told to a model with every request: the editor's language, so what it says back (and copy it
 * invents) matches the screen unless the person wrote in another language.
 */
export function replyLanguage(lang: Language): string {
  const name = modelLanguageName(lang);
  return `The person's editor is in ${name}. Write what you say to them in the language of their request; if that is unclear, in ${name}. New placeholder copy you write into files follows the copy around it, else the same language.`;
}
