import { translate } from './translate';
import type { I18nState, Locale } from './types';

const EMPTY_LOCALES: readonly Locale[] = [];

/**
 * Translate a key against locale packs without a kernel — for boot copy that
 * renders before (or outside) the i18n plugin. Same lookup as `t()`:
 * `defaultLocale` → fallback locale `'en'` → `fallback` → the key.
 */
export function getStaticTranslation(
  locales: readonly Locale[],
  defaultLocale: string,
  key: string,
  fallback?: string,
): string {
  const byCode: Record<string, Locale> = {};
  for (const locale of locales) byCode[locale.code] = locale;
  const state: I18nState = {
    locale: defaultLocale,
    fallbackLocale: 'en',
    locales: byCode,
    loading: null,
  };
  return translate(state, key, fallback !== undefined ? { fallback } : undefined).text;
}

/**
 * Bind `getStaticTranslation` to a pack list. Same signature as v2's hook;
 * this package is DOM-free so the helper is pure (not a React hook). Call it
 * at render time or wrap it in `useCallback` / `useMemo` at a React boundary.
 */
export function useStaticTranslation(config?: {
  locales?: readonly Locale[];
  defaultLocale?: string;
}): (key: string, fallback?: string) => string {
  const locales = config?.locales ?? EMPTY_LOCALES;
  const defaultLocale = config?.defaultLocale ?? 'en';
  return (key, fallback) => getStaticTranslation(locales, defaultLocale, key, fallback);
}
