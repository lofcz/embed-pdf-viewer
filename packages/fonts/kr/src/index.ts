/**
 * @embedpdf/fonts-kr
 *
 * Korean (Hangeul) fallback fonts - Noto Sans KR
 * 7 weights: Thin (100) to Black (900)
 *
 * @packageDocumentation
 */

import { FontCharset, type FontFile, type FontPackageMeta } from '@embedpdf/models';

/**
 * Font files included in this package
 */
export const fonts: FontFile[] = [
  { file: 'NotoSansKR-Thin.otf', weight: 100 },
  { file: 'NotoSansKR-Light.otf', weight: 300 },
  { file: 'NotoSansKR-DemiLight.otf', weight: 350 },
  { file: 'NotoSansKR-Regular.otf', weight: 400 },
  { file: 'NotoSansKR-Medium.otf', weight: 500 },
  { file: 'NotoSansKR-Bold.otf', weight: 700 },
  { file: 'NotoSansKR-Black.otf', weight: 900 },
];

/**
 * Package metadata
 */
export const fontsMeta: FontPackageMeta = {
  name: '@embedpdf/fonts-kr',
  fonts,
};

/**
 * Build a font-fallback config that serves fonts from this package (no CDN).
 * Pass the result to `PDFViewer` / `usePdfiumEngine` as `fontFallback`.
 */
export function createFontFallback() {
  return {
    fonts: {
      [FontCharset.HANGEUL]: fonts.map((f) => ({
        url: new URL(/* @vite-ignore */ `../fonts/${f.file}`, import.meta.url).href,
        weight: f.weight,
        italic: f.italic,
      })),
    },
  };
}
