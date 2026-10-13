/** i18next's plural suffixes (Intl.PluralRules categories). English needs `_one` and `_other`, Chinese only `_other`. */
type PluralSuffix = 'zero' | 'one' | 'two' | 'few' | 'many';
type Plural<K> = K extends `${string}_${PluralSuffix}` ? K : never;

/**
 * What another language's bundle must look like, given the English one: every key English has,
 * as a string, except the plural forms a language may not use (`x_one` in Chinese), which are
 * optional. A missing or misspelt key is then a type error, not a string that silently falls
 * back to English.
 */
export type Locale<T> = {
  [K in keyof T as K extends Plural<K> ? never : K]: T[K] extends string ? string : Locale<T[K]>;
} & {
  [K in keyof T as K extends Plural<K> ? K : never]?: string;
};
