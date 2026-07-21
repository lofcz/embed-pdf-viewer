/**
 * @embedpdf/fonts-jp
 *
 * Japanese (Shift-JIS) fallback fonts - Noto Sans JP
 * 7 weights: Thin (100) to Black (900)
 *
 * @packageDocumentation
 */

import { FontCharset, type FontFile, type FontPackageMeta } from '@embedpdf/models';

/**
 * Font files included in this package
 */
export const fonts: FontFile[] = [
  { file: 'NotoSansJP-Thin.otf', weight: 100 },
  { file: 'NotoSansJP-Light.otf', weight: 300 },
  { file: 'NotoSansJP-DemiLight.otf', weight: 350 },
  { file: 'NotoSansJP-Regular.otf', weight: 400 },
  { file: 'NotoSansJP-Medium.otf', weight: 500 },
  { file: 'NotoSansJP-Bold.otf', weight: 700 },
  { file: 'NotoSansJP-Black.otf', weight: 900 },
];

/**
 * Package metadata
 */
export const fontsMeta: FontPackageMeta = {
  name: '@embedpdf/fonts-jp',
  fonts,
};

/**
 * Build a font-fallback config that serves fonts from this package (no CDN).
 * Pass the result to `PDFViewer` / `usePdfiumEngine` as `fontFallback`.
 */
export function createFontFallback() {
  return {
    fonts: {
      [FontCharset.SHIFTJIS]: fonts.map((f) => ({
        url: new URL(/* @vite-ignore */ `../fonts/${f.file}`, import.meta.url).href,
        weight: f.weight,
        italic: f.italic,
      })),
    },
  };
}
