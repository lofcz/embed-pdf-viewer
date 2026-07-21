/**
 * @embedpdf/fonts-hebrew
 *
 * Hebrew fallback fonts - Noto Sans Hebrew
 * 2 weights: Regular and Bold
 *
 * @packageDocumentation
 */

import { FontCharset, type FontFile, type FontPackageMeta } from '@embedpdf/models';

/**
 * Font files included in this package
 */
export const fonts: FontFile[] = [
  { file: 'NotoSansHebrew-Regular.ttf', weight: 400 },
  { file: 'NotoSansHebrew-Bold.ttf', weight: 700 },
];

/**
 * Package metadata
 */
export const fontsMeta: FontPackageMeta = {
  name: '@embedpdf/fonts-hebrew',
  fonts,
};

/**
 * Build a font-fallback config that serves fonts from this package (no CDN).
 * Pass the result to `PDFViewer` / `usePdfiumEngine` as `fontFallback`.
 */
export function createFontFallback() {
  return {
    fonts: {
      [FontCharset.HEBREW]: fonts.map((f) => ({
        url: new URL(/* @vite-ignore */ `../fonts/${f.file}`, import.meta.url).href,
        weight: f.weight,
        italic: f.italic,
      })),
    },
  };
}
