import type { FontFallbackConfig, FontEntry } from './font-fallback';
import { FontCharset } from '@embedpdf/models';

/**
 * Merge multiple {@link FontFallbackConfig} values (e.g. from several
 * `@embedpdf/fonts-*` `createFontFallback()` helpers) into one config.
 * Later configs win on overlapping charset keys.
 */
export function mergeFontFallbacks(...configs: Array<FontFallbackConfig | null | undefined>): FontFallbackConfig {
  const fonts: Partial<Record<FontCharset, FontEntry>> = {};

  for (const config of configs) {
    if (!config?.fonts) continue;
    Object.assign(fonts, config.fonts);
  }

  const merged: FontFallbackConfig = { fonts };

  // Prefer the last non-undefined defaultFont / baseUrl / fontLoader.
  for (let i = configs.length - 1; i >= 0; i--) {
    const config = configs[i];
    if (!config) continue;
    if (merged.defaultFont === undefined && config.defaultFont !== undefined) {
      merged.defaultFont = config.defaultFont;
    }
    if (merged.baseUrl === undefined && config.baseUrl !== undefined) {
      merged.baseUrl = config.baseUrl;
    }
    if (merged.fontLoader === undefined && config.fontLoader !== undefined) {
      merged.fontLoader = config.fontLoader;
    }
  }

  return merged;
}
